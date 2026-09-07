// Unit tests for src/search.mjs, the optional search proxy.
//
// Run with: node --test  (from the repo root; it discovers these on its own)
//
// Every file here is .mjs deliberately. There is no package.json, so Node treats a bare .js file
// as CommonJS and an ESM `.js` import resolves only through the module-syntax detection added in
// Node 20.19 / 22.7 — silently raising the project's floor from Node 18. The .mjs extension is
// unambiguous on every version, which is why the handler can simply be imported here.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as proxy from "./search.mjs";

const KEYLESS_URL = "https://api.keenable.ai/v1/search/public";
const KEYED_URL = "https://api.keenable.ai/v1/search";
const ENGINE_NAME = "Froogle";

/* ---- helpers ---- */

/* A minimal stand-in for a Workers Request: the proxy reads exactly one header and the body. */
function makeRequest(body, { contentLength, throwOnRead = false } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    headers: {
      get: (name) =>
        name.toLowerCase() === "content-length"
          ? (contentLength === undefined ? String(Buffer.byteLength(text)) : contentLength)
          : null,
    },
    text: async () => {
      reads += 1;
      if (throwOnRead) throw new Error("stream failed");
      return text;
    },
  };
}

/* Replaces the global fetch for the duration of `body`, recording every upstream call. `replies` is
   consumed in order; an entry may be an Error, to stand for a dead upstream.

   A try/finally rather than the test context's `after` hook, which only arrived in Node 18.17 —
   this suite's floor is Node 18.0, the version that first shipped `node --test`. */
async function withStubbedFetch(replies, body) {
  const calls = [];
  /* A flag checked after the fact, not an assertion inside the stub: callKeenable catches
     everything fetch can do, so an assertion thrown in here is swallowed and converted into a 502,
     and a test that overran its replies would pass while quietly measuring the wrong thing. */
  let overran = false;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const reply = replies[calls.length];
    calls.push({
      url,
      method: options.method,
      headers: options.headers,
      body: JSON.parse(options.body),
    });
    if (!reply) {
      overran = true;
      throw new Error("upstream called more times than the test expected");
    }
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? "{}", { status: reply.status });
  };
  try {
    const result = await body(calls);
    assert.equal(overran, false,
      "upstream called " + calls.length + " times, but only " + replies.length + " were queued");
    return result;
  } finally {
    globalThis.fetch = original;
  }
}

const ok = (body = { results: [] }) => ({ status: 200, body: JSON.stringify(body) });
const fails = (status, body = { error: "no" }) => ({ status, body: JSON.stringify(body) });

async function post({ body = { query: "cats" }, env = {}, replies = [], requestOptions } = {}) {
  return withStubbedFetch(replies, async (calls) => {
    const request = makeRequest(body, requestOptions);
    const response = await proxy.handleSearch(request, env);
    return { response, calls, request, text: await response.text() };
  });
}

/* ---- allowlistBody ---- */

test("allowlistBody keeps every allowlisted field", () => {
  const raw = {
    query: "typescript",
    mode: "pro",
    max_results: 25,
    snippet_max_length: 400,
    site: "example.com",
    published_after: "2026-01-01",
    published_before: "2026-06-01",
    acquired_after: "2026-01-01",
    acquired_before: "2026-06-01",
  };
  assert.deepEqual(proxy.allowlistBody(raw), { ok: true, value: raw });
});

test("allowlistBody drops unknown fields", () => {
  // JSON.parse rather than a literal: `__proto__` in an object literal sets the prototype, while
  // a parsed one is an own property — which is the shape a real request would arrive in.
  const raw = JSON.parse(
    "{\"query\":\"cats\",\"api_key\":\"keen_stolen\",\"query_time\":\"2020-01-01\","
    + "\"stream\":true,\"__proto__\":{\"polluted\":true}}");
  const result = proxy.allowlistBody(raw);
  assert.deepEqual(result, { ok: true, value: { query: "cats" } });
  assert.equal(Object.keys(result.value).length, 1);
  assert.equal({}.polluted, undefined);
});

