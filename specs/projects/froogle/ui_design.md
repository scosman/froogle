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
| `--alert` | `#b3261e` | Error notices, the "Proxied is unavailable" note, and the key field's refused-save state |
| `--rule` | `#eeeeee` | The masthead hairline |
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
> implementation collapses them to one, `--ink-muted` at 5.1:1 on white, because the URL line, the
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

               About  Settings: Proxied              <- 12px utility row
```

The whole view is a flex column centered on `min-height: 100svh`. The input takes focus on load.

### Results

```
Froogle  [ moog model d repair          ]  [ Search ]
About  Settings: Proxied  0.19 SECONDS
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

One form: two radios for the mode, each with the About bullet beneath it, the key field indented
inside the Direct choice, and a single Save. Two status lines follow it — what searches will
actually do, and what key this browser holds. See **Mode** below.

## Components

| Component | Notes |
|---|---|
| Wordmark | Text only, single color, weight 500, negative tracking. Two sizes. Never multi-colored |
| Search form | Real `<form>`, labelled `<input type="search">`, submit button. One in the masthead, one on home |
| Utility row | About · the Settings link, plus the timing on results. One per search form. 12px, `--ink-muted` links in every state — chrome, not content |
| Result item | `<li>` containing title link, URL line, snippet |
| Notice | One block used for errors, the empty state, and the two no-search states. `role="status"` |
| Settings form | Settings only. The mode radios, the key field nested in the Direct choice, and one Save |

### Fields and buttons

A field is a bottom rule only: no box, no radius, no background. The UA focus outline is
suppressed on fields and replaced, not removed — the rule takes `--link` and doubles in weight via
a `box-shadow`, which is visible on white and does not depend on the outline. Every other control
keeps the standard 2px `--link` `:focus-visible` outline.

That replacement holds only outside forced colors. Under `forced-colors: active` the platform
drops `box-shadow` altogether and overrides `border-color` with a system color, which would leave
a keyboard user with no indication at all on either field — so a `forced-colors` media query
restores a real `2px solid Highlight` outline on `.search__field:focus` and `.key-input:focus`.
It is load-bearing, not belt-and-braces: delete it and the two fields lose their focus state in
Windows High Contrast.

The submit button is solid `--ink` with `--on-ink` text and square corners, and goes `--ink-muted`
when disabled. Clear is not a second button: it is a 12px `--link` control beside the key field's
label, because it is a quiet secondary action on that one field rather than a peer of Save. It is
a `<button>`, not an anchor — it acts, it does not navigate.

A refused save reddens the key field: its label, its rule (`--alert`, doubled to the same weight
the focus rule uses), and the note beneath it. Focus reverts to a real `2px --link` outline for as
long as that lasts, because the rule cannot be red and blue at once and the save moves focus into
the field, so both states are always on screen together.

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

Choosing is not the same as saving. The radio is **pending form state**: it moves nothing outside
the Settings form until Save commits it, which is what makes an unsearchable combination
unreachable rather than merely reported. Everything that reports the mode — both utility rows, the
state line under the radios, and the search path — reads the *saved* preference, so the masthead
never shows a mode that has not been committed.

### The Settings link

One link in each utility row, 12px `--ink-muted`, going to Settings. There is no separate mode
line: the link carries the mode in its own text, so the thing that reports the mode is also the
way to change it. It names the mode a search started *right now* would use:

| Effective mode | Link |
|---|---|
| `proxied` | Settings: Proxied |
| `direct` | Settings: Direct |
| `nokey` | Settings: no key |

`nokey` gets its own wording rather than reading "Direct", because a page with no key cannot
search and saying "Direct" would claim it can. Home and the masthead each carry one of these
links; they are rendered by one function from one state, so they cannot disagree.

### The Settings form

Everything in Settings is one form, saved by one button:

```
SEARCH MODE

(o) Proxied  default
    Queries are proxied through Froogle's servers…            <- the About bullet
    Not available here: …                                     <- 13px --alert, when it applies

( ) Direct
    All requests go directly from your browser to Keenable…   <- the About bullet

    Keenable API key   Clear        <- 13px --ink-muted label; 12px --link, only when a key is saved
    [ keen_…                    ]   <- underlined field, 420px, write-only
    Direct mode needs a Keenable…   <- 13px, --alert on a refusal, --ink-muted for a staged clear

[ Save ]

Settings saved.                          <- state line: Save's feedback, and a built-in key
```

The key field is indented to the choice bodies' 25px, inside the Direct choice rather than under a
heading of its own: it is what that choice needs, and one paragraph explaining a key is enough for
the page. It stays usable while Proxied is selected, because saving a key before switching is a
reasonable order to do things in and Proxied never discards one.

Both choices are always shown with their About wording. There is no line restating which one is
selected: the radios already show it, and a sentence saying the same thing again is noise on a
screen whose whole job is to make that choice legible. Where the chosen mode is not the one that
will run, the two places that say so are the ones where it is actionable — Save's refusal, and the
search error itself.

Where Proxied cannot be honoured, a note in `--alert` sits under it, associated with the radio by
`aria-describedby` so the reason reaches a screen reader that has just been told the control is
dimmed:

