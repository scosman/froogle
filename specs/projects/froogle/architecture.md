---
status: draft
---

# Architecture: Froogle

## Constraints that drive everything

1. **`index.html` must work standing alone**, opened from a Downloads folder over `file://`. No
   build step, no bundler, no module imports, no `npm install` to run it.
2. **No runtime dependencies.** Nothing fetched from a CDN, no fonts, no images.
3. **The proxy is optional.** Its absence must degrade to a working direct-mode app, not an error.
4. **Search results are untrusted remote content** and are rendered into the DOM.

These rule out every framework and most conveniences. The design is plain DOM, plain functions,
one `<script>`.

## Repo layout

```
index.html                 the whole frontend
functions/api/search.js    the proxy (Cloudflare Pages Function). Optional.
test/core.test.js          unit tests for the frontend's pure core
test/proxy.test.js         unit tests for the proxy
README.md
```

`test/` is dev-only and affects nothing at deploy time. It needs no `npm install`: Node 18+ ships
`node --test`.

## Frontend

### Organization inside one script

Two regions, separated by marker comments:

```js
// ---- FROOGLE:CORE:BEGIN ----   pure functions, no DOM, no network, no globals
// ---- FROOGLE:CORE:END ----
//                                runtime: DOM, fetch, storage, router
```

The core region is pure and therefore testable (see Testing). Everything below it may touch the
DOM. The split is a discipline, not a module system — there is no bundler to enforce it, so the
test harness enforces it instead by evaluating the core region in isolation, where any reference
to `document`, `window`, or `fetch` throws.

### State

One module-level object. No framework, no reactivity; `render()` is called explicitly after any
mutation.

```js
const state = {
  view: "home",      // "home" | "results" | "about" | "settings"
  query: "",         // raw text as typed, including operators
  status: "idle",    // "idle" | "searching" | "ok" | "empty" | "error"
  results: [],       // SearchResult[]
  error: null,       // { status, mode } | null
  seq: 0,            // monotonic request counter, for race resolution
};
```

### Core interfaces

```js
// Routing. The fragment is authoritative; the query string is legacy input only.
parseRoute(hash, search) -> { view, query }
formatRoute(view, query) -> string            // "#q=foo", "#about", ""
legacyTarget(search)     -> string | null     // "?q=foo" -> "#q=foo", else null

// Query operators. Unrecognized or malformed operators stay in the query text.
parseQuery(raw) -> { query, filters: { site?, published_after?, published_before? } }
buildRequestBody(parsed) -> object            // adds mode, max_results, snippet_max_length

// Mode selection.
resolveKey(configKey, stored)  -> string | null
selectMode({ key, protocol, proxyKnownBad, proxyPath }) -> "direct" | "shared" | "nokey"

// Result presentation.
pickSnippet(result)     -> string             // snippet || description || ""
normalizeSnippet(text)  -> string             // collapse whitespace, trim
isLinkableUrl(url)      -> boolean            // http: / https: only
displayUrl(url)         -> string
formatDate(iso)         -> string | null

// Errors.
errorMessage({ status, mode }) -> { text, action }   // action: null | "settings"
```

`selectMode` centralizes the whole hybrid decision, which is otherwise the easiest thing in this
app to get subtly wrong:

| key | protocol | proxy known bad | result |
|---|---|---|---|
| present | any | any | `direct` |
| none | `file:` | — | `nokey` |
| none | http(s) | no | `shared` |
| none | http(s) | yes | `nokey` |

Mode is computed per search, not cached, so saving or clearing a key takes effect on the next
search with no reload.

### Request flow

```
submit
  -> parseQuery(raw)
  -> buildRequestBody
  -> selectMode
  -> direct: POST https://api.keenable.ai/v1/search   with X-API-Key
     shared: POST <PROXY_PATH>                        with no auth header
     nokey : render the no-key notice, no request
  -> render
```

`mode: "pro"`, `max_results: 25`, `snippet_max_length: 400` on every request. Filters are added
only when parsed.

**Race resolution.** Each search increments `state.seq` and captures the value. On resolution, a
response whose captured seq is stale is discarded without rendering. The in-flight request is also
aborted via `AbortController`, so the stale response usually never arrives — the seq check covers
the window where it is already decoded. Both together, because either alone leaves a gap.

