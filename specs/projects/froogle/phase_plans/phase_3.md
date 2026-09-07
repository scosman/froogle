---
status: complete
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
   // Whether a shared-mode outcome PROVES the proxy is not there, as opposed to a search that
   // failed. 404 and 405 are a static host answering for a path with no function behind it, and
   // "unreadable" is one answering it with a page — an SPA fallback serves index.html for any
   // path and returns 200 with HTML, which no proxy would ever do.
   proxyUnavailable(status) -> boolean   // 404, 405, "unreadable"
   ```

   Only the unambiguous cases, because the consequence lasts the whole session. Status `0` is
   deliberately excluded: it means `fetch` rejected, which on a same-origin path is a dropped
   connection rather than a CORS block, so one bad moment on a phone would otherwise downgrade the
   session *and* flip About to a claim that is then false. A 5xx and a `"timeout"` are excluded for
   the same reason — something is there and having a bad minute.

   That distinction did not exist before: `requestSearch` flattened both a `fetch` rejection and an
   unparseable body to `0`. It now sets a `responded` flag the instant `fetch` resolves and returns
   `"unreadable"` for the second case. `errorMessage` maps it to the same generic retryable text,
   so the split is invisible to the visitor and exists only for the probe.

3. **Shared-mode probe handling in `runSearch`.** Every shared-mode search doubles as the probe,
   because a relative `PROXY_PATH` is all this page knows and nothing else ever asks. After the
   sequence check, before the generic failure branch:

   ```js
   if (mode === "shared" && proxyUnavailable(outcome.status)) {
     markProxyMissing();
     fail("nokey");
     return;
   }
   ```

   and, on the success path, the other half: `if (mode === "shared") proxyAnswered = true;` — a
   readable answer from `PROXY_PATH` being the only proof this page ever gets that a proxy is
   really there. A *failed* response is not proof of presence: a 500 or a 429 at that path could
   come from a static host or an edge rule as easily as from a proxy.

   `markProxyMissing()` sets a module-level `proxyMissing` **and** writes the session flag, and
   `proxyKnownBad()` reads both. The mirror matters: `writeStore` returns false in Safari's "block
   all cookies", and without it the notice would say "needs your own key" while the footer said
   "Queries proxied through Froogle" — exactly the disagreement `keyStateText` forbids — and every
   search would re-probe.

   `fail("nokey")` renders the actionable key prompt rather than "Search is unavailable right now",
   and every later search takes the `nokey` branch before making a request.

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
     1–50 and `snippet_max_length` to 180–10000 whatever the caller asked for — the operator's key
     pays for what we send, and an unclamped 10000 across 50 results is half a megabyte per
     request. String fields are copied only when they are strings and numeric fields only when they
     are finite numbers, so a caller cannot smuggle an object through. Allowlisting rather than
     forwarding is the entire point: a pass-through proxy is an open relay for arbitrary JSON on
     the operator's key.
   * `mode` is **pinned**, not merely type-checked: copied only when it is exactly `"pro"`, and
     dropped otherwise. `realtime` requires an API key, so honouring it would let an anonymous
     caller fail the keyless tier on purpose and be served on `KEENABLE_API_KEY` on every request.
     Validating against the full enum leaves that open; pinning the one value the frontend ever
     sends closes it and costs nothing.
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
     in both modes — byte-for-byte for every non-2xx status and for a 2xx that parses as JSON. A
     2xx whose body will not parse becomes a 502 instead. That is what makes the client's
     `"unreadable"` probe sound: it reads an unparseable success from `PROXY_PATH` as proof no
     proxy is there, so forwarding a malformed 200 from Keenable would let a working deployment
     frame itself as a missing one. The guard is 2xx only — an error body reaches the client
     untouched whatever it contains. `Cache-Control: no-store` is set on the way out; nothing is
     logged and nothing is stored.

5. **`test/proxy.test.mjs`.** Reads `functions/api/search.js` and imports it as a `data:` URL
   module, then injects a stub `fetch`.

   The `data:` import is not decoration. The file has to be `.js` for Cloudflare Pages, and with no
   `package.json` a direct `import("../functions/api/search.js")` resolves as CommonJS on Node 18
   and loads only through the module-syntax detection added in Node 20.19 / 22.7 — the exact silent
   floor-raising the `.mjs` rule elsewhere exists to prevent. A `data:` URL is unambiguously ESM on
   every version, and it still reads the real file from disk.

6. **A third state for the deployment prose.** `sharedAllowanceExists()` becomes
   `deploymentSharing() -> "shared" | "solo" | "unknown"`, and a `data-when-unknown` wording joins
   `data-when-shared` and `data-when-solo` in About and Settings.

   Two states were a guess wearing the clothes of a fact. `selectMode` returns `"shared"` for any
   http(s) origin with a `PROXY_PATH` that has *not been probed*, and only a keyless search ever
   probes — so on a static host whose operator baked in an `API_KEY`, nobody is ever keyless,
   nothing ever probes, and About would assert a shared proxy that does not exist for the life of
   the deployment. `"shared"` is now claimed only once `proxyAnswered` is true, `"solo"` only when
   it is structurally certain (`file:`, no `PROXY_PATH`, or a probe that proved it), and
   `"unknown"` says so plainly and points at the footer.

   The footer indicator and the key-state line keep reading `shared` on an unprobed deployment,
   deliberately: they describe what the *next search will attempt*, which is true and self-corrects
   within one request, while this prose describes the deployment, which is a durable claim. Both
   are worded to say so rather than leaving the reader to infer it — the key-state line reads
   "searches **will try** …'s shared allowance", and the unknown bullet ends by telling the visitor
   what a search will do if there turns out to be no proxy, rather than pointing at a footer line
   that only changes in the failure case.

7. **`README.md`.** What Froogle is; the two modes and why the shape is what it is; the three
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
- `allowlistBody` — accepts `mode: "pro"` and drops every other value, `"realtime"` and casing
  variants included; and end to end, a request asking for `"realtime"` reaches Keenable with no
  `mode` at all.
- `allowlistBody` — clamps `snippet_max_length` above 10000 and below 180, and omits it when the
  caller sent none.
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
  error, whitespace included, and a 2xx parsing to a non-object still passes through.
- `onRequestPost` — a 2xx body that will not parse (empty, whitespace, HTML, truncated JSON)
  becomes a 502 carrying only an `error` field; a non-2xx body is passed through whether it parses
  or not.
- `onRequestPost` — an upstream `fetch` that throws becomes a 502 carrying no stack, and falls back
  when a second credential exists.
- `onRequestPost` — the response carries `Cache-Control: no-store`.
- The proxy module holds no per-request state: two identical requests produce identical upstream
  call sequences, and the module exports no counter or store.

New tests in `test/core.test.mjs`:

- `proxyUnavailable` — true for 404, 405 and `"unreadable"`; false for `0`, 200, 400, 401, 402,
  403, 429, 500, 502, 503, `"timeout"`, `"nokey"`, `undefined` and `null`.
- `errorMessage` — `"unreadable"` reduces to exactly the generic retryable message that `0` does,
  in both modes, and leaks nothing about parsing.
- `keyCheckResult` — `"unreadable"` saves the key with the same unverified note that `0` gives:
  a response we could not read disproves nothing about the key.

All 75 existing tests keep passing, including the sandbox-globals diff and the
no-DOM-dependency evaluation, which now cover one more exported function.

## Manual checklist

Browser-level behavior this phase makes reachable for the first time. It goes into the README, and
the first item has never rendered in any build:

* **The About and Settings prose walks all three of its states**: *unknown* on first load of a
  hosted build, *shared* after one successful keyless search, *solo* on `file://`. The shared
  branch renders for the first time here — every Phase 2 build resolved to solo — and the unknown
  branch is new in this phase.
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
* Going offline on a working hosted build gives the generic retryable error, and the next search
  once back online succeeds: a dropped connection must not retire shared mode or flip the prose.
