/**
 * Sitecore page lookups for the "Insert internal link" picker.
 *
 * There are two ways to reach Sitecore, tried in that order:
 *
 * 1. The Marketplace SDK. The Pages host proxies each call and signs it with
 *    the app's own credentials, which exist only once the app has been granted
 *    API access in the Sitecore Cloud Portal. The site tree comes from the XM
 *    Cloud Pages API and page URLs from the Experience Edge preview endpoint,
 *    so what authors see matches the Pages app and the live website.
 *
 * 2. This app's own server routes under `/api/sitecore`. They authenticate
 *    with an automation client created in XM Cloud Deploy and read the
 *    Authoring API directly. This is the fallback for deployments where the
 *    Marketplace grant is missing, and it keeps the picker usable until that
 *    is sorted out.
 *
 * The chosen source is reported back so the UI can show it and so follow-up
 * calls stay on the same one.
 */

import type {
  ApplicationContext,
  ClientSDK,
} from "@sitecore-marketplace-sdk/client";
import type { Xmapp } from "@sitecore-marketplace-sdk/xmc";
import {
  fileExtensionFromUrl,
  itemIdKey,
  sameItemId,
  toGuid,
} from "./item-id";

export { fileExtensionFromUrl, itemIdKey, sameItemId, toGuid };

/** Which backend answered. */
export type PageSource = "marketplace" | "server";

/** A node of the site's page tree (a page, a folder or the site root). */
export interface SitecorePageNode {
  /** Item id, normalised to 32 lower-case hex characters. */
  id: string;
  name: string;
  displayName: string;
  /** Item path, normalised to start with a slash. */
  path: string;
  /** `undefined` when the API did not say – the node may still be expandable. */
  hasChildren?: boolean;
  /** False for the site root and for folders – those cannot be linked to. */
  hasPresentation: boolean;
  parentId?: string;
  /** Template name when the API supplied it. Used to spot media folders. */
  templateName?: string;
}

/** Where the URL of a picked page came from. */
export type PageUrlSource = "edge" | "derived";

/** What the picker hands back once the author confirms an item. */
export interface SelectedInternalPage {
  id: string;
  name: string;
  displayName: string;
  path: string;
  /** URL to use as the anchor href. Site-relative for pages. */
  url: string;
  urlSource: PageUrlSource;
  /** Whether a page or a media library file was picked. */
  kind: PickerKind;
  /** File extension, when the media lookup reported one. */
  extension?: string;
}

/** The two trees the picker can browse. */
export type PickerKind = "page" | "media";

/** Everything the lookups need about the current editing session. */
export interface PagePickerContext {
  /** Preview context id, present only when the host granted resource access. */
  contextId?: string;
  siteId?: string;
  siteName?: string;
  language?: string;
  currentPageId?: string;
  currentPagePath?: string;
  currentPageRoute?: string;
}

/** The top of the site tree plus any children already loaded. */
export interface SiteTree {
  roots: SitecorePageNode[];
  childrenById: Record<string, SitecorePageNode[]>;
  source: PageSource;
}

/** Thrown when the deployment has no server credentials configured. */
export class ServerFallbackUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerFallbackUnavailableError";
  }
}

const MISSING_GRANT_MESSAGE =
  "The app has no API access to an XM Cloud environment. In the Sitecore Cloud Portal open the app under Developer Studio > Marketplace apps, add the XM Cloud environment under API access, save, then update the installed app's permissions and reload Pages.";

function normalizeItemPath(path: string | null | undefined): string {
  const trimmed = (path ?? "").trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  return "/" + trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0
  );
}

/**
 * Preview context id granted to the app (see `application.context`).
 * Every granted resource is checked and the deprecated `resources` list is
 * accepted too, since older hosts still populate it.
 */
export function getPreviewContextId(
  appContext: ApplicationContext | null | undefined
): string | undefined {
  const granted = [
    ...(appContext?.resourceAccess ?? []),
    ...(appContext?.resources ?? []),
  ];
  for (const resource of granted) {
    const preview = firstString(
      resource?.context?.preview,
      resource?.contextId
    );
    if (preview) return preview;
  }
  return undefined;
}

