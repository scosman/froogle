// Unit tests for the pure core of index.html.
//
// The core region is extracted from the HTML and evaluated in a vm context seeded with nothing but
// the language built-ins plus URL and URLSearchParams. That gives real coverage of the logic and
// constrains the region from growing a DOM, network or storage dependency — precisely: a top-level
// reference to one fails when the region is evaluated, while a reference inside a function body
// fails only when that function is called, so the guarantee reaches exactly as far as this suite's
// coverage of the exports.
//
// Run with: node --test  (from the repo root; it discovers test/ on its own)
//
// The .mjs extension, not .js: there is no package.json to declare module type, and relying on
// Node's module-syntax detection would silently raise the floor to Node 20.19 / 22.7.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const INDEX_PATH = fileURLToPath(new URL("../index.html", import.meta.url));

const EXPORTED = [
  "MAX_RESULTS", "SNIPPET_MAX_LENGTH",
  "parseQuery", "buildRequestBody", "searchRequest",
  "parseRoute", "formatRoute", "legacyTarget", "legacyRedirect",
  "resolveKey", "normalizeMode", "proxyStatus", "selectMode", "proxyUnavailable",
  "resultsFrom", "resultTitle", "pickSnippet", "normalizeSnippet", "isLinkableUrl", "displayUrl",
  "formatDate",
  "escapeXml", "errorMessage", "keyCheckResult",
  "modeLabel", "proxyNote", "modeStateText", "keyStateText", "settingsError", "formatElapsed",
  "resolveEngineName", "DEFAULT_ENGINE_NAME", "DEFAULT_MODE",
];

function extractCore() {
  const html = readFileSync(INDEX_PATH, "utf8");
  const match = /\/\/ ---- FROOGLE:CORE:BEGIN ----([\s\S]*?)\/\/ ---- FROOGLE:CORE:END ----/
    .exec(html);
  assert.ok(match, "index.html must contain a FROOGLE:CORE region");
  return match[1];
}

/* URL and URLSearchParams are seeded because they are standard web platform globals the core
   legitimately uses; a vm context ships only the ECMAScript built-ins. console is explicitly
   blanked, since a pure region has nothing to log. */
function createSandbox() {
  return vm.createContext({ URL, URLSearchParams, console: undefined });
}

function loadCore() {
  const context = createSandbox();
  const source = extractCore() + "\n;({ " + EXPORTED.join(", ") + " });";
  return vm.runInContext(source, context, { filename: "index.html#core" });
}

const core = loadCore();

/* Objects built inside the vm come from a different realm, so their prototypes are not the host's
   and deepStrictEqual rejects them on identity alone. This copies a plain result across the
   boundary without loosening the comparison — null and undefined stay distinct. */
function toHost(value) {
  // Array.from rather than value.map: map on a vm array builds another vm array.
  if (Array.isArray(value)) return Array.from(value, toHost);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toHost(v)]));
  }
  return value;
}

test("the core's sandbox holds nothing but the language, URL and URLSearchParams", () => {
  const listGlobals = (context) =>
    vm.runInContext("Object.getOwnPropertyNames(globalThis)", context);
  const languageOnly = new Set(listGlobals(vm.createContext({})));
  const seeded = listGlobals(createSandbox()).filter((name) => !languageOnly.has(name));
  assert.deepEqual(toHost(seeded).sort(), ["URL", "URLSearchParams"]);
  // console is seeded as undefined, so a stray log in the core throws instead of quietly working.
  // A blanked global is not reported as an own name, hence the separate check.
  assert.equal(vm.runInContext("typeof console", createSandbox()), "undefined");
});

test("core region carries no DOM, network or storage dependency", () => {
  // A top-level reference to document, fetch or localStorage fails here, at evaluation. One inside
  // a function body fails only when that function runs — which is why every exported function is
  // exercised below, and why a new export must arrive with a test that calls it.
  assert.doesNotThrow(loadCore);
});

/* ---- parseQuery ---- */

test("parseQuery returns a bare query unchanged", () => {
  assert.deepEqual(toHost(core.parseQuery("typescript best practices")),
    { query: "typescript best practices", filters: {} });
});

test("parseQuery handles empty and whitespace-only input", () => {
  assert.deepEqual(toHost(core.parseQuery("")), { query: "", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("   \n  ")), { query: "", filters: {} });
  assert.deepEqual(toHost(core.parseQuery(undefined)), { query: "", filters: {} });
});

test("parseQuery extracts site: alone and mid-query", () => {
  assert.deepEqual(toHost(core.parseQuery("site:example.com")),
    { query: "", filters: { site: "example.com" } });
  assert.deepEqual(toHost(core.parseQuery("rust site:docs.rs traits")),
    { query: "rust traits", filters: { site: "docs.rs" } });
});

test("parseQuery extracts valid after: and before: dates", () => {
  assert.deepEqual(toHost(core.parseQuery("news after:2026-01-01 before:2026-02-01")), {
    query: "news",
    filters: { published_after: "2026-01-01", published_before: "2026-02-01" },
  });
});

