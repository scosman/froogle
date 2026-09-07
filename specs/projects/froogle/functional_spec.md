---
status: complete
---

# Functional Spec: Froogle

A free web search engine that runs as a single HTML page against the
[Keenable](https://keenable.ai) search API.

## Why it is shaped this way

Keenable's API is browser-callable, but not in every mode. Measured behavior (see
`api_research.md` for the full contract):

* The **keyless** endpoint requires an `X-Keenable-Title` header, and Keenable's CORS preflight
  returns a static `Access-Control-Allow-Headers` list that omits it. No browser can call the
  keyless endpoint. This is a defect on their side and may be fixed later.
* The **keyed** endpoint needs no such header, and `X-API-Key` *is* on the preflight allowlist. A
  browser holding a key can search directly. Measured: `POST /v1/search` with only `Content-Type`
  and `X-API-Key` returns 200.

So the app has two request paths, and which one runs depends only on whether a key is available.

## The two modes

### Direct mode

The browser calls `POST https://api.keenable.ai/v1/search` itself, with `X-API-Key`. Used whenever
a key is available, from either:

* `API_KEY` — a config constant baked into `index.html` by a self-hoster, or
* a key the visitor saved into `localStorage` through the settings view.

Nothing touches a Froogle server. On the hosted instance, a visitor who saves a key never calls the
proxy again.

### Shared mode

No key available. The browser calls Froogle's own proxy, which performs the search server-side and
returns the same JSON shape. This is what a first-time visitor to the hosted instance gets.

The proxy tries the keyless endpoint first (it can send `X-Keenable-Title`, having no CORS
constraint) and falls back to the operator's own API key when that fails.

Mode is decided per request, at call time, so saving or clearing a key takes effect immediately
with no reload.

## Deployment shapes

| Shape | Files used | Mode available |
|---|---|---|
| Downloads folder / `file://` | `index.html` | Direct (key in config or localStorage) |
| Any static host | `index.html` | Direct |
| Cloudflare Pages + Function | `index.html`, `functions/api/search.js` | Both |

The proxy is a Cloudflare Pages Function at `/api/search`, which makes it **same-origin** with the
page. There is therefore no CORS configuration on Froogle's own proxy, no preflight, and no origin
allowlist to maintain. A self-hoster who wants only direct mode copies `index.html` and ignores the
rest of the repo.

## Repo

* `index.html` — the whole frontend: markup, CSS, JS. No frameworks, no build step, no
  dependencies, no images, no network requests other than to the search API or the proxy.
* `functions/api/search.js` — the proxy. Optional.
* `README.md`

## Configuration

### Frontend — constants at the top of `index.html`

| Name | Default | Meaning |
|---|---|---|
| `SEARCH_ENGINE_NAME` | `"Froogle"` | The engine's name everywhere it appears: wordmark, `<title>`, favicon letter, the About and Settings prose, the mode indicator, the key-state line, and the error messages that name it. Blank or whitespace-only falls back to `"Froogle"` |
| `API_KEY` | `""` | Baked-in Keenable key. Publishes the key if the page is public; intended for `file://`, intranet, and personal deploys |
| `PROXY_PATH` | `"/api/search"` | Same-origin path to the proxy. Relative by design (see below) |

Key resolution order: `API_KEY` → `localStorage` → none (shared mode if a proxy responds at
`PROXY_PATH`, otherwise the no-key state).

`PROXY_PATH` is deliberately a **relative** path, and the repo ships deployable as-is:

* Deployed whole to Cloudflare Pages, it resolves to that deployment's own Function. No
  deploy-time substitution, no build step, no domain baked into the source.
* Copied as a lone `index.html` to any other static host, it resolves to *that* host, where nothing
  is listening. A self-hosted copy therefore **cannot** reach the original operator's proxy — a
  structural guarantee, unlike a hardcoded domain check, which is a client-side string anyone can
  edit.
* A self-hoster who deploys the whole repo gets shared mode against their own proxy and their own
  key, with no edits.
* Over `file://` no proxy can exist, so the app short-circuits on `location.protocol === "file:"`
  and never attempts one — no doomed request, no console error, straight to the key prompt.

Anywhere else, the first failure (404, a non-JSON body, or a network error) marks the proxy
unavailable for the rest of the session via `sessionStorage`, so a static-only deployment wastes
one request per session rather than one per search, and every later search goes straight to the
key prompt.

### Proxy — environment variables

| Name | Default | Meaning |
|---|---|---|
| `KEENABLE_API_KEY` | unset | Operator's key, used when keyless fails |
| `UNAUTHENTICATED_FIRST` | `true` | Try keyless before the key |