/**
 * Collect the site, page and language of the current editing session.
 * Missing resource access is not an error here: the server fallback does not
 * need it, and the Marketplace path reports it later with a clear message.
 */
export async function loadPagePickerContext(
  client: ClientSDK,
  appContext: ApplicationContext
): Promise<PagePickerContext> {
  const contextId = getPreviewContextId(appContext);
  if (!contextId) {
    console.warn(
      "[internal-link] application.context has no XM Cloud resource access:",
      appContext
    );
  }

  const res = await client.query("pages.context");
  if (res.error) {
    throw new Error(`Could not read the Pages context: ${res.error.message}`);
  }

  const siteInfo = res.data?.siteInfo;
  const pageInfo = res.data?.pageInfo;

  return {
    contextId,
    siteId: firstString(siteInfo?.id),
    siteName: firstString(siteInfo?.displayName, siteInfo?.name),
    language: firstString(pageInfo?.language, siteInfo?.languages?.[0]),
    currentPageId: firstString(pageInfo?.id, pageInfo?.itemId),
    currentPagePath: firstString(pageInfo?.path),
    currentPageRoute: firstString(pageInfo?.route),
  };
}

/* -------------------------------------------------------------------------- */
/* Marketplace SDK source                                                     */
/* -------------------------------------------------------------------------- */

/** Shape shared by every `client.query("xmc.*")` result we care about. */
interface SdkQueryResult<T> {
  data?: { data?: T; error?: unknown; response?: { status?: number } };
  error?: Error;
}

function describeProblem(problem: unknown): string {
  if (problem && typeof problem === "object") {
    const p = problem as {
      title?: unknown;
      detail?: unknown;
      message?: unknown;
      status?: unknown;
    };
    const parts = [p.title, p.detail, p.message].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (parts.length > 0) {
      const status = typeof p.status === "number" ? ` (HTTP ${p.status})` : "";
      return parts.join(" – ") + status;
    }
    try {
      return JSON.stringify(problem).slice(0, 300);
    } catch {
      /* fall through */
    }
  }
  return String(problem);
}

/** Turn an SDK query result into its payload or a readable error. */
function unwrap<T>(res: SdkQueryResult<T>, what: string): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  if (res.data?.error) {
    throw new Error(`${what} failed: ${describeProblem(res.data.error)}`);
  }
  const data = res.data?.data;
  if (data === undefined || data === null) {
    throw new Error(`${what} returned no data.`);
  }
  return data;
}

function fromPagesApi(page: Xmapp.PageResponse): SitecorePageNode | null {
  const id = typeof page.id === "string" ? page.id.trim() : "";
  if (!id) return null;
  const name = page.name ?? "";
  return {
    id: itemIdKey(id),
    name,
    displayName: page.displayName || name || id,
    path: normalizeItemPath(page.path),
    hasChildren:
      typeof page.hasChildren === "boolean"
        ? page.hasChildren
        : (page.children?.length ?? 0) > 0
          ? true
          : undefined,
    hasPresentation: page.hasPresentation !== false,
    parentId: page.parentId ?? undefined,
  };
}

function fromPagesApiList(
  pages: Xmapp.PageResponse[] | null | undefined
): SitecorePageNode[] {
  return (pages ?? [])
    .map(fromPagesApi)
    .filter((node): node is SitecorePageNode => node !== null);
}

/** Store any nested `children` the API returned so they need no extra call. */
function collectPreloadedChildren(
  pages: Xmapp.PageResponse[] | null | undefined,
  into: Record<string, SitecorePageNode[]>
): void {
  for (const page of pages ?? []) {
    if (!page?.id || !Array.isArray(page.children)) continue;
    into[itemIdKey(page.id)] = fromPagesApiList(page.children);
    collectPreloadedChildren(page.children, into);
  }
}

