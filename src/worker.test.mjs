// Unit tests for src/worker.mjs, the Cloudflare adapter.
//
// The adapter is routing and nothing else, so these tests are about exactly one question: does a
// request reach the proxy, the asset server, or neither. The routing it replaces used to be
// Cloudflare's — a functions/ directory that was itself the route table — and losing it silently
// is what made a working proxy look absent to index.html — including, now, the assertion that this
// adapter's path and index.html's PROXY_PATH have not drifted apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

/* The one piece of this repo that is duplicated rather than shared: "/api/search" is a constant in
   index.html, where it is the path the page POSTs to, and a constant in worker.mjs, where it is the
   path this adapter answers on. Neither can import the other — index.html is a page, not a module,
   and worker.mjs must not export the string, because the Workers runtime reads every named export
   of the entry module as a handler and refuses a string one at startup.

   Drift between them is silent and looks like something else entirely. The page reads the 404 that
   a mismatch produces as proof the deployment has no proxy, retires proxied mode for the session,
   and shows the "bring your own key" prompt — which is exactly what a correct deployment with no
   proxy looks like. So the agreement is asserted here instead. */
test("the adapter answers on exactly the path index.html posts to", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const match = /\nconst PROXY_PATH = "([^"]*)";/.exec(html);
  assert.ok(match, "index.html must declare a PROXY_PATH constant");

  /* An empty PROXY_PATH is the documented way to turn proxied mode off, and then there is no path
     for the two to agree on. */
  if (match[1] === "") return;

  const ASSETS = stubAssets();
  const request = new Request("https://froogle.example" + match[1], { method: "POST", body: "{" });
  const response = await worker.fetch(request, { ASSETS });
  assert.equal(response.status, 400, "index.html's PROXY_PATH reached the proxy, not the assets");
  assert.deepEqual(ASSETS.calls, [], "the asset server was not consulted");
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
