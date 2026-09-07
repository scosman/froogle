---
status: draft
---

# Phase 2: Search, direct mode

## Overview

Replace Phase 1's `runSearch()` placeholder with a real API client, and render what it returns.
At the end of this phase Froogle searches for real: open `index.html` from a Downloads folder or
any static host, give it a Keenable key (baked into `API_KEY` or saved in Settings), and it works
end to end — searching, results, empty, error, and no-key states all drawn.

Phase 3 owns the proxy and the shared-mode request. Two consequences for this phase:

* `selectMode` already returns `"shared"` for a keyless visitor on `http(s)`, but nothing can
  serve that request yet. `currentMode()` therefore carries a **one-line bridge** mapping
  `"shared"` to `"nokey"` until the proxy client exists, so the footer, the mode indicator, the
  Settings key-state line and the search path all tell the same true story about a Phase 2 build.
  Phase 3 deletes that line, and nothing else: every one of those four is derived from
  `currentMode()`, so the deletion is a single coordinated edit. This mirrors how Phase 1 handled
  the unwired search: one marked branch, deleted by the phase that makes it false.

  A fifth surface joins them and does *not* go away in Phase 3: the static About and Settings
  prose that describes a shared allowance. Over `file://` there has never been one and never will
  be — `selectMode` short-circuits on the protocol — so that is a permanent property of the
  deployment rather than a phase artifact. Both wordings are authored in the HTML, marked
  `data-when-shared` / `data-when-solo`, and `renderDeploymentProse` shows one. The question it
  asks is `currentMode(null) === "shared"`: what a *keyless* visitor here would get, so saving a
  key does not rewrite the page's explanation of itself.
* `searchRequest` — the pure function that turns a mode plus a key into a URL and headers —
  is written whole, covering the proxy target as well as the direct one. It is request
  *construction*, not the shared-mode path: splitting "which credential goes to which host" across
  two phases would leave the single most security-relevant decision in the client half-tested.

The DOM and `fetch` layers are, by `architecture.md`'s testing strategy, covered by the manual
checklist rather than by unit tests. This phase therefore pushes every real decision the client
makes down into the pure core, where it is tested: response shaping (`resultsFrom`), request
shaping (`searchRequest`), and the save-or-reject decision for a pasted key (`keyCheckResult`).
What is left above the core marker is wiring — a `fetch` call, a timer, and `createElement`.

## Steps

1. **Delete the `"unwired"` branch** from `errorMessage`, and its test.

2. **Core additions**, all pure, all exported to the test harness:

   ```js
   // Request construction. `directUrl` and `proxyPath` are passed in: the core cannot read the
   // config block above it.
   searchRequest({ mode, key, body, directUrl, proxyPath }) -> { url, options }

   // Response shaping. The body is remote JSON and is treated as hostile.
   resultsFrom(payload) -> SearchResult[]

   // Settings: what a validation search's outcome means for a pasted key.
   keyCheckResult(outcome) -> { save: boolean, text: string }
   ```

   * `searchRequest` sets `Content-Type` and `Accept: application/json`, and attaches
     `X-API-Key` **only** in direct mode, so a key can never travel to the proxy. `credentials`
     is `"omit"` explicitly — Keenable answers with `Access-Control-Allow-Credentials: true` and a
     search has no business carrying cookies. `referrerPolicy: "no-referrer"`. It throws on any
     mode but `"direct"` or `"shared"` rather than treating "not direct" as the proxy, which would
     quietly aim a real request at `PROXY_PATH` the moment a mode value went wrong.
   * `resultsFrom` returns `[]` for anything that is not an object carrying an array, and drops
     entries with neither a title nor a URL, which would otherwise draw a blank row.
   * `keyCheckResult` saves on success, refuses **only** on 401/403 — the sole statuses that prove
     the key is bad — and saves with an honest note on 402 (authenticated but out of credits) and
     on any transient failure. Refusing to save because Keenable was briefly unreachable would be a
     worse outcome than storing an unverified key, and it is not "silently saving a bad key",
     which is what the functional spec forbids.

3. **Runtime constants**, above the search section, not in the config block: the config block is
   the documented three-value editing surface, and these are not tuning knobs.

   ```js
   const KEENABLE_SEARCH_URL = "https://api.keenable.ai/v1/search";
   const REQUEST_TIMEOUT_MS = 15000;
   ```

4. **The API client.** One function, one timeout, one place where any failure becomes a
   `{ status }` pair — nothing throws out of it, so the render path never sees an exception.

   ```js
   async function requestSearch(body, { mode, key, controller }) -> { results } | { status }
   ```

   * A single `AbortController` per request serves both the 15s timeout and the supersede abort,
     rather than composing `AbortSignal.timeout` with a second signal: `AbortSignal.any` is
     newer than either, and one controller with a `setTimeout` needs no fallback path and tells
     the two abort causes apart exactly, with a `timedOut` flag rather than by sniffing error
     names.
   * A non-`ok` response yields `{ status }`. A body that will not parse as JSON, a network
     failure and a CORS block all yield `{ status: 0 }` — the app's marker for "no HTTP response
     was readable", which is all `fetch` can tell us about any of them.