test("parseQuery leaves malformed operator values in the query text", () => {
  assert.deepEqual(toHost(core.parseQuery("after:yesterday")),
    { query: "after:yesterday", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("after:2026-13-01")),
    { query: "after:2026-13-01", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("after:2026-02-30")),
    { query: "after:2026-02-30", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("before:2026-1-1")),
    { query: "before:2026-1-1", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("site:localhost")),
    { query: "site:localhost", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("site:example.com/blog")),
    { query: "site:example.com/blog", filters: {} });
});

test("parseQuery leaves an operator with an empty value in the query text", () => {
  assert.deepEqual(toHost(core.parseQuery("cats site: dogs")),
    { query: "cats site: dogs", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("after:")), { query: "after:", filters: {} });
});

test("parseQuery lets a later operator override an earlier one", () => {
  assert.deepEqual(toHost(core.parseQuery("site:a.com site:b.com")),
    { query: "", filters: { site: "b.com" } });
});

test("parseQuery does not treat an ordinary colon as an operator", () => {
  assert.deepEqual(toHost(core.parseQuery("ratio 3:1")), { query: "ratio 3:1", filters: {} });
  assert.deepEqual(toHost(core.parseQuery("https://example.com")),
    { query: "https://example.com", filters: {} });
});

test("parseQuery matches operator names case-insensitively", () => {
  assert.deepEqual(toHost(core.parseQuery("Site:Example.com After:2026-01-01")),
    { query: "", filters: { site: "Example.com", published_after: "2026-01-01" } });
});

test("parseQuery collapses the whitespace left behind by removed operators", () => {
  assert.deepEqual(toHost(core.parseQuery("  a   site:x.com   b  ")),
    { query: "a b", filters: { site: "x.com" } });
});

/* ---- buildRequestBody ---- */

test("buildRequestBody always sets mode, max_results and snippet_max_length", () => {
  assert.deepEqual(toHost(core.buildRequestBody({ query: "cats", filters: {} })), {
    query: "cats",
    mode: "pro",
    max_results: core.MAX_RESULTS,
    snippet_max_length: core.SNIPPET_MAX_LENGTH,
  });
  assert.equal(core.MAX_RESULTS, 25);
  assert.equal(core.SNIPPET_MAX_LENGTH, 400);
});

test("buildRequestBody includes filters only when present", () => {
  const body = core.buildRequestBody({
    query: "cats",
    filters: { site: "example.com", published_after: "2026-01-01" },
  });
  assert.equal(body.site, "example.com");
  assert.equal(body.published_after, "2026-01-01");
  assert.equal("published_before" in body, false);
});

/* ---- searchRequest ---- */

const DIRECT_URL = "https://api.keenable.ai/v1/search";
const PROXY_PATH = "/api/search";

function requestFor(mode, key, body = { query: "cats" }) {
  return toHost(core.searchRequest({ mode, key, body, directUrl: DIRECT_URL, proxyPath: PROXY_PATH }));
}

test("searchRequest sends the key to Keenable in direct mode", () => {
  const { url, options } = requestFor("direct", "keen_abc");
  assert.equal(url, DIRECT_URL);
  assert.equal(options.method, "POST");
  assert.deepEqual(options.headers, {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-API-Key": "keen_abc",
  });
});

test("searchRequest never attaches a key to the proxy call", () => {
  // The proxy is same-origin and carries the operator's credential server-side; a visitor's key
  // has no business travelling there.
  const { url, options } = requestFor("proxied", "keen_abc");
  assert.equal(url, PROXY_PATH);
  assert.equal("X-API-Key" in options.headers, false);
  assert.deepEqual(options.headers, {
    "Content-Type": "application/json",
    "Accept": "application/json",
  });
});

test("searchRequest never lets a search carry cookies", () => {
  // Keenable answers with Access-Control-Allow-Credentials: true, so this is stated, not assumed.
  for (const mode of ["direct", "proxied"]) {
    assert.equal(requestFor(mode, "keen_abc").options.credentials, "omit");
    assert.equal(requestFor(mode, "keen_abc").options.referrerPolicy, "no-referrer");
  }
});

test("searchRequest serializes the request body unchanged", () => {
  const body = core.buildRequestBody(core.parseQuery("rust site:docs.rs after:2026-01-01"));
  const sent = JSON.parse(requestFor("direct", "keen_abc", body).options.body);
  assert.deepEqual(sent, {
    query: "rust",
    mode: "pro",
    max_results: core.MAX_RESULTS,
    snippet_max_length: core.SNIPPET_MAX_LENGTH,
    site: "docs.rs",
    published_after: "2026-01-01",
  });
});

test("searchRequest tolerates a missing key rather than sending undefined", () => {
  assert.equal(requestFor("direct", undefined).options.headers["X-API-Key"], "");
});

