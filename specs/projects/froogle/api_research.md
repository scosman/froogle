---
status: draft
---

# Keenable API — research notes

`docs.keenable.ai` and `api.keenable.ai` are blocked by this session's egress proxy, so the live
API was **not** probed. Everything below is derived from Keenable's own published, first-party
artifacts, which are consistent with each other:

| Source | What it gave us |
|---|---|
| `keenable` (npm, official TS SDK v0.1.2) | endpoint construction, headers, request payload, error mapping |
| `keenable` (PyPI, official Python SDK v0.1.1) | same, independently confirming |
| `@keenable/client` (npm v0.1.1) | **generated OpenAPI schema** — the authoritative contract |
| `keenableai/keenable-mcp` (GitHub) | keyless endpoint URL, keyless rate limit, `X-Keenable-Title` |
| `n8n-nodes-keenable` (npm) | `realtime` mode requires a key |

## Endpoints

Base URL `https://api.keenable.ai` (override: `KEENABLE_API_URL`).

The SDKs build the path as `/v1/{endpoint}` and append `/public` when no API key is configured:

| Purpose | Keyed | Keyless |
|---|---|---|
| Search | `POST /v1/search` | `POST /v1/search/public` |
| Fetch page as markdown | `GET /v1/fetch?url=` | `GET /v1/fetch/public?url=` |
| Relevance feedback | `POST /v1/feedback` | — |
| Validate key / identity | `GET /v1/auth/user` | — |

## Headers

* `X-Keenable-Title: <name>` — attribution string. **The public tier rejects requests without it**
  (verbatim comment in the official TS SDK). Sent on keyed requests too.
* `X-API-Key: keen_...` — only when keyed.
* `Content-Type: application/json` on search; `Accept: application/json`.

## Search request

```json
{
  "query": "string, required",
  "mode": "pro | realtime",
  "site": "arxiv.org",
  "published_after": "YYYY-MM-DD | ISO 8601 | relative e.g. \"7d\"",
  "published_before": "...",
  "acquired_after": "...",
  "acquired_before": "...",
  "snippet_max_length": 500
}
```

* `mode` defaults to `pro` (deeper retrieval). `realtime` is faster and, per the n8n node's README,
  **requires an API key**.
* `snippet_max_length` is sent by both official SDKs but is **absent from the OpenAPI schema** —
  newer than the generated spec, or undocumented. Treat as best-effort; truncate client-side too.

## Search response

```json
{ "query": "echo", "mode": "pro", "results": [ { ... } ] }
```

`SearchResult`: `title`, `url`, `description`, `snippet?`, `published_at?`, `acquired_at?`.

Two sources disagree on which text field is populated, so **both must be handled**:

* OpenAPI schema marks `description` required and `snippet` optional.
* Both SDK READMEs say the opposite: `snippet` carries the extracted page text and is the field to
  use; `description` is the page's meta description and "is absent for most pages".

Resolution: render `snippet || description || ""`. The keyless script in Keenable's own skill does
exactly this (`r.get("snippet") or r.get("description")`).

`snippet` is **raw page text, not a SERP snippet** — the Python SDK notes it "carries newlines".
It is sized for stuffing into an LLM prompt, not for a two-line result listing.

## No pagination, no result count

Confirmed across the OpenAPI schema and both official SDKs: there is **no** `count`, `limit`,
`num_results`, `offset`, `page`, or cursor parameter, and the response carries no total or
next-page token. You get one array, server-chosen length.

Consequences for a SERP: there is no page 2 to build. Result count per query is whatever the API
returns.

## Errors

| Status | Meaning (from the OpenAPI schema) |
|---|---|
| 400 | Invalid request parameters |
| 401 | Missing or invalid API key |
| 402 | **No credits available** — upgrade plan or buy credits |
| 404 | (fetch) page not found |
| 422 | (fetch) content could not be extracted |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

402 matters for the fallback design: a keyed request can fail on *credits* as well as on *rate*,
and both should fall back to keyless.

## Rate limits

