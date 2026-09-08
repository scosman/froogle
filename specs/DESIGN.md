# Froogle Technical Design

A free web search engine that is one HTML file.

No frameworks, no build step, no dependencies, no images, no tracking, no accounts. Results come
from the [Keenable](https://keenable.ai) web search API. You can host it, or you can save
`index.html` to your Downloads folder and open it — it works from `file://`.

```
index.html                 the whole frontend: markup, CSS, JS
src/search.mjs             the optional proxy: (request, env) => Response, no platform APIs
src/worker.mjs             Cloudflare adapter — routing only
src/serve.mjs              Node adapter — the dev server, no dependencies
src/*.test.mjs             unit tests, dev-only, no dependencies
wrangler.jsonc             Cloudflare deployment config
```

MIT licensed — see [LICENSE](LICENSE).

---

## The two modes

Froogle is a hybrid, because of a measured constraint in Keenable's CORS configuration:

* Keenable's **keyless** endpoint requires an `X-Keenable-Title` header, and their CORS preflight does not allow that header. **No browser can call it.**
* Keenable's **keyed** endpoint needs no such header, and `X-API-Key` *is* allowed. A browser holding a key can search Keenable directly.

So there are two request paths, and **the visitor chooses** which one their searches take, in
Settings:

| Mode | What happens | Setup |
|---|---|---|
| **Proxied** (default) | The browser calls Froogle's own same-origin proxy, which calls Keenable's keyless endpoint for it and falls back to the operator's key. Froogle logs nothing and passes on no identifier and no visitor IP, so a query is mixed in with every other visitor's. May hit rate limits. | None |
| **Direct** | The browser calls `https://api.keenable.ai/v1/search` itself with the visitor's own key. Nothing touches a Froogle server, so Froogle never sees the query — and Keenable can identify the visitor by that key. | A free Keenable account and key |

The choice lives in `localStorage` at `froogle.mode`, **separately from the key** at
`froogle.key`, so switching to Proxied and back never throws a saved key away. It defaults to
Proxied.

Settings is a form: the radio and the Clear link are pending until you press Save, which commits
the mode and the key together or neither. That is what makes Direct-with-no-key unreachable —
saving it is refused on the key field rather than accepted and then reported everywhere as
"Settings: no key".

The mode is applied per search, so saving Settings takes effect immediately with no reload, and the
mode in use is shown on every view by the Settings link itself, which reads "Settings: Proxied",
"Settings: Direct" or "Settings: no key".

Where a choice cannot be honoured, Froogle says so rather than quietly doing something else:

| Chosen | Situation | What Froogle does |
|---|---|---|
| Direct | No key saved | Settings will not save this combination; it survives only from outside, such as storage being cleared. The search then stops and asks for a key, and the setting stays on Direct. |
| Proxied | `file://`, or `PROXY_PATH` set to `""` | There is no server to proxy through, so Proxied is shown disabled with the reason, and searches use Direct. |
| Proxied | Nothing answers at `PROXY_PATH` — a lone `index.html` on a static host | The search says this copy has no proxy, and points at Direct plus a key. **The setting is kept**, so redeploying the same file behind a Function honours it again with nothing to re-choose. |

---

## Deploying it

| Shape | Files | Modes available |
|---|---|---|
| Downloads folder, `file://` | `index.html` | Direct |
| Any static host — GitHub Pages, S3, Netlify, nginx | `index.html` | Direct |
| Cloudflare Workers | `index.html` + `src/` + `wrangler.jsonc` | Direct and proxied |

### Local file

Save `index.html`, open it, then paste a Keenable key into Settings and press Save. There is no proxy over `file://` and there never can be, so Froogle never attempts one — no doomed request, no console error.

### A static host

Copy `index.html` anywhere that serves files. Visitors search in direct mode with their own key.

`PROXY_PATH` is a **relative** path by design. A copy of `index.html` on another host resolves it against *that* host, so a self-hosted copy structurally cannot reach the original operator's proxy
— unlike a hardcoded domain, which is a string anyone can edit. If nothing answers there, the first keyless search of the session costs one wasted request and then Froogle remembers, for the rest of that browser session, to go straight to the key prompt instead.

### Cloudflare Workers, with proxied mode

In the Cloudflare dashboard, **Workers & Pages → Create application → import your repository**.
There is no build command to set: `wrangler.jsonc` already names the entry point and the assets
directory, and every push to `main` deploys.

`src/worker.mjs` serves `/api/search`, same-origin with the page, which is why there is no CORS configuration, no preflight, and no origin allowlist anywhere in this project. It contains routing and nothing else — one path check, one method check — because Workers has no file-based routing of its own.

Optionally set `KEENABLE_API_KEY` in the Worker's environment so the proxy can fall back to your own
key when the keyless tier is busy. Add it under **Settings → Variables and Secrets** as a **Secret**,
not a plaintext variable: `wrangler deploy` replaces plaintext vars with whatever `wrangler.jsonc`
declares, and would wipe one set in the dashboard. Secrets are left alone. **If you are exposing
this publicly, read [Running a public instance](#running-a-public-instance) first.**

---

## Configuration

### Frontend — constants at the top of `index.html`

| Name | Default | Meaning |
|---|---|---|
| `SEARCH_ENGINE_NAME` | `"Froogle"` | The engine's name everywhere it appears: the wordmark, the page title, the favicon letter, the About and Settings prose, the Settings state lines, and the error messages that name it. Blank or whitespace-only falls back to `"Froogle"`. |
| `API_KEY` | `""` | A Keenable key baked into the file. **See the warning below.** |
| `PROXY_PATH` | `"/api/search"` | Same-origin path to the proxy. Relative by design. Set it to `""` to disable proxied mode entirely. |

Two of these are stated twice, because a browser page and a server module cannot share a constant:

* If you rename the engine, change `SEARCH_ENGINE_NAME` in **both** `index.html` and
  `src/search.mjs` — the proxy sends it to Keenable as the `X-Keenable-Title` attribution string and
  cannot read the frontend's config. A mismatch only misattributes; nothing breaks.
* If you move the proxy, change `PROXY_PATH` in **both** `index.html` and `src/worker.mjs`, which is
  what routes that path. A mismatch here *is* silent breakage — the page reads the resulting 404 as
  proof the deployment has no proxy and shows the key prompt instead — so `node --test` asserts the
  two agree.

### Proxy — Cloudflare environment variables

| Name | Default | Meaning |
|---|---|---|
| `KEENABLE_API_KEY` | unset | The operator's Keenable key, used only when the keyless tier fails. Leave it unset and the proxy is keyless-only. |
| `UNAUTHENTICATED_FIRST` | `true` | Try the keyless endpoint before the key. Set to `false` to reverse the order. |

The proxy falls back **at most once**, and only on 401, 402, 429 or 5xx. A 400 is never retried: a
malformed query fails identically on both tiers, so a retry would only burn quota. Keenable's
status and body are returned unchanged, so error messages read the same in both modes — with one
exception: a 2xx whose body will not parse as JSON becomes a 502 rather than being forwarded, so a
working proxy can never be mistaken by the page for an absent one.

Requests are allowlisted rather than forwarded — an open relay for arbitrary JSON would let anyone
spend the operator's key on anything Keenable offers. Only nine parameters are copied through, each
type-checked; `max_results` is clamped to 1–50 and `snippet_max_length` to 180–10000; and the
retrieval mode is pinned to `"pro"`. Keenable's other mode, `realtime`, **requires** an API key, so
accepting it would let an anonymous caller make the keyless tier refuse every request and be served
on `KEENABLE_API_KEY` instead. It is dropped, not honoured.

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

On Cloudflare: **Security → WAF → Rate limiting rules**, matching on the path `/api/search`. This
requires a **custom domain**. WAF and rate limiting are zone-level features, and a `*.workers.dev`
hostname is not in one of your zones — a rule written there will never fire. Attach a custom domain
to the Worker first, or treat `KEENABLE_API_KEY` as unset until you have. Any
other host has an equivalent. Pick limits that suit your budget. The rule matches at the edge,
*before* the Worker runs, so an over-limit request never reaches the proxy at all — the
browser gets the platform's 429 directly, and Froogle shows its "the proxy is busy" message
with a link to Settings to switch to Direct with a personal key.

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
* **The proxy logs nothing and stores nothing.** In proxied mode Keenable sees the proxy's egress
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
node --test          # the unit tests
node src/serve.mjs   # the app, on http://localhost:8787
```

Run both from the repository root. **Not** `node --test src/` — Node 22 resolves a bare directory
argument as a module and fails; bare `node --test` discovers `src/*.test.mjs` on its own.

`src/serve.mjs` replaces `wrangler pages dev`, which emulated a product this repo no longer deploys
to and would therefore pass on routing that fails in production. It bridges `node:http` to
`Request`/`Response` and hands the result to the same `src/worker.mjs` Cloudflare runs, including a
filesystem stand-in for the `ASSETS` binding that honours `.assetsignore`. Nothing to install.

* `src/core.test.mjs` extracts the pure core of `index.html` — the region between the
  `FROOGLE:CORE:BEGIN` / `:END` markers — and evaluates it in a sandbox that holds nothing but the
  language plus `URL` and `URLSearchParams`. That both tests the logic and keeps the region free of
  DOM, network and storage dependencies.
* `src/search.test.mjs` imports `src/search.mjs` and injects a stub `fetch`.
* `src/worker.test.mjs` checks the adapter's routing: proxy path, asset path, and the 405 that
  `index.html` reads as proof no proxy is there.

Test files are `.mjs` deliberately: with no `package.json` to declare the module type, an ESM `.js`
test would load only through Node's module-syntax detection, silently raising the project's floor
from Node 18 to Node 20.19 / 22.7.

### Manual test checklist

The DOM and `fetch` layers are covered here rather than by unit tests. Work through this before
shipping a change to the browser layer.

**Mode**

- [ ] On a deployed Worker, or against `node src/serve.mjs`, a first-time visitor searches with no
      setup, the Settings link reads "Settings: Proxied", and the request goes to `/api/search`.
- [ ] Moving the mode radio changes **nothing** until Save: the Settings link in the utility row,
      the state line under the radios, and a search all keep reporting the saved mode.
- [ ] Save with Direct chosen and no key saved is **refused** — the key field goes red, the reason
      appears under it, focus lands in it, and neither the mode nor the key is written.
- [ ] Save with Direct and a key flips the Settings link and the next search to direct with no
      reload.
- [ ] Save with a key Keenable rejects writes **nothing**, the mode included, and says so in red
      **under the key field** with focus moved there — not in the state lines under Save.
- [ ] Typing in the key field selects the **Direct** radio, and like the radio itself changes
      nothing until Save; moving the radio back to Proxied before saving still saves the key.
- [ ] The key field shows what is typed in it, and is still blank on arrival when a key is saved.
- [ ] Clear, beside the key field's label, only stages the removal: the key survives until Save,
      and Save under Direct with nothing typed is refused like any other keyless Direct.
- [ ] Saving Direct and then Proxied again does **not** lose the saved key.
- [ ] Leaving Settings mid-edit and coming back shows the saved mode and an empty key field.
- [ ] `index.html` alone on a static host with no Worker: the first search costs one request and
      lands on "this copy has no proxy"; every later search in that session makes no request to
      `/api/search` at all; the Proxied radio stays **enabled** and stays chosen, with its reason
      shown; a new tab tries once more.
- [ ] The same, but with a key already saved: the first search says the next one will go direct,
      and it does.
- [ ] Over `file://`, Proxied is shown **disabled** with its reason from the very first render, no
      request is attempted, and nothing appears in the console.
- [ ] On a working hosted build, going offline (DevTools → Network → Offline) and searching gives
      "Search is unavailable right now" — and then, back online, the very next search works. A
      dropped connection must **not** retire proxied mode for the session.
- [ ] The Settings state line, the utility-row Settings link and an attempted search all agree, in
      every combination of chosen mode, key present/absent, and `file://`/hosted.
- [ ] Loads and searches from `file://` with a stored key.
- [ ] The timing in the utility row shows a real elapsed time on results, and is absent before a
      search, on an error, and on About and Settings.

**Routing**

- [ ] Back and forward move between home, results, about and settings.
- [ ] A legacy `?q=` URL normalizes to `#q=` and leaves no extra history entry (one Back press
      returns to wherever you came from, not to the `?q=` URL).

**Accessibility and layout**

- [ ] Keyboard-only operation throughout, with a visible focus indicator on every control — the
      mode radios (arrow keys) and the text fields, whose focus is the rule turning blue and
      thickening rather than an outline, included.
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
      no-key state rather than breaking, and choosing a mode says plainly that the choice will be
      forgotten when the tab closes while still applying it for that tab.
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