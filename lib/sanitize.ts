import DOMPurify from "isomorphic-dompurify";

/**
 * Allowed inline HTML for cell content.
 *
 * Cells store raw HTML (e.g. `mytext <a href="#link">text</a>`), so any value
 * rendered with dangerouslySetInnerHTML MUST be sanitized first to prevent XSS.
 * We allow a small set of inline/formatting tags and link attributes only.
 */
const ALLOWED_TAGS = [
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "br",
  "span",
  "small",
  "sub",
  "sup",
  "code",
  "mark",
];

const ALLOWED_ATTR = ["href", "target", "rel", "title", "class", "style"];

let hookInstalled = false;

/**
 * Ensure links that open in a new tab are hardened with rel="noopener noreferrer".
 * Installed once, lazily. isomorphic-dompurify provides a DOM on the server too.
 */
function ensureHook() {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof Element && node.tagName === "A") {
      if (node.getAttribute("target") === "_blank") {
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
  });
  hookInstalled = true;
}

/**
 * Sanitize a raw HTML string for safe rendering.
 * Works on both server and client (isomorphic-dompurify), so it is safe to use
 * in server-rendered components as well as the browser.
 */
export function sanitizeHtml(dirty: string): string {
  ensureHook();
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Strip all tags to produce a plain-text preview of HTML content.
 * Used for placeholders / server-side fallback rendering.
 */
export function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}