test("allowlistBody drops a field of the wrong type rather than forwarding it", () => {
  const result = proxy.allowlistBody({
    query: "cats",
    site: { toString: "not a string" },
    mode: ["pro"],
    snippet_max_length: "400",
    max_results: null,
  });
  assert.deepEqual(result, { ok: true, value: { query: "cats" } });
});

test("allowlistBody accepts no retrieval mode but pro", () => {
  // realtime requires an API key, so accepting it would let an anonymous caller force every
  // request onto the operator's key by making the keyless tier refuse it.
  assert.equal(proxy.allowlistBody({ query: "cats", mode: "pro" }).value.mode, "pro");
  for (const mode of ["realtime", "Pro", "PRO", "pro ", "", "fast", 1, true, null, ["pro"]]) {
    const value = proxy.allowlistBody({ query: "cats", mode }).value;
    assert.equal("mode" in value, false, "expected mode dropped for " + JSON.stringify(mode));
  }
});

test("a mode the caller asked for never reaches Keenable unless it is pro", async () => {
  const { calls } = await post({
    body: { query: "cats", mode: "realtime" },
    env: { KEENABLE_API_KEY: "keen_op" },
    replies: [ok()],
  });
  assert.deepEqual(calls[0].body, { query: "cats" });
});

test("allowlistBody clamps snippet_max_length to Keenable's documented 180-10000", () => {
  const at = (n) => proxy.allowlistBody({ query: "cats", snippet_max_length: n })
    .value.snippet_max_length;
  // Unclamped, 10000 across 50 results is half a megabyte pulled through the operator's proxy.
  assert.equal(at(99999), 10000);
  assert.equal(at(10001), 10000);
  assert.equal(at(400), 400);
  assert.equal(at(180), 180);
  assert.equal(at(179), 180);
  assert.equal(at(0), 180);
  assert.equal(at(-5), 180);
  assert.equal(at(400.7), 400);
  assert.equal("snippet_max_length" in proxy.allowlistBody({ query: "cats" }).value, false);
});

test("allowlistBody rejects a query that is missing, empty, blank or not a string", () => {
  for (const query of [undefined, null, "", "   ", 42, ["cats"], { q: "cats" }]) {
    const result = proxy.allowlistBody({ query });
    assert.equal(result.ok, false, "expected rejection for " + JSON.stringify(query));
    assert.match(result.message, /query/i);
  }
});

test("allowlistBody rejects a query over 2KB", () => {
  const result = proxy.allowlistBody({ query: "a".repeat(2049) });
  assert.equal(result.ok, false);
  assert.match(result.message, /too long/i);
});

test("allowlistBody accepts a query at exactly the 2KB limit, trimmed", () => {
  const result = proxy.allowlistBody({ query: "  " + "a".repeat(2048) + "  " });
  assert.deepEqual(result, { ok: true, value: { query: "a".repeat(2048) } });
});

test("allowlistBody rejects a body that is not a JSON object", () => {
  for (const raw of [null, undefined, "cats", 5, ["cats"]]) {
    assert.equal(proxy.allowlistBody(raw).ok, false);
  }
});

test("allowlistBody clamps max_results to Keenable's documented 1-50", () => {
  const at = (max_results) => proxy.allowlistBody({ query: "cats", max_results }).value.max_results;
  assert.equal(at(500), 50);
  assert.equal(at(51), 50);
  assert.equal(at(50), 50);
  assert.equal(at(25), 25);
  assert.equal(at(1), 1);
  assert.equal(at(0), 1);
  assert.equal(at(-10), 1);
  assert.equal(at(25.9), 25);
});

test("allowlistBody omits max_results entirely when the caller sent none", () => {
  assert.equal("max_results" in proxy.allowlistBody({ query: "cats" }).value, false);
});

