---
status: complete
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
test/core.test.mjs         unit tests for the frontend's pure core
test/proxy.test.mjs        unit tests for the proxy
README.md
LICENSE                    MIT
```

`test/` is dev-only and affects nothing at deploy time. It needs no `npm install`: Node 18+ ships
`node --test`. The `.mjs` extension is load-bearing — with no `package.json` to declare the module
type, an ESM `.js` test loads only through Node's module-syntax detection, which would silently
raise the floor from Node 18 to Node 20.19 / 22.7.

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
legacyRedirect(search, hash) -> string | null // as legacyTarget, but an existing fragment wins

// Query operators. Unrecognized or malformed operators stay in the query text.
parseQuery(raw) -> { query, filters: { site?, published_after?, published_before? } }
buildRequestBody(parsed) -> object            // adds mode, max_results, snippet_max_length

// The request, as data. The one security-relevant decision in the client — which credential goes
// to which host — is therefore a pure function under test rather than a branch inside a fetch
// call: X-API-Key is attached in direct mode only, so a key can never travel to the proxy. The
// endpoints are parameters because they are declared above the core marker. Throws on any mode
// but "direct" or "proxied", rather than treating an unknown one as the proxy.
searchRequest({ mode, key, body, directUrl, proxyPath }) -> { url, options }

// Mode: a stored preference, constrained by what this copy of the page can do.
resolveKey(configKey, stored)   -> string | null
normalizeMode(value)            -> "proxied" | "direct"          // anything unknown -> DEFAULT_MODE
proxyStatus({ protocol, proxyPath, proxyKnownBad }) -> "possible" | "blocked" | "missing"
selectMode({ preference, key, protocol, proxyKnownBad, proxyPath })
                                -> "direct" | "proxied" | "nokey"

// Whether a proxied-mode failure proves there is no proxy, rather than that a search failed.
// Only the unambiguous cases: 404, 405 and "unreadable". Not 0, not 5xx, not "timeout".
proxyUnavailable(status) -> boolean

// Result presentation. The response body is remote JSON and is treated as hostile.
resultsFrom(payload)    -> SearchResult[]     // [] unless it is an object holding an array
pickSnippet(result)     -> string             // snippet || description || ""
normalizeSnippet(text)  -> string             // collapse whitespace, trim
isLinkableUrl(url)      -> boolean            // http: / https: only
displayUrl(url)         -> string
formatDate(iso)         -> string | null

// Text. The engine's name is a parameter, never read from the config block: the core region has
// to stay evaluable on its own, and SEARCH_ENGINE_NAME is declared above it.
escapeXml(text) -> string
errorMessage({ status, mode, engineName }) -> { text, action }   // action: null | "settings"
modeLabel(mode)                           -> string             // the utility-row mode line
proxyNote(status, engineName)             -> string | null      // why Proxied cannot be honoured
keyStateText({ builtIn, saved, engineName })         -> string   // which key this browser holds
settingsError({ mode, typedKey, keptKey, proxyUsable }) -> string | null  // why Save refuses
formatElapsed(ms) -> string | null        // "0.19 seconds", or null for a non-measurement

// Settings: what a validation search's outcome means for a pasted key, given the shape the client
// returns — { results } on success, { status } on failure.
keyCheckResult(outcome) -> { save, text }
```

`SEARCH_ENGINE_NAME` is a documented configuration option, so a renamed instance must read
correctly in every string it appears in. The two places that name it are the core messages above —
all of which take `engineName` — and the static prose, through `[data-engine-name]` spans filled at
startup alongside `[data-wordmark]`. `DEFAULT_ENGINE_NAME` in the core mirrors the config
default and stands in when a caller passes nothing.

`selectMode` centralizes the whole hybrid decision, which is otherwise the easiest thing in this
app to get subtly wrong. It is the visitor's preference, constrained by `proxyStatus`:

