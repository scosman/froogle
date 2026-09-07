---
status: draft
---

# UI Design: Froogle

One HTML file, four views, no images, no frameworks, no build step.

## Design intent

Inspired by early-2000s web search: a wordmark, a box, a list of links, and nothing else. The
reference is the *era*, not any one engine. Explicitly avoided, because they are specific to
Google rather than to the period:

* Multi-colored wordmark letters.
* Google's link blue (`#1a0dab`) and their green URL line.
* Their typefaces, logo forms, and layout measurements.

What the period actually gives us, and what we take: heavy whitespace, a centered single-purpose
home page, underlined text links, a dense unstyled-feeling result list, and no chrome.

## Design tokens

Declared once as CSS custom properties on `:root`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fcfcfa` | Page. Warm off-white, not pure white |
| `--ink` | `#202020` | Body text, wordmark |
| `--ink-soft` | `#5f5b54` | URL line, dates, footer, secondary text |
| `--ink-faint` | `#8a857c` | Rules, borders, placeholder |
| `--link` | `#1a3fb0` | Unvisited result titles |
| `--link-visited` | `#6b2fa0` | Visited result titles |
| `--notice` | `#8a4b1f` | Error and empty-state text |
| `--focus` | `#1a3fb0` | Focus ring |

Type: `Georgia, "Times New Roman", serif` for the wordmark only; `system-ui, -apple-system,
"Segoe UI", Roboto, sans-serif` for everything else. Sizes: 15px base, 13px secondary, 11px
footer, 44px home wordmark, 22px header wordmark.

Spacing scale: 4, 8, 12, 16, 24, 40px. Nothing else.

> **Note:** the URL line is grey rather than green. A green URL under a blue title is the single
> most Google-specific cue in a SERP, and the brief is "inspired by", not "clone". One token
> changes it back if you disagree.

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
example.com/blog/structural-typing                        <- 13px, --ink-soft, plain text
Jan 8, 2026 — Structural typing means a type is           <- 13px, --ink, 2 lines max
compatible with another if its members are compatible…

(24px gap, next result)

                About · Settings · <mode line>
```

The search box stays populated with the current query so it can be edited in place.

### About

Prose in the same column: what Froogle is, how it works, privacy. Headings at 15px bold, body at
15px, generous paragraph spacing. Ends with links to the source repo and to Keenable.

### Settings

Explains the two modes, then a single labelled `<input type="password">` for a Keenable key, with
Save and Clear buttons and a link to Keenable's console. Below it, the current state in one line:
"Using a key stored in this browser" or "No key set — searches use Froogle's shared allowance."

Saving runs a real search to validate before storing, so a mistyped key is rejected at the moment
of entry rather than at the next search.

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
* URL line is plain text, not a link, so there is one click target per result.
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
  borders, never for text.
* No color is the sole carrier of meaning.

## Non-goals

No dark mode, no themes, no icons, no images, no animation beyond the browser's own focus and
link states, no third-party fonts, no CSS framework. A favicon is supplied as an inline
`data:image/svg+xml` letterform so the page stays one file and browsers do not 404 on
`/favicon.ico`.
