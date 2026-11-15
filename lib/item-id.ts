/**
 * Sitecore item id and media URL helpers.
 *
 * Item ids arrive in several shapes depending on the API: 32 hex characters
 * from the Pages API, a braced and hyphenated GUID from GraphQL, sometimes
 * lower case and sometimes upper. These helpers make them comparable and
 * convert to the form a given API expects. Safe to use on the server and in
 * the browser.
 */

const HEX_ID = /^[0-9a-f]{32}$/i;

/** Comparable key for an item id regardless of braces, hyphens or case. */
export function itemIdKey(id: string | null | undefined): string {
  return (id ?? "").replace(/[{}-]/g, "").toLowerCase();
}

/** True when both ids denote the same item. Empty ids never match. */
export function sameItemId(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const keyA = itemIdKey(a);
  return keyA.length > 0 && keyA === itemIdKey(b);
}

/**
 * Format an id as `{8-4-4-4-12}`, the form GraphQL `item(path:)` accepts.
 * Values that are not item ids are returned untouched.
 */
export function toGuid(id: string): string {
  const hex = itemIdKey(id);
  if (!HEX_ID.test(hex)) return id;
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`.toUpperCase();
}

/**
 * Id-based Sitecore link for an item, so the link survives renames and moves.
 * Pages use the link.aspx form, media items the .ashx media form; both are
 * resolved to real URLs by Sitecore when the content is rendered.
 */
export function buildItemHref(
  id: string,
  kind: "page" | "media"
): string {
  const hex = itemIdKey(id).toUpperCase();
  return kind === "media"
    ? `/~/media/${hex}.ashx`
    : `/~/link.aspx?_id=${hex}&_z=z`;
}

/**
 * File extension of a media URL such as `/-/media/Brochure.pdf?rev=1`.
 * Returns undefined when the URL carries none.
 */
export function fileExtensionFromUrl(url: string): string | undefined {
  const withoutQuery = (url ?? "").split(/[?#]/)[0];
  const lastSegment = withoutQuery.split("/").pop() ?? "";
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(lastSegment);
  return match ? match[1].toLowerCase() : undefined;
}
