/* Froogle's search proxy: a Cloudflare Pages Function at /api/search.
 *
 * It exists for one measured reason. Keenable's keyless endpoint requires an X-Keenable-Title
 * header, and Keenable's own CORS preflight does not allow that header, so no browser can call it.
 * A server can. This is the whole of shared mode: a visitor with no API key POSTs here, and this
 * calls the keyless endpoint on their behalf, falling back to the operator's key when the keyless
 * tier refuses.
 *
 * It is optional. A deployment without it is direct-mode only, and index.html degrades to the key
 * prompt on its own after one failed request per session.
 *
 * Same-origin with the page, so there is no CORS handling here, no preflight, and no origin
 * allowlist to maintain.
 *
 * It stores nothing, logs nothing, and holds no per-request state of any kind — no counters, no
 * cache entries, nothing keyed on the visitor. That means it has no rate limiting of its own:
 * an operator exposing a public instance is expected to put a platform rate-limiting rule
 * (a Cloudflare Rate Limiting rule, or the equivalent elsewhere) in front of it. See the README.
 */

/* The X-Keenable-Title attribution string sent on keyless calls. This file cannot read
   index.html's config block, so a renamed instance changes SEARCH_ENGINE_NAME in both places. */
const SEARCH_ENGINE_NAME = "Froogle";

const KEYLESS_URL = "https://api.keenable.ai/v1/search/public";
const KEYED_URL = "https://api.keenable.ai/v1/search";

/* Generous for a search request — the largest legitimate one is a 2KB query plus a handful of
   short filters — and small enough that nothing is buffered on our account. */
const MAX_BODY_BYTES = 8192;
const MAX_QUERY_LENGTH = 2048;

/* The one retrieval mode this proxy will ask for. Not an enum check: Keenable's other documented
   mode, "realtime", requires an API key, so a caller who sent it would fail on the keyless tier and
   — depending on the status that failure carries — be served on KEENABLE_API_KEY instead. That
   would let an anonymous caller choose the tier the operator pays for, on every request. The
   frontend only ever sends "pro", so pinning it costs nothing and closes that entirely. */
const ALLOWED_MODE = "pro";

/* Keenable's documented ranges. Whatever the caller asks for, the operator's key pays for what we
   send, and an unclamped snippet_max_length of 10000 across 50 results is half a megabyte pulled
   through the proxy per request. */
const NUMBER_FIELDS = {
  max_results: { min: 1, max: 50 },
  snippet_max_length: { min: 180, max: 10000 },
};

const STRING_FIELDS = [
  "site",
  "published_after",
  "published_before",
  "acquired_after",
  "acquired_before",
];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  /* A search response is per-visitor and worth nothing to anyone else; nothing about this proxy
     should end up in an intermediary's cache. */
  "Cache-Control": "no-store",
};

export async function onRequestPost({ request, env }) {
  const body = await readJsonBody(request);
  if (!body.ok) return errorResponse(400, body.message);

  const allowed = allowlistBody(body.value);
  if (!allowed.ok) return errorResponse(400, allowed.message);

  /* At most two credentials, run in order, stopping at the first outcome not worth retrying. The
     "fall back at most once" rule is therefore structural rather than a counter to get wrong. */
  let outcome;
  for (const auth of credentialChain(env)) {
    outcome = await search(allowed.value, auth);
    if (!shouldFallback(outcome.status)) break;
  }

  /* Keenable's status and body, unchanged — except a 2xx whose body will not parse, which `search`
     has already turned into a 502. Every other status and body reaches the client exactly as
     Keenable sent it, so the client's error mapping is identical in direct and shared mode. */
  return new Response(outcome.body, { status: outcome.status, headers: JSON_HEADERS });
}

/* Reads the request body as a JSON object, refusing anything too large to be a search or too
   malformed to be one. Content-Length is checked first so an oversized body is refused before it
   is read; the decoded length is checked again afterwards, because Content-Length can be absent
   on a chunked request and is not a promise in any case. */
async function readJsonBody(request) {
  const declared = Number(request.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, message: "Request body is too large." };
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, message: "Request body could not be read." };
  }
  if (byteLength(text) > MAX_BODY_BYTES) {
    return { ok: false, message: "Request body is too large." };
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: "Request body must be JSON." };
  }
  if (!isPlainObject(value)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  return { ok: true, value };
}

