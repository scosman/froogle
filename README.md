# Froogle

A free web search engine that is one HTML file.

No frameworks, no build step, no dependencies, no images, no tracking, no accounts. Results come
from the [Keenable](https://keenable.ai) web search API. You can host it, or you can save
`index.html` to your Downloads folder and open it — it works from `file://`.

```
index.html                 the whole frontend: markup, CSS, JS
functions/api/search.js    the optional proxy (a Cloudflare Pages Function)
test/                      unit tests, dev-only, no dependencies
```

---

## The two modes

Froogle is a hybrid, because of a measured constraint in Keenable's CORS configuration:

* Keenable's **keyless** endpoint requires an `X-Keenable-Title` header, and their CORS preflight
  does not allow that header. **No browser can call it.**
* Keenable's **keyed** endpoint needs no such header, and `X-API-Key` *is* allowed. A browser
  holding a key can search Keenable directly.

So which request Froogle makes depends only on whether a key is available:

| Mode | When | What happens |
|---|---|---|
| **Direct** | A key is available — `API_KEY` in the file, or one the visitor saved in Settings | The browser calls `https://api.keenable.ai/v1/search` itself. Nothing touches a Froogle server. |
| **Shared** | No key, and a proxy answers at `PROXY_PATH` | The browser calls Froogle's own same-origin proxy, which calls the keyless endpoint for it and falls back to the operator's key. |
| **No key** | No key and no proxy — including anything opened over `file://` | Froogle explains that it needs a key, and links to Settings. |

The mode is decided per search, so saving or clearing a key takes effect immediately with no
reload. It is always shown in the footer.

---

## Deploying it

| Shape | Files | Modes available |
|---|---|---|
| Downloads folder, `file://` | `index.html` | Direct |
| Any static host — GitHub Pages, S3, Netlify, nginx | `index.html` | Direct |
| Cloudflare Pages | `index.html` + `functions/api/search.js` | Direct and shared |

### Downloads folder

Save `index.html`, open it, and paste a Keenable key into Settings. There is no proxy over
`file://` and there never can be, so Froogle never attempts one — no doomed request, no console
error.

### A static host

Copy `index.html` anywhere that serves files. Visitors search in direct mode with their own key.

`PROXY_PATH` is a **relative** path by design. A copy of `index.html` on another host resolves it
against *that* host, so a self-hosted copy structurally cannot reach the original operator's proxy
— unlike a hardcoded domain, which is a string anyone can edit. If nothing answers there, the first
keyless search of the session costs one wasted request and then Froogle remembers, for the rest of
that browser session, to go straight to the key prompt instead.

### Cloudflare Pages, with shared mode

Connect the repository to Cloudflare Pages. There is no build command and no output directory to
set — deploy the repo root as-is. Pages picks up `functions/api/search.js` on its own and serves it
at `/api/search`, same-origin with the page, which is why there is no CORS configuration, no
preflight, and no origin allowlist anywhere in this project.

Optionally set `KEENABLE_API_KEY` in the Pages environment so the proxy can fall back to your own
key when the keyless tier is busy. **If you are exposing this publicly, read
[Running a public instance](#running-a-public-instance) first.**

---

## Configuration

### Frontend — constants at the top of `index.html`

| Name | Default | Meaning |
|---|---|---|
| `SEARCH_ENGINE_NAME` | `"Froogle"` | The engine's name everywhere it appears: the wordmark, the page title, the favicon letter, the About and Settings prose, the footer mode line, and the error messages that name it. Blank or whitespace-only falls back to `"Froogle"`. |
| `API_KEY` | `""` | A Keenable key baked into the file. **See the warning below.** |
| `PROXY_PATH` | `"/api/search"` | Same-origin path to the proxy. Relative by design. Set it to `""` to disable shared mode entirely. |

If you rename the engine, change `SEARCH_ENGINE_NAME` in **both** `index.html` and
`functions/api/search.js` — the proxy sends it to Keenable as the `X-Keenable-Title` attribution
string and cannot read the frontend's config.

### Proxy — Cloudflare environment variables

| Name | Default | Meaning |
|---|---|---|
| `KEENABLE_API_KEY` | unset | The operator's Keenable key, used only when the keyless tier fails. Leave it unset and the proxy is keyless-only. |
| `UNAUTHENTICATED_FIRST` | `true` | Try the keyless endpoint before the key. Set to `false` to reverse the order. |

The proxy falls back **at most once**, and only on 401, 402, 429 or 5xx. A 400 is never retried: a
malformed query fails identically on both tiers, so a retry would only burn quota. Keenable's
status and body are returned unchanged, so error messages read the same in both modes.

With `KEENABLE_API_KEY` unset there is nothing to fall back to, so the proxy passes the upstream
response straight through — a 429 included. A fork deployed without a key inherits no exposure to
anyone else's credits.

---

## ⚠️ An `API_KEY` in a public file is public

`API_KEY` is written into `index.html`, and `index.html` is served to the browser verbatim. **Anyone
who views source on a publicly hosted copy can read the key and spend your credits.** There is no
way around this: the file is the deployment.

Set `API_KEY` only for a copy that is not public — a `file://` copy on your own machine, an
intranet, or a password-gated host. For a public deployment, leave it empty and put the operator's
key in the proxy's `KEENABLE_API_KEY` environment variable instead, where it stays server-side.

Visitors' own keys are never affected by this: a key saved through Settings lives in that browser's
`localStorage`, is sent only to Keenable, and never reaches the proxy.

---

## Running a public instance

**Put a platform rate-limiting rule in front of `/api/search` before you expose it.** This is a
required step, not a suggestion, if the proxy has a `KEENABLE_API_KEY` behind it — otherwise
anyone can spend your credits at whatever rate they can issue requests.

The proxy deliberately has **no rate limiter of its own**. It holds no per-request state at all: no
counters, no cache entries, nothing keyed on the visitor. That is what lets it promise it stores
nothing, and it is what keeps deployment down to "connect the repo". Rate limiting belongs at the
platform edge, where it works across colos and leaves the logging decision with you.

On Cloudflare: **Security → WAF → Rate limiting rules**, matching on the path `/api/search`. Any
other host has an equivalent. Pick limits that suit your budget; the proxy will pass the platform's
rejection through as any other error.

Two other things worth doing on a public instance:

* Add `Content-Security-Policy: frame-ancestors 'none'` (or `X-Frame-Options: DENY`) at the edge.
  The page ships a CSP in a `<meta>` tag, but `frame-ancestors` is ignored there, so clickjacking
  protection is only available to a hosted instance that sets a real header.
* Decide what your host logs. Froogle's own proxy logs nothing, but queries never reach it in a
  loggable form anyway — see below.

---

## Privacy

* **Queries live in the URL fragment.** Every URL Froogle generates uses `#` (`#q=…`, `#about`),
  and browsers never send the fragment to a server. A query therefore appears in no access log, no
  CDN log, and no `Referer` header. Legacy `?q=` links are accepted and immediately rewritten to
  the `#` form, leaving no extra history entry.
* **No cookies, no analytics, no third-party code**, in any mode.
* **The proxy logs nothing and stores nothing.** In shared mode Keenable sees the proxy's egress
  IP, not the visitor's.
* **In direct mode nothing touches a Froogle server at all.** Keenable sees the query and the
  visitor's IP address.
* A saved API key is held in the browser's `localStorage` and is sent only to Keenable. It is never
  attached to a proxy request — that decision is a pure function, `searchRequest`, with a test on
  it.
* Search results are remote, untrusted content. They are inserted as text nodes only; a result URL
  becomes a link only after it parses as `http:` or `https:`, and every result link carries
  `rel="noopener noreferrer"`.

---

## Development

There is no `package.json`, nothing to install, and nothing to build. Tests use Node's built-in
runner (Node 18+):

```sh
node --test
```

Run it from the repository root. **Not** `node --test test/` — Node 22 resolves a bare directory
argument as a module and fails; bare `node --test` discovers `test/` on its own.

* `test/core.test.mjs` extracts the pure core of `index.html` — the region between the
  `FROOGLE:CORE:BEGIN` / `:END` markers — and evaluates it in a sandbox that holds nothing but the
  language plus `URL` and `URLSearchParams`. That both tests the logic and keeps the region free of
  DOM, network and storage dependencies.
* `test/proxy.test.mjs` loads `functions/api/search.js` and injects a stub `fetch`.

Test files are `.mjs` deliberately: with no `package.json` to declare the module type, an ESM `.js`
test would load only through Node's module-syntax detection, silently raising the project's floor
from Node 18 to Node 20.19 / 22.7.

### Manual test checklist

The DOM and `fetch` layers are covered here rather than by unit tests. Work through this before
shipping a change to the browser layer.

**Deployment and mode**

- [ ] On a Cloudflare Pages build with the Function deployed, and **no key saved**, the About and
      Settings prose shows the *shared* wording — "two ways your search can reach them", the
      **Shared** bullet, and the Settings paragraph about a shared allowance.
- [ ] On `file://`, the same prose shows the *solo* wording — no shared mode, no shared allowance.
- [ ] A keyless search on the hosted build returns results through the proxy, and the footer reads
      "Queries proxied through Froogle. Zero logs."
- [ ] Saving a key on that build flips the footer, the Settings key-state line and the next search
      to direct with no reload — and the About prose keeps its shared wording, because the
      deployment still has a shared allowance.
- [ ] `index.html` alone on a static host with no Function: the first keyless search costs one
      request and lands on the key prompt; every later search in that session goes straight to the
      key prompt with no network request at all; a new tab tries once more.
- [ ] Over `file://`, a keyless search goes straight to the key prompt with no request attempted
      and nothing in the console.
- [ ] The Settings key-state line, the footer indicator and an attempted search all agree about the
      mode, in every combination of key present/absent and `file://`/hosted.
- [ ] Loads and searches from `file://` with a stored key.

**Routing**

- [ ] Back and forward move between home, results, about and settings.
- [ ] A legacy `?q=` URL normalizes to `#q=` and leaves no extra history entry (one Back press
      returns to wherever you came from, not to the `?q=` URL).

**Accessibility and layout**

- [ ] Keyboard-only operation throughout, with a visible focus ring on every control.
- [ ] Keyboard focus survives a search started from either Search button — including the two
      failures that return early without a request.
- [ ] Tapping Search on a touch device does **not** re-open the on-screen keyboard over the
      results. (This is why the focus restore tests `:focus-visible` rather than
      `document.activeElement`; a regression is invisible on a desktop browser.)
- [ ] A screen reader announces the result count when results arrive, rather than falling silent
      after "Searching…".
- [ ] Renders correctly at 320px width with no horizontal scrolling.

**Robustness**

- [ ] With storage disabled (Safari private mode, or "block all cookies"), the app degrades to the
      no-key state rather than breaking.
- [ ] With JavaScript disabled, the page explains that Froogle needs it.

---

## Search operators

Typed into the search box; anything not recognized stays part of the query text.

| Typed | Effect |
|---|---|
| `site:example.com` | Restrict to one domain |
| `after:2026-01-01` | Published on or after a date |
| `before:2026-01-01` | Published before a date |

There is no pagination, and no pager is drawn: Keenable exposes no offset, page or cursor
parameter, and returns no total. Froogle asks for 25 results and renders every one it gets.

---

## Not in v1

A cached-page view (Keenable's `GET /v1/fetch` returns any page as markdown), point-in-time search
via `query_time`, and keyless zero-signup search — the last of which becomes possible the day
Keenable adds `X-Keenable-Title` to their CORS allowlist, and would let the proxy be demoted or
removed entirely.