/* ---- shouldFallback ---- */

test("shouldFallback covers 401, 402, 429 and 5xx and nothing else", () => {
  for (const status of [401, 402, 429, 500, 502, 503, 599]) {
    assert.equal(proxy.shouldFallback(status), true, "expected fallback on " + status);
  }
  // 400 above all: a malformed query fails identically on both tiers, so retrying only burns quota.
  for (const status of [200, 204, 400, 403, 404, 422]) {
    assert.equal(proxy.shouldFallback(status), false, "expected no fallback on " + status);
  }
});

/* ---- credentialChain ---- */

test("credentialChain is keyless-only when no operator key is configured", () => {
  for (const env of [{}, { KEENABLE_API_KEY: "" }, { KEENABLE_API_KEY: "   " },
                     { KEENABLE_API_KEY: null }, { UNAUTHENTICATED_FIRST: "false" }]) {
    assert.deepEqual(proxy.credentialChain(env), [{ title: ENGINE_NAME }]);
  }
});

test("credentialChain tries keyless first by default", () => {
  assert.deepEqual(proxy.credentialChain({ KEENABLE_API_KEY: "keen_op" }),
    [{ title: ENGINE_NAME }, { key: "keen_op" }]);
  for (const flag of ["true", "TRUE", "1", "yes", true, undefined, ""]) {
    assert.deepEqual(
      proxy.credentialChain({ KEENABLE_API_KEY: "keen_op", UNAUTHENTICATED_FIRST: flag }),
      [{ title: ENGINE_NAME }, { key: "keen_op" }],
      "expected keyless first for " + String(flag));
  }
});

test("credentialChain reverses the order when UNAUTHENTICATED_FIRST is off", () => {
  for (const flag of ["false", "FALSE", "0", "no", "off", " false ", false]) {
    assert.deepEqual(
      proxy.credentialChain({ KEENABLE_API_KEY: "keen_op", UNAUTHENTICATED_FIRST: flag }),
      [{ key: "keen_op" }, { title: ENGINE_NAME }],
      "expected keyed first for " + String(flag));
  }
});

test("credentialChain trims a padded operator key", () => {
  assert.deepEqual(proxy.credentialChain({ KEENABLE_API_KEY: "  keen_op\n" }),
    [{ title: ENGINE_NAME }, { key: "keen_op" }]);
});

/* ---- request validation ---- */

test("a body that is not JSON is refused without calling upstream", async () => {
  const { response, calls, text } = await post({ body: "not json at all" });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
  assert.match(JSON.parse(text).error, /JSON/i);
});

test("a JSON array, string or number body is refused without calling upstream", async () => {
  for (const body of [["cats"], "\"cats\"", "5", "null"]) {
    const { response, calls } = await post({ body });
    assert.equal(response.status, 400);
    assert.deepEqual(calls, []);
  }
});

test("a body over 8KB is refused without calling upstream", async () => {
  const { response, calls, text } = await post({ body: { query: "a".repeat(9000) } });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
  assert.match(JSON.parse(text).error, /too large/i);
});

test("an oversized Content-Length is refused before the body is read", async () => {
  const { response, request, calls } = await post({
    requestOptions: { contentLength: "999999" },
  });
  assert.equal(response.status, 400);
  assert.equal(request.reads, 0);
  assert.deepEqual(calls, []);
});

