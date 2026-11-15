/**
 * Server-side page URL lookup through Experience Edge (preview).
 *
 * SERVER ONLY. Used by the route handlers under `app/api/sitecore/`.
 *
 * The Authoring API knows item paths but not the public URL of a page, so the
 * site-relative URL comes from Edge, the same source the website itself uses
 * for its links. Edge preview is addressed with a context id in the query
 * string and needs no OAuth token, so this works even when the Marketplace app
 * has no API access.
 *
 * If no context id is configured, or Edge cannot answer, the caller falls back
 * to deriving a route from the item path and warns the author.
 */

import { fileExtensionFromUrl } from "@/lib/item-id";

const EDGE_URL = (
  process.env.SITECORE_EDGE_URL || "https://edge-platform.sitecorecloud.io"
).replace(/\/+$/, "");

const CONTEXT_ID = (
  process.env.SITECORE_PREVIEW_CONTEXT_ID ||
  process.env.NEXT_PUBLIC_SITECORE_PREVIEW_CONTEXT_ID ||
  ""
).trim();

export function isEdgeConfigured(): boolean {
  return Boolean(CONTEXT_ID);
}

/**
 * Edge declares `language` as non-null, so the variable must be declared
 * `String!` and always carry a value. Declaring it nullable makes the whole
 * query fail validation.
 */
const PAGE_URL_QUERY = `
  query GridComposerPageUrl($path: String!, $language: String!) {
    item(path: $path, language: $language) {
      id
      url {
        path
      }
    }
  }
`;

/** Language used when the editing context does not report one. */
const DEFAULT_LANGUAGE = "en";

interface EdgeEnvelope {
  data?: {
    item?: { url?: { path?: string | null } | null } | null;
  };
  errors?: Array<{ message?: string }>;
}

/**
 * Resolve the site-relative URL of a page.
 * `itemId` may be a plain or braced GUID; Edge accepts it as the item path.
 * Returns null when Edge is not configured or cannot answer.
 */
export async function resolvePageUrlFromEdge(
  itemId: string,
  language?: string
): Promise<string | null> {
  if (!isEdgeConfigured() || !itemId) return null;

  try {
    const res = await fetch(
      `${EDGE_URL}/content/api/graphql/v1?sitecoreContextId=${encodeURIComponent(CONTEXT_ID)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: PAGE_URL_QUERY,
          variables: { path: itemId, language: language || DEFAULT_LANGUAGE },
        }),
        cache: "no-store",
      }
    );

    if (!res.ok) {
      console.warn(
        `[sitecore-edge] Preview request failed (HTTP ${res.status}).`
      );
      return null;
    }

    const envelope = (await res.json()) as EdgeEnvelope;
    if (envelope.errors?.length) {
      console.warn("[sitecore-edge] GraphQL errors:", envelope.errors);
    }

    const path = envelope.data?.item?.url?.path;
    return typeof path === "string" && path.trim() ? path.trim() : null;
  } catch (err) {
    console.warn("[sitecore-edge] Could not resolve the page URL:", err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Media items                                                                */
/* -------------------------------------------------------------------------- */

export interface EdgeMedia {
  /** Site-relative media URL, for example `/-/media/Brochure.pdf`. */
  url: string;
  extension?: string;
}

/**
 * Resolve a media item's URL through Edge preview.
 *
 * Media items answer the same `url { path }` query that pages do, returning
 * a site-relative media handler path. That path is what gets inserted, so a
 * link keeps working when the content is published to another environment.
 *
 * Returns null when Edge is not configured, cannot answer, or the item is not
 * a media file.
 */
export async function resolveMediaFromEdge(
  itemId: string,
  language?: string
): Promise<EdgeMedia | null> {
  const path = await resolvePageUrlFromEdge(itemId, language);
  if (!path || !path.startsWith("/-/")) return null;

  return { url: path, extension: fileExtensionFromUrl(path) };
}