**Timeout.** 15s via `AbortSignal.timeout(15000)`, with a manual `AbortController` fallback for
older browsers. Timeouts surface as the generic "took too long" message, distinguished from a user
abort by whether a newer search has started.

**Proxy unavailability.** In shared mode, a response that is 404/405, or whose body is not JSON, or
which fails at the network level, marks `sessionStorage["froogle.proxyUnavailable"] = "1"` and
re-renders as `nokey`. Subsequent searches skip the doomed request entirely. On `file:` the probe
never runs at all.

### Rendering and injection safety

Results are built with `document.createElement` and `textContent`. `innerHTML` is used nowhere in
the result path — the only `innerHTML` in the file is the static view markup authored by us, and a
lint-style comment marks it as such.

* `href` is set only after `isLinkableUrl` passes, which parses with `new URL()` and requires
  `http:` or `https:`. This blocks `javascript:`, `data:`, and `vbscript:` URLs.
* Result links carry `rel="noopener noreferrer"`.
* `<meta name="referrer" content="no-referrer">` on the document, so no outbound click leaks the
  page URL even when a visitor arrived on a legacy `?q=` link.
* A `Content-Security-Policy` meta tag restricting `default-src 'none'`, `connect-src` to the
  Keenable origin and `'self'`, `style-src 'unsafe-inline'`, `script-src 'unsafe-inline'`. Inline
  script and style are unavoidable in a single-file app; the value is in `default-src 'none'`,
  which blocks any image, frame, font, or object a compromised result could try to pull.

### Storage

| Key | Store | Contents |
|---|---|---|
| `froogle.key` | `localStorage` | The visitor's Keenable API key |
| `froogle.proxyUnavailable` | `sessionStorage` | `"1"` once a proxy probe has failed |

Every read and write is wrapped in `try/catch`. Safari's private mode and "block all cookies" both
make these throw, and a search engine that white-screens because storage is unavailable is a worse
failure than one that simply cannot remember a key. On failure the app behaves as if no key is
stored.

## Proxy

`functions/api/search.js`, a Cloudflare Pages Function exporting `onRequestPost`. Same-origin with
the page, so no CORS handling, no preflight, no origin allowlist.

```js
export async function onRequestPost({ request, env })

allowlistBody(raw)          -> { ok: true, value } | { ok: false, message }
checkRateLimit(ip, env)     -> { ok: true } | { ok: false, retryAfter }
callKeenable(body, auth)    -> Response        // auth: {key} | {title}
shouldFallback(status)      -> boolean         // 401,402,429,5xx -> true; 400 -> false
```

### Flow

1. Reject non-JSON or oversized bodies (8KB cap) with 400.
2. `checkRateLimit` on `CF-Connecting-IP`. Over limit → 429 with `Retry-After`.
3. `allowlistBody` — copy only `query`, `mode`, `max_results`, `snippet_max_length`, `site`,
   `published_after`, `published_before`, `acquired_after`, `acquired_before`. Anything else is
   dropped silently. `query` must be a non-empty string under 2KB; `max_results` is clamped to
   1–50 regardless of what the client asked for.
4. Call Keenable in the configured order. `UNAUTHENTICATED_FIRST` (default true) tries
   `/v1/search/public` with `X-Keenable-Title: <SEARCH_ENGINE_NAME>` first, then falls back to
   `/v1/search` with `KEENABLE_API_KEY`.
5. Fall back **once**, only when `shouldFallback(status)` and a second credential actually exists.
   A 400 is never retried: a malformed query fails identically on both tiers, so a retry only
   burns quota.
6. Return Keenable's status and JSON body unchanged, so the client's error mapping is identical in
   both modes.

Allowlisting rather than forwarding is the point: a pass-through proxy is an open relay for
arbitrary JSON to Keenable on the operator's key.

### Rate limiting

Fixed-window counter in the Cache API, keyed on a SHA-256 of the IP plus the current minute, with
a 60-second TTL. No KV binding, no Durable Object, nothing to provision — deployment stays "connect
the repo to Pages".

**Honest limitation:** the Cache API is per-colo, so the limit is per-datacenter, not global. A
distributed attacker gets roughly `RATE_LIMIT_PER_MINUTE × colos`. This is a speed bump against
casual scraping, not a real defense. The README documents a Cloudflare Rate Limiting rule as the
actual backstop for a public instance — it runs at the edge, is genuinely global, and is
configuration rather than code.