test("a missing Content-Length still gets the body checked", async () => {
  const { response, calls } = await post({
    body: { query: "a".repeat(9000) },
    requestOptions: { contentLength: null },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("a multibyte body is measured in bytes, not code units", async () => {
  // 3000 astral characters is 3000 code points, 6000 UTF-16 code units, 12000 UTF-8 bytes.
  const { response, calls } = await post({
    body: { query: "\u{1F600}".repeat(3000) },
    requestOptions: { contentLength: null },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("a body that cannot be read is refused rather than thrown", async () => {
  const { response, calls } = await post({ requestOptions: { throwOnRead: true } });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test("a request with no query is refused without calling upstream", async () => {
  const { response, calls } = await post({ body: { mode: "pro" } });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

/* ---- upstream calls ---- */

test("the keyless call carries X-Keenable-Title and no key", async () => {
  const { calls } = await post({ replies: [ok()] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, KEYLESS_URL);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers["X-Keenable-Title"], ENGINE_NAME);
  assert.equal("X-API-Key" in calls[0].headers, false);
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.equal(calls[0].headers["Accept"], "application/json");
});

test("the keyed call carries X-API-Key and no title", async () => {
  const { calls } = await post({
    env: { KEENABLE_API_KEY: "keen_op", UNAUTHENTICATED_FIRST: "false" },
    replies: [ok()],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, KEYED_URL);
  assert.equal(calls[0].headers["X-API-Key"], "keen_op");
  assert.equal("X-Keenable-Title" in calls[0].headers, false);
});

test("the upstream body is the allowlisted object, not the caller's", async () => {
  const { calls } = await post({
    body: { query: "  cats  ", site: "example.com", max_results: 900, secret: "keen_stolen" },
    replies: [ok()],
  });
  assert.deepEqual(calls[0].body, { query: "cats", site: "example.com", max_results: 50 });
});

/* ---- fallback ---- */

test("a keyless failure worth retrying falls back to the operator key", async () => {
  for (const status of [401, 402, 429, 500, 503]) {
    const { response, calls, text } = await post({
      env: { KEENABLE_API_KEY: "keen_op" },
      replies: [fails(status), ok({ results: [{ title: "second" }] })],
    });
    assert.equal(calls.length, 2, "expected a fallback on " + status);
    assert.equal(calls[0].url, KEYLESS_URL);
    assert.equal(calls[1].url, KEYED_URL);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(text), { results: [{ title: "second" }] });
  }
});

test("a 400 is never retried, on either tier", async () => {
  const { response, calls, text } = await post({
    env: { KEENABLE_API_KEY: "keen_op" },
    replies: [fails(400, { error: "bad query" })],
  });
  assert.equal(calls.length, 1);
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(text), { error: "bad query" });
});

test("a 403 and a 404 are not retried either", async () => {
  for (const status of [403, 404]) {
    const { response, calls } = await post({
      env: { KEENABLE_API_KEY: "keen_op" },
      replies: [fails(status)],
    });
    assert.equal(calls.length, 1, "expected no fallback on " + status);
    assert.equal(response.status, status);
  }
});

test("the fallback is attempted at most once, and its failure is what comes back", async () => {
  const { response, calls, text } = await post({
    env: { KEENABLE_API_KEY: "keen_op" },
    replies: [fails(429, { error: "keyless busy" }), fails(402, { error: "no credits" })],
  });
  assert.equal(calls.length, 2);
  assert.equal(response.status, 402);
  assert.deepEqual(JSON.parse(text), { error: "no credits" });
});

test("with the order reversed, the keyed call falls back to keyless", async () => {
  const { response, calls } = await post({
    env: { KEENABLE_API_KEY: "keen_op", UNAUTHENTICATED_FIRST: "false" },
    replies: [fails(402), ok()],
  });
  assert.deepEqual(calls.map((call) => call.url), [KEYED_URL, KEYLESS_URL]);
  assert.equal(response.status, 200);
});

test("with no operator key there is nothing to fall back to and a 429 passes through", async () => {
  const { response, calls, text } = await post({
    replies: [fails(429, { error: "rate limited" })],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, KEYLESS_URL);
  assert.equal(response.status, 429);
  assert.deepEqual(JSON.parse(text), { error: "rate limited" });
});

/* ---- pass-through ---- */

test("a successful body comes back byte for byte, whitespace included", async () => {
  const payload = "{\"query\":\"cats\", \"mode\":\"pro\",\n  \"results\":[{\"title\":\"a\"}]}";
  const { response, text } = await post({ replies: [{ status: 200, body: payload }] });
  assert.equal(response.status, 200);
  assert.equal(text, payload);
});

test("a 2xx that will not parse becomes a 502 rather than being passed through", async () => {
  // The client reads "200 from PROXY_PATH carrying something that is not JSON" as proof no proxy
  // is there and retires shared mode for the session. Forwarding a malformed 200 from Keenable
  // would make a working deployment frame itself as a missing one, durably and wrongly. So the
  // pass-through guarantee is byte-for-byte for *parseable* success bodies, and this is the edge.
  for (const body of ["", "   ", "<!doctype html><p>hi", "{\"results\":", "undefined"]) {
    const { response, text } = await post({ replies: [{ status: 200, body }] });
    assert.equal(response.status, 502, "expected 502 for " + JSON.stringify(body));
    assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
  }
});

test("a 2xx that parses to a non-object is still passed through", async () => {
  // The guard is "parseable", not "shaped like a search response": the client's resultsFrom
  // already treats any payload as hostile, and narrowing further here would be the proxy
  // second-guessing Keenable's contract.
  for (const body of ["null", "[]", "\"cats\"", "0"]) {
    const { response, text } = await post({ replies: [{ status: 200, body }] });
    assert.equal(response.status, 200, "expected pass-through for " + body);
    assert.equal(text, body);
  }
});

test("an error body is passed through whatever it contains, parseable or not", async () => {
  // Deliberately not guarded like a 2xx: the client's error mapping reads the status, and an
  // operator debugging a broken upstream should see exactly what Keenable sent.
  for (const body of ["", "<html>502 Bad Gateway</html>", "{\"error\":\"nope\"}"]) {
    const { response, text } = await post({ replies: [{ status: 503, body }] });
    assert.equal(response.status, 503);
    assert.equal(text, body);
  }
});

test("an error status and body come back unchanged too", async () => {
  const payload = "{\"error\":\"Invalid request parameters\"}";
  const { response, text } = await post({ replies: [{ status: 400, body: payload }] });
  assert.equal(response.status, 400);
  assert.equal(text, payload);
});

test("responses are marked no-store JSON", async () => {
  const { response } = await post({ replies: [ok()] });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /application\/json/);
});

/* ---- a dead upstream ---- */

test("a fetch that throws becomes a 502 carrying no stack", async () => {
  const { response, calls, text } = await post({
    replies: [new Error("ECONNREFUSED at Object.<anonymous> (/secret/path.js:1:1)")],
  });
  assert.equal(calls.length, 1);
  assert.equal(response.status, 502);
  const parsed = JSON.parse(text);
  assert.equal(typeof parsed.error, "string");
  assert.doesNotMatch(text, /ECONNREFUSED|secret\/path|at Object/);
});

test("a dead upstream falls back like any other 5xx", async () => {
  const { response, calls } = await post({
    env: { KEENABLE_API_KEY: "keen_op" },
    replies: [new Error("boom"), ok()],
  });
  assert.equal(calls.length, 2);
  assert.equal(response.status, 200);
});

/* ---- statelessness ---- */

test("the proxy holds no per-request state: identical requests behave identically", async () => {
  const env = { KEENABLE_API_KEY: "keen_op" };
  const first = await post({ env, replies: [fails(429), ok({ results: [] })] });
  const second = await post({ env, replies: [fails(429), ok({ results: [] })] });
  assert.deepEqual(first.calls, second.calls);
  assert.equal(first.response.status, second.response.status);
  assert.equal(first.text, second.text);
});

test("the proxy exports only functions, so there is no counter or store to keep", () => {
  const exported = Object.entries(proxy).filter(([name]) => name !== "default");
  assert.ok(exported.length > 0);
  for (const [name, value] of exported) {
    assert.equal(typeof value, "function", name + " should be a function");
  }
});
