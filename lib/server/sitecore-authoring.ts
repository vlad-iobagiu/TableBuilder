/**
 * Server-side access to the XM Cloud Authoring and Management GraphQL API.
 *
 * SERVER ONLY. This module reads a client secret from the environment, so it
 * must never be imported from a client component. It is used by the route
 * handlers under `app/api/sitecore/`.
 *
 * Why it exists: the internal link picker normally reaches Sitecore through
 * the Marketplace SDK, where the Pages host signs each call with the app's own
 * credentials. When the app has not been granted API access in the Sitecore
 * Cloud Portal those calls fail with "Marketplace M2M credentials not found".
 * This module is the fallback: an automation client created in XM Cloud Deploy
 * authenticates directly, so the picker keeps working until the grant is in
 * place. See `.env.example` for the variables involved.
 */

const AUTHORITY = (
  process.env.SITECORE_AUTH_AUTHORITY || "https://auth.sitecorecloud.io"
).replace(/\/+$/, "");

const AUDIENCE =
  process.env.SITECORE_AUTH_AUDIENCE || "https://api.sitecorecloud.io";

const CM_HOST = (process.env.SITECORE_CM_HOST || "")
  .trim()
  .replace(/\/+$/, "");

const CLIENT_ID = (process.env.SITECORE_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SITECORE_CLIENT_SECRET || "").trim();

/** True when all three required variables are present. */
export function isAuthoringConfigured(): boolean {
  return Boolean(CM_HOST && CLIENT_ID && CLIENT_SECRET);
}

/** Content management host, without a trailing slash. */
export function getCmHost(): string {
  return CM_HOST;
}

/** One item of the content tree as the Authoring API returns it. */
export interface AuthoringItem {
  itemId: string;
  name: string;
  path: string;
  displayName?: string;
  hasChildren?: boolean;
  hasPresentation?: boolean;
  /** Used to tell media folders from actual files. May be absent. */
  template?: { name?: string } | null;
}

export interface ChildrenResult {
  item: AuthoringItem | null;
  children: AuthoringItem[];
}

/* -------------------------------------------------------------------------- */
/* Access token                                                               */
/* -------------------------------------------------------------------------- */

let tokenCache: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    audience: AUDIENCE,
  });

  const res = await fetch(`${AUTHORITY}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(
      `Could not get a Sitecore access token (HTTP ${res.status}). ${detail}`
    );
  }

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("The Sitecore token response contained no access token.");
  }

  // Renew a minute early so a request never travels with an expiring token.
  const ttlSeconds = typeof json.expires_in === "number" ? json.expires_in : 3600;
  tokenCache = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(ttlSeconds - 60, 60) * 1000,
  };
  return json.access_token;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    tokenCache = null;
    tokenRequest = null;
  }
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.value;
  }
  // Collapse parallel requests onto one token call.
  if (!tokenRequest) {
    tokenRequest = requestToken().finally(() => {
      tokenRequest = null;
    });
  }
  return tokenRequest;
}

/* -------------------------------------------------------------------------- */
/* GraphQL                                                                    */
/* -------------------------------------------------------------------------- */

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

async function postGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<{ status: number; body: GraphQLEnvelope<T> | null; text: string }> {
  const res = await fetch(`${CM_HOST}/sitecore/api/authoring/graphql/v1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const text = await res.text();
  let body: GraphQLEnvelope<T> | null = null;
  try {
    body = JSON.parse(text) as GraphQLEnvelope<T>;
  } catch {
    // Non-JSON response (an HTML error page, for instance) – kept in `text`.
  }
  return { status: res.status, body, text };
}

/** Run a query, refreshing the token once if the endpoint rejects it. */
async function runGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<GraphQLEnvelope<T>> {
  let token = await getAccessToken();
  let result = await postGraphQL<T>(query, variables, token);

  if (result.status === 401) {
    token = await getAccessToken(true);
    result = await postGraphQL<T>(query, variables, token);
  }

  if (result.status === 401 || result.status === 403) {
    throw new Error(
      `The Authoring API rejected the automation client (HTTP ${result.status}). Check that the client is scoped to this environment.`
    );
  }
  if (!result.body) {
    throw new Error(
      `The Authoring API returned a non-JSON response (HTTP ${result.status}): ${result.text.slice(0, 200)}`
    );
  }
  return result.body;
}