test("searchRequest refuses a mode it does not know rather than defaulting to the proxy", () => {
  // "anything that is not direct" would aim a real request at PROXY_PATH the moment a mode value
  // went wrong. There are two endpoints and the function names both of them.
  for (const mode of [undefined, null, "", "nokey", "Direct", "proxy", "shared"]) {
    assert.throws(() => core.searchRequest({ mode, key: "keen_abc", body: {} }), /mode/,
      `expected ${JSON.stringify(mode)} to throw`);
  }
  assert.throws(() => core.searchRequest(), /mode/);
});

/* ---- routing ---- */

const ROUND_TRIP_QUERIES = [
  "cats",
  "hello world",
  "c# generics",
  "a & b",
  "one+two",
  "naïve café 日本語",
  "100% of ?things=yes",
  "trailing slash /",
];

test("parseRoute and formatRoute round-trip every awkward query", () => {
  for (const query of ROUND_TRIP_QUERIES) {
    const hash = core.formatRoute("results", query);
    assert.deepEqual(toHost(core.parseRoute(hash, "")), { view: "results", query },
      `round trip failed for ${JSON.stringify(query)} via ${hash}`);
  }
});

test("formatRoute maps the static views", () => {
  assert.equal(core.formatRoute("about", ""), "#about");
  assert.equal(core.formatRoute("settings", ""), "#settings");
  assert.equal(core.formatRoute("home", ""), "");
});

test("formatRoute falls back to home for an empty results query", () => {
  assert.equal(core.formatRoute("results", "   "), "");
  assert.equal(core.formatRoute("results", ""), "");
});

test("parseRoute reads the static views", () => {
  assert.deepEqual(toHost(core.parseRoute("#about", "")), { view: "about", query: "" });
  assert.deepEqual(toHost(core.parseRoute("#settings", "")), { view: "settings", query: "" });
});

test("parseRoute falls back to home for empty, blank and unknown fragments", () => {
  for (const hash of ["", "#", "#q=", "#q=%20", "#nonsense", "#ABOUT", undefined]) {
    assert.deepEqual(toHost(core.parseRoute(hash, "")), { view: "home", query: "" },
      `expected home for ${JSON.stringify(hash)}`);
  }
});

test("parseRoute accepts a fragment with or without its leading hash", () => {
  assert.deepEqual(toHost(core.parseRoute("q=cats", "")), { view: "results", query: "cats" });
});

test("parseRoute survives a malformed percent sequence", () => {
  assert.deepEqual(toHost(core.parseRoute("#q=%E0%A4%A", "")),
    { view: "results", query: "%E0%A4%A" });
});

test("parseRoute falls back to a legacy query string only when the fragment says nothing", () => {
  assert.deepEqual(toHost(core.parseRoute("", "?q=cats")), { view: "results", query: "cats" });
  assert.deepEqual(toHost(core.parseRoute("", "?about")), { view: "about", query: "" });
  assert.deepEqual(toHost(core.parseRoute("#q=dogs", "?q=cats")),
    { view: "results", query: "dogs" });
  assert.deepEqual(toHost(core.parseRoute("#about", "?q=cats")), { view: "about", query: "" });
  assert.deepEqual(toHost(core.parseRoute("#settings", "?about")),
    { view: "settings", query: "" });
});

test("legacyTarget maps legacy links onto fragments", () => {
  assert.equal(core.legacyTarget("?q=cats"), "#q=cats");
  assert.equal(core.legacyTarget("?q=hello+world"), "#q=hello%20world");
  assert.equal(core.legacyTarget("?q=hello%20world"), "#q=hello%20world");
  assert.equal(core.legacyTarget("?about"), "#about");
  assert.equal(core.legacyTarget("?q=cats&utm_source=x"), "#q=cats");
});

test("legacyTarget rewrites an empty legacy query to home", () => {
  assert.equal(core.legacyTarget("?q="), "");
  assert.equal(core.legacyTarget("?q=%20%20"), "");
});

test("legacyTarget returns null when there is nothing to rewrite", () => {
  for (const search of ["", "?", "?utm_source=x", "?settings", undefined, null]) {
    assert.equal(core.legacyTarget(search), null, `expected null for ${JSON.stringify(search)}`);
  }
});

test("legacyRedirect follows the legacy query string when there is no fragment", () => {
  assert.equal(core.legacyRedirect("?q=cats", ""), "#q=cats");
  assert.equal(core.legacyRedirect("?about", ""), "#about");
  assert.equal(core.legacyRedirect("?q=cats", "#"), "#q=cats");
  assert.equal(core.legacyRedirect("?q=", ""), "");
});

test("legacyRedirect keeps an existing fragment, which outranks the query string", () => {
  assert.equal(core.legacyRedirect("?q=cats", "#about"), "#about");
  assert.equal(core.legacyRedirect("?q=cats", "#q=dogs"), "#q=dogs");
  assert.equal(core.legacyRedirect("?about", "#settings"), "#settings");
  assert.equal(core.legacyRedirect("?q=cats", "settings"), "#settings");
});

test("legacyRedirect leaves a URL with no legacy parameter alone", () => {
  assert.equal(core.legacyRedirect("", "#about"), null);
  assert.equal(core.legacyRedirect("?utm_source=x", "#about"), null);
  assert.equal(core.legacyRedirect(undefined, undefined), null);
});

