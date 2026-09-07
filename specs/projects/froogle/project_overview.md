---
status: draft
---

# Froogle

A free search engine over the [Keenable](https://keenable.ai) web search API.

CORS on `api.keenable.ai` is wide open (verified by the project owner), so the browser can call
the keyless public endpoint directly. That removes the backend entirely: every visitor spends
their **own** IP's keyless quota, so the engine costs nothing to run and has no shared rate limit
to protect.

## The repo

Two files. That's it.

* `index.html` — the entire search engine. Markup, CSS, and JS in one file. No frameworks, no
  build step, no dependencies, no images.
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

Very "old school Google". Just "Froogle" above the search box, small about at the bottom. SERP is
a simple list of links. No frameworks. No images.
