---
status: complete
---

# UI Design: Froogle

One HTML file, four views, no images, no frameworks, no build step.

## Design intent

A plain white page, one dark ink, one blue link, and a Helvetica-first stack. Nothing is
decorated: there is no card, no shadow, no rounded corner, no icon, and no rule anywhere except
the one under the masthead and the one under a text field. Type size and whitespace carry the
whole hierarchy.

The home view is a wordmark, a tagline, an underlined text field and three small links, centered
in the viewport. The results view replaces all of it with a single row — wordmark, field, button —
above a hairline, then a list. Both sit on the same 660px measure.

> **Supersedes the previous design.** Until this revision the page was a warm off-white
> (`#fcfcfa`), a Georgia wordmark, a green URL line (`#2d6a4f`) and a boxed search field, in a
> 640px column with a footer. That system is gone in full — palette, type, layout and footer — and
> nothing here inherits from it. The mode indicator survived, moved from the footer into the
> utility row.

## Design tokens

Declared once as CSS custom properties on `:root`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Page |
| `--ink` | `#111111` | Headings, wordmark, field rules, button face |
| `--on-ink` | `#ffffff` | Text on the dark button |
| `--ink-muted` | `#6e6e6e` | Every piece of secondary text: tagline, utility row, URL line, timing, placeholders, state lines |
| `--body` | `#3d3d3d` | Snippets and prose body |
| `--link` | `#1734d4` | Links, result titles, focus ring, focused field rule |
| `--link-visited` | `#6b2ea8` | Visited links |
| `--alert` | `#b3261e` | Error notices and the "Proxied is unavailable" note |
| `--rule` | `#eeeeee` | The masthead hairline, and the secondary button's hover face |
| `--measure` | `660px` | Column width for the masthead and every page body |

Type: one stack, `"Helvetica Neue", Helvetica, "Segoe UI", "Liberation Sans", Arial, sans-serif`,
for everything. No serif, no second family, nothing loaded from the network. Sizes: 15px base,
56px home wordmark, 21px masthead wordmark, 28px page heading, 19px result title, 14px snippet and
tagline, 12px utility row and URL line, 11px timing. The wordmark and the page heading are weight
500 with negative tracking (`-0.035em` / `-0.025em`); section headings are 12px uppercase at
`0.09em`.

Spacing is not a strict scale — it is the reference mockups' own measurements, kept rather than
rounded: 14px and 22px inside the search rows, 30px between results, 42px on home, and 22/40px
page gutters that drop to 16px below 560px.

Every color the page paints is one of these tokens. Two literals remain, both deliberate: `#000`
for the submit button's hover face, which is one step darker than `--ink` and exists only as a
hover response, and the `--ink` value written inline in the static favicon `<link>`, because a
`data:` URI cannot reference a custom property — the script redraws that favicon from the token at
startup.

> **On the grey.** The reference mockups use three greys, down to `#a8a8a8` for the timing. This
> implementation collapses them to one, `--ink-muted` at 4.6:1 on white, because the URL line, the
> timing and the placeholders are all *text*, and the project's accessibility rule is that text
> meets WCAG AA. The hierarchy the extra greys carried is recovered through size, tracking and
> uppercasing instead. `--rule` is a border color and is never used for text.

## Page inventory

| View | Route | Purpose |
|---|---|---|
| Home | *(no fragment)* | Enter a search |
| Results | `#q=<query>` | See results for a query |
| About | `#about` | What Froogle is, privacy, self-hosting |
| Settings | `#settings` | Choose a mode; manage a Keenable key |

Views are `<section>` elements in the one document, shown and hidden by the router. There is no
client-side templating; each view's markup exists in the HTML and only the result list is built
dynamically.

## Layout

### Masthead

A `<header>` above `<main>`, shown on every view **but** home, holding the wordmark, the search
field, the submit button, and beneath them the utility row. It is centered on `--measure` with a
`--rule` hairline under it. Because it lives outside the view sections, Results, About and
Settings all carry the same search box and the same links with no duplication.

Below 560px the row wraps and the wordmark takes a full line of its own, so the field and its
button keep a usable width at 320px.

### Home

```
                    (centered in the viewport)

                         Froogle              <- 56px, weight 500, -0.035em
                   Fast ad-free search        <- 14px, --ink-muted

              [ Search                 ] [ Search ]   <- underlined field, dark button

               About  Settings  Mode: Proxied         <- 12px utility row
```

The whole view is a flex column centered on `min-height: 100svh`. The input takes focus on load.

### Results

```
Froogle  [ moog model d repair          ]  [ Search ]
About  Settings  Mode: Proxied  0.19 SECONDS
──────────────────────────────────────────────────────  <- 1px --rule

Servicing a Moog Model D: complete teardown guide       <- 19px --link
synthrepairguild.org/guides/moog-model-d                <- 12px --ink-muted
Jan 8, 2026 — Step-by-step photos covering key…         <- 14px --body, 2 lines max

(30px gap, next result)
```

### About

The prose the project ships: what Froogle is, four bullets, the privacy section with the two modes
described in full, and self-hosting. The two mode bullets are the canonical explanation, and
Settings echoes them rather than inventing a second wording.

### Settings

Two radios for the mode, each with the About bullet beneath it, then one line saying what searches
will actually do, then the key form. See **Mode** below.

## Components

| Component | Notes |
|---|---|
| Wordmark | Text only, single color, weight 500, negative tracking. Two sizes. Never multi-colored |
| Search form | Real `<form>`, labelled `<input type="search">`, submit button. One in the masthead, one on home |
| Utility row | About · Settings · mode line, plus the timing on results. One per search form |
| Result item | `<li>` containing title link, URL line, snippet |
| Notice | One block used for errors, the empty state, and the two no-search states. `role="status"` |
| Mode radios | Settings only |
| Key form | Settings only |