/* ---- mode selection ---- */

test("normalizeMode keeps the two real modes and defaults everything else", () => {
  // A hand-edited localStorage value is a preference, not input: an unknown one falls back to the
  // default rather than erroring or being carried around as a third mode.
  assert.equal(core.normalizeMode("proxied"), "proxied");
  assert.equal(core.normalizeMode("direct"), "direct");
  assert.equal(core.DEFAULT_MODE, "proxied");
  for (const junk of [undefined, null, "", "  ", "shared", "Direct", "PROXIED", 0, {}]) {
    assert.equal(core.normalizeMode(junk), core.DEFAULT_MODE,
      `expected the default mode for ${JSON.stringify(junk)}`);
  }
});

test("proxyStatus calls a proxy impossible only where it structurally is", () => {
  const path = "/api/search";
  assert.equal(core.proxyStatus({ protocol: "file:", proxyPath: path, proxyKnownBad: false }),
    "blocked");
  assert.equal(core.proxyStatus({ protocol: "https:", proxyPath: "", proxyKnownBad: false }),
    "blocked");
  assert.equal(core.proxyStatus({ protocol: "https:", proxyPath: path, proxyKnownBad: true }),
    "missing");
  // "possible" is also the answer before anything has asked, which is the whole reason the page
  // cannot decide the mode from the deployment alone.
  for (const protocol of ["http:", "https:"]) {
    assert.equal(core.proxyStatus({ protocol, proxyPath: path, proxyKnownBad: false }), "possible");
  }
  // Called with nothing: no protocol and no path is a page with nothing behind it, not "possible".
  assert.equal(core.proxyStatus(), "blocked");
});

const HOSTED = { protocol: "https:", proxyPath: "/api/search", proxyKnownBad: false };

test("selectMode honours a Proxied preference wherever a proxy can answer", () => {
  // Including when a key is saved: the preference is the visitor's, and a key is for Direct mode,
  // not a silent override of it.
  for (const key of [null, "", "keen_x"]) {
    assert.equal(core.selectMode({ preference: "proxied", key, ...HOSTED }), "proxied");
  }
  assert.equal(core.selectMode({ key: null, ...HOSTED }), "proxied", "default is proxied");
});

test("selectMode honours a Direct preference, and says nokey rather than falling back", () => {
  // The visitor asked for Direct. With no key the search cannot run, and quietly proxying it
  // would send to Froogle's servers the query they chose to keep away from them.
  assert.equal(core.selectMode({ preference: "direct", key: "keen_x", ...HOSTED }), "direct");
  for (const key of [null, "", "   ", undefined]) {
    assert.equal(core.selectMode({ preference: "direct", key, ...HOSTED }), "nokey");
  }
});

test("selectMode falls back to Direct where Proxied is impossible", () => {
  const impossible = [
    { protocol: "file:", proxyPath: "/api/search", proxyKnownBad: false },
    { protocol: "https:", proxyPath: "", proxyKnownBad: false },
    { protocol: "https:", proxyPath: "/api/search", proxyKnownBad: true },
  ];
  for (const where of impossible) {
    assert.equal(core.selectMode({ preference: "proxied", key: "keen_x", ...where }), "direct");
    assert.equal(core.selectMode({ preference: "proxied", key: null, ...where }), "nokey");
  }
});

test("proxyUnavailable is true only for a proxy that provably is not there", () => {
  // 404 and 405 are a static host answering for a path with no function behind it. "unreadable" is
  // one answering it with a page: an SPA fallback serves index.html for any path and returns 200
  // with HTML, which no proxy would ever do.
  for (const status of [404, 405, "unreadable"]) {
    assert.equal(core.proxyUnavailable(status), true, "expected true for " + status);
  }
});

test("proxyUnavailable leaves an ambiguous failure alone", () => {
  // Status 0 is fetch rejecting — on a same-origin path, a dropped connection rather than a CORS
  // block, which proves nothing. A 5xx and a timeout mean something is there and is having a bad
  // minute. Marking any of them missing would strand the whole session on the key prompt, and flip
  // the About page to a claim that is then false.
  for (const status of [0, 200, 400, 401, 402, 403, 429, 500, 502, 503, "timeout", "nokey",
                        undefined, null]) {
    assert.equal(core.proxyUnavailable(status), false, "expected false for " + String(status));
  }
});

test("errorMessage reduces an unreadable response to the generic retryable message", () => {
  // A body that would not parse says nothing a visitor can act on, so it reads the same as a
  // dropped connection rather than exposing that distinction, which exists for the proxy probe.
  const generic = toHost(core.errorMessage({ status: 0, mode: "proxied" }));
  assert.deepEqual(toHost(core.errorMessage({ status: "unreadable", mode: "proxied" })), generic);
  assert.deepEqual(toHost(core.errorMessage({ status: "unreadable", mode: "direct" })), generic);
  assert.doesNotMatch(generic.text, /unreadable|parse|JSON/i);
});

