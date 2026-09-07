---
status: draft
---

# Phase 3: Proxy and shared mode

## Overview

The last phase. It adds the half of the app that Phase 2 deliberately left unreachable: the
Cloudflare Pages Function at `functions/api/search.js`, and the frontend path that talks to it.

Phase 2 shipped `searchRequest` already able to build the proxy request, and `selectMode` already
able to return `"shared"` — then bridged `"shared"` back to `"nokey"` inside `currentMode()`,
because nothing could serve that request. Retiring that bridge is one edit and it flips five
surfaces at once: the footer mode indicator, the Settings key-state line, the About and Settings
deployment prose, `sharedAllowanceExists()`, and the search path itself. The bridge is retired by
**replacing** its `return` with `return mode;` — deleting the line returns `undefined` and leaves
all five quietly wrong, with no test to catch it.

What is genuinely new here is small and sits in three places:

* `functions/api/search.js` — the whole proxy, and the only new file with logic in it.
* Proxy-unavailability detection in the frontend: a static host that answers `/api/search` with a
  404, a 405, or an HTML page must cost one wasted request per session, not one per search.
* `README.md`, which is a deliverable of this phase and the first thing a stranger reads.

**No rate limiter.** It was removed from the design; `architecture.md` and `functional_spec.md` are
current on that. The proxy holds no per-request state of any kind. Platform rate limiting is the
operator's required step before exposing a public instance, and the README says so plainly.

## Steps

