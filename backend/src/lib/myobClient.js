// Minimal read-only MYOB Advanced (Acumatica) client. Strictly GET against
// data entities — the only POSTs are the auth login/logout bracket. Node fetch
// has no cookie jar, so a last-write-wins map of Set-Cookie pairs is replayed
// on every request (.ASPXAUTH, ASP.NET_SessionId, etc.).
const config = require("../config");

class MyobHttpError extends Error {
  constructor(status, body, url) {
    const detail = typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body ?? "").slice(0, 200);
    super(`MYOB request failed (${status}) ${url}: ${detail}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// Manual query-string builder: MYOB rejects bare apostrophes in $filter, and
// encodeURIComponent leaves ' unescaped — so callers pass raw apostrophes
// (e.g. datetimeoffset'2025-07-01') and this encodes them to %27 exactly once.
function buildQuery(params = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${key}=${encodeURIComponent(String(value)).replace(/'/g, "%27")}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function updateCookies(jar, response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

// List GETs normally return a bare JSON array; unwrap {value:[...]} defensively.
function entityRows(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.value)) return body.value;
  return body ? [body] : [];
}

// POST /entity/auth/login -> 204 + session cookies. company defaults to
// MYOB_COMPANY; pass config.myob.companyTest for the test tenant.
async function login({ company } = {}) {
  const myob = config.myob;
  if (!myob.url || !myob.username || !myob.password) {
    throw new Error("MYOB credentials are not configured (MYOB_URL/MYOB_USERNAME/MYOB_PASSWORD)");
  }
  const jar = new Map();
  const response = await fetch(`${myob.url}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: myob.username,
      password: myob.password,
      company: company || myob.company,
      branch: myob.branch,
      locale: "",
    }),
    signal: AbortSignal.timeout(myob.timeoutMs),
  });
  updateCookies(jar, response);
  if (response.status !== 204 && !response.ok) {
    throw new MyobHttpError(response.status, await response.text(), `${myob.url}/entity/auth/login`);
  }
  return { jar, url: myob.url, base: `${myob.url}/entity/${myob.endpointFamily}`, timeoutMs: myob.timeoutMs };
}

// Best-effort logout — Acumatica limits concurrent API sessions, so this runs
// in a finally and never throws.
async function logout(session) {
  try {
    await fetch(`${session.url}/entity/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookieHeader(session.jar) },
      signal: AbortSignal.timeout(session.timeoutMs),
    });
  } catch {
    // best-effort only
  }
}

// Bracket a whole read run in one login/logout session.
async function withSession(fn, { company } = {}) {
  const session = await login({ company });
  try {
    return await fn(session);
  } finally {
    await logout(session);
  }
}

// Low-level GET {base}/{entity}?{params}. Returns {status, ok, body, rows}
// so probes can record non-200 statuses without throwing.
async function getEntity(session, entity, { params } = {}) {
  const url = `${session.base}/${entity}${buildQuery(params)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Cookie: cookieHeader(session.jar) },
    signal: AbortSignal.timeout(session.timeoutMs),
  });
  updateCookies(session.jar, response);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, ok: response.ok, body, rows: response.ok ? entityRows(body) : [] };
}

// Paged accumulator: $top/$skip pages of `top` until a short/empty page (or
// maxRows). Throws MyobHttpError on any non-200 page.
async function pagedFetch(session, entity, { filter, expand, top = 500, maxRows = Infinity } = {}) {
  const rows = [];
  for (let skip = 0; rows.length < maxRows; skip += top) {
    const { status, ok, body, rows: page } = await getEntity(session, entity, {
      params: { $top: top, $skip: skip > 0 ? skip : undefined, $expand: expand, $filter: filter },
    });
    if (!ok) throw new MyobHttpError(status, body, `${session.base}/${entity}`);
    rows.push(...page);
    if (page.length < top) break;
  }
  return rows.length > maxRows ? rows.slice(0, maxRows) : rows;
}

// The single definitions of the {value} unwrap and field-variant coalescing
// helpers live in the cache repository; re-exported here so client callers
// have the full toolkit in one require.
const { flattenRecord, pickField } = require("../repositories/myobCacheRepository");

module.exports = {
  MyobHttpError,
  buildQuery,
  entityRows,
  login,
  logout,
  withSession,
  getEntity,
  pagedFetch,
  flattenRecord,
  pickField,
};