async function fetchMarketplaceTree(
  client: ClientSDK,
  ctx: PagePickerContext
): Promise<SiteTree> {
  const res = await client.query("xmc.xmapp.retrieveSiteHierarchy", {
    params: {
      path: { siteId: ctx.siteId as string },
      query: { sitecoreContextId: ctx.contextId, language: ctx.language },
    },
  });
  const hierarchy = unwrap<Xmapp.PageHierarchy>(res, "Loading the site tree");

  const childrenById: Record<string, SitecorePageNode[]> = {};
  const home = hierarchy.page ? fromPagesApi(hierarchy.page) : null;
  const roots: SitecorePageNode[] = [];

  if (home) {
    roots.push(home);
    if (Array.isArray(hierarchy.children)) {
      childrenById[home.id] = fromPagesApiList(hierarchy.children);
      collectPreloadedChildren(hierarchy.children, childrenById);
    }
  }

  for (const sibling of fromPagesApiList(hierarchy.siblings)) {
    if (!roots.some((root) => sameItemId(root.id, sibling.id))) {
      roots.push(sibling);
    }
  }
  collectPreloadedChildren(hierarchy.siblings, childrenById);

  if (roots.length === 0) {
    roots.push(...fromPagesApiList(hierarchy.children));
    collectPreloadedChildren(hierarchy.children, childrenById);
  }

  return { roots, childrenById, source: "marketplace" };
}

async function fetchMarketplaceChildren(
  client: ClientSDK,
  ctx: PagePickerContext,
  pageId: string
): Promise<SitecorePageNode[]> {
  const res = await client.query("xmc.xmapp.listPageChildren", {
    params: {
      path: { siteId: ctx.siteId as string, pageId },
      query: { sitecoreContextId: ctx.contextId, language: ctx.language },
    },
  });
  return fromPagesApiList(
    unwrap<Xmapp.PageResponse[]>(res, "Loading child pages")
  );
}

/* -------------------------------------------------------------------------- */
/* Server route source                                                        */
/* -------------------------------------------------------------------------- */

interface AuthoringItemDto {
  itemId: string;
  name: string;
  path: string;
  displayName?: string;
  hasChildren?: boolean;
  hasPresentation?: boolean;
  template?: { name?: string } | null;
}

function fromAuthoringItem(item: AuthoringItemDto): SitecorePageNode | null {
  const id = itemIdKey(item?.itemId);
  if (!id) return null;
  return {
    id,
    name: item.name ?? "",
    displayName: item.displayName || item.name || id,
    path: normalizeItemPath(item.path),
    hasChildren:
      typeof item.hasChildren === "boolean" ? item.hasChildren : undefined,
    // The field is optional in the schema; when absent, let the author decide.
    hasPresentation: item.hasPresentation !== false,
    templateName: item.template?.name ?? undefined,
  };
}

async function readServerTree(
  path: string
): Promise<{ item: SitecorePageNode | null; children: SitecorePageNode[] }> {
  const res = await fetch(
    `/api/sitecore/tree?path=${encodeURIComponent(path)}`,
    { cache: "no-store" }
  );

  let body: { item?: AuthoringItemDto; children?: AuthoringItemDto[]; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }

  if (res.status === 501) {
    throw new ServerFallbackUnavailableError(
      body.error ?? "Server credentials are not configured."
    );
  }
  if (!res.ok) {
    throw new Error(body.error ?? `Reading the content tree failed (HTTP ${res.status}).`);
  }

  return {
    item: body.item ? fromAuthoringItem(body.item) : null,
    children: (body.children ?? [])
      .map(fromAuthoringItem)
      .filter((node): node is SitecorePageNode => node !== null),
  };
}

async function fetchServerTree(ctx: PagePickerContext): Promise<SiteTree> {
  const rootPath = inferSiteRootPath(ctx);
  const { item, children } = await readServerTree(rootPath);

  if (!item) {
    throw new Error(`No item was found at ${rootPath}.`);
  }

  return {
    roots: [item],
    childrenById: { [item.id]: children },
    source: "server",
  };
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Load the top of the site tree, preferring the Marketplace SDK and falling
 * back to this app's own server routes.
 */
export async function fetchSiteTree(
  client: ClientSDK,
  ctx: PagePickerContext
): Promise<SiteTree> {
  let marketplaceError: Error | null = null;

  if (ctx.contextId && ctx.siteId) {
    try {
      return await fetchMarketplaceTree(client, ctx);
    } catch (err) {
      marketplaceError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        "[internal-link] The Marketplace path failed, trying the server route:",
        marketplaceError
      );
    }
  } else {
    marketplaceError = new Error(MISSING_GRANT_MESSAGE);
  }

  try {
    return await fetchServerTree(ctx);
  } catch (err) {
    // No server credentials: the Marketplace problem is the one to report.
    if (err instanceof ServerFallbackUnavailableError) {
      throw marketplaceError ?? err;
    }
    throw err;
  }
}

