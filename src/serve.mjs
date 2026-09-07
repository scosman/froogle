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
   production 404s here too. Deliberately a prefix match rather than a gitignore engine: every line
   in .assetsignore is a plain path or a directory, and a real matcher would be more code than the
   server. If that file ever grows a glob, this needs to grow with it. */
const excluded = (await readFile(new URL(".assetsignore", ROOT), "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

function isExcluded(pathname) {
  const relative = pathname.replace(/^\//, "");
  return excluded.some((entry) => relative === entry || relative.startsWith(entry));
}

/* Stands in for the Workers ASSETS binding: a static file server over the repo root. */
async function serveAsset(request) {
  const { pathname } = new URL(request.url);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);

  /* A path that escapes the repo root is not a file this server has any business reading. */
  const target = new URL(relative, ROOT);
  if (!target.href.startsWith(ROOT.href) || isExcluded("/" + relative)) {
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

createServer(async (incoming, outgoing) => {
  /* The body is buffered rather than streamed. A search is capped at 8KB by the proxy itself, and
     buffering avoids Node's half-duplex stream plumbing for no loss of fidelity. */
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);

  const request = new Request(new URL(incoming.url, `http://${incoming.headers.host ?? "localhost"}`), {
    method: incoming.method,
    headers: incoming.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });

  let response;
  try {
    response = await worker.fetch(request, env);
  } catch (error) {
    console.error(error);
    response = new Response("Internal error", { status: 500 });
  }

  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`Froogle on http://localhost:${PORT}`);
  console.log(env.KEENABLE_API_KEY ? "Proxy: keyless, falling back to KEENABLE_API_KEY."
                                   : "Proxy: keyless only (set KEENABLE_API_KEY to add a fallback).");
});