| Proxy status | When | Note | Radio |
|---|---|---|---|
| `blocked` | `file://`, or `PROXY_PATH` empty | "Not available here: this copy of Froogle has no server behind it to proxy through." | Disabled |
| `missing` | A request proved nothing answers at `PROXY_PATH` | "Not available here: nothing is answering at this copy of Froogle's proxy path." | **Enabled** |

Each note states a fact about the deployment and stops there. What to *do* about it belongs to the
state line below the radios, which is the only one of the two that knows whether a key is saved: a
note reading "switch to Direct and add a key" would otherwise land on the same screen as a state
line saying searches already go direct with the key the visitor already added. One source of
advice.

The asymmetry in the last column is deliberate. `blocked` is structural and permanent for that
deployment, so the choice is disabled rather than offered and left to fail. `missing` was
*learned* this session and may be wrong tomorrow — the same file redeployed behind a Function has
a proxy — so the radio stays usable and the stored preference is left intact, to be honoured the
moment one answers.

The second state line carries Save's feedback, and one standing sentence: that this copy has a key
built into the file, which beats anything saved in the browser. Nothing else. A key saved in *this
browser* gets no line — the Clear button beside the field appears only when there is one to remove,
so the form has already said it, and a sentence repeating it is a second thing to keep in step with
the first. A built-in key has no such tell, which is why it keeps one.

### Saving

Save commits the mode and the key in one action, and refuses one combination: Direct with no key
anywhere — none typed, none staying saved, none built into the file. That refusal reddens the key
field and writes nothing at all: not the key, not the mode. A key typed into the field is still
checked against Keenable first, and a rejected one likewise saves neither half.

The refusal offers the alternative only where it exists: "Direct mode needs a Keenable API key. Add
one, or choose Proxied." where the proxy is usable, and "…Add one to search." where it is not.
Telling a `file://` visitor to choose Proxied would contradict the note two lines above saying
Proxied is unavailable here — the same one-source-of-advice rule `proxyNote` and the state line
already follow.

| Save, with | Result |
|---|---|
| Direct, field blank, a key saved or built in | Committed. Blank is the write-only field's resting state, not an error |
| Direct, field blank, no key anywhere | Refused on the key field. Nothing written |
| Direct, a key typed | Checked with Keenable; committed together, or neither on a rejection |
| Proxied, field blank | Committed. A saved key is left alone, not discarded |
| A staged Clear, under Direct, with nothing typed | Refused, exactly as choosing Direct with no key is |

Clear is staged, not immediate: it empties the field and says "This key will be removed when you
save.", and Save applies it. One rule for the whole page — nothing changes until Save — and it
composes, so clearing the key out from under Direct meets the same refusal rather than stranding
the visitor in a mode that cannot search. It appears only when a key is saved, so its presence is
itself the statement that there is one. Typing a key supersedes it: a replacement is not a
removal, and the cue and the link both come back to say so.

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
| Save refused | The key field's label, rule and note go `--alert`: "Direct mode needs a Keenable API key", plus "Add one, or choose Proxied" where Proxied is usable and "Add one to search" where it is not. Focus moves to the field, which carries `aria-invalid` |
| Clear staged | "This key will be removed when you save." under the field, in `--ink-muted`, and the Clear link goes |
| Proxied chosen, no proxy | "This copy of Froogle has no proxy of its own." Then "Switch to Direct mode and add a free Keenable API key" with a Settings link, or "Search again and it will go straight to Keenable with your key" when a key is already saved |

## Accessibility

* Every control reachable and operable by keyboard, with a visible focus indicator: a 2px `--link`
  outline on buttons, links and radios, and the doubled `--link` rule on text fields — with a
  `Highlight` outline restored on those fields under `forced-colors: active`, where `box-shadow`
  is dropped by the platform.
* Both search inputs have a real `<label>`, visually hidden — the wordmark beside them supplies the
  visible context. The Results view carries a visually hidden `<h1>`.
* The mode radios are a `<fieldset>` with a visually hidden `<legend>`, and are operable with the
  arrow keys like any radio group. Moving the selection commits nothing, so arrowing through them
  with a screen reader cannot change what the page does.
* A refused save is announced, not merely coloured: the field takes `aria-invalid`, its
  `aria-describedby` note carries the reason, and focus moves to the field — which is what speaks
  both. The staged-clear cue rides the same description.
* Clear is a `<button>`, not a link, because it acts rather than navigates. Its accessible name
  begins with its visible label.
* Results are a `<ul>`, so screen readers announce the count.
* The notice, the mode state line and the key state line are all `role="status" aria-live="polite"`.
* `document.title` updates to `query — Froogle` on the results view.
* All text meets WCAG AA against `--bg`: `--body` at 10.9:1, `--ink-muted` at 5.1:1, `--link` at
  8.5:1, `--alert` at 6.5:1. `--rule` is a border color and never carries text.
* No color is the sole carrier of meaning.

## Non-goals

No dark mode, no themes, no icons, no images, no animation beyond the browser's own focus and
link states, no third-party fonts, no CSS framework. A favicon is supplied as an inline
`data:image/svg+xml` letterform so the page stays one file and browsers do not 404 on
`/favicon.ico`.
