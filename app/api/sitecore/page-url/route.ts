/**
 * Resolves the site-relative URL of a Sitecore page for the internal link
 * picker, using Experience Edge preview.
 *
 * Part of the same fallback as `../tree`: it runs only when the Marketplace
 * app cannot reach Sitecore itself. A null URL is a normal answer and means
 * the caller should derive a route from the item path instead.
 */

import { NextResponse } from "next/server";
import { isEdgeConfigured, resolvePageUrlFromEdge } from "@/lib/server/sitecore-edge";
import { toGuid } from "@/lib/item-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (!isEdgeConfigured()) {
    // Not an error: the picker derives a route from the item path instead.
    return NextResponse.json(
      { url: null, reason: "no_context_id" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const url = await resolvePageUrlFromEdge(toGuid(id), language || undefined);
    return NextResponse.json(
      { url },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[api/sitecore/page-url] Failed to resolve the URL:", err);
    return NextResponse.json({ url: null, reason: "edge_failed" });
  }
}