| preference | proxy status | key | result |
|---|---|---|---|
| `proxied` | `possible` | any | `proxied` |
| `proxied` | `blocked` / `missing` | present | `direct` |
| `proxied` | `blocked` / `missing` | none | `nokey` |
| `direct` | any | present | `direct` |
| `direct` | any | none | `nokey` |

Two properties of that table are load-bearing. A saved key does **not** override a Proxied
preference — a key is what Direct mode needs, not a silent switch into it. And a Direct preference
with no key yields `nokey` rather than falling back to the proxy: quietly proxying would send
Froogle's servers the very query the visitor chose to keep from them.

`proxyStatus` separates the two ways a proxy can be absent, because they have different
consequences. `blocked` (a `file://` copy, or an empty `PROXY_PATH`) is structural and permanent
for that deployment, so the Settings radio is disabled. `missing` was learned from one request this
session and may be wrong for the next deploy of the same file, so the radio stays enabled and the
stored preference is never rewritten.

Mode is computed per search, not cached, so saving a key or switching mode takes effect on the next
search with no reload.

### Request flow

```
submit
  -> parseQuery(raw)
  -> buildRequestBody
  -> selectMode
  -> direct : POST https://api.keenable.ai/v1/search   with X-API-Key
     proxied: POST <PROXY_PATH>                        with no auth header
     nokey  : render "nokey" or "noproxy" per the preference, no request
  -> render, with performance.now() either side of the fetch for the timing line
```

`mode: "pro"`, `max_results: 25`, `snippet_max_length: 400` on every request. Filters are added
only when parsed.

**Race resolution.** Each search increments `state.seq` and captures the value. On resolution, a
response whose captured seq is stale is discarded without rendering. The in-flight request is also
aborted via `AbortController`, so the stale response usually never arrives — the seq check covers
the window where it is already decoded. Both together, because either alone leaves a gap.

**Timeout.** 15s, and the *same* `AbortController` that serves the race abort above serves it: a
`setTimeout` calls `controller.abort()` and sets a `timedOut` flag. Not `AbortSignal.timeout`,
which would need composing with the race abort through `AbortSignal.any` — newer than either, and
so a second fallback path to write. One controller needs no fallback at all, and the flag tells the
two abort causes apart exactly, rather than by sniffing an error's name. Timeouts surface as their
own `"timeout"` status and the "took too long" message; a supersede abort is discarded by the seq
check before its status is ever read.

**Proxy unavailability.** In proxied mode, a response that is 404 or 405, or that arrives with a
body which will not parse as JSON (status `"unreadable"` — a static host answering the proxy path
with an HTML page), marks `sessionStorage["froogle.proxyUnavailable"] = "1"` and re-renders with
the `"noproxy"` message. Subsequent searches select their mode with the proxy already known bad, so
they either go direct with a saved key or stop at the notice before any request is made. On `file:`
the probe never runs at all. The stored **preference** is untouched throughout.

The `"unreadable"` half of that rests on a guarantee the proxy makes rather than on an assumption
about proxies in general: it turns a 2xx it cannot parse into a 502, so a successful response from
a real proxy is always parseable JSON. See the proxy's flow, step 5.

Only those unambiguous cases count, because the consequence lasts the session. A `fetch` rejection
(status `0`) is a dropped connection on a same-origin path and proves nothing; a 5xx and a timeout
mean something is there and is broken. Retiring the proxy on any of them would strand a visitor on
a flaky connection *and* flip the About page to a claim that is then false.

The flag is mirrored in a module-level variable, because `writeStore` returns false in Safari's
"block all cookies" and an unrecorded probe would leave the search notice and the Settings mode
lines disagreeing about the very same question.

There is no matching "the proxy answered" flag any more. It existed to drive three variants of
deployment-conditional prose on About and Settings; the mode is now chosen rather than inferred, so
the prose describes both modes unconditionally and the page never has to guess which kind of copy
it is before it has asked.

### Rendering and injection safety

Results are built with `document.createElement` and `textContent`. `innerHTML` appears nowhere in
`index.html` at all — not in the result path and not in the view markup, which is authored as HTML
in the document rather than assembled by the script.

