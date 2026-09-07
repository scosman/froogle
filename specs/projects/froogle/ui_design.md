---
status: complete
---

# UI Design: Froogle

One HTML file, four views, no images, no frameworks, no build step.

## Design intent

Inspired by early-2000s web search: a wordmark, a box, a list of links, and nothing else. The
reference is the *era*, not any one engine. Explicitly avoided, because they are specific to
Google rather than to the period:

* Multi-colored wordmark letters.
* Their exact palette values — link blue `#1a0dab`, URL green `#006621`.
* Their typefaces, logo forms, and layout measurements.

What the period actually gives us, and what we take: heavy whitespace, a centered single-purpose
home page, underlined text links, a dense unstyled-feeling result list, and no chrome.

## Design tokens

Declared once as CSS custom properties on `:root`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fcfcfa` | Page. Warm off-white, not pure white |
| `--ink` | `#202020` | Body text, wordmark |
| `--ink-soft` | `#5f5b54` | Dates, footer, secondary text, input placeholder |
| `--url` | `#2d6a4f` | The URL line under a result title |
| `--ink-faint` | `#8a857c` | Rules and borders only |
| `--link` | `#1a3fb0` | Unvisited result titles |
| `--link-visited` | `#6b2fa0` | Visited result titles |
| `--notice` | `#8a4b1f` | Error and empty-state text |
| `--focus` | `#1a3fb0` | Focus ring |
| `--field` | `#ffffff` | Text input interiors |
| `--control` | `#f1efe9` | Button face |
| `--control-hover` | `#e8e5dd` | Button face, hover |

Type: `Georgia, "Times New Roman", serif` for the wordmark only; `system-ui, -apple-system,
"Segoe UI", Roboto, sans-serif` for everything else. Sizes: 15px base, 13px secondary, 11px
footer, 44px home wordmark, 22px header wordmark.

Spacing scale: 4, 8, 12, 16, 24, 40px. Nothing else.

> **On the green URL line.** A colored URL beneath the title is a general SERP convention, not a
> Google invention, so it stays. What we avoid is their specific value: `#006621` is a warm,
> saturated emerald. `--url` is a desaturated pine with a cool cast — recognizably the same idea,
> plainly not the same color. It clears WCAG AA against `--bg` at roughly 6.3:1.

Every color the page paints is one of these tokens; no surface, border or text color is written as
a literal outside the `:root` block. The one exception is the static favicon `<link>` in `<head>`,
which carries `--ink`'s value inline because a `data:` URI cannot reference a custom property; the
script redraws that favicon from the token at startup.

## Page inventory

| View | Route | Purpose |
|---|---|---|
| Home | *(no fragment)* | Enter a search |
| Results | `#q=<query>` | See results for a query |
| About | `#about` | What Froogle is, how it works, privacy |
| Settings | `#settings` | Manage a personal API key |

Views are `<section>` elements in the one document, shown and hidden by the router. There is no
client-side templating; each view's markup exists in the HTML and only the result list is built
dynamically.

## Layout

Single column throughout, max width 640px, centered, 16px side padding. The same column applies at
every breakpoint — a search engine has no use for a second column, so there is no responsive
reflow to get wrong. Below 480px the results header stacks the wordmark above the search box.

### Home

```
                    (vertical space, ~22vh)

                       F r o o g l e            <- 44px serif wordmark

              [ search box, 480px max      ] [ Search ]

                    (vertical space)

                About · Settings · <mode line>  <- 11px, --ink-soft
```

Input receives focus on load. Submit via the button or Enter.

### Results

```
Froogle   [ typescript best practices    ] [ Search ]     <- 22px wordmark, links home
──────────────────────────────────────────────────────    <- 1px --ink-faint rule

Understanding TypeScript's structural typing              <- 15px, --link, underlined
example.com/blog/structural-typing                        <- 13px, --url, plain text
Jan 8, 2026 — Structural typing means a type is           <- 13px, --ink, 2 lines max
compatible with another if its members are compatible…

(24px gap, next result)

                About · Settings · <mode line>
```

The search box stays populated with the current query so it can be edited in place.

### About

Prose in the same column: what Froogle is, how it works, privacy. Headings at 15px bold, body at
15px, generous paragraph spacing. Ends with links to the source repo and to Keenable.

The "how it works" list describes shared mode only where shared mode can actually happen — see
**Deployment-conditional prose** below.

### Settings

Explains the modes this deployment has, then a single labelled `<input type="password">` for a
Keenable key, with Save and Clear buttons and a link to Keenable's console. Below it, the current
state in one line, which is derived from the same mode calculation as the footer indicator so the
two can never disagree:

| Condition | Line |
|---|---|
| Direct, key from `API_KEY` | "This copy of Froogle has a key built in, which takes precedence over anything saved here." |
| Direct, key from `localStorage` | "Using a key stored in this browser." |
| Shared | "No key set — searches will try Froogle's shared allowance." |
| No key and no proxy | "No key set, and this copy of Froogle has no shared allowance to fall back on, so searching needs a key." |

