/* Node adapter: the local dev server, and a container entry point if one is ever wanted.
 *
 * Run it with `node src/serve.mjs` from the repo root. No install, no npx, no wrangler — which is
 * the point. The predecessor to this file was `wrangler pages dev .`, and that command emulated
 * Cloudflare Pages: a different product, with a different router, from the one this repo deploys
 * to. It passed while production 404ed. This server calls the very same worker.mjs that Cloudflare
 * calls, so a route that works here works there for the same reason.
 *
 * Node has no built-in fetch-style server, so the ~30 lines below are the bridge: node:http in,
 * Request out, Response in, node:http out. Deno and Bun need no such thing — `deno serve` and
 * `bun run` take worker.mjs's default export directly.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import worker from "./worker.mjs";

const ROOT = new URL("../", import.meta.url);
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

/* The same exclusions the deployed site uses, read from the same file, so a request that 404s in
   production 404s here too. Deliberately a path-prefix match rather than a gitignore engine: every
   line in .assetsignore is a plain path or a directory, and a real matcher would be more code than
   the server. It is narrower than gitignore in two known ways — it anchors at the root, where
   gitignore's `src/` would match a nested src/ as well, and it understands no globs. Both are
   true of the file as written; either becoming untrue means this has to grow with it. */
const excluded = (await readFile(new URL(".assetsignore", ROOT), "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

/* Matched on whole path segments, not on characters: a bare `startsWith` would hide a README.mdx
   behind the README.md entry, and dev would 404 a file production happily serves. */
function isExcluded(relative) {
  return excluded.some((entry) => {
    const name = entry.replace(/\/+$/, "");
    return relative === name || relative.startsWith(name + "/");
  });
}

/* Stands in for the Workers ASSETS binding: a static file server over the repo root. */
async function serveAsset(request) {
  const { pathname } = new URL(request.url);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);

  /* A path that escapes the repo root is not a file this server has any business reading. */
  const target = new URL(relative, ROOT);
  if (!target.href.startsWith(ROOT.href) || isExcluded(relative)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(fileURLToPath(target));
    const extension = relative.split(".").pop().toLowerCase();
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": MIME[extension] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const env = { ...process.env, ASSETS: { fetch: serveAsset } };

/* node:http in, Request out. */
async function toRequest(incoming) {
  /* The body is buffered rather than streamed. A search is capped at 8KB by the proxy itself, and
     buffering avoids Node's half-duplex stream plumbing for no loss of fidelity. It is read to the
     end even when it is then dropped, because an unread request body wedges keep-alive. */
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);

  /* A body on a GET or HEAD is dropped rather than forwarded. `new Request` throws outright on one
     — "Request with GET/HEAD method cannot have body" — and dropping it is also the more faithful
     emulation: Cloudflare hands the Worker a bodyless Request for those methods regardless. */
  const bodied = chunks.length > 0 && incoming.method !== "GET" && incoming.method !== "HEAD";

  return new Request(new URL(incoming.url, `http://${incoming.headers.host ?? "localhost"}`), {
    method: incoming.method,
    /* Node hands duplicate headers over as an array; Headers stringifies those, which is what a
       Worker would have received anyway. */
    headers: incoming.headers,
    body: bodied ? Buffer.concat(chunks) : undefined,
  });
}

async function handle(incoming, outgoing) {
  const response = await worker.fetch(await toRequest(incoming), env);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

createServer((incoming, outgoing) => {
  /* Nothing in here may reject unattended, and the catch has to be out here rather than around the
     worker call alone. Node's default for an unhandled rejection is to print it and exit, so a
     single malformed request would take the whole dev server down — one curl flag away, since a
     GET carrying a body used to throw while building the Request, before the old try block began
     — and would leave the browser holding a socket nobody was ever going to answer. */
  handle(incoming, outgoing).catch((error) => {
    console.error(error);
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    outgoing.end("Internal error");
  });
}).listen(PORT, () => {
  console.log(`Froogle on http://localhost:${PORT}`);
  /* Deliberately does not claim an order: with a key configured, UNAUTHENTICATED_FIRST decides
     which credential is tried first, and this line would be wrong half the time if it guessed. */
  console.log(env.KEENABLE_API_KEY
    ? "Proxy: keyless and KEENABLE_API_KEY, in the order UNAUTHENTICATED_FIRST sets."
    : "Proxy: keyless only (set KEENABLE_API_KEY to add a fallback).");
});
