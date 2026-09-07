// Unit tests for the pure core of index.html.
//
// The core region is extracted from the HTML and evaluated in a vm context seeded with nothing but
// the language built-ins plus URL and URLSearchParams. That gives real coverage of the logic and
// simultaneously proves the region has not grown a DOM, network or storage dependency: if it has,
// loading throws here.
//
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const INDEX_PATH = fileURLToPath(new URL("../index.html", import.meta.url));

const EXPORTED = [
  "MAX_RESULTS", "SNIPPET_MAX_LENGTH",
  "parseQuery", "buildRequestBody",
  "parseRoute", "formatRoute", "legacyTarget",
  "resolveKey", "selectMode",
  "resultTitle", "pickSnippet", "normalizeSnippet", "isLinkableUrl", "displayUrl", "formatDate",
  "errorMessage", "modeIndicator",
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
  if (Array.isArray(value)) return value.map(toHost);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toHost(v)]));
  }
  return value;
}

test("core region carries no DOM, network or storage dependency", () => {
  const context = createSandbox();
  const absent = ["document", "window", "fetch", "localStorage", "sessionStorage", "location",
                  "navigator", "XMLHttpRequest", "console"];
  for (const name of absent) {
    assert.equal(
      vm.runInContext(`typeof ${name}`, context), "undefined",
      `${name} must not exist in the core's sandbox`,
    );
  }
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

/* ---- mode selection ---- */

test("selectMode returns direct whenever a key is present", () => {
  for (const protocol of ["https:", "http:", "file:"]) {
    for (const proxyKnownBad of [true, false]) {
      assert.equal(
        core.selectMode({ key: "keen_x", protocol, proxyKnownBad, proxyPath: "/api/search" }),
        "direct",
      );
    }
  }
});

test("selectMode returns nokey with no key over file:", () => {
  assert.equal(
    core.selectMode({ key: null, protocol: "file:", proxyKnownBad: false,
                      proxyPath: "/api/search" }),
    "nokey",
  );
});

test("selectMode returns shared with no key over http(s) and a healthy proxy", () => {
  for (const protocol of ["http:", "https:"]) {
    assert.equal(
      core.selectMode({ key: null, protocol, proxyKnownBad: false, proxyPath: "/api/search" }),
      "shared",
    );
  }
});

test("selectMode returns nokey once the proxy is known bad", () => {
  assert.equal(
    core.selectMode({ key: null, protocol: "https:", proxyKnownBad: true,
                      proxyPath: "/api/search" }),
    "nokey",
  );
});

test("selectMode returns nokey when no proxy path is configured", () => {
  assert.equal(
    core.selectMode({ key: "", protocol: "https:", proxyKnownBad: false, proxyPath: "" }),
    "nokey",
  );
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
});

test("formatDate returns null for absent or unparseable input", () => {
  for (const value of [undefined, null, "", "   ", "not a date", 20260108]) {
    assert.equal(core.formatDate(value), null, `expected null for ${JSON.stringify(value)}`);
  }
});

/* ---- messages ---- */

function messageFor(status, mode) {
  return core.errorMessage({ status, mode });
}

test("errorMessage distinguishes the two modes at 429", () => {
  const direct = messageFor(429, "direct");
  const shared = messageFor(429, "shared");
  assert.notEqual(direct.text, shared.text);
  assert.equal(direct.action, null);
  assert.equal(shared.action, "settings");
  assert.match(shared.text, /own free Keenable key/);
});

test("errorMessage points a rejected key at settings, in direct mode only", () => {
  for (const status of [401, 403]) {
    assert.equal(messageFor(status, "direct").action, "settings");
    assert.equal(messageFor(status, "shared").action, null);
  }
});

test("errorMessage reports exhausted credits in direct mode only", () => {
  assert.match(messageFor(402, "direct").text, /out of credits/);
  assert.match(messageFor(402, "shared").text, /unavailable/);
});

test("errorMessage explains a 400 as a search problem in either mode", () => {
  for (const mode of ["direct", "shared"]) {
    assert.match(messageFor(400, mode).text, /could not be understood/);
    assert.equal(messageFor(400, mode).action, null);
  }
});

test("errorMessage gives one generic message for 5xx and network failure", () => {
  const generic = "Search is unavailable right now. Try again.";
  for (const status of [500, 502, 503, 0]) {
    assert.equal(messageFor(status, "direct").text, generic);
    assert.equal(messageFor(status, "shared").text, generic);
  }
});

test("errorMessage handles the timeout and no-key sentinels", () => {
  assert.match(messageFor("timeout", "direct").text, /too long/);
  assert.equal(messageFor("timeout", "direct").action, null);
  assert.match(messageFor("nokey", "nokey").text, /Keenable API key/);
  assert.equal(messageFor("nokey", "nokey").action, "settings");
});

test("errorMessage never leaks a raw status code or an empty message", () => {
  const statuses = [0, 400, 401, 402, 403, 404, 429, 500, 503, "timeout", "nokey", undefined];
  for (const status of statuses) {
    for (const mode of ["direct", "shared", "nokey"]) {
      const { text, action } = messageFor(status, mode);
      assert.ok(text.length > 10, `message for ${status}/${mode} is too short`);
      assert.doesNotMatch(text, /\b[45]\d\d\b/, `message for ${status}/${mode} leaks a code`);
      assert.ok(action === null || action === "settings");
    }
  }
  assert.deepEqual(toHost(core.errorMessage()), toHost(messageFor(undefined, undefined)));
});

test("modeIndicator describes each mode and only prompts for a key when there is none", () => {
  assert.deepEqual(toHost(core.modeIndicator("direct")),
    { text: "Direct: your searches go straight to Keenable.", action: null });
  assert.deepEqual(toHost(core.modeIndicator("shared")),
    { text: "Queries proxied through Froogle. Zero logs.", action: null });
  assert.deepEqual(toHost(core.modeIndicator("nokey")),
    { text: "No API key set.", action: "settings" });
});
