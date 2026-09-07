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

So the app has two request paths. Which one runs is the **visitor's choice**, made in Settings and
constrained only by what a given copy of the page can actually do.

## The two modes

The mode is a stored preference — `froogle.mode` in `localStorage`, `"proxied"` or `"direct"`,
defaulting to `"proxied"` — kept **separately from the key**, so switching modes never destroys a
saved key and switching back needs no re-entry. Both wordings below are the ones the About page
uses; Settings echoes them rather than inventing a second explanation.

### Proxied mode (the default)

Queries are proxied through Froogle's own server to the Keenable API. Nothing is logged or tracked
by Froogle. Keenable may still log and track, but no personal identifier and no visitor IP is
passed to them, so a visitor's traffic is mixed with every other Froogle user's. It may hit rate
limits. Zero setup — it is what a first-time visitor gets.

The proxy tries the keyless endpoint first (it can send `X-Keenable-Title`, having no CORS
constraint) and falls back to the operator's own API key when that fails.

### Direct mode

The visitor enters a Keenable API key, saved in their browser's `localStorage`. The browser calls
`POST https://api.keenable.ai/v1/search` itself, with `X-API-Key`; nothing touches a Froogle server
and Froogle never sees the queries. It needs a Keenable account, and Keenable can identify the
visitor by that unique key.

A key baked into the file by a self-hoster (`API_KEY`) is used the same way, and takes precedence
over a saved one.

### Where a choice cannot be honoured

The preference wins wherever it can be honoured. Where it cannot, the page says so plainly rather
than silently doing something else, and the stored preference is left untouched:

| Chosen | Situation | What happens |
|---|---|---|
| Direct | No key saved | The search fails with "Direct mode needs a Keenable API key", linking to Settings. The radio stays on Direct |
| Proxied | `file://`, or `PROXY_PATH` empty | Impossible — there is no server. The Proxied radio is shown disabled with a one-line reason, and searches use Direct |
| Proxied | The proxy answers 404/405, or unparseably | The search says this copy has no proxy, and either points at Direct plus a key or, when a key is already saved, notes the next search will go direct. The preference survives, so a later deploy that does have a proxy is honoured with no re-choosing |

Mode is computed per search, so saving a key or switching mode takes effect immediately with no
reload.

## Deployment shapes

| Shape | Files used | Mode available |
|---|---|---|
| Downloads folder / `file://` | `index.html` | Direct (key in config or localStorage) |
| Any static host | `index.html` | Direct |
| Cloudflare Worker + assets | `index.html`, `src/`, `wrangler.jsonc` | Both |

The proxy answers at `/api/search` on the deployment's own origin, which makes it **same-origin**
with the page. There is therefore no CORS configuration on Froogle's own proxy, no preflight, and no
origin allowlist to maintain. `src/search.mjs` is the handler and `src/worker.mjs` is the Cloudflare
adapter that routes that path to it; Workers has no file-based routing, so the route is written down
rather than implied by a filename. A self-hoster who wants only direct mode copies `index.html` and
ignores the rest of the repo.

The repo is MIT licensed; `LICENSE` sits at the root.

## Repo

* `index.html` — the whole frontend: markup, CSS, JS. No frameworks, no build step, no
  dependencies, no images, no network requests other than to the search API or the proxy.
* `src/search.mjs` — the proxy handler. Optional. `src/worker.mjs` and `src/serve.mjs` are the
  adapters that route to it, on Cloudflare and on Node respectively.
* `README.md`

## Configuration

### Frontend — constants at the top of `index.html`

| Name | Default | Meaning |
|---|---|---|
| `SEARCH_ENGINE_NAME` | `"Froogle"` | The engine's name everywhere it appears: wordmark, `<title>`, favicon letter, the About and Settings prose, the Settings state lines, and the error messages that name it. Blank or whitespace-only falls back to `"Froogle"` |
| `API_KEY` | `""` | Baked-in Keenable key. Publishes the key if the page is public; intended for `file://`, intranet, and personal deploys |
| `PROXY_PATH` | `"/api/search"` | Same-origin path to the proxy. Relative by design (see below) |

Key resolution order: `API_KEY` → `localStorage` → none. The key decides what Direct mode can do;
it no longer decides the mode, which is the visitor's stored choice.

`PROXY_PATH` is deliberately a **relative** path, and the repo ships deployable as-is:

* Deployed whole to Cloudflare, it resolves to that deployment's own proxy. No deploy-time
  substitution, no build step, no domain baked into the source. The path is therefore stated twice
  — here, and in `src/worker.mjs`, which routes it — and the two must agree; `src/worker.test.mjs`
  asserts that they do.
* Copied as a lone `index.html` to any other static host, it resolves to *that* host, where nothing
  is listening. A self-hosted copy therefore **cannot** reach the original operator's proxy — a
  structural guarantee, unlike a hardcoded domain check, which is a client-side string anyone can
  edit.
* A self-hoster who deploys the whole repo gets proxied mode against their own proxy and their own
  key, with no edits.
* Over `file://` no proxy can exist, so the app never offers the choice: Proxied is shown disabled
  with its reason, and searches use Direct. No doomed request, no console error.

Anywhere else, the first failure that **proves** nothing is listening — a 404, a 405, or a body
that will not parse as JSON, which is what a static host answering the proxy path with an HTML page
returns — marks the proxy unavailable for the rest of the session via `sessionStorage`, so a
static-only deployment wastes one request per session rather than one per search. Every later
search then either goes direct with a saved key or stops at the notice before any request is made.
The stored preference is deliberately **not** rewritten, so the same file redeployed behind a
Function honours it again with nothing for the visitor to re-choose.

