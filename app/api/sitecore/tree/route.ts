/**
 * Reads the Sitecore content tree for the internal link picker.
 *
 * This route is the fallback used when the Marketplace app has no API access
 * granted in the Sitecore Cloud Portal. It authenticates with the automation
 * client configured in the environment, so it is only as restricted as that
 * client.
 *
 * NOTE ON EXPOSURE: the route has no caller authentication, because the app
 * runs inside an iframe with no identity of its own. Anyone who can reach the
 * deployment can therefore read page names and paths of the content tree.
 * Reads are limited to `/sitecore/content` and return names and paths only,
 * never field values. Remove the credentials once the Marketplace grant is in
 * place and this route stops being reachable.
 */

import { NextResponse } from "next/server";
import {
  isAuthoringConfigured,
  listChildren,
} from "@/lib/server/sitecore-authoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only the content and media trees may be read, never `/sitecore/system`
 * and friends.
 */
const ALLOWED_ROOTS = ["/sitecore/content", "/sitecore/media library"];

function isAllowedPath(path: string): boolean {
  if (path.includes("..")) return false;
  const normalized = path.replace(/\/+$/, "").toLowerCase();
  return ALLOWED_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`)
  );
}

export async function GET(request: Request) {
  if (!isAuthoringConfigured()) {
    return NextResponse.json(
      {
        error:
          "Server credentials are not configured for this deployment. Set SITECORE_CM_HOST, SITECORE_CLIENT_ID and SITECORE_CLIENT_SECRET.",
      },
      { status: 501 }
    );
  }

  const path = new URL(request.url).searchParams.get("path") || ALLOWED_ROOTS[0];

  if (!isAllowedPath(path)) {
    return NextResponse.json(
      { error: `Only items under ${ALLOWED_ROOTS.join(" or ")} can be read.` },
      { status: 400 }
    );
  }

  try {
    const result = await listChildren(path);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[api/sitecore/tree] Failed to read the tree:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to read the content tree.",
      },
      { status: 502 }
    );
  }
}
