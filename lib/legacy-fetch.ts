/**
 * Fetches legacy "dynamic table" data (row_/column_ child items) via the
 * Sitecore Marketplace SDK and converts it to the current TableData format.
 *
 * Used when the Grid Composer field is empty: that means the item still holds
 * its table as child items (see lib/legacy-table.ts for the structure), so we
 * read those items through the Authoring GraphQL API and migrate them.
 *
 * NOTE: Two things depend on the host/schema and may need tuning for your
 * environment (both are isolated below and logged when they fail):
 *   1. Extracting the current item id/language from `pages.context`.
 *   2. The Authoring GraphQL shape for `children` / the cell field name.
 */

import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { TableData } from "./types/table";
import { getPreviewContextId } from "./sitecore-pages";
import {
  LegacyRowItem,
  convertLegacyTableToTableData,
  LegacyConversionOptions,
} from "./legacy-table";

/** Name of the field on each `column_NN` item that holds the cell content. */
const CELL_CONTENT_FIELD = "Content";

interface LegacyFetchOptions extends LegacyConversionOptions {
  /** Override the cell content field name (defaults to "Content"). */
  contentFieldName?: string;
}

/** Best-effort extraction of the current item id from the pages context. */
function extractItemId(ctx: unknown): string | undefined {
  const c = ctx as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== "object") return undefined;
  const candidates = [
    c.itemId,
    c.id,
    (c.item as Record<string, unknown> | undefined)?.id,
    (c.route as Record<string, unknown> | undefined)?.itemId,
  ];
  return candidates.find((v): v is string => typeof v === "string" && !!v);
}

/** Best-effort extraction of the current language from the pages context. */
function extractLanguage(ctx: unknown): string | undefined {
  const c = ctx as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== "object") return undefined;
  const candidates = [
    c.language,
    c.itemLanguage,
    (c.item as Record<string, unknown> | undefined)?.language,
  ];
  return candidates.find((v): v is string => typeof v === "string" && !!v);
}

/** Normalize a GraphQL "children" value that may be a list or a { nodes } connection. */
function childNodes(children: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(children)) return children as Array<Record<string, unknown>>;
  const nodes = (children as Record<string, unknown> | undefined)?.nodes;
  return Array.isArray(nodes) ? (nodes as Array<Record<string, unknown>>) : [];
}

/** Read a named field value from an item node (supports `field` or `fields[]`). */
function readFieldValue(
  itemNode: Record<string, unknown>,
  fieldName: string
): string {
  // Shape A: aliased single field -> { cellContent: { value } }
  const single = itemNode.cellContent as Record<string, unknown> | undefined;
  if (single && typeof single.value === "string") return single.value;

  // Shape B: fields list -> { fields: [{ name, value }] } or { fields: { nodes: [...] } }
  const list = childNodes(itemNode.fields);
  const match = list.find(
    (f) => (f.name as string)?.toLowerCase() === fieldName.toLowerCase()
  );
  return typeof match?.value === "string" ? match.value : "";
}

/**
 * Load and convert the legacy child-item table for the current item.
 * Returns null if there is no context, no children, or anything goes wrong
 * (caller should then fall back to an empty table).
 */
export async function loadLegacyTable(
  client: ClientSDK,
  options: LegacyFetchOptions = {}
): Promise<TableData | null> {
  const contentFieldName = options.contentFieldName ?? CELL_CONTENT_FIELD;

  try {
    // 1) Preview context id (required for authoring GraphQL). Shares the
    //    lookup with the internal link picker: granted resource access first,
    //    then the NEXT_PUBLIC_SITECORE_PREVIEW_CONTEXT_ID build-time fallback.
    const appRes = await client.query("application.context");
    const previewContextId = getPreviewContextId(appRes?.data);
    if (!previewContextId) {
      console.warn("[legacy] No preview context id; cannot query children.");
      return null;
    }

    // 2) Current item id + language from the pages context.
    const pagesRes = await client.query("pages.context");
    const pagesCtx = pagesRes?.data;
    const itemId = extractItemId(pagesCtx);
    const language = extractLanguage(pagesCtx);
    if (!itemId) {
      console.warn(
        "[legacy] Could not determine current item id from pages.context:",
        pagesCtx
      );
      return null;
    }

    // 3) Query the item's children (rows) and their children (columns) with
    //    the cell content field. `item(path:)` accepts an item id.
    // The Authoring/Management GraphQL schema uses list-style selections
    // (e.g. `fields { name value }`), so `children` is selected as a list.
    // The parser below (childNodes) also tolerates a `{ nodes }` connection
    // shape in case your endpoint differs.
    const query = `
      query GetLegacyTable($path: String!, $language: String) {
        item(path: $path, language: $language) {
          id
          name
          children {
            name
            children {
              name
              cellContent: field(name: "${contentFieldName}") { value }
            }
          }
        }
      }
    `;

    const gqlRes = await client.mutate("xmc.authoring.graphql", {
      params: {
        query: { sitecoreContextId: previewContextId },
        body: { query, variables: { path: itemId, language } },
      },
    });

    // The authoring endpoint returns a standard GraphQL envelope.
    const envelope = (gqlRes?.data ?? {}) as {
      data?: { item?: Record<string, unknown> };
      errors?: unknown;
    };
    if (envelope.errors) {
      console.warn("[legacy] GraphQL errors:", envelope.errors);
    }
    const item = envelope.data?.item;
    if (!item) {
      console.warn("[legacy] No item returned for id", itemId);
      return null;
    }

    // 4) Map GraphQL nodes -> LegacyRowItem[].
    const rowNodes = childNodes(item.children);
    if (rowNodes.length === 0) {
      // No legacy child rows -> nothing to migrate.
      return null;
    }

    const legacyRows: LegacyRowItem[] = rowNodes.map((rowNode) => ({
      name: (rowNode.name as string) ?? "",
      columns: childNodes(rowNode.children).map((colNode) => ({
        name: (colNode.name as string) ?? "",
        content: readFieldValue(colNode, contentFieldName),
      })),
    }));

    // Guard: if there are rows but none have any columns, treat as no data.
    if (legacyRows.every((r) => r.columns.length === 0)) {
      return null;
    }

    return convertLegacyTableToTableData(legacyRows, options);
  } catch (err) {
    console.error("[legacy] Failed to load/convert legacy table:", err);
    return null;
  }
}