* `href` is set only after `isLinkableUrl` passes, which parses with `new URL()` and requires
  `http:` or `https:`. This blocks `javascript:`, `data:`, and `vbscript:` URLs.
* Result links carry `rel="noopener noreferrer"`.
* `<meta name="referrer" content="no-referrer">` on the document, so no outbound click leaks the
  page URL even when a visitor arrived on a legacy `?q=` link.
* A `Content-Security-Policy` meta tag, placed as the first element in `<head>` so it governs
  everything after it:

  ```html
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'unsafe-inline';
    style-src 'unsafe-inline';
    img-src data:;
    connect-src 'self' https://api.keenable.ai;
    form-action 'none';
    base-uri 'none'">
  ```

  `'unsafe-inline'` is forced, not lazy. A single-file app has no external script to point
  `'self'` at. Nonces need a server to generate a fresh value per response. Hashes do work for
  static files, but the hash covers the inline script — and the top of that script is exactly
  where a self-hoster edits `SEARCH_ENGINE_NAME` and `API_KEY`, so any config change would break
  the hash and white-screen the page. That trades away the project's central property.

  The value therefore sits in the other directives. `default-src 'none'` closes every fetch
  directive not named, so an attacker-authored search result cannot beacon out through an
  `<img>`, pull a frame, font, or object, or reach the network anywhere but Keenable and our own
  origin. `img-src data:` exists solely for the inline SVG favicon, which `img-src` governs.

  Known gaps: `frame-ancestors` and `report-uri` are ignored in meta tags, so clickjacking
  protection is only available to a hosted instance that adds the header at the edge. And once
  `'unsafe-inline'` is granted, CSP constrains where data can go, not whether injected code runs
  — the primary defense remains the `textContent` discipline and the URL scheme check above.

### Storage

| Key | Store | Contents |
|---|---|---|
| `froogle.key` | `localStorage` | The visitor's Keenable API key |
| `froogle.mode` | `localStorage` | The chosen mode, `"proxied"` or `"direct"`. Absent until chosen |
| `froogle.proxyUnavailable` | `sessionStorage` | `"1"` once a proxy probe has failed |

The mode and the key are separate entries on purpose: switching to Proxied and back must not
destroy a saved key, and a key must not imply a mode.

Every read and write is wrapped in `try/catch`. Safari's private mode and "block all cookies" both
make these throw, and a search engine that white-screens because storage is unavailable is a worse
failure than one that simply cannot remember a key. On failure the app behaves as if no key is
stored.

Two of the three are mirrored in module-level variables for the case where the write itself is
refused: `proxyMissing`, so the page cannot go on believing in a proxy the notice in front of the
visitor says is absent, and `modeMemory`, so a mode the visitor just saved works for the rest of
the tab instead of snapping back with no explanation. Both say so in the UI — the Settings line
reports that the choice will be forgotten when the tab closes.

### Settings is a form

The mode radio and the Clear control write nothing. They live in three module-level variables —
`pendingMode`, `pendingClear`, `keyError` — that no other part of the page reads; `resetSettingsForm`
loads them from storage on every navigation. Every surface that reports the mode (both utility
rows, the Settings state line, and `runSearch` itself) goes through `modePreference()`, which reads
only what is saved, so a pending choice cannot leak into the masthead or into a search.

`saveSettings` is the one path from the form into storage, and it is all-or-nothing. It reads
`settingsError` first and writes nothing when that refuses; it validates a typed key with a real
request and writes nothing when Keenable rejects it; and `commitSettings` writes the key before the
mode, returning early if that write is refused, because committing Direct with a key that could not
be stored would produce exactly the unsearchable saved state `settingsError` exists to prevent.

## Proxy

`functions/api/search.js`, a Cloudflare Pages Function exporting `onRequestPost`. Same-origin with
the page, so no CORS handling, no preflight, no origin allowlist.