5. **`runSearch`.** Resolve the key once, derive the mode from it, then:

   * `nokey` renders the no-key notice and makes no request.
   * A query that parses down to nothing but filters (`site:example.com` alone) is answered
     locally with the 400 message instead of spending a request on a rejection we can predict.
   * Otherwise: abort any in-flight request, take a sequence number, render `searching`, await,
     and **discard the outcome if the sequence is stale**. `AbortController` and the sequence
     check are both needed: the abort closes the window where the response has not arrived, the
     sequence check closes the window where it has already been decoded.

   `cancelSearch()` — bump the sequence and abort — is called when the router leaves the results
   view, so a response that lands after navigation cannot write into a view that is no longer
   showing.

6. **Result rendering**, `document.createElement` and `textContent` throughout, no `innerHTML`:

   ```html
   <li>
     <a class="result-title" href="…" rel="noopener noreferrer">Title</a>
     <div class="result-url">example.com/path</div>
     <p class="result-snippet"><span class="result-date">Jan 8, 2026 — </span>snippet…</p>
   </li>
   ```

   The title is an `<a>` only when `isLinkableUrl` passes; otherwise it is a `<span
   class="result-title-plain">` and no `href` is ever set. The URL line and the snippet line are
   omitted entirely when empty. The two-line clamp stays in CSS, as `ui_design.md` specifies.

   Two accessibility details the visual design does not imply. `#notice` is the `aria-live`
   region, and hiding it on success would follow "Searching…" with silence, so success puts the
   result count in it under `visually-hidden` instead — spoken, never seen. And on the first
   render of any search — the two early failures included, since in a keyless Phase 2 build the
   no-key failure *is* the common path — focus moves to the results search box if it was on either
   Search button, since the one is about to be disabled and the other hidden, and a browser drops
   focus to `<body>` with nothing to restore it up to 15s later.

   That test is `:focus-visible`, not `=== document.activeElement`: a tap on Android leaves focus
   on the button too, and re-focusing the box there would pop the on-screen keyboard back up over
   the results. `matches()` throws on a pseudo-class it does not know, so it is guarded and an old
   browser goes without the restore rather than without search.

7. **Settings key validation.** Save runs a real minimal search with the pasted key before
   storing it, disabling Save while it runs and reporting the outcome through `keyCheckResult`.
   A `keyCheckSeq` counter, bumped on navigation and on each attempt, keeps a slow check's message
   — and the emptying of the input, which by then may hold something newly typed — from landing
   after the visitor has moved on. The `localStorage` write stays outside that guard: storing the
   key is what they asked for.

   Both async entry points are called through a `.catch()` rather than `void`, and the body of
   `saveKey` re-enables its buttons from a `finally`. Nothing in `requestSearch` throws, so the
   realistic trigger is a bug in `render()` — but a silent unhandled rejection there strands the
   page on "Searching…", or leaves Save and Clear disabled, with only a reload to undo it.

8. **Tests** in `test/core.test.mjs` for the three new core functions, plus the `"unwired"`
   deletion.

## Tests

- `searchRequest` — direct mode targets the Keenable URL and carries `X-API-Key`; shared mode
  targets the relative proxy path and carries **no** `X-API-Key`; both send JSON content type and
  accept headers, `POST`, `credentials: "omit"`, and a body that is the serialized request object.
- `searchRequest` — the serialized body round-trips through `JSON.parse` to exactly what
  `buildRequestBody` produced, filters included; a missing key sends `""` rather than
  `"undefined"`; and any mode but `"direct"` or `"shared"` throws.
- `resultsFrom` — a well-formed payload passes through in order; a missing, null, or non-array
  `results` yields `[]`; a non-object payload yields `[]`; null and primitive entries are dropped;
  an entry with neither title nor URL is dropped; an entry with only a URL survives.
- `keyCheckResult` — success saves; 401 and 403 refuse and say so; 402 saves with the
  out-of-credits note; 429, 500, 0 and `"timeout"` save with the unverified note; every branch
  returns a non-empty message that leaks no raw status code.
- `errorMessage` — the `"unwired"` placeholder is gone: it now falls through to the generic
  message, and no branch of the core mentions being unwired.
- All 61 Phase 1 tests continue to pass, including the sandbox-globals diff and the
  no-DOM-dependency evaluation, which now cover three more exported functions.

The DOM and `fetch` layers stay on the manual checklist per `architecture.md`. What is now
checkable there and was not before, added to that checklist in Phase 3 alongside the README:
the Settings key-state line, the footer and a search all agree about the mode; a screen reader
announces the result count rather than falling silent; and keyboard focus survives a search
started from either Search button.