/** Load the direct children of a node from whichever source is in use. */
export async function fetchPageChildren(
  client: ClientSDK,
  ctx: PagePickerContext,
  node: SitecorePageNode,
  source: PageSource
): Promise<SitecorePageNode[]> {
  if (source === "marketplace") {
    return fetchMarketplaceChildren(client, ctx, node.id);
  }
  const { children } = await readServerTree(node.path);
  return children;
}

/* -------------------------------------------------------------------------- */
/* Media library                                                              */
/* -------------------------------------------------------------------------- */

const MEDIA_LIBRARY_ROOT = "/sitecore/media library";

/**
 * Same query the server route runs, for use through the Marketplace SDK when
 * the app does have API access. The Pages API cannot browse media, so the
 * Authoring API is used for both sources here.
 */
const AUTHORING_TREE_QUERY = `
  query GridComposerTree($path: String!) {
    item(where: { path: $path }) {
      itemId
      name
      path
      displayName
      hasChildren
      template { name }
      children {
        nodes {
          itemId
          name
          path
          displayName
          hasChildren
          template { name }
        }
      }
    }
  }
`;

interface AuthoringTreeBody {
  data?: {
    item?:
      | (AuthoringItemDto & { children?: { nodes?: AuthoringItemDto[] } | null })
      | null;
  };
  errors?: Array<{ message?: string }>;
}

interface TreeLevel {
  item: SitecorePageNode | null;
  children: SitecorePageNode[];
}

function toNodes(items: AuthoringItemDto[] | null | undefined): SitecorePageNode[] {
  return (items ?? [])
    .map(fromAuthoringItem)
    .filter((node): node is SitecorePageNode => node !== null);
}

/** Read one level of the tree through the Marketplace SDK's Authoring API. */
async function readAuthoringTreeViaSdk(
  client: ClientSDK,
  ctx: PagePickerContext,
  path: string
): Promise<TreeLevel> {
  const result = (await client.mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId: ctx.contextId },
      body: { query: AUTHORING_TREE_QUERY, variables: { path } },
    },
  })) as unknown as { data?: AuthoringTreeBody; error?: unknown } | undefined;

  if (result?.error) {
    throw new Error(`Reading ${path} failed: ${describeProblem(result.error)}`);
  }
  const errors = (result?.data?.errors ?? [])
    .map((e) => e.message)
    .filter((m): m is string => Boolean(m));
  if (errors.length > 0) {
    throw new Error(errors.join(" | "));
  }

  const item = result?.data?.data?.item;
  if (!item) throw new Error(`No item was found at ${path}.`);

  return {
    item: fromAuthoringItem(item),
    children: toNodes(item.children?.nodes),
  };
}

async function readMediaLevel(
  client: ClientSDK,
  ctx: PagePickerContext,
  path: string,
  source: PageSource
): Promise<TreeLevel> {
  return source === "marketplace"
    ? readAuthoringTreeViaSdk(client, ctx, path)
    : readServerTree(path);
}

/** Load the top of the media library, preferring the Marketplace SDK. */
export async function fetchMediaTree(
  client: ClientSDK,
  ctx: PagePickerContext
): Promise<SiteTree> {
  let marketplaceError: Error | null = null;

  if (ctx.contextId) {
    try {
      const level = await readAuthoringTreeViaSdk(client, ctx, MEDIA_LIBRARY_ROOT);
      if (level.item) {
        return {
          roots: [level.item],
          childrenById: { [level.item.id]: level.children },
          source: "marketplace",
        };
      }
    } catch (err) {
      marketplaceError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        "[internal-link] The Marketplace path failed, trying the server route:",
        marketplaceError
      );
    }
  } else {
    marketplaceError = new Error(MISSING_GRANT_MESSAGE);
  }

  try {
    const level = await readServerTree(MEDIA_LIBRARY_ROOT);
    if (!level.item) {
      throw new Error(`No item was found at ${MEDIA_LIBRARY_ROOT}.`);
    }
    return {
      roots: [level.item],
      childrenById: { [level.item.id]: level.children },
      source: "server",
    };
  } catch (err) {
    if (err instanceof ServerFallbackUnavailableError) {
      throw marketplaceError ?? err;
    }
    throw err;
  }
}