```js
export async function onRequestPost({ request, env })

allowlistBody(raw)          -> { ok: true, value } | { ok: false, message }
credentialChain(env)        -> Array<{title} | {key}>   // one entry, or two in configured order
callKeenable(body, auth)    -> Response        // auth: {key} | {title}
shouldFallback(status)      -> boolean         // 401,402,429,5xx -> true; 400 -> false
```

### Flow

1. Reject non-JSON or oversized bodies (8KB cap) with 400.
2. `allowlistBody` — copy only `query`, `mode`, `max_results`, `snippet_max_length`, `site`,
   `published_after`, `published_before`, `acquired_after`, `acquired_before`. Anything else is
   dropped silently, as is any of those carrying the wrong type. `query` must be a non-empty string
   under 2KB. `max_results` is clamped to 1–50 and `snippet_max_length` to 180–10000, whatever the
   client asked for: the operator's key pays for what we send, and an unclamped 10000 across 50
   results is half a megabyte per request.

   `mode` is not merely type-checked but **pinned**: it is copied only when it is exactly `"pro"`,
   and any other value is dropped. Keenable's other mode, `realtime`, requires an API key, so a
   caller sending it would fail on the keyless tier and — if that failure carries a fallback status
   — be served on `KEENABLE_API_KEY` instead. Validating against the full enum would leave an
   anonymous caller able to choose the tier the operator pays for, on every request; pinning the
   one value the frontend ever sends closes it and costs nothing.
3. Call Keenable in the configured order. `UNAUTHENTICATED_FIRST` (default true) tries
   `/v1/search/public` with `X-Keenable-Title: <SEARCH_ENGINE_NAME>` first, then falls back to
   `/v1/search` with `KEENABLE_API_KEY`.
4. Fall back **once**, only when `shouldFallback(status)` and a second credential actually exists.
   A 400 is never retried: a malformed query fails identically on both tiers, so a retry only
   burns quota.
5. Return Keenable's status and body unchanged, so the client's error mapping is identical in both
   modes — byte-for-byte for every non-2xx status, and for a 2xx whose body parses as JSON. A 2xx
   whose body will **not** parse is the one exception: it becomes a 502 instead of being forwarded.

   That exception is what makes the client's `"unreadable"` inference sound. The client reads "a
   2xx from `PROXY_PATH` carrying something that is not JSON" as proof no proxy is there — it is
   what a static host does when it serves a page for every path — and retires proxied mode for the
   session on it. Forwarding an empty or malformed 200 from Keenable would make a working
   deployment frame itself as a missing one, durably and wrongly. The guard is deliberately 2xx
   only: an error body is passed through whatever it contains, so an operator debugging a broken
   upstream sees exactly what Keenable sent.

Allowlisting rather than forwarding is the point: a pass-through proxy is an open relay for
arbitrary JSON to Keenable on the operator's key.

The authenticated fallback exists only when `KEENABLE_API_KEY` is configured. With it unset the
proxy is keyless-only and passes the upstream status and body through untouched, a 429 included —
there is nothing to fall back to. A fork deployed without a key therefore inherits no credit
exposure.

The proxy holds no per-request state at all: no counters, no cache entries, nothing keyed on the
visitor. An operator exposing a public instance should put a platform rate-limiting rule in front
of it — a Cloudflare Rate Limiting rule, or the equivalent on another host.

## Error handling strategy

Errors never propagate as exceptions to the UI. The search path catches everything and reduces it
to `{ status, mode }`, which `errorMessage` maps to display text.

"Everything" takes two catches, not one. The request itself is reduced inside `requestSearch`. Two
things escape that: `searchRequest` refusing an unrecognized mode, which throws before the try
block on purpose, and a bug anywhere after the `await` — in `render()`, say. Both are caught at the
call site, which is why the async entry points (`startSearch`, and the Settings save handler) are
invoked through a `.catch()` rather than `void`. Without it either one is a silent unhandled
rejection that leaves the page stuck on "Searching…", or Save and the mode radios disabled, until a
reload. `saveSettings` additionally re-enables its controls from a `finally`, so the recovery does
not depend on that catch running first. Status codes:

