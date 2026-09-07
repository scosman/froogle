---
status: draft
---

# Phase 1: Shell

## Overview

Build `index.html` end to end with no network calls: design tokens, layout, the four views,
fragment routing with legacy `?q=` normalization, the whole pure core, key storage guarded by
`try/catch`, the settings form (no validation yet), the footer mode indicator, and the security
meta tags. Plus `test/core.test.mjs` covering the full core surface.

`buildRequestBody` is built here alongside `parseQuery` rather than in Phase 2: it is pure, it is
part of the core surface in `architecture.md`, and splitting it from the parser it consumes would
leave both half-tested. Everything else Phase 2 owns stays in Phase 2 — the API client, and the
result renderer with its `createElement` / `textContent` discipline and `isLinkableUrl` guard.
Phase 1 ships the result list's *markup and styling* as part of the layout, because the layout is
what this phase is for, but nothing writes into that list yet.

At the end of this phase the page is real and navigable — home, results, about, settings, back and
forward, a saved key that flips the mode indicator — and submitting a search renders a notice
saying search is not wired up yet. Phase 2 replaces that one function with the API client.

## Steps

1. **`index.html` head.** CSP meta first in `<head>` (exact policy from `architecture.md`), then
   `<meta name="referrer" content="no-referrer">`, charset, viewport, `<title>`, an inline
   `data:image/svg+xml` favicon, and the `<style>` block.

2. **CSS.** `:root` custom properties for the nine tokens in `ui_design.md`. Single 640px column,
   16px side padding. Home (44px serif wordmark, 22vh top space), results header (22px wordmark +
   inline form, stacking below 480px), a 1px rule, result list, notice, prose, key form, footer.
   Two-line snippet clamp via `-webkit-line-clamp` with a `max-height` fallback. 2px `--focus`
   outline on every focusable control. No images, no animation.

3. **Markup.** `<noscript>` explaining Froogle needs JavaScript. Four `<section>` views
   (`#view-home`, `#view-results`, `#view-about`, `#view-settings`) toggled by the `hidden`
   attribute, one shared `<footer>` with About · Settings · mode indicator. Both search forms are
   real `<form>`s with a labelled `<input type="search">`; the home label is visually hidden.
   Results are a `<ul>`. The notice is `role="status" aria-live="polite"`.

4. **Config constants** at the top of the script: `SEARCH_ENGINE_NAME`, `API_KEY`, `PROXY_PATH`,
   plus `KEENABLE_SEARCH_URL`, `MAX_RESULTS`, `SNIPPET_MAX_LENGTH`, `REQUEST_TIMEOUT_MS`.

5. **Core region**, fenced by `// ---- FROOGLE:CORE:BEGIN ----` / `:END`, pure — no `document`,
   `window`, `fetch`, or storage:

   ```js
   parseRoute(hash, search) -> { view, query }
   formatRoute(view, query) -> string
   legacyTarget(search) -> string | null      // "" means "normalize to home"
   parseQuery(raw) -> { query, filters }
   buildRequestBody(parsed) -> object
   legacyRedirect(search, hash) -> string | null
   resolveKey(configKey, stored) -> string | null
   selectMode({ key, protocol, proxyKnownBad, proxyPath }) -> "direct" | "shared" | "nokey"
   resultTitle(result) -> string
   pickSnippet(result) -> string
   normalizeSnippet(text) -> string
   isLinkableUrl(url) -> boolean
   displayUrl(url) -> string
   formatDate(iso) -> string | null
   escapeXml(text) -> string
   errorMessage({ status, mode, engineName }) -> { text, action }
   modeIndicator(mode, engineName) -> { text, action }
   ```

   Operator rules: `site:`, `after:`, `before:` matched case-insensitively on whitespace tokens;
   `site` must be a dotted hostname, dates must be a real `YYYY-MM-DD`; anything malformed or
   empty stays in the query text. `formatDate` uses UTC getters and a fixed month table so it does
   not vary by locale or timezone. `errorMessage` accepts numeric statuses plus the sentinels
   `"timeout"` and `"nokey"`. `errorMessage` and `modeIndicator` take the engine's name as a
   parameter rather than reading `SEARCH_ENGINE_NAME`, which is declared above the core marker: a
   renamed instance has to read correctly everywhere, and the core has to stay evaluable alone.
   `legacyRedirect` layers the fragment-wins precedence over `legacyTarget`, so the router and
   `parseRoute` cannot disagree about which one is authoritative.

