/* Cloudflare adapter. Routing only — every decision about a search lives in search.mjs.
 *
 * This file exists because Cloudflare Workers has no file-based routing. Pages did: a file at
 * functions/api/search.js exporting onRequestPost *was* the route, which is why that directory
 * could not be renamed or moved. Workers asks for the route to be written down instead, and this
 * is it. The whole of what Pages was doing for us is the eight lines below.
 *
 * The shape — `export default { fetch(request, env) }` — is the interoperable one. It runs
 * unmodified on Deno and Bun as well, and env stays an argument rather than a global so the
 * handler never learns which platform it is on.
 */

import { handleSearch } from "./search.mjs";

/* Module-local, deliberately not exported. The Workers runtime treats every named export of the
   entry module as a handler and rejects a string one outright ("not of type 'function or
   ExportedHandler'"), which fails the Worker at startup rather than at request time. Node's test
   runner does not care, so nothing but the real runtime catches it. */
const PROXY_PATH = "/api/search";

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== PROXY_PATH) {
      /* Everything that is not the proxy is index.html and friends. On Cloudflare that binding is
         the asset server; serve.mjs passes its own equivalent. */
      return env.ASSETS.fetch(request);
    }

    /* Pages answered a non-POST on an onRequestPost-only route with a 405, and index.html reads
       405 as proof that no proxy is there (see proxyUnavailable). Keeping the status identical
       keeps that inference true. */
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }

    return handleSearch(request, env);
  },
};
