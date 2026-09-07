// Unit tests for src/worker.mjs, the Cloudflare adapter.
//
// The adapter is routing and nothing else, so these tests are about exactly one question: does a
// request reach the proxy, the asset server, or neither. The routing it replaces used to be
// Cloudflare's — a functions/ directory that was itself the route table — and losing it silently
// is what made a working proxy look absent to index.html. That is worth three assertions.

import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "./worker.mjs";

/* An ASSETS binding that records rather than serves. */
function stubAssets() {
  const calls = [];
  return {
    calls,
    fetch(request) {
      calls.push(new URL(request.url).pathname);
      return new Response("index", { status: 200 });
    },
  };
}

function get(path) {
  return new Request("https://froogle.example" + path);
}

test("a request that is not the proxy path goes to the assets binding", async () => {
  const ASSETS = stubAssets();
  for (const path of ["/", "/index.html", "/api/search/extra", "/api/searchx"]) {
    const response = await worker.fetch(get(path), { ASSETS });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(ASSETS.calls, ["/", "/index.html", "/api/search/extra", "/api/searchx"]);
});

test("a query string does not stop the proxy path from matching", async () => {
  const ASSETS = stubAssets();
  const request = new Request("https://froogle.example/api/search?x=1", { method: "POST", body: "{" });
  const response = await worker.fetch(request, { ASSETS });
  assert.equal(response.status, 400, "reached the proxy, which refused the malformed body");
  assert.deepEqual(ASSETS.calls, [], "the asset server was not consulted");
});

test("a non-POST on the proxy path is a 405, the status index.html reads as 'no proxy here'", async () => {
  const ASSETS = stubAssets();
  const response = await worker.fetch(get("/api/search"), { ASSETS });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST");
  assert.deepEqual(ASSETS.calls, []);
});

test("a POST on the proxy path reaches the handler", async () => {
  const request = new Request("https://froogle.example/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "" }),
  });
  const response = await worker.fetch(request, { ASSETS: stubAssets() });
  assert.equal(response.status, 400, "the handler validated the body rather than the adapter");
});