6. **Runtime region.** `state` object per `architecture.md`; storage helpers wrapped in
   `try/catch` (`froogle.key` in `localStorage`, `froogle.proxyUnavailable` in `sessionStorage`);
   `currentMode()` composing `resolveKey` + `selectMode`; `render()` showing one view, filling the
   forms, updating `document.title`, the footer mode line and the settings key state; the router
   (`legacyRedirect` normalization via `location.replace` on a URL with `search` cleared, then
   `hashchange`); form submit handlers; settings Save/Clear; and a `try/catch` around startup, so a
   failure there reads as a message rather than a blank page. No result rendering — that is Phase 2.

7. **Search placeholder.** `runSearch()` sets `state.status = "error"` with a phase-1 notice
   saying search is not wired up yet. This is the single function Phase 2 replaces.

8. **`test/core.test.mjs`.** Reads `index.html`, extracts the text between the core markers,
   evaluates it in a `node:vm` context seeded only with `URL` and `URLSearchParams`, and returns
   the exported names. Runs under `node --test` from the repo root with no dependencies and no
   `package.json`. Two constraints on how it is written:

   * `.mjs`, not `.js`. With no `package.json` to declare the module type, an ESM `.js` test file
     loads only through Node's module-syntax detection, which would raise the project's floor from
     Node 18 to Node 20.19 / 22.7 without saying so.
   * `node --test`, not `node --test test/`. Node 22 resolves a bare directory argument as a
     module and fails; bare `node --test` discovers `test/` on its own.

## Tests

- `the core's sandbox holds nothing but the language, URL and URLSearchParams` — the seeded
  globals are diffed against a bare context, so the sandbox cannot quietly grow one.
- `core region carries no DOM, network or storage dependency` — the core evaluates in that sandbox,
  which is the assertion. Precisely: a *top-level* reference to `document`, `fetch` or
  `localStorage` fails at evaluation, while one inside a function body fails only when that
  function is called, so the guarantee reaches exactly as far as this suite's coverage of the
  exports — which is why every export is exercised.
- `parseQuery` — bare query; `site:` alone and mid-query; `after:`/`before:` valid and malformed;
  empty operator value stays in text; multiple operators; later operator wins; `ratio 3:1` is not
  an operator; case-insensitive operator names; empty input.
- `parseRoute` / `formatRoute` — round-trip for plain, spaced, `#`, `&`, `+`, and non-ASCII
  queries; `#about`, `#settings`; empty, `#q=`, and unknown fragments fall back to home; a
  malformed percent sequence does not throw.
- `legacyTarget` — `?q=foo` and `?q=hello+world` map to `#q=`, `?about` maps to `#about`, `?q=`
  empty maps to `""`, and anything else returns `null`.
- `legacyRedirect` — follows the query string when there is no fragment, keeps the fragment when
  there is one (`?q=cats#about` stays on About), and returns `null` with nothing legacy to rewrite.
- `selectMode` — every row of the architecture table, plus an empty `proxyPath`.
- `resolveKey` — config wins over stored; whitespace-only and non-string are absent; stored used
  when config is empty.
- `isLinkableUrl` — accepts http/https; rejects `javascript:`, `data:`, `vbscript:`, `file:`,
  empty, and malformed.
- `displayUrl` — strips the scheme, drops a bare trailing slash, keeps path and query, truncates
  very long URLs, passes through unparseable input.
- `resultTitle` — uses `title`, falls back to hostname, then to the raw URL.
- `pickSnippet` / `normalizeSnippet` — `snippet` wins, falls back to `description`, both absent
  yields `""`; newlines and whitespace runs collapse.
- `formatDate` — `YYYY-MM-DD`, a full ISO timestamp, a zone-less timestamp near either end of the
  day, an explicit offset, absent, and unparseable input; no timezone drift in any of them.
- `errorMessage` — 400, 401, 403, 402, 429 in both direct and shared mode, 500, 0, `"timeout"`,
  `"nokey"`, and the Phase 1 `"unwired"` placeholder; every message is plain language containing no
  raw status code.
- `buildRequestBody` — always sets `mode`, `max_results`, `snippet_max_length`; includes filters
  only when present.
- `modeIndicator` — the three mode strings, and only `nokey` carries a settings action.
- `escapeXml` — the five characters that would break the inline SVG favicon.
- A renamed engine — a non-default `engineName` reaches every core message that names the engine.
- `resolveEngineName` — a blank, whitespace-only, absent or non-string name falls back to
  `DEFAULT_ENGINE_NAME`, and a padded one is trimmed. The host layer resolves the configured name
  once into `ENGINE_NAME` and uses that everywhere, so the page cannot end up half-renamed.