/* Copies the allowlisted fields onto a fresh object and drops everything else without comment.
   This is the point of the proxy rather than a detail of it: forwarding the caller's body would
   make this an open relay for arbitrary JSON to Keenable on the operator's key, and would hand a
   caller every parameter Keenable ever adds, including ones that cost money.

   A field is copied only when it has the right type, so an object or an array cannot ride in on a
   field that is supposed to be a string; numeric fields are clamped to Keenable's documented
   ranges; and `mode` is copied only when it is exactly the one mode this proxy will ask for. */
export function allowlistBody(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (!query) return { ok: false, message: "A query is required." };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, message: "Query is too long." };

  const value = { query };
  /* Dropped rather than refused, like every other field this does not recognize: a caller asking
     for "realtime" gets a "pro" search, which is what Keenable does with an absent mode anyway. */
  if (raw.mode === ALLOWED_MODE) value.mode = ALLOWED_MODE;
  for (const field of STRING_FIELDS) {
    if (typeof raw[field] === "string" && raw[field]) value[field] = raw[field];
  }
  for (const [field, range] of Object.entries(NUMBER_FIELDS)) {
    if (typeof raw[field] === "number" && Number.isFinite(raw[field])) {
      value[field] = clamp(Math.trunc(raw[field]), range.min, range.max);
    }
  }
  return { ok: true, value };
}

/* The credentials to try, in order. With no KEENABLE_API_KEY configured the proxy is keyless-only
   and there is nothing to fall back to, so a fork deployed without a key inherits no exposure to
   the original operator's credits — and passes a 429 through untouched. */
export function credentialChain(env) {
  const keyless = { title: SEARCH_ENGINE_NAME };
  const configured = typeof env?.KEENABLE_API_KEY === "string" ? env.KEENABLE_API_KEY.trim() : "";
  if (!configured) return [keyless];
  const keyed = { key: configured };
  return readFlag(env?.UNAUTHENTICATED_FIRST, true) ? [keyless, keyed] : [keyed, keyless];
}

/* Worth trying the other credential for. A 400 is never retried: a malformed query fails
   identically on both tiers, so a retry only burns the operator's quota to be told the same
   thing. 401 and 429 are the keyless tier being out of allowance or refusing us; 402 is the keyed
   tier out of credits; a 5xx is either tier having a bad moment. */
export function shouldFallback(status) {
  return status === 401 || status === 402 || status === 429 || status >= 500;
}

/* One upstream attempt, reduced to a plain status and body so the caller never has to reason
   about a Response that may or may not exist. */
async function search(body, auth) {
  const response = await callKeenable(body, auth);
  let text;
  try {
    text = await response.text();
  } catch {
    return badGateway();
  }

  /* A 2xx whose body will not parse becomes a 502 instead of being passed through. The client
     treats "a 200 from PROXY_PATH carrying something that is not JSON" as proof that no proxy is
     there — it is what a static host does when it serves a page for every path — and retires
     shared mode for the session on it. Were this proxy ever to forward an empty or malformed 200
     from Keenable, a working deployment would frame itself as a missing one, durably and wrongly.
     Emitting only parseable JSON on success is what makes that inference sound.

     Deliberately 2xx only: an error body is passed through untouched whatever it contains, so the
     client sees exactly the status and payload Keenable produced. */
  if (response.status >= 200 && response.status < 300) {
    try {
      JSON.parse(text);
    } catch {
      return badGateway();
    }
  }
  return { status: response.status, body: text };
}

/* X-Keenable-Title on the keyless call, X-API-Key on the keyed one, never both: the title header
   is what the keyless tier requires for attribution, and sending a key alongside it would blur
   which tier a request is actually spending.

   A fetch that throws — DNS, TLS, a dropped connection — becomes a 502 rather than an exception,
   so a dead upstream flows through the same fallback and pass-through as a live one answering
   500, and no stack trace can escape into a response. */
export async function callKeenable(body, auth) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (auth.key) headers["X-API-Key"] = auth.key;
  else headers["X-Keenable-Title"] = auth.title;

  try {
    return await fetch(auth.key ? KEYED_URL : KEYLESS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    const { status, body: text } = badGateway();
    return new Response(text, { status, headers: JSON_HEADERS });
  }
}

function badGateway() {
  return { status: 502, body: JSON.stringify({ error: "Search upstream is unreachable." }) };
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/* TextEncoder is a Workers global and a Node one; a code-unit count would undercount every
   non-ASCII query. */
function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/* Cloudflare environment variables arrive as strings, so "false" has to mean false rather than
   "a non-empty string, which is truthy". An unset or empty value takes the default. */
function readFlag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !/^(false|0|no|off)$/i.test(String(value).trim());
}
