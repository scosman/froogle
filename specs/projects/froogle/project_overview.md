---
status: complete
---

# Froogle

A free search engine over the [Keenable](https://keenable.ai) web search API.

Hybrid, because of a measured constraint in Keenable's CORS config: the **keyless** endpoint
requires an `X-Keenable-Title` header that their own preflight forbids, so no browser can call it;
the **keyed** endpoint has no such requirement and is browser-callable.

The visitor chooses which of the two the page uses, in Settings; the choice is stored separately
from the key, and constrained only by what a given copy of the page can actually do.

* **Proxied mode** (the default) — the browser calls Froogle's own thin proxy, which tries the
  keyless endpoint first and falls back to the operator's key. Zero setup, and Froogle passes on
  no identifier and no visitor IP.
* **Direct mode** — with a key (baked in by a self-hoster, or saved by a visitor into
  `localStorage`), the browser calls Keenable itself. Nothing touches a Froogle server.

## The repo

* `index.html` — the entire frontend. Markup, CSS, and JS in one file.
* `src/search.mjs` — the optional proxy, same-origin, plus the thin adapters that route to it
  (`src/worker.mjs` on Cloudflare, `src/serve.mjs` on Node).
* `README.md`, `LICENSE` (MIT)

## Self hosting

"Anywhere you can host an HTML file" — GitHub Pages, S3, Cloudflare, Netlify, a static nginx, or
your own Downloads folder opened over `file://`. Shared mode additionally needs a host that runs the
proxy; the repo ships ready to deploy as a Cloudflare Worker.

## Config

JS variables at the top of `index.html`:

* `SEARCH_ENGINE_NAME` — default `"Froogle"`
* `API_KEY` — default none
* `PROXY_PATH` — default `"/api/search"`, a relative path, so a self-hosted copy resolves to
  its own origin and can never reach someone else's proxy

Proxy environment: `KEENABLE_API_KEY`, `UNAUTHENTICATED_FIRST` (default true).

## Design

White ground, `#111` ink, a Helvetica-first stack, one blue link, a 660px measure. A wordmark and
a tagline above an underlined search field on home; a wordmark, field and utility row above a plain
list of links on the SERP. No frameworks, no build step, no dependencies, no images, no icons. See
`ui_design.md`.

## About page

Part of the same single-page app, at `#about`. Covers roughly what the README covers, rendered for
the web:

* A fast, ad-free search engine — fast, ad-free, simple, private.
* Powered by the Keenable API, and not associated with Keenable.
* Privacy: Keenable sees every query and may track it. On the Froogle side, the two modes and
  their tradeoffs — proxied, where Froogle logs nothing and passes on no identifier or IP, and
  direct, where the browser talks to Keenable itself with the visitor's own key.
* Self hosting, with a link to the repo.

## Routing and privacy

The fragment is never sent to a server, so all generated URLs use `#` (`#q=...`, `#about`). Legacy
`?q=` / `?about` links are accepted inbound and normalized to `#`.