## Views and routing

One page, four views, selected by the URL fragment.

| Fragment | View |
|---|---|
| *(none)* | Home |
| `#q=<query>` | Results |
| `#about` | About |
| `#settings` | Settings |

The fragment is never transmitted to a server, so a query is never present in any access log,
CDN log, or `Referer` header. All URLs the app generates use `#`.

Legacy `?q=` and `?about` links are accepted on load and normalized to the `#` form via
`location.replace`, so they leave no extra history entry. `<meta name="referrer" content="no-referrer">`
is set regardless, so even a visitor arriving on a `?q=` link leaks nothing onward when clicking a
result.

Navigation is driven by `hashchange`, which works identically over `http(s)` and `file://` —
unlike `history.pushState`, which browsers block on `file://` URLs. Back and forward work normally.

### Home

Centered wordmark, a single text input, a submit button. Footer: About, Settings, mode indicator.
Focus is placed in the input on load.

The mode indicator reads:

* Direct — "Direct: your searches go straight to Keenable."
* Shared — "Queries proxied through Froogle. Zero logs."

### Results

Small wordmark top-left linking home, the search box beside it prefilled with the current query, a
thin rule, then the result list. Same footer.

### About

Static prose in the same page. Content:

* What Froogle is: a free single-page search engine, one HTML file, no tracking, no ads, no
  accounts.
* How it works: results come from Keenable. In direct mode your browser calls Keenable itself and
  your query never reaches a Froogle server. In shared mode your query passes through Froogle's
  proxy, which stores nothing and logs nothing.
* Privacy, stated precisely rather than as a slogan: Froogle sets no cookies, runs no analytics,
  and includes no third-party code. A saved API key is held in your browser's `localStorage` and is
  sent only to Keenable. Whoever hosts the page can see that the page was requested, never what was
  searched. Keenable sees the query and, in direct mode, your IP address.
* A link to the source repo and to Keenable.

### Settings

Explains the two modes and why a key helps: a personal key means searches go straight to Keenable,
and Keenable's free tier is far larger than the shared allowance. A text input to paste a key, a
Save, and a Clear. Links to Keenable's console to get one free. States that the key stays in this
browser.

Saving validates the key with a real search request before storing it, and reports failure rather
than silently saving a bad key.

## Search behavior

### Query parsing

Operators are parsed out of the raw input string and mapped onto API parameters. Everything not
recognized as an operator remains the query text.

| Typed | Sent as |
|---|---|
| `site:example.com` | `site` |
| `after:2026-01-01` | `published_after` |
| `before:2026-01-01` | `published_before` |

An operator with an empty or malformed value is left in the query text rather than sent as a
filter. There are no UI controls for filters; the search box is the whole interface.

### Request

```
POST <endpoint>
Content-Type: application/json
X-API-Key: <key>          (direct mode only)

{ "query": "...", "mode": "pro", "max_results": 25, "snippet_max_length": 400, ...filters }
```

* `mode` is always `"pro"`. `"realtime"` is faster but shallower, and depth matters more than
  latency for a web SERP. Note that `mode` is absent from Keenable's documented parameter list
  even though the API accepts it and both official SDKs send it; it is unpromised, so the client
  must not break if it is ever rejected.
* `max_results` is set to 25. Documented range is 1-50, default 10; measured working at 25.
* `snippet_max_length` is set to 400. Documented range 180-10000; outside it the API returns 400.
  It is a **soft target that rounds to a content boundary**, not a hard cap: requesting 180
  returned 136-294 characters, requesting 400 returned 385-498. Two clamped lines need ~180
  visible characters, so 400 keeps every snippet full even at the low end, while cutting the
  payload from ~50KB to ~10KB across 25 results against the ~2,000-character default. The UI
  truncates independently, because the cap is approximate in both directions.
* `credentials` is never set to `"include"`. Keenable returns
  `Access-Control-Allow-Credentials: true`, and there is no reason to attach cookies to a search.
* Requests are aborted after 15 seconds via `AbortSignal`.
* Only the most recent search renders. If a second search starts before the first resolves, the
  first is aborted, so results can never arrive out of order.

### Response and result rendering

Response shape: `{ query, mode, results: [{ title, url, description, snippet?, published_at?, acquired_at? }] }`.

Every returned result is rendered, in the order given. There is **no pagination**: Keenable exposes
no `offset`, `page`, or cursor, and returns no total — `max_results` sets the size of the single
response and nothing addresses a second page. The list simply ends, and no pager control is drawn,
because there is no second page to request.

Each result renders as:

