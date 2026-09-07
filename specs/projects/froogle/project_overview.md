---
status: complete
---

# Froogle

A free search engine over the [Keenable](https://keenable.ai) web search API.

Hybrid, because of a measured constraint in Keenable's CORS config: the **keyless** endpoint
requires an `X-Keenable-Title` header that their own preflight forbids, so no browser can call it;
the **keyed** endpoint has no such requirement and is browser-callable.

* **Direct mode** — with a key (baked in by a self-hoster, or saved by a visitor into
  `localStorage`), the browser calls Keenable itself. Nothing touches a Froogle server. On the
  hosted instance, a visitor who sets a key never calls the proxy again.
* **Shared mode** — with no key, the browser calls Froogle's own thin proxy, which tries the
  keyless endpoint first and falls back to the operator's key.

## The repo

* `index.html` — the entire frontend. Markup, CSS, and JS in one file.
* `src/search.mjs` — the optional proxy, same-origin, plus the thin adapters that route to it
  (`src/worker.mjs` on Cloudflare, `src/serve.mjs` on Node).
* `README.md`

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

Inspired by old-school web search: a wordmark above a search box, a small about link at the bottom,
and a SERP that is a plain list of links. **Inspired by, not a clone** — no Google colors, fonts,
logo forms, or layout measurements. No frameworks, no build step, no dependencies, no images.

## About page

Part of the same single-page app, at `#about`. Covers roughly what the README covers, rendered for
the web:

* A free single-page search engine.
* How it works: results come from Keenable. In direct mode your browser calls them itself and your
  query never reaches a Froogle server; in shared mode it passes through Froogle's proxy, which
  logs and stores nothing.
* Privacy: no cookies, no analytics, no third-party code. A saved key stays in your browser.

## Routing and privacy

The fragment is never sent to a server, so all generated URLs use `#` (`#q=...`, `#about`). Legacy
`?q=` / `?about` links are accepted inbound and normalized to `#`.
