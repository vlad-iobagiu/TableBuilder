/**
 * Resolves the URL of a Sitecore media item for the media link picker.
 *
 * Experience Edge is asked first and answers with a site-relative media path
 * such as `/-/media/Brochure.pdf`. Relative is deliberate: the table JSON is
 * content, so a link must keep working when it is published to another
 * environment. Set SITECORE_MEDIA_HOST when links should be absolute instead,
 * for example when media is served from a separate CDN hostname.
 *
 * When Edge cannot answer, Sitecore's media handler URL is built from the item
 * id, which works regardless of the item's path or file extension.
 *
 * Part of the same fallback as `../tree`: it runs only when the Marketplace
 * app cannot reach Sitecore itself.
 */

import { NextResponse } from "next/server";
import { resolveMediaFromEdge } from "@/lib/server/sitecore-edge";
import { itemIdKey, toGuid } from "@/lib/item-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Optional absolute host for media links. Empty means site-relative URLs. */
function mediaHost(): string {
  return (process.env.SITECORE_MEDIA_HOST || "").trim().replace(/\/+$/, "");
}

function withHost(path: string): string {
  const host = mediaHost();
  return host ? `${host}${path}` : path;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = (params.get("id") || "").trim();
  const language = (params.get("language") || "").trim();

  if (!id) {
    return NextResponse.json(
      { error: "An item id is required." },
      { status: 400 }
    );
  }

  const headers = { "Cache-Control": "no-store" };

  const edge = await resolveMediaFromEdge(toGuid(id), language || undefined);
  if (edge) {
    return NextResponse.json(
      {
        url: withHost(edge.url),
        source: "edge",
        extension: edge.extension ?? null,
      },
      { headers }
    );
  }

  // Sitecore's media handler accepts the item id with no extension.
  return NextResponse.json(
    {
      url: withHost(`/-/media/${itemIdKey(id)}.ashx`),
      source: "constructed",
      extension: null,
    },
    { headers }
  );
}