/** Load the direct children of a media folder. */
export async function fetchMediaChildren(
  client: ClientSDK,
  ctx: PagePickerContext,
  node: SitecorePageNode,
  source: PageSource
): Promise<SitecorePageNode[]> {
  const level = await readMediaLevel(client, ctx, node.path, source);
  return level.children;
}

/**
 * Templates that organise the media library rather than hold a file.
 * Everything else is treated as a file, since Sitecore has one template per
 * media type (Jpeg, Pdf, Docx and so on) and the list is open ended.
 */
const MEDIA_CONTAINER_TEMPLATES = ["folder", "main section", "node"];

/**
 * Whether a media library node is a file rather than a container.
 * When the template name is unknown the node stays selectable, and a failed
 * URL lookup is what tells the author it was not a file.
 */
export function isMediaFile(node: SitecorePageNode): boolean {
  const template = node.templateName?.toLowerCase();
  if (!template) return true;
  return !MEDIA_CONTAINER_TEMPLATES.some((name) => template.includes(name));
}

export interface ResolvedMediaUrl {
  url: string;
  source: PageUrlSource;
  extension?: string;
}

/**
 * Resolve the public URL of a media item.
 *
 * Experience Edge is asked first so the link matches what the website serves.
 * The server route is tried next, which also knows how to build Sitecore's
 * media handler URL from the item id. Null means neither could answer, which
 * usually means the selected item is not a file.
 */