| Status | Source | Recoverable |
|---|---|---|
| 400 | Malformed operator or query | Yes — edit and retry |
| 401 / 403 | Bad key (direct) | Yes — fix in Settings |
| 402 | Out of credits (direct) | No, from the app's side |
| 429 | Rate limit, either tier | Yes — wait, or add a key |
| 5xx | Keenable or proxy | Yes — retry |
| `0` | Network failure or CORS block | Yes — retry |
| `"unreadable"` | A response arrived; its body was not JSON | Yes — retry |
| `"timeout"` | The 15s abort fired | Yes — retry |
| `"nokey"` | No key and no proxy | Yes — add a key |

Status `0` is the app's internal marker for a `fetch` rejection — no HTTP response at all. A CORS
failure and a dropped connection are indistinguishable to JavaScript by design, so both get the
same generic message rather than a guess. `"unreadable"` is the neighbouring case: a response did
arrive, and its body was not JSON.

The two read identically to the visitor, and exist as separate statuses for one reason — the
proxied-mode proxy probe above, where "the server answered with a web page" is proof there is no
proxy and "the connection dropped" is proof of nothing.

No stack traces or raw status codes reach the UI. The proxy logs nothing.

## Testing strategy

Node's built-in test runner. Zero dependencies and no `package.json`; run it as `node --test` from
the repo root, which discovers `test/` on its own. Not `node --test test/` — Node resolves a bare
directory argument as a module and fails.

### `test/core.test.mjs`

Reads `index.html`, extracts the text between the `FROOGLE:CORE` markers, and evaluates it in a
`node:vm` context seeded with nothing but the language built-ins plus `URL` and `URLSearchParams`,
with `console` blanked. This gives real coverage of the pure logic and constrains the core region
from growing a DOM dependency.

The constraint is worth stating precisely, because it is weaker than "the tests throw on load": a
*top-level* reference to `document`, `fetch` or `localStorage` fails when the region is evaluated,
but one inside a function body fails only when that function is called. The guarantee therefore
extends exactly as far as the suite's coverage of the exported functions, which is why every export
is exercised. A separate test diffs the sandbox's globals against a bare context, so the sandbox
itself cannot quietly acquire one.

Cases:

* `parseQuery` — bare query; `site:` alone and mid-query; `after:`/`before:` with valid and
  malformed dates; an operator with an empty value stays in the text; multiple operators; a colon
  inside ordinary text (`ratio 3:1`) is not an operator.
* `parseRoute` / `formatRoute` — round-trips, including queries containing `#`, `&`, `+`, spaces,
  and non-ASCII; empty and unknown fragments fall back to home.
* `legacyTarget` — `?q=` and `?about` map to fragments; anything else returns null.
* `legacyRedirect` — follows the query string with no fragment present, keeps the fragment when
  there is one, returns null with nothing legacy to rewrite.
* `normalizeMode` — the two real modes survive; anything else, a hand-edited storage value
  included, becomes the default.
* `proxyStatus` — `blocked` on `file:` and on an empty path, `missing` once known bad, `possible`
  otherwise, including before anything has asked.
* `selectMode` — every row of the table above: a Proxied preference honoured even with a key
  saved, a Direct preference refusing to fall back to the proxy, and both fallbacks where Proxied
  is impossible.
* `resolveKey` — config key wins over stored; whitespace-only treated as absent.
* `isLinkableUrl` — rejects `javascript:`, `data:`, `vbscript:`, `file:`, and malformed input;
  accepts http and https.
* `resultsFrom` — a well-formed payload passes through in order; a missing, null or non-array
  `results` and a non-object payload each yield `[]`; null and primitive entries are dropped, as is
  an entry with neither a title nor a URL.
* `pickSnippet` / `normalizeSnippet` — falls back to `description`; both absent yields `""`;
  newlines and runs of whitespace collapse.
* `formatDate` — valid ISO, absent, and unparseable.
* `errorMessage` — every status, the mode-dependent difference at 429, the two no-search sentinels
  (`"nokey"` and `"noproxy"`, the latter differing by whether a key is there to fall back on), and
  a non-default `engineName` reaching every message that names the engine.