### Fields and buttons

A field is a bottom rule only: no box, no radius, no background. The UA focus outline is
suppressed on fields and replaced, not removed — the rule takes `--link` and doubles in weight via
a `box-shadow`, which is visible on white and does not depend on the outline. Every other control
keeps the standard 2px `--link` `:focus-visible` outline.

The submit button is solid `--ink` with `--on-ink` text and square corners. Clear is its outline
counterpart. Both go `--ink-muted` when disabled.

### Result item

* Title is an `<a>` at 19px. When `title` is empty, the URL's hostname is used instead.
* URL line is plain text in `--ink-muted`, not a link, so there is one click target per result.
* Snippet is `snippet || description || ""`, whitespace collapsed, clamped to two lines with
  `-webkit-line-clamp` and a `max-height` fallback.
* A `published_at` date, when present, prefixes the snippet as `Jan 8, 2026 — ` in `--ink-muted`.
* Only `http:` and `https:` URLs become links; anything else renders as plain text.

## Mode

The mode is **chosen**, not derived. The visitor's preference lives at `froogle.mode` in
`localStorage` (`"proxied"` | `"direct"`, default `"proxied"`), independent of `froogle.key`, so
switching modes never destroys a saved key. `selectMode` then constrains that preference by what
this copy of the page can actually do; the preference itself is never rewritten.

### The mode line

One line in each utility row, 12px `--ink-muted`, always a link to Settings, so the line that
reports the mode is also the way to change it. It names the mode a search started *right now*
would use:

| Effective mode | Line |
|---|---|
| `proxied` | Mode: Proxied |
| `direct` | Mode: Direct |
| `nokey` | Mode: no key |

`nokey` gets its own wording rather than reading "Direct", because a page with no key cannot
search and saying "Direct" would claim it can. Home and the masthead each carry one of these
lines; they are rendered by one function from one state, so they cannot disagree.

### The Settings radios

Both choices are always shown with their About wording. Below them, one line — the only place that
can say the chosen mode is not the one running:

| Chosen | Running | Line |
|---|---|---|
| Proxied | Proxied | Searches go through Froogle's proxy. |
| Direct | Direct | Searches go straight from this browser to Keenable. |
| Proxied | Direct | Proxied is not available here, so searches go straight to Keenable with your saved key. |
| Proxied | *(no key)* | Proxied is not available here, so searching needs a Keenable API key. |
| Direct | *(no key)* | Direct mode needs a Keenable API key before it can search. |

Where Proxied cannot be honoured, a note in `--alert` sits under it:

| Proxy status | When | Note | Radio |
|---|---|---|---|
| `blocked` | `file://`, or `PROXY_PATH` empty | "Not available here: this copy of Froogle has no server behind it to proxy through, so searches use Direct instead." | Disabled |
| `missing` | A request proved nothing answers at `PROXY_PATH` | "This copy of Froogle has no proxy — switch to Direct and add a key." | **Enabled** |

The asymmetry is deliberate. `blocked` is structural and permanent for that deployment, so the
choice is disabled rather than offered and left to fail. `missing` was *learned* this session and
may be wrong tomorrow — the same file redeployed behind a Function has a proxy — so the radio stays
usable and the stored preference is left intact, to be honoured the moment one answers.

The key form sits below, under its own heading, and its state line reports only what key this
browser holds. It says nothing about the mode: the line under the radios owns that, and two lines
describing the same thing are two lines that can drift apart.

### Timing

The utility row on Results carries the measured round trip of the request, `0.19 SECONDS`, in 11px
uppercase with `0.08em` tracking. It is `performance.now()` either side of the fetch, to two
decimals — real or absent, never a placeholder, because it is a checkable claim about this
deployment's speed. It is omitted whenever there is nothing to report: before a search, on an
error, and on every view but Results.

## States

| State | Presentation |
|---|---|
| Idle | Home or Results as above |
| Searching | "Searching…" in the notice slot, replacing the previous list. Submit disabled |
| Results | The list, and the timing in the utility row |
| Empty | "No results found for *query*." Notice styling, not error styling |
| Error | Plain-language message per the functional spec, search box still populated |
| Direct chosen, no key | "Direct mode needs a Keenable API key to search. Keys are free." + Settings link |
| Proxied chosen, no proxy | "This copy of Froogle has no proxy of its own." Then "Switch to Direct mode and add a free Keenable API key" with a Settings link, or "Search again and it will go straight to Keenable with your key" when a key is already saved |

## Accessibility

* Every control reachable and operable by keyboard, with a visible focus indicator: a 2px `--link`
  outline on buttons, links and radios, and the doubled `--link` rule on text fields.
* Both search inputs have a real `<label>`, visually hidden — the wordmark beside them supplies the
  visible context. The Results view carries a visually hidden `<h1>`.
* The mode radios are a `<fieldset>` with a visually hidden `<legend>`, and are operable with the
  arrow keys like any radio group.
* Results are a `<ul>`, so screen readers announce the count.
* The notice, the mode state line and the key state line are all `role="status" aria-live="polite"`.
* `document.title` updates to `query — Froogle` on the results view.
* All text meets WCAG AA against `--bg`: `--body` at 10.9:1, `--ink-muted` at 4.6:1, `--link` at
  8.5:1, `--alert` at 6.5:1. `--rule` is a border color and never carries text.
* No color is the sole carrier of meaning.

## Non-goals

No dark mode, no themes, no icons, no images, no animation beyond the browser's own focus and
link states, no third-party fonts, no CSS framework. A favicon is supplied as an inline
`data:image/svg+xml` letterform so the page stays one file and browsers do not 404 on
`/favicon.ico`.
