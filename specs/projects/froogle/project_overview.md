---
status: draft
---

# Froogle

A free search engine over the [Keenable](https://keenable.ai) web search API.

CORS on `api.keenable.ai` is open (verified by the project owner), so the browser can call the
keyless public endpoint directly. That removes the backend entirely: every visitor spends their
**own** IP's keyless quota, so the engine costs nothing to run and has no shared rate limit to
protect.

## The repo

Two files. That's it.

* `index.html` — the entire search engine. Markup, CSS, and JS in one file.
* `README.md`

## Self hosting

"Anywhere you can host an HTML file" — GitHub Pages, S3, Cloudflare Pages, Netlify, a static
nginx, or your own Downloads folder opened over `file://`.

## Config

JS variables at the top of `index.html`:

* `SEARCH_ENGINE_NAME` — default `"Froogle"`
* `API_KEY` — default none
* `UNAUTHENTICATED_FIRST` — bool, default `false`. When an API key is present and this is set, try
  the keyless endpoint first and fall back to the key on rate limits.

## Design

Inspired by old-school web search: a wordmark above a search box, a small about link at the bottom,
and a SERP that is a plain list of links. **Inspired by, not a clone** — no Google colors, fonts,
logo forms, or layout measurements. No frameworks, no build step, no dependencies, no images.

## About page

Part of the same single-page app, at `#about`. Covers roughly what the README covers, rendered for
the web:

* A free single-page search engine.
* How it works: calls Keenable directly from your machine. Your queries never pass through Froogle.
* Privacy: Froogle tracks nothing.

## Routing and privacy

The fragment is never sent to a server, so all generated URLs use `#` (`#q=...`, `#about`). Legacy
`?q=` / `?about` links are accepted inbound and normalized to `#`.