Saving runs a real search to validate before storing, so a mistyped key is rejected at the moment
of entry rather than at the next search. Both buttons are disabled while that check runs.

### Deployment-conditional prose

Two sentences in About and one paragraph in Settings describe a shared allowance, and a `file://`
copy has none and never will — `selectMode` short-circuits on the protocol, so this is a permanent
property of that deployment rather than something a later phase fixes.

There are **three** wordings, not two, because the page has three honest answers and only two of
them are certain:

| State | When | The prose says |
|---|---|---|
| `data-when-solo` | `file://`, no `PROXY_PATH`, or a probe proved nothing is there | There is no shared mode here; a key is required |
| `data-when-shared` | A shared-mode request has come back readable | There are two ways your search can reach Keenable |
| `data-when-unknown` | Everything else — an http(s) origin with a `PROXY_PATH` nothing has tried yet | There may be two ways, depending on how this copy is hosted; try a search and the footer will say |

The third state is not a nicety. `PROXY_PATH` is relative and carries no host by design, so the
page cannot tell a deployment with a Function behind it from a lone `index.html` on a static host
until something has answered there — and only a keyless search ever asks. On a static host whose
operator baked in an `API_KEY`, nobody is ever keyless, nothing ever asks, and a two-state guess
would assert a shared allowance that does not exist for the life of the deployment. Asserting
neither until one is established is the same discipline the rest of the app follows.

All three wordings are authored in the HTML, marked `data-when-shared`, `data-when-solo` and
`data-when-unknown`, and the renderer shows one: the prose is toggled, not rewritten, so all three
stay readable in the source and keep their markup.

The question asked is "would a keyless visitor here get shared mode", with the key forced absent —
a deployment property, not a per-visitor one, so saving a key does not rewrite the page's
explanation of itself. Note the asymmetry with the footer mode indicator and the Settings key-state
line, which read `shared` on an unprobed deployment: those describe what the *next search will
attempt*, which is true and self-correcting within one request, while this prose describes the
deployment itself, which is a durable claim.

## Components

| Component | Notes |
|---|---|
| Wordmark | Text only, single color, slight letter-spacing. Two sizes. Never multi-colored |
| Search form | Real `<form>`, labelled `<input type="search">`, submit button. Identical markup in both placements, different sizing |
| Result item | `<li>` containing title link, URL line, snippet. See below |
| Footer | About · Settings · mode indicator. Present on every view |
| Notice | One block used for errors, the empty state, and the no-key state. `role="status"` |
| Key form | Settings only |

### Result item

* Title is an `<a>`. When `title` is empty, the URL's hostname is used instead.
* URL line is plain text in `--url`, not a link, so there is one click target per result.
* Snippet is `snippet || description || ""`, whitespace collapsed, clamped to two lines with
  `-webkit-line-clamp` and a `max-height` fallback.
* A `published_at` date, when present, prefixes the snippet as `Jan 8, 2026 — ` in `--ink-soft`.
* Only `http:` and `https:` URLs become links; anything else renders as plain text.

## Mode indicator

One line in the footer, `--ink-soft`, 11px:

* Direct — "Direct: your searches go straight to Keenable."
* Shared — "Queries proxied through Froogle. Zero logs."
* No key, no proxy — "No API key set." linking to Settings.

It is the honest, always-visible version of the privacy claim, rather than something buried in
About. It updates whenever a key is saved or cleared, without a reload.

## States

| State | Presentation |
|---|---|
| Idle | Home or Results as above |
| Searching | "Searching…" in the notice slot, replacing the previous list. Submit disabled |
| Results | The list |
| Empty | "No results found for *query*." Notice styling, not error styling |
| Error | Plain-language message per the functional spec, search box still populated |
| No key available | Notice explaining Froogle needs a key here, linking to Settings |

## Accessibility

* Every control reachable and operable by keyboard, with a visible 2px `--focus` outline.
* The search input has a real `<label>`, visually hidden on the home view where the wordmark
  already supplies context.
* Results are a `<ul>`, so screen readers announce the count.
* The notice region is `role="status" aria-live="polite"`, so state changes are announced.
* `document.title` updates to `query — Froogle` on the results view.
* Body text meets WCAG AA contrast against `--bg`; `--ink-faint` is used only for rules and
  borders, never for text — placeholder text included, which is why every `::placeholder` takes
  `--ink-soft` (6.6:1) rather than `--ink-faint` (3.6:1) or the UA default (~3.2:1).
* No color is the sole carrier of meaning.

## Non-goals

No dark mode, no themes, no icons, no images, no animation beyond the browser's own focus and
link states, no third-party fonts, no CSS framework. A favicon is supplied as an inline
`data:image/svg+xml` letterform so the page stays one file and browsers do not 404 on
`/favicon.ico`.