/* -------------------------------------------------------------------------- */
/* Reading the tree                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fields requested for every node. The first four are the ones the schema
 * probe confirmed; the rest are useful but not guaranteed to exist on every
 * XM Cloud version, so any field the endpoint rejects is dropped and
 * remembered for the life of the process.
 */
const CORE_FIELDS = ["itemId", "name", "path", "hasChildren"] as const;
const OPTIONAL_FIELDS = ["displayName", "hasPresentation"] as const;

/** Nested selections that are also dropped if the schema rejects them. */
const OPTIONAL_BLOCKS: Record<string, string> = {
  template: "template { name }",
};

const MAX_DEGRADE_ATTEMPTS =
  OPTIONAL_FIELDS.length + Object.keys(OPTIONAL_BLOCKS).length;

const dropped = new Set<string>();

function selectionSet(): string {
  const fields = [
    ...CORE_FIELDS,
    ...OPTIONAL_FIELDS.filter((f) => !dropped.has(f)),
  ];
  const blocks = Object.entries(OPTIONAL_BLOCKS)
    .filter(([name]) => !dropped.has(name))
    .map(([, selection]) => selection);
  return [...fields, ...blocks].join("\n    ");
}

/** "Cannot query field \"displayName\" on type \"Item\"" -> "displayName" */
function unknownSelectionFrom(messages: string[]): string | null {
  const optional: string[] = [
    ...OPTIONAL_FIELDS,
    ...Object.keys(OPTIONAL_BLOCKS),
  ];
  for (const message of messages) {
    const match = /cannot query field ['"`]?([A-Za-z_][A-Za-z0-9_]*)['"`]?/i.exec(
      message
    );
    if (match && optional.includes(match[1])) return match[1];
  }
  return null;
}

interface ChildrenQueryResult {
  item?: {
    children?: { nodes?: AuthoringItem[] | null } | null;
  } & AuthoringItem;
}

/**
 * Read an item and its direct children.
 *
 * The language is deliberately left out of the query: the probe confirmed
 * `item(where: { path: ... })` works, and adding arguments the schema may not
 * accept would break the whole call. Names and paths do not vary by language,
 * which is all the picker needs for navigation.
 */
export async function listChildren(path: string): Promise<ChildrenResult> {
  if (!isAuthoringConfigured()) {
    throw new Error(
      "Sitecore server credentials are not configured. Set SITECORE_CM_HOST, SITECORE_CLIENT_ID and SITECORE_CLIENT_SECRET."
    );
  }

  // One retry per optional selection the endpoint turns out not to support.
  for (let attempt = 0; attempt <= MAX_DEGRADE_ATTEMPTS; attempt++) {
    const fields = selectionSet();
    const query = `
      query GridComposerChildren($path: String!) {
        item(where: { path: $path }) {
          ${fields}
          children {
            nodes {
              ${fields}
            }
          }
        }
      }
    `;

    const envelope = await runGraphQL<ChildrenQueryResult>(query, { path });
    const messages = (envelope.errors ?? []).map((e) => e.message ?? "");

    if (messages.length > 0) {
      const unknown = unknownSelectionFrom(messages);
      if (unknown) {
        console.warn(
          `[sitecore-authoring] Dropping unsupported selection "${unknown}" and retrying.`
        );
        dropped.add(unknown);
        continue;
      }
      throw new Error(messages.filter(Boolean).join(" | ") || "GraphQL error");
    }

    const item = envelope.data?.item ?? null;
    const children = item?.children?.nodes ?? [];
    return {
      item: item ? stripChildren(item) : null,
      children: children.map(stripChildren),
    };
  }

  throw new Error("Could not build a query the Authoring API accepts.");
}

/** Drop the nested `children` connection so only flat nodes are returned. */
function stripChildren(item: AuthoringItem): AuthoringItem {
  return {
    itemId: item.itemId,
    name: item.name,
    path: item.path,
    displayName: item.displayName,
    hasChildren: item.hasChildren,
    hasPresentation: item.hasPresentation,
    template: item.template ?? undefined,
  };
}