export async function resolveMediaUrl(
  client: ClientSDK,
  ctx: PagePickerContext,
  node: SitecorePageNode,
  source: PageSource
): Promise<ResolvedMediaUrl | null> {
  if (source === "marketplace" && ctx.contextId) {
    // Media items answer the same `url { path }` query that pages do.
    const path = await resolveUrlViaMarketplace(client, ctx, node);
    if (path && path.startsWith("/-/")) {
      return {
        url: path,
        source: "edge",
        extension: fileExtensionFromUrl(path),
      };
    }
  }

  try {
    const params = new URLSearchParams({ id: node.id });
    if (ctx.language) params.set("language", ctx.language);

    const res = await fetch(`/api/sitecore/media-url?${params.toString()}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as {
        url?: string | null;
        source?: string | null;
        extension?: string | null;
      };
      if (typeof body.url === "string" && body.url.trim()) {
        return {
          url: body.url.trim(),
          source: body.source === "edge" ? "edge" : "derived",
          extension: body.extension ?? undefined,
        };
      }
    }
  } catch (err) {
    console.warn("[internal-link] The media URL route failed:", err);
  }

  return null;
}

/**
 * Edge declares `language` as non-null, so the variable must be declared
 * `String!` and always carry a value. Declaring it nullable makes the whole
 * query fail validation.
 */
const RESOLVE_PAGE_URL_QUERY = `
  query GridComposerResolvePageUrl($path: String!, $language: String!) {
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

interface ResolvePageUrlBody {
  data?: {
    item?: { url?: { path?: string | null } | null } | null;
  };
  errors?: Array<{ message?: string }>;
}

/** Ask Experience Edge through the Marketplace SDK. Null when it cannot answer. */
async function resolveUrlViaMarketplace(
  client: ClientSDK,
  ctx: PagePickerContext,
  page: SitecorePageNode
): Promise<string | null> {
  try {
    const result = (await client.mutate("xmc.preview.graphql", {
      params: {
        query: { sitecoreContextId: ctx.contextId },
        body: {
          query: RESOLVE_PAGE_URL_QUERY,
          variables: {
            path: toGuid(page.id),
            language: ctx.language || DEFAULT_LANGUAGE,
          },
        },
      },
    })) as unknown as { data?: ResolvePageUrlBody; error?: unknown } | undefined;

    if (result?.error) {
      console.warn("[internal-link] Edge request failed:", result.error);
    }
    if (result?.data?.errors?.length) {
      console.warn("[internal-link] Edge GraphQL errors:", result.data.errors);
    }

    const edgePath = result?.data?.data?.item?.url?.path;
    return typeof edgePath === "string" && edgePath.trim()
      ? edgePath.trim()
      : null;
  } catch (err) {
    console.warn("[internal-link] Could not resolve the page URL via Edge:", err);
    return null;
  }
}

/** Ask this app's server route, which talks to Edge. Null when it cannot answer. */
async function resolveUrlViaServer(
  ctx: PagePickerContext,
  page: SitecorePageNode
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ id: page.id });
    if (ctx.language) params.set("language", ctx.language);

    const res = await fetch(`/api/sitecore/page-url?${params.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { url?: string | null };
    return typeof body.url === "string" && body.url.trim()
      ? body.url.trim()
      : null;
  } catch (err) {
    console.warn("[internal-link] The page URL route failed:", err);
    return null;
  }
}

/**
 * Resolve the public URL of a page.
 *
 * Experience Edge is asked first because that is what the website uses for its
 * own links. If it cannot answer, the URL is derived from the item path, which
 * is a best effort the author should check.
 */
export async function resolvePageUrl(
  client: ClientSDK,
  ctx: PagePickerContext,
  page: SitecorePageNode,
  source: PageSource
): Promise<{ url: string; source: PageUrlSource }> {
  const edgeUrl =
    source === "marketplace"
      ? await resolveUrlViaMarketplace(client, ctx, page)
      : await resolveUrlViaServer(ctx, page);

  if (edgeUrl) {
    return { url: edgeUrl, source: "edge" };
  }
  return { url: derivePageRoute(page.path, ctx), source: "derived" };
}

/* -------------------------------------------------------------------------- */
/* Item path helpers                                                          */
/* -------------------------------------------------------------------------- */

function splitSegments(path: string): string[] {
  return path
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);
}

/**
 * Work out the item path of the site's start item from the current page: its
 * route is the tail of its item path, so what remains is the start item.
 * Returns null when the two do not line up.
 */
function inferHomeSegments(
  ctx: Pick<PagePickerContext, "currentPagePath" | "currentPageRoute">
): string[] | null {
  if (!ctx.currentPagePath || typeof ctx.currentPageRoute !== "string") {
    return null;
  }
  const pathSegments = splitSegments(ctx.currentPagePath);
  const routeSegments = splitSegments(ctx.currentPageRoute);
  if (routeSegments.length > pathSegments.length) return null;

  const tail = pathSegments.slice(pathSegments.length - routeSegments.length);
  const matches = routeSegments.every((segment, i) => segment === tail[i]);
  return matches
    ? pathSegments.slice(0, pathSegments.length - routeSegments.length)
    : null;
}

/**
 * Item path to root the tree at when reading through the server route.
 * Uses the current page to locate the site's start item, falling back to the
 * first "home" segment and finally to the whole content tree.
 */
export function inferSiteRootPath(ctx: PagePickerContext): string {
  const original = (ctx.currentPagePath ?? "").split("/").filter(Boolean);

  const home = inferHomeSegments(ctx);
  if (home && home.length > 0) {
    return "/" + original.slice(0, home.length).join("/");
  }

  const lower = original.map((segment) => segment.toLowerCase());
  const homeIndex = lower.indexOf("home");
  if (homeIndex >= 0) {
    return "/" + original.slice(0, homeIndex + 1).join("/");
  }

  return "/sitecore/content";
}

/**
 * Best-effort site-relative route for an item path, used only when Edge
 * cannot be asked. Lower-cased, always starts with a slash.
 */
export function derivePageRoute(
  pagePath: string,
  ctx: Pick<PagePickerContext, "currentPagePath" | "currentPageRoute"> = {}
): string {
  const segments = splitSegments(pagePath);
  if (segments.length === 0) return "/";

  const home = inferHomeSegments(ctx);
  if (
    home &&
    home.length <= segments.length &&
    home.every((segment, i) => segment === segments[i])
  ) {
    return "/" + segments.slice(home.length).join("/");
  }

  const homeIndex = segments.indexOf("home");
  if (homeIndex >= 0) {
    return "/" + segments.slice(homeIndex + 1).join("/");
  }

  return "/" + segments[segments.length - 1];
}