1. **Retire the bridge.** In `currentMode()` in `index.html`, replace

   ```js
   return mode === "shared" ? "nokey" : mode;
   ```

   with `return mode;`, and replace the Phase 2 bridge comment with a note on why the mode is
   computed per call rather than cached. Nothing else in `currentMode` changes. Sweep the file for
   the remaining Phase-2-era references to the bridge (`keyStateText`'s comment) and bring them
   current.

2. **Core addition** — one pure predicate, exported to the test harness:

   ```js
   // Whether a shared-mode outcome says the proxy is not there at all, as opposed to a search
   // that failed. 404 and 405 are a static host answering for a path with no function behind it;
   // 0 is the client's marker for "no readable HTTP response", which covers a body that would not
   // parse as JSON — an SPA fallback serving index.html for /api/search — and a network failure.
   proxyUnavailable(status) -> boolean
   ```

   A 5xx is deliberately *not* on the list: something is there and it is broken, which is a
   retryable search failure, not a missing proxy. Nor is `"timeout"`.

3. **Shared-mode failure handling in `runSearch`.** After the sequence check, before the generic
   failure branch:

   ```js
   if (mode === "shared" && proxyUnavailable(outcome.status)) {
     writeStore(sessionStorage, PROXY_UNAVAILABLE_KEY, "1");
     fail("nokey");
     return;
   }
   ```

   The write is through the existing `writeStore` guard, so a browser blocking storage costs one
   request per search instead of one per session rather than throwing. `fail("nokey")` renders the
   actionable key prompt rather than "Search is unavailable right now", and every later search in
   the session takes the `nokey` branch before making a request — `currentMode()` reads the flag
   through `proxyKnownBad()`. The same render also flips the About and Settings prose to the solo
   wording, because `sharedAllowanceExists()` is now false.

   Over `file:` none of this runs: `selectMode` short-circuits on the protocol and shared mode is
   never selected, so there is no doomed request and no console error.

   No new search call site is introduced. Per `phase_2.md` step 7, if one ever is, it goes through
   `startSearch`, never `runSearch` directly and never `void`.

4. **`functions/api/search.js`** — a Cloudflare Pages Function, same-origin with the page, so no
   CORS handling, no preflight, no origin allowlist. Plain ES module, no imports, no dependencies.

   ```js
   export async function onRequestPost({ request, env })

   readJsonBody(request)      -> Promise<{ ok: true, value } | { ok: false, message }>
   allowlistBody(raw)         -> { ok: true, value } | { ok: false, message }
   shouldFallback(status)     -> boolean
   credentialChain(env)       -> Array<{ title } | { key }>
   callKeenable(body, auth)   -> Promise<Response>
   ```

   * `SEARCH_ENGINE_NAME` is a constant at the top of the file, mirroring `index.html`'s: it is
     the `X-Keenable-Title` attribution string, and the proxy cannot read the frontend's config.
     The README's config table says to change both when renaming.
   * `readJsonBody` rejects a body over 8KB — checked against `Content-Length` first and against
     the decoded byte length after — and a body that is not JSON, or is not a JSON object.
   * `allowlistBody` copies only `query`, `mode`, `max_results`, `snippet_max_length`, `site`,
     `published_after`, `published_before`, `acquired_after`, `acquired_before`. Everything else is
     dropped silently. `query` must be a non-empty string under 2KB. `max_results` is clamped to
     1–50 whatever the caller asked for. String fields are copied only when they are strings and
     numeric fields only when they are finite numbers, so a caller cannot smuggle an object
     through. Allowlisting rather than forwarding is the entire point: a pass-through proxy is an
     open relay for arbitrary JSON on the operator's key.
   * `credentialChain` returns `[{ title }]` when `KEENABLE_API_KEY` is unset — the proxy is then
     keyless-only and a fork inherits no credit exposure — and both credentials in the order
     `UNAUTHENTICATED_FIRST` (default true) asks for when it is set.
   * `callKeenable` sends `X-Keenable-Title` on the keyless call and `X-API-Key` on the keyed one,
     never both. A `fetch` that throws becomes a synthesized 502 rather than a stack trace, so the
     one flow handles a dead upstream identically to a 5xx from a live one.
   * The attempt loop runs the chain in order and stops at the first outcome that is not
     `shouldFallback`. With at most two credentials it therefore falls back **at most once**,
     structurally rather than by a counter. `shouldFallback` is 401, 402, 429 and 5xx; a 400 is
     never retried, because a malformed query fails identically on both tiers and a retry only
     burns quota.
   * Keenable's status and body are returned unchanged, so the client's error mapping is the same
     in both modes. `Cache-Control: no-store` is set on the way out; nothing is logged and nothing
     is stored.

5. **`test/proxy.test.mjs`.** Reads `functions/api/search.js` and imports it as a `data:` URL
   module, then injects a stub `fetch`.

   The `data:` import is not decoration. The file has to be `.js` for Cloudflare Pages, and with no
   `package.json` a direct `import("../functions/api/search.js")` resolves as CommonJS on Node 18
   and loads only through the module-syntax detection added in Node 20.19 / 22.7 — the exact silent
   floor-raising the `.mjs` rule elsewhere exists to prevent. A `data:` URL is unambiguously ESM on
   every version, and it still reads the real file from disk.

6. **`README.md`.** What Froogle is; the two modes and why the shape is what it is; the three
   deployment shapes; the frontend config table and the proxy environment table; the plain warning
   that an `API_KEY` baked into a publicly served file is publicly readable; platform rate limiting
   as the **required** step before exposing a public instance with a key; how to run the tests; and
   the manual test checklist, transcribed from `architecture.md` and `phase_2.md`.

## Tests

New tests in `test/proxy.test.mjs`:

- `allowlistBody` — keeps every allowlisted field; drops unknown fields; drops a non-string `site`
  and a non-numeric `snippet_max_length`; rejects a missing, non-string, empty, whitespace-only, or
  over-2KB `query`; clamps `max_results` above 50, below 1, and rounds a fractional one; leaves a
  `max_results` in range alone; omits `max_results` entirely when the caller sent none.
- `shouldFallback` — true for 401, 402, 429, 500, 502, 503; false for 200, 400, 403, 404.
- `credentialChain` — keyless only when `KEENABLE_API_KEY` is unset, blank, or whitespace;
  `[title, key]` under the default; `[key, title]` when `UNAUTHENTICATED_FIRST` is `"false"` (and
  `"0"`, `"no"`, and a real `false`); `[title, key]` for `"true"` and for an unset value.
- `onRequestPost` — a non-JSON body, a JSON array, a JSON string, and an oversized body each return
  400 without calling `fetch` at all.
- `onRequestPost` — the keyless call goes to `/v1/search/public` and carries `X-Keenable-Title` and
  no `X-API-Key`; the keyed call goes to `/v1/search` and carries `X-API-Key` and no
  `X-Keenable-Title`.
- `onRequestPost` — the upstream request body is the allowlisted object, not the caller's.
- `onRequestPost` — falls back on 401, 402, 429 and 5xx; does **not** fall back on 400 or 403; the
  fallback is attempted at most once, so two failing credentials produce exactly two upstream
  calls and the second failure is returned.
- `onRequestPost` — no fallback when `KEENABLE_API_KEY` is absent: a keyless 429 is returned
  unchanged after exactly one upstream call.
- `onRequestPost` — the upstream status and body are returned byte-for-byte on success and on
  error.
- `onRequestPost` — an upstream `fetch` that throws becomes a 502 carrying no stack, and falls back
  when a second credential exists.
- `onRequestPost` — the response carries `Cache-Control: no-store`.
- The proxy module holds no per-request state: two identical requests produce identical upstream
  call sequences, and the module exports no counter or store.

New tests in `test/core.test.mjs`:

- `proxyUnavailable` — true for 404, 405 and 0; false for 200, 400, 401, 429, 500, `"timeout"`,
  `"nokey"`, and `undefined`.

All 75 existing tests keep passing, including the sandbox-globals diff and the
no-DOM-dependency evaluation, which now cover one more exported function.

## Manual checklist

Browser-level behavior this phase makes reachable for the first time. It goes into the README, and
the first item has never rendered in any build:

* **On a hosted build with the Function deployed, the About and Settings prose shows the *shared*
  wording.** Every Phase 2 build resolved to solo, so this branch renders for the first time here.
* A keyless search on a hosted build returns results through the proxy, and the footer reads
  "Queries proxied through Froogle. Zero logs."
* Saving a key on that same build flips the footer, the key-state line and the next search to
  direct, with no reload — and the About prose keeps its shared wording, because the deployment
  still has a shared allowance.
* `index.html` alone on a static host with no Function: the first keyless search costs one request
  and lands on the key prompt; every later search in the session goes straight there with no
  network request at all; a new tab tries once more.
* Over `file://` a keyless search goes straight to the key prompt with no request attempted and
  nothing in the console.