test("keyCheckResult stores a key an unreadable response could not disprove", () => {
  assert.deepEqual(toHost(core.keyCheckResult({ status: "unreadable" })),
    toHost(core.keyCheckResult({ status: 0 })));
  assert.equal(core.keyCheckResult({ status: "unreadable" }).save, true);
});

test("resolveKey prefers the configured key over the stored one", () => {
  assert.equal(core.resolveKey("keen_config", "keen_stored"), "keen_config");
  assert.equal(core.resolveKey("  keen_config  ", null), "keen_config");
});

test("resolveKey falls back to the stored key", () => {
  assert.equal(core.resolveKey("", "keen_stored"), "keen_stored");
  assert.equal(core.resolveKey("   ", "  keen_stored  "), "keen_stored");
});

test("resolveKey treats blank and non-string keys as absent", () => {
  assert.equal(core.resolveKey("", ""), null);
  assert.equal(core.resolveKey("   ", "   "), null);
  assert.equal(core.resolveKey(null, undefined), null);
  assert.equal(core.resolveKey(0, 12345), null);
});

/* ---- presentation ---- */

test("isLinkableUrl accepts http and https", () => {
  assert.equal(core.isLinkableUrl("http://example.com"), true);
  assert.equal(core.isLinkableUrl("https://example.com/a?b=c#d"), true);
});

test("isLinkableUrl rejects every other scheme and malformed input", () => {
  const rejected = [
    "javascript:alert(1)",
    "  javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>x</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "//example.com",
    "example.com",
    "",
    "   ",
    null,
    undefined,
    123,
  ];
  for (const url of rejected) {
    assert.equal(core.isLinkableUrl(url), false, `expected rejection of ${JSON.stringify(url)}`);
  }
});

test("displayUrl strips the scheme and a bare trailing slash", () => {
  assert.equal(core.displayUrl("https://example.com/"), "example.com");
  assert.equal(core.displayUrl("https://example.com"), "example.com");
  assert.equal(core.displayUrl("http://www.example.com/blog/post"), "www.example.com/blog/post");
  assert.equal(core.displayUrl("https://example.com/s?q=1"), "example.com/s?q=1");
});

test("displayUrl truncates very long URLs", () => {
  const long = "https://example.com/" + "a".repeat(300);
  const shown = core.displayUrl(long);
  assert.equal(shown.length, 96);
  assert.ok(shown.endsWith("…"));
});

test("displayUrl passes unparseable input straight through", () => {
  assert.equal(core.displayUrl("not a url"), "not a url");
  assert.equal(core.displayUrl(null), "");
});

test("resultTitle prefers the title, then the hostname, then the raw url", () => {
  assert.equal(core.resultTitle({ title: "A Post", url: "https://example.com/p" }), "A Post");
  assert.equal(core.resultTitle({ title: "   ", url: "https://example.com/p" }), "example.com");
  assert.equal(core.resultTitle({ url: "https://example.com/p" }), "example.com");
  assert.equal(core.resultTitle({ title: "", url: "nonsense" }), "nonsense");
  assert.equal(core.resultTitle({}), "");
});

test("resultsFrom passes a well-formed payload through in order", () => {
  const payload = {
    query: "cats",
    results: [
      { title: "One", url: "https://a.example/1" },
      { title: "Two", url: "https://b.example/2" },
    ],
  };
  assert.deepEqual(toHost(core.resultsFrom(payload)).map((r) => r.title), ["One", "Two"]);
});

test("resultsFrom yields an empty list for anything that is not a results array", () => {
  for (const payload of [undefined, null, "results", 7, {}, { results: null },
                         { results: "one" }, { results: { 0: {} } }]) {
    assert.deepEqual(toHost(core.resultsFrom(payload)), [],
      `expected [] for ${JSON.stringify(payload)}`);
  }
});

test("resultsFrom drops entries with nothing to draw", () => {
  const kept = toHost(core.resultsFrom({
    results: [
      null,
      "a string",
      {},
      { title: "   ", url: "" },
      { url: "https://only-a-url.example/x" },
      { title: "Only a title" },
    ],
  }));
  assert.deepEqual(kept, [
    { url: "https://only-a-url.example/x" },
    { title: "Only a title" },
  ]);
});

test("pickSnippet prefers snippet and falls back to description", () => {
  assert.equal(core.pickSnippet({ snippet: "s", description: "d" }), "s");
  assert.equal(core.pickSnippet({ description: "d" }), "d");
  assert.equal(core.pickSnippet({ snippet: "   ", description: "d" }), "d");
  assert.equal(core.pickSnippet({}), "");
  assert.equal(core.pickSnippet({ snippet: 5, description: null }), "");
});

test("normalizeSnippet collapses newlines and runs of whitespace", () => {
  assert.equal(core.normalizeSnippet("  a\n\n  b\t\tc  "), "a b c");
  assert.equal(core.normalizeSnippet(""), "");
  assert.equal(core.normalizeSnippet(null), "");
});