A network failure is deliberately **not** one of those. It is indistinguishable from a dropped
connection, and retiring the proxy on it would let one bad moment on a phone downgrade the whole
session and, worse, leave the About page asserting this copy has no proxy when it does. A 5xx and a
timeout are excluded for the same reason: something is there and is having a bad minute.

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

Wordmark, tagline, a single text input and a submit button, centered in the viewport, with a
utility row beneath: About, Settings, and the mode line. Focus is placed in the input on load.

The mode line names the mode a search started now would use — "Mode: Proxied", "Mode: Direct", or
"Mode: no key" — and always links to Settings.

### Results

A masthead: the wordmark linking home, the search box beside it prefilled with the current query,
the submit button, then the utility row and a hairline. The utility row here also carries the
measured round trip of the request, shown to two decimals of a second and omitted whenever there
is nothing real to report. Then the result list.

The same masthead and utility row appear on About and Settings, so every view but home can search.

### About

Static prose in the same page. Content:

* What Froogle is: a fast, ad-free search engine — "like search from 2005" — with four bullets:
  fast, ad-free, simple, private.
* That it is powered by the Keenable API and not associated with Keenable.
* **Privacy.** Keenable sees every query and may track requests; their privacy policy is linked.
  Then the two Froogle-side modes and their tradeoffs, in full — this is the canonical wording,
  which Settings echoes — and a link to Settings to change the mode.
* **Self hosting.** Froogle is open source, can be self-hosted, and can be as simple as saving
  `index.html`. Links to the repo.

### Settings

Two radios, **Proxied** (default) and **Direct**, each with the About page's wording beneath it,
then one line reporting what searches will actually do — which is the only place that can say the
chosen mode is not the one running. Where Proxied cannot be honoured, a note under it gives the
one-line reason; the radio is disabled only where a proxy is structurally impossible, never merely
because a request found none.

Below that, the key form: a text input, a Save, and a Clear, with a link to Keenable for a free
key. The key is stored apart from the mode, so switching modes never throws it away, and its state
line reports only what key this browser holds.

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

A plain white page, `#111` ink, a Helvetica-first stack, one blue link and one purple visited link,
on a 660px measure. Fields are a bottom rule rather than a box; the submit button is solid ink with
square corners. Grey secondary text for the URL line, the utility row and the search timing. No
logo artwork, no icons, no images of any kind, no second typeface. See `ui_design.md` for the full
token set — it supersedes the warm off-white and serif system this project shipped with.

## Proxy behavior

`POST /api/search` accepts `{ query, mode, max_results, snippet_max_length, site,
published_after, published_before, acquired_after, acquired_before }`, allowlisting those fields
and dropping anything else. `max_results` is clamped to 1-50 and `snippet_max_length` to
180-10000, whatever the caller asked for, and `mode` is accepted **only** as `"pro"`: `realtime`
requires an API key, so honouring it would let an anonymous caller make the keyless tier refuse
every request and be served on the operator's key instead. Then:

1. If `UNAUTHENTICATED_FIRST`, calls `POST /v1/search/public` with
   `X-Keenable-Title: <SEARCH_ENGINE_NAME>`.
2. On 401, 402, 429, or 5xx, retries once against `POST /v1/search` with `KEENABLE_API_KEY`.
   A 400 is **not** retried: a bad query fails identically on both tiers, so retrying only burns
   quota.
3. If `UNAUTHENTICATED_FIRST` is false, the order is reversed.
4. Returns Keenable's status and body unchanged — byte-for-byte for every non-2xx status and for
   a 2xx that parses as JSON. A 2xx whose body will not parse becomes a 502 instead, because the
   client treats an unparseable success from the proxy path as proof no proxy is there, and a
   working deployment must not be able to frame itself as a missing one.

The retry against the key only happens when `KEENABLE_API_KEY` is set. Without one the proxy is
keyless-only and passes the upstream response straight through, a 429 included.

It logs nothing and stores nothing — no counters, no per-visitor state of any kind. An operator
running a public instance is expected to put a platform rate-limiting rule (a Cloudflare Rate
Limiting rule, or the equivalent on another host) in front of it.

Keenable sees the proxy's egress IP, not the visitor's, so the keyless allowance is consumed per
Cloudflare egress IP and shared with all other traffic from that IP. The fallback to the
operator's key exists precisely because that allowance is unpredictable.

## Error handling

Errors render in place of the result list, in plain language, with the search box still populated
so the query can be edited and retried. No error exposes a raw status code or stack.

| Condition | Shown |
|---|---|
| 429, direct mode | Too many searches. Keenable allows a limited number per hour; wait a few minutes. |
| 429, proxied mode | Froogle's proxy is busy. Wait a moment, or switch to Direct mode with your own free key — with a link to Settings. |
| 401 / 403, direct mode | The API key was rejected — with a link to Settings. |
| 402, direct mode | The account is out of credits. |
| 400 | The search could not be understood — usually a malformed operator. |
| 5xx, or network failure | Search is unavailable right now. Try again. |
| Timeout / abort | The search took too long. Try again. |
| Direct chosen, no key | Direct mode needs a Keenable API key. Keys are free — with a link to Settings. |
| Proxied chosen, no proxy here | This copy has no proxy of its own. With no key: switch to Direct and add a free key, with a link to Settings. With a key already saved: search again and it will go straight to Keenable. |
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