* `modeLabel` / `proxyNote` / `keyStateText` — the mode line for each mode; a
  reason only where Proxied cannot be honoured, stating the deployment fact and giving no advice;
  and that the key line says nothing about the mode and nothing at all for an
  empty browser.
* `settingsError` — Direct with no key typed, kept or built in is the one refusal; a typed key, a
  kept key, and Proxied with nothing at all each commit; and the refusal offers Proxied as the way
  out only when `proxyUsable`.
* `formatElapsed` — two decimals of a second, and null for anything that is not a measurement.
* `escapeXml` — the five characters that would break the inline SVG favicon.
* `buildRequestBody` — always sets `mode`, `max_results`, `snippet_max_length`; includes filters
  only when present.
* `searchRequest` — direct mode targets Keenable and carries `X-API-Key`; proxied mode targets the
  relative proxy path and carries none; both are a `POST` with JSON content-type and accept
  headers, `credentials: "omit"`, and a body that round-trips to what `buildRequestBody` produced;
  any other mode throws.
* `keyCheckResult` — success saves; 401 and 403 refuse; 402 saves with the out-of-credits note;
  every other status saves with the unverified note; no message leaks a raw status code.

### `test/proxy.test.mjs`

Imports `functions/api/search.js` directly — it is a plain ES module — and injects a stub `fetch`.

* Fallback order under `UNAUTHENTICATED_FIRST` true and false.
* Fallback fires on 401, 402, 429, 5xx; does **not** fire on 400.
* Fallback is attempted at most once.
* No fallback when the second credential is absent.
* `allowlistBody` drops unknown fields and wrongly-typed ones, rejects a missing or oversized
  query, clamps `max_results` above 50 and below 1 and `snippet_max_length` above 10000 and below
  180, and drops any `mode` but `"pro"` — including `"realtime"`, end to end, so it cannot reach
  Keenable.
* Keenable's status and body are returned unchanged on success and on error, whitespace included,
  and a 2xx body that parses to a non-object still passes through.
* A 2xx body that will not parse becomes a 502; a non-2xx body is passed through whether it parses
  or not.
* The upstream request carries `X-Keenable-Title` on the keyless call and `X-API-Key` on the keyed
  call, and never both.

### Manual checklist

Browser-level behavior that cannot be unit tested, recorded in the README:

* Loads and searches from `file://` with a stored key, with Proxied shown disabled and its reason.
* Moving the mode radio changes nothing until Save: the utility-row mode line, the Settings state
  line and a search all keep reporting the saved mode.
* A refused Save — Direct with no key, or a staged Clear under Direct — writes neither the mode nor
  the key, reddens the field and moves focus to it.
* Saving Direct and back to Proxied leaves a saved key intact.
* Back and forward move between home, results, about, and settings.
* A legacy `?q=` URL normalizes to `#q=` with no extra history entry.
* Keyboard-only operation, visible focus throughout, radios included.
* Renders correctly at 320px width with no horizontal scroll.
* The search timing shows a real elapsed time on results and nothing anywhere else.
* Storage disabled (Safari private mode) degrades to the no-key state rather than breaking, and
  says so when a mode choice cannot be remembered.

## Deliberate non-choices

* **No framework, no TypeScript, no build.** A build step would break the "open it from Downloads"
  property, which is the project's most distinctive feature.
* **No client-side caching of results.** Keenable's quota is per visitor, queries repeat rarely
  within a session, and a cache is state to get wrong for no real gain.
* **No rate limiter in the proxy.** A Cache API counter is per-colo, so it was a speed bump rather
  than a defense, and any per-IP state — hashed and truncated included — undercuts "Froogle tracks
  nothing". Truncation buys privacy only through collisions, and those same collisions punish
  innocent users sharing a bucket. Platform rate limiting is the answer, and it leaves the logging
  decision with the operator.
* **No service worker.** Offline search is meaningless.
* **No KV or Durable Objects.** Both would make deployment more than "connect the repo".
