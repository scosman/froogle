---
status: draft
---

# Implementation Plan: Froogle

Three phases. Each ends with a working, reviewable artifact and its tests passing.

## Phases

- [ ] **Phase 1: Shell.** `index.html` end to end with no network: design tokens and layout,
      the four views, fragment routing with legacy `?q=` normalization, the core pure functions
      (`parseRoute`, `formatRoute`, `legacyTarget`, `parseQuery`, `selectMode`, `resolveKey`,
      presentation helpers, `errorMessage`), key storage with `try/catch` guards, the settings
      form without validation, the footer mode indicator, and the CSP and referrer meta tags.
      `test/core.test.js` covering the full core surface. Ships as a real page you can navigate;
      searching reports that search is not wired yet.

- [ ] **Phase 2: Search, direct mode.** The API client with `AbortController`, sequence-based
      race resolution, and the 15s timeout. `buildRequestBody`, result rendering with
      `createElement`/`textContent` and the `isLinkableUrl` guard, every state (searching, results,
      empty, error, no-key), and settings key validation via a live search. At the end of this
      phase Froogle is fully usable from `file://` or any static host with a key.

- [ ] **Phase 3: Proxy and shared mode.** `functions/api/search.js`: body allowlist, per-IP rate
      limiter, the keyless-first fallback chain, unchanged status and body pass-through. Frontend
      shared-mode path, proxy-unavailable detection cached in `sessionStorage`, and the `file:`
      short-circuit. `test/proxy.test.js`. README: what Froogle is, config table, the three
      deployment shapes, the API key warning for public static hosts, the Cloudflare Rate Limiting
      recommendation, and the manual test checklist.

## Later

Not part of v1, ordered by expected value:

- [ ] **Cached page view.** A per-result link rendering `GET /v1/fetch` markdown as plain text.
- [ ] **Keyless zero-signup**, if Keenable adds `X-Keenable-Title` to their CORS allowlist. Would
      demote the key prompt to a fallback and could retire the proxy.
- [ ] **Point-in-time search** via the documented `query_time` parameter.