* **Keyless:** 1,000 requests/hour, per caller (Keenable's MCP README, repeated across their
  packages). The exact bucketing (per IP, per IP+Title) is not documented publicly.
* **Keyed:** pricing page states 100,000 free requests/month then pay-as-you-go. The 10 req/s
  figure is from the project owner and is not in any published artifact we could reach.

## CORS — measured, and it constrains the design

Both directions were tested with curl against `POST /v1/search/public`.

**Actual response** (with `Origin: https://evil.example`):

```
access-control-allow-origin: https://evil.example      <- echoes the origin, not "*"
vary: Origin
access-control-allow-credentials: true
access-control-expose-headers: X-Request-Id, Server-Timing
x-ratelimit-limit: 1000
x-ratelimit-remaining: 997
x-ratelimit-reset: 2026-09-07T17:13:25.008Z
```

**Preflight response** (`OPTIONS`, requesting `content-type,x-keenable-title`):

```
HTTP/2 204
access-control-allow-methods: GET,POST,PUT,DELETE,PATCH,OPTIONS
access-control-allow-headers: Content-Type,Authorization,X-API-Key,baggage,sentry-trace,
                              traceparent,tracestate,Accept,Accept-Language,Content-Language
access-control-expose-headers: Content-Type,Authorization,X-Request-Id
```

### Consequences

1. **`X-Keenable-Title` is NOT allowed by the preflight.** The allow-headers list is static — it
   ignores `Access-Control-Request-Headers` rather than reflecting it. A browser that sends the
   header fails preflight and the request is never made. curl succeeds only because curl does not
   preflight.

   This collides with the comment in Keenable's official TS SDK: *"The public tier rejects
   requests without this header."* **BLOCKING OPEN QUESTION:** does `POST /v1/search/public`
   actually succeed with no `X-Keenable-Title`? If yes, omit the header and the browser-only
   architecture stands. If no, keyless-from-browser is impossible and the project needs either a
   proxy or a key.

2. **`Content-Type` and `X-API-Key` are allowed**, so a JSON POST works and the keyed endpoint is
   browser-reachable. (A JSON `Content-Type` is not CORS-safelisted, so every search is
   preflighted; that preflight passes.)

3. **Rate-limit headers are invisible to JS.** `X-RateLimit-Limit/Remaining/Reset` are sent but
   absent from `access-control-expose-headers`, so `fetch()` cannot read them cross-origin. No
   quota indicator is possible; the app only learns of the limit when a 429 arrives.

4. **Origin is echoed, not `*`,** and `access-control-allow-credentials: true`. Never send
   `credentials: "include"` — there is no reason to attach cookies to a search. It also leaves
   `file://` (`Origin: null`) unverified: it works only if the server echoes the literal `null`.

5. Confirms the keyless limit is **1,000/hour**, with an absolute ISO reset timestamp.

### Still open

* Does the public endpoint work without `X-Keenable-Title`? (blocking, above)
* Does `file://` / `Origin: null` work? (gates the "Downloads folder" deployment promise)

## Consequences of calling from the browser

* **Quota is per visitor.** Each user's IP gets its own keyless 1,000/hour, so the engine has no
  aggregate rate limit and costs the operator nothing.
* **An `API_KEY` in a static file is public.** Anyone who views source can read it. The key option
  is therefore only meaningful for a private deployment (`file://`, an intranet, a password-gated
  host). This must be stated plainly in the README next to the config block.
* **No server-side caching is possible.** Any caching is per-browser.

## Result count: not requestable

There is no `limit`, `count`, `top_k`, `num_results`, `offset`, `page`, or cursor in the OpenAPI
schema or either official SDK, and the response carries no total or next-page token. The Haystack
integration's `top_k` is documented as *"applied client-side"*, confirming integrations trim rather
than request. Undocumented params demonstrably exist (`snippet_max_length` is sent by both SDKs and
absent from the schema), so a probe for an undocumented count param is worth one pass; absent a
hit, the app renders every result the API returns.