The IP is hashed rather than stored raw, so nothing in the cache is personally identifying. Nothing
else is written or logged anywhere.

## Error handling strategy

Errors never propagate as exceptions to the UI. The search path catches everything and reduces it
to `{ status, mode }`, which `errorMessage` maps to display text. Status codes:

| Status | Source | Recoverable |
|---|---|---|
| 400 | Malformed operator or query | Yes — edit and retry |
| 401 / 403 | Bad key (direct) | Yes — fix in Settings |
| 402 | Out of credits (direct) | No, from the app's side |
| 429 | Rate limit, either tier | Yes — wait, or add a key |
| 5xx | Keenable or proxy | Yes — retry |
| `0` | Network failure, timeout, CORS block | Yes — retry |

Status `0` is the app's internal marker for "no HTTP response was readable", which is what a
`fetch` rejection gives us. The distinction matters: a CORS failure and a dropped connection are
indistinguishable to JavaScript by design, so both get the same generic message rather than a
guess.

No stack traces or raw status codes reach the UI. The proxy logs nothing.

## Testing strategy

Node's built-in test runner. Zero dependencies, no `package.json` required to run
`node --test test/`.

### `test/core.test.js`

Reads `index.html`, extracts the text between the `FROOGLE:CORE` markers, and evaluates it in a
`node:vm` context with no `document`, `window`, `fetch`, or `localStorage` defined. This gives real
coverage of the pure logic and simultaneously proves the core region has not silently grown a DOM
dependency — if it has, the tests throw on load.

Cases:

* `parseQuery` — bare query; `site:` alone and mid-query; `after:`/`before:` with valid and
  malformed dates; an operator with an empty value stays in the text; multiple operators; a colon
  inside ordinary text (`ratio 3:1`) is not an operator.
* `parseRoute` / `formatRoute` — round-trips, including queries containing `#`, `&`, `+`, spaces,
  and non-ASCII; empty and unknown fragments fall back to home.
* `legacyTarget` — `?q=` and `?about` map to fragments; anything else returns null.
* `selectMode` — every row of the table above.
* `resolveKey` — config key wins over stored; whitespace-only treated as absent.
* `isLinkableUrl` — rejects `javascript:`, `data:`, `vbscript:`, `file:`, and malformed input;
  accepts http and https.
* `pickSnippet` / `normalizeSnippet` — falls back to `description`; both absent yields `""`;
  newlines and runs of whitespace collapse.
* `formatDate` — valid ISO, absent, and unparseable.
* `errorMessage` — every status, and the mode-dependent difference at 429.
* `buildRequestBody` — always sets `mode`, `max_results`, `snippet_max_length`; includes filters
  only when present.

### `test/proxy.test.js`

Imports `functions/api/search.js` directly — it is a plain ES module — and injects a stub `fetch`
and a stub `caches`.

* Fallback order under `UNAUTHENTICATED_FIRST` true and false.
* Fallback fires on 401, 402, 429, 5xx; does **not** fire on 400.
* Fallback is attempted at most once.
* No fallback when the second credential is absent.
* `allowlistBody` drops unknown fields, rejects a missing or oversized query, clamps
  `max_results` above 50 and below 1.
* Rate limiter allows up to the configured count and rejects past it, with `Retry-After`.
* Keenable's status and body are returned unchanged on success and on error.
* The upstream request carries `X-Keenable-Title` on the keyless call and `X-API-Key` on the keyed
  call, and never both.

### Manual checklist

Browser-level behavior that cannot be unit tested, recorded in the README:

* Loads and searches from `file://` with a stored key.
* Back and forward move between home, results, about, and settings.
* A legacy `?q=` URL normalizes to `#q=` with no extra history entry.
* Keyboard-only operation, visible focus throughout.
* Renders correctly at 320px width with no horizontal scroll.
* Storage disabled (Safari private mode) degrades to the no-key state rather than breaking.

## Deliberate non-choices

* **No framework, no TypeScript, no build.** A build step would break the "open it from Downloads"
  property, which is the project's most distinctive feature.
* **No client-side caching of results.** Keenable's quota is per visitor, queries repeat rarely
  within a session, and a cache is state to get wrong for no real gain.
* **No service worker.** Offline search is meaningless.
* **No KV or Durable Objects.** Both would make deployment more than "connect the repo".