* **Title** — a link to `url`. Falls back to the URL's hostname when `title` is empty.
* **URL line** — the URL as plain text beneath the title, not a link.
* **Snippet** — `snippet || description || ""`. Keenable's sources disagree about which field is
  populated, so both are handled. `snippet` is raw extracted page text containing newlines, not a
  prepared SERP snippet: whitespace is collapsed and the text is clamped to two lines.
* **Date** — when `published_at` is present, a short formatted date prefixes the snippet.

All result text is inserted as text nodes, never as HTML, so remote content cannot inject markup.
Result links carry `rel="noopener noreferrer"`.

Only `http:` and `https:` result URLs are linked; anything else renders as plain text.

### Look

Inspired by early-2000s web search, not a reproduction of any specific engine. Plain system fonts,
a light background, a restrained palette chosen for this project. Underlined link titles, a muted
URL line, generous whitespace, a comfortable maximum line length for readability. No logo artwork,
no icons, no images of any kind.

## Proxy behavior

`POST /api/search` accepts `{ query, mode, snippet_max_length, site, published_after,
published_before, acquired_after, acquired_before }`, allowlisting those fields and rejecting
anything else, then:

1. If `UNAUTHENTICATED_FIRST`, calls `POST /v1/search/public` with
   `X-Keenable-Title: <SEARCH_ENGINE_NAME>`.
2. On 401, 402, 429, or 5xx, retries once against `POST /v1/search` with `KEENABLE_API_KEY`.
   A 400 is **not** retried: a bad query fails identically on both tiers, so retrying only burns
   quota.
3. If `UNAUTHENTICATED_FIRST` is false, the order is reversed.
4. Returns Keenable's JSON body and status unchanged.

The retry against the key only happens when `KEENABLE_API_KEY` is set. Without one the proxy is
keyless-only and passes the upstream response straight through, a 429 included.

It logs nothing and stores nothing — no counters, no per-visitor state of any kind. An operator
running a public instance is expected to put a platform rate-limiting rule (a Cloudflare Rate
Limiting rule, or the equivalent on another host) in front of it.

Keenable sees the proxy's egress IP, not the visitor's, so the keyless allowance is consumed per
Cloudflare egress IP and shared with other traffic from that IP. The fallback to the operator's key
exists precisely because that allowance is unpredictable.

## Error handling

Errors render in place of the result list, in plain language, with the search box still populated
so the query can be edited and retried. No error exposes a raw status code or stack.

| Condition | Shown |
|---|---|
| 429, direct mode | Too many searches. Keenable allows a limited number per hour; wait a few minutes. |
| 429, shared mode | Froogle's shared allowance is busy. Wait a moment, or add your own free key — with a link to Settings. |
| 401 / 403, direct mode | The API key was rejected — with a link to Settings. |
| 402, direct mode | The account is out of credits. |
| 400 | The search could not be understood — usually a malformed operator. |
| 5xx, or network failure | Search is unavailable right now. Try again. |
| Timeout / abort | The search took too long. Try again. |
| No key and no proxy | Explains that Froogle needs a Keenable key in this deployment, with a link to Settings. |
| Zero results | "No results found for <query>." No error styling. |

Keenable sends `X-RateLimit-Limit`, `-Remaining`, and `-Reset`, but omits them from
`Access-Control-Expose-Headers`, so browser JS cannot read them. No quota indicator or reset
countdown is possible in direct mode; a limit is discoverable only when a 429 arrives.

## Accessibility and robustness

* Works with keyboard alone; visible focus states.
* Search box is a real `<form>` with a labelled `<input type="search">`.
* Semantic list markup for results, so screen readers announce the count.
* Layout is responsive down to a phone width with no horizontal scrolling.
* Loading state while a search is in flight.
* If JavaScript is disabled the page explains that Froogle needs it, rather than showing an empty
  box that silently fails.

## Out of scope for v1

* **Cached page view.** Keenable's `GET /v1/fetch` returns any page as clean markdown, which would
  support a "Cached" link per result. Deferred to a later phase.
* Search suggestions, autocomplete, instant results.
* Result feedback, though `POST /v1/feedback` exists.
* Image, video, news, or any vertical other than web.
* Themes, dark mode, or any user-configurable appearance.
* Analytics of any kind, in any mode.

## Open items

* **`query_time`** is a documented point-in-time search parameter: it excludes pages acquired after
  a given instant. Not used in v1, but a natural fit for a later "search the web as it was"
  feature.
* **Ask Keenable to allowlist `X-Keenable-Title`.** If they do, keyless becomes available to the
  browser and can become the zero-signup default, with the proxy demoted or removed.