test("formatDate renders a plain date without timezone drift", () => {
  assert.equal(core.formatDate("2026-01-08"), "Jan 8, 2026");
  assert.equal(core.formatDate("2026-12-31"), "Dec 31, 2026");
  assert.equal(core.formatDate("2026-01-08T14:03:00Z"), "Jan 8, 2026");
  assert.equal(core.formatDate("  2026-01-08  "), "Jan 8, 2026");
});

test("formatDate reads a zone-less timestamp as UTC, not local time", () => {
  // Parsed as local time these land on Jan 7 west of the meridian and Jan 9 east of it.
  assert.equal(core.formatDate("2026-01-08T00:30:00"), "Jan 8, 2026");
  assert.equal(core.formatDate("2026-01-08T23:30:00"), "Jan 8, 2026");
  assert.equal(core.formatDate("2026-01-08T23:30:00.500"), "Jan 8, 2026");
});

test("formatDate honours an explicit offset", () => {
  assert.equal(core.formatDate("2026-01-08T23:30:00-05:00"), "Jan 9, 2026");
  assert.equal(core.formatDate("2026-01-08T00:30:00+05:00"), "Jan 7, 2026");
});

test("formatDate returns null for absent or unparseable input", () => {
  for (const value of [undefined, null, "", "   ", "not a date", 20260108]) {
    assert.equal(core.formatDate(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

/* ---- messages ---- */

const RENAMED = "Peachsearch";

function messageFor(status, mode, engineName) {
  return core.errorMessage({ status, mode, engineName });
}

test("errorMessage distinguishes the two modes at 429", () => {
  const direct = messageFor(429, "direct");
  const proxied = messageFor(429, "proxied");
  assert.notEqual(direct.text, proxied.text);
  assert.equal(direct.action, null);
  assert.equal(proxied.action, "settings");
  assert.match(proxied.text, /own free Keenable key/);
});

test("errorMessage points a rejected key at settings, in direct mode only", () => {
  for (const status of [401, 403]) {
    assert.equal(messageFor(status, "direct").action, "settings");
    assert.equal(messageFor(status, "proxied").action, null);
  }
});

test("errorMessage reports exhausted credits in direct mode only", () => {
  assert.match(messageFor(402, "direct").text, /out of credits/);
  assert.match(messageFor(402, "proxied").text, /unavailable/);
});

test("errorMessage explains a 400 as a search problem in either mode", () => {
  for (const mode of ["direct", "proxied"]) {
    assert.match(messageFor(400, mode).text, /could not be understood/);
    assert.equal(messageFor(400, mode).action, null);
  }
});

test("errorMessage gives one generic message for 5xx and network failure", () => {
  const generic = "Search is unavailable right now. Try again.";
  for (const status of [500, 502, 503, 0]) {
    assert.equal(messageFor(status, "direct").text, generic);
    assert.equal(messageFor(status, "proxied").text, generic);
  }
});

test("errorMessage no longer knows about an unwired search", () => {
  // Phase 2 wired it up and deleted the placeholder branch; an unknown status is now generic.
  assert.equal(messageFor("unwired", "direct").text, messageFor(500, "direct").text);
});

test("errorMessage handles the timeout sentinel", () => {
  assert.match(messageFor("timeout", "direct").text, /too long/);
  assert.equal(messageFor("timeout", "direct").action, null);
});

test("errorMessage asks for a key when Direct was chosen without one", () => {
  assert.match(messageFor("nokey", "nokey").text, /Direct mode needs a Keenable API key/);
  assert.equal(messageFor("nokey", "nokey").action, "settings");
});

test("errorMessage explains a missing proxy differently depending on the fallback", () => {
  // With a key saved the next search goes direct on its own, so asking for a key would be wrong;
  // with none there is nothing to fall back to and the visitor has to add one.
  const withKey = messageFor("noproxy", "direct");
  const without = messageFor("noproxy", "nokey");
  assert.match(withKey.text, /no proxy of its own/);
  assert.match(withKey.text, /with your key/);
  assert.equal(withKey.action, null);
  assert.match(without.text, /no proxy of its own/);
  assert.match(without.text, /Switch to Direct mode/);
  assert.equal(without.action, "settings");
});

test("errorMessage names the configured engine, and falls back to the default name", () => {
  assert.match(messageFor("noproxy", "nokey", RENAMED).text, new RegExp("copy of " + RENAMED));
  assert.match(messageFor(429, "proxied", RENAMED).text, new RegExp("^" + RENAMED + "'s"));
  assert.match(messageFor("noproxy", "nokey").text, /copy of Froogle/);
  assert.match(messageFor(429, "proxied", "   ").text, /^Froogle's/);
  assert.equal(core.DEFAULT_ENGINE_NAME, "Froogle");
});

test("errorMessage never leaks a raw status code or an empty message", () => {
  const statuses = [0, 400, 401, 402, 403, 404, 429, 500, 503,
                    "timeout", "nokey", "noproxy", undefined];
  for (const status of statuses) {
    for (const mode of ["direct", "proxied", "nokey"]) {
      const { text, action } = messageFor(status, mode);
      assert.ok(text.length > 10, `message for ${status}/${mode} is too short`);
      assert.doesNotMatch(text, /\b[45]\d\d\b/, `message for ${status}/${mode} leaks a code`);
      assert.ok(action === null || action === "settings");
    }
  }
  assert.deepEqual(toHost(core.errorMessage()), toHost(messageFor(undefined, undefined)));
});

/* ---- keyCheckResult ---- */

test("keyCheckResult saves a key that searched successfully", () => {
  assert.deepEqual(toHost(core.keyCheckResult({ results: [] })), {
    save: true,
    text: "Key saved.",
  });
  assert.equal(core.keyCheckResult({ results: [{ title: "One" }] }).save, true);
});

test("keyCheckResult refuses to save a key Keenable rejected", () => {
  for (const status of [401, 403]) {
    const { save, text } = toHost(core.keyCheckResult({ status }));
    assert.equal(save, false, `expected ${status} to block the save`);
    assert.match(text, /rejected that key/);
    assert.match(text, /nothing was saved/);
  }
});

test("keyCheckResult saves an authenticated key that has no credits, and says so", () => {
  const { save, text } = toHost(core.keyCheckResult({ status: 402 }));
  assert.equal(save, true);
  assert.match(text, /out of credits/);
});

test("keyCheckResult saves an unverified key when the check itself failed", () => {
  // A 429, a 5xx, a dropped connection and a timeout say nothing about the key. Refusing the save
  // because Keenable was briefly unreachable would strand the visitor, and saying the check did
  // not complete is the opposite of saving a bad key silently.
  for (const status of [0, 400, 404, 429, 500, 503, "timeout"]) {
    const { save, text } = toHost(core.keyCheckResult({ status }));
    assert.equal(save, true, `expected ${status} to still save`);
    assert.match(text, /could not be checked/);
  }
});

test("keyCheckResult always returns a plain message that leaks no status code", () => {
  const outcomes = [{ results: [] }, { status: 401 }, { status: 402 }, { status: 429 },
                    { status: 0 }, { status: "timeout" }, {}, undefined, null];
  for (const outcome of outcomes) {
    const { save, text } = toHost(core.keyCheckResult(outcome));
    assert.equal(typeof save, "boolean");
    assert.ok(text.length > 8, `message for ${JSON.stringify(outcome)} is too short`);
    assert.doesNotMatch(text, /\b[45]\d\d\b/,
      `message for ${JSON.stringify(outcome)} leaks a code`);
  }
});

test("modeLabel names the mode a search would actually use", () => {
  assert.equal(core.modeLabel("proxied"), "Mode: Proxied");
  assert.equal(core.modeLabel("direct"), "Mode: Direct");
  // Not "Direct": a page with no key cannot search, and labelling it Direct would say it can.
  assert.equal(core.modeLabel("nokey"), "Mode: no key");
  assert.equal(core.modeLabel(undefined), "Mode: no key");
});

test("proxyNote gives a reason only where Proxied cannot be honoured", () => {
  assert.equal(core.proxyNote("possible", "Froogle"), null);
  assert.match(core.proxyNote("blocked", "Froogle"), /no server behind it/);
  assert.match(core.proxyNote("missing", "Froogle"), /nothing is answering/);
  assert.match(core.proxyNote("blocked", RENAMED), new RegExp("copy of " + RENAMED));
  assert.match(core.proxyNote("missing", RENAMED), new RegExp("copy of " + RENAMED));
  assert.match(core.proxyNote("missing"), /copy of Froogle/);
});

test("proxyNote states the deployment fact and gives no advice", () => {
  // Advice belongs to modeStateText, the only one of the two that knows whether a key is saved.
  // A note telling a visitor to "switch to Direct and add a key" would otherwise appear on the
  // same screen as a line saying searches already go direct with the key they already added.
  for (const status of ["blocked", "missing"]) {
    const note = core.proxyNote(status, "Froogle");
    assert.doesNotMatch(note, /switch|add a key|instead|Settings/i,
      `the ${status} note should not advise: ${note}`);
  }
});

test("modeStateText restates the chosen mode when it is the one running", () => {
  assert.match(core.modeStateText({ preference: "proxied", effective: "proxied" }),
    /through Froogle's proxy/);
  assert.match(core.modeStateText({ preference: "direct", effective: "direct" }),
    /straight from this browser to Keenable/);
  assert.match(core.modeStateText({ preference: "proxied", effective: "proxied",
                                    engineName: RENAMED }),
    new RegExp(RENAMED + "'s proxy"));
});

test("modeStateText says plainly when the chosen mode is not the one running", () => {
  // The radio still shows what was chosen — the preference is never rewritten — so this line is
  // the only place that can say what is happening instead.
  assert.match(core.modeStateText({ preference: "proxied", effective: "direct" }),
    /Proxied is not available here.*saved key/);
  assert.match(core.modeStateText({ preference: "proxied", effective: "nokey" }),
    /Proxied is not available here.*needs a Keenable API key/);
  assert.match(core.modeStateText({ preference: "direct", effective: "nokey" }),
    /Direct mode needs a Keenable API key/);
});

test("modeStateText treats an unreadable stored preference as the default", () => {
  assert.equal(core.modeStateText({ preference: "nonsense", effective: "proxied" }),
    core.modeStateText({ preference: "proxied", effective: "proxied" }));
  assert.equal(core.modeStateText(), core.modeStateText({ preference: "proxied",
    effective: undefined }));
});

test("keyStateText reports the key this browser holds, and nothing about the mode", () => {
  // The mode line above it owns the mode; two lines describing it could drift apart.
  assert.equal(core.keyStateText({ builtIn: false, saved: true }), "A key is saved in this browser.");
  // Nothing at all for an empty browser: the write-only key field above is blank, which says it.
  assert.equal(core.keyStateText({ builtIn: false, saved: false }), "");
  assert.equal(core.keyStateText(), "");
  assert.match(core.keyStateText({ builtIn: true, saved: true }), /has a key built in/);
  assert.match(core.keyStateText({ builtIn: true, saved: false, engineName: RENAMED }),
    new RegExp("copy of " + RENAMED));
  for (const line of [core.keyStateText({ saved: true }), core.keyStateText({ builtIn: true })]) {
    assert.doesNotMatch(line, /proxied|direct|mode/i);
  }
});

test("settingsError refuses only the mode that could not search once saved", () => {
  // Direct with no key anywhere is the one combination Save cannot commit: storing it would
  // produce the saved "Mode: no key" state the form exists to make unreachable.
  assert.match(core.settingsError({ mode: "direct", typedKey: "", keptKey: "" }),
    /needs a Keenable API key/);
  assert.match(core.settingsError({ mode: "direct", typedKey: "   ", keptKey: "  " }),
    /needs a Keenable API key/);
  // A key typed now, or one already saved and not being cleared, or one built into the file.
  assert.equal(core.settingsError({ mode: "direct", typedKey: "keen_new", keptKey: "" }), null);
  assert.equal(core.settingsError({ mode: "direct", typedKey: "", keptKey: "keen_saved" }), null);
  // Proxied never needs a key, and never discards one that is saved.
  assert.equal(core.settingsError({ mode: "proxied", typedKey: "", keptKey: "" }), null);
  assert.equal(core.settingsError({ mode: "proxied", typedKey: "", keptKey: "keen_saved" }), null);
  // An unreadable stored preference is the default, which is Proxied, so it commits.
  assert.equal(core.settingsError({ mode: "nonsense", typedKey: "", keptKey: "" }), null);
  assert.equal(core.settingsError(), null);
});

test("settingsError offers Proxied as the way out only where Proxied works", () => {
  // Otherwise the refusal would tell a file:// visitor to choose the mode the note two lines above
  // has just said is unavailable here. One source of advice, as everywhere else in Settings.
  const usable = core.settingsError({ mode: "direct", proxyUsable: true });
  assert.match(usable, /Keenable API key/);
  assert.match(usable, /choose Proxied/);
  for (const blocked of [false, undefined]) {
    const message = core.settingsError({ mode: "direct", proxyUsable: blocked });
    assert.match(message, /Keenable API key/);
    assert.doesNotMatch(message, /Proxied/);
  }
  assert.doesNotMatch(usable, /\b[45]\d\d\b/);
});

test("formatElapsed reports a real measurement to two decimals, or nothing at all", () => {
  assert.equal(core.formatElapsed(184), "0.18 seconds");
  assert.equal(core.formatElapsed(1234.5), "1.23 seconds");
  assert.equal(core.formatElapsed(0), "0.00 seconds");
  // Anything that is not a measurement shows nothing rather than "NaN seconds": the number is a
  // claim about this deployment's speed and a fabricated one would be unfalsifiable.
  for (const value of [undefined, null, -1, NaN, Infinity, "180", {}]) {
    assert.equal(core.formatElapsed(value), null,
      `expected null for ${JSON.stringify(value)}`);
  }
});

test("resolveEngineName falls back to the default for a blank or missing name", () => {
  // The host layer resolves the configured name once through this and uses the result everywhere,
  // so a blank SEARCH_ENGINE_NAME cannot leave half the page named and half of it empty.
  assert.equal(core.resolveEngineName("Peachsearch"), "Peachsearch");
  assert.equal(core.resolveEngineName("  Peachsearch  "), "Peachsearch");
  for (const blank of ["", "   ", "\t\n", null, undefined, 0, 12345]) {
    assert.equal(core.resolveEngineName(blank), core.DEFAULT_ENGINE_NAME,
      `expected the default name for ${JSON.stringify(blank)}`);
  }
});

test("escapeXml neutralizes the characters that would break the inline SVG favicon", () => {
  assert.equal(core.escapeXml("&"), "&#38;");
  assert.equal(core.escapeXml("<b>"), "&#60;b&#62;");
  assert.equal(core.escapeXml(`"'`), "&#34;&#39;");
  assert.equal(core.escapeXml("Froogle"), "Froogle");
  assert.equal(core.escapeXml(null), "");
});
