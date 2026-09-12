# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Earlier releases predate this file; their history is in the git log.

## [Unreleased]

### Fixed

- **A `.scrollable` frame no longer scrolls its own chrome away.** The frame used
  to be the scroll container itself (`overflow: auto` on the `<section>`), and the
  headline and footline are its absolutely-positioned children, so they travelled
  with the content: scrolled to the end the footline moved from `top:690` to
  `-201` — off the top of the slide — and the last line of content stayed
  permanently hidden behind it. The frame now clips and the body scrolls inside a
  `.beamer-scroll` layer, so the chrome stays put. This also covers the `.smaller`
  and `.beamer-long-frame-title` frames, which shared the same rule, and it applies
  to Quarto's document-level footnotes and bibliography slides, which carry
  `.smaller .scrollable` by default. Pinning the chrome with `position: fixed`
  fixes the screen too, but it needs a `position: absolute` reset in print/PDF
  layout (the print assertion reports `footerContained: false` without it) and it
  only lines up while the viewport box and the slide box coincide.
  **No visual baseline changed** — the layer is inset to the same padding box the
  body already occupied. Two probes and one assertion had to learn about the new
  layer: they measured `scrollHeight`/direct children on the frame, which is now
  the layer's job.
  The layer is inset from the frame's own padding, and *both* of the inputs it
  depends on are rewritten after the decoration pass — the reserved frame height is
  re-measured on every resize, font load and slide change, and
  `beamer-long-frame-title` is only ever added by that measurement. So the layer is
  re-fitted whenever either moves, and removed again when a frame stops scrolling.
  Without that, a frame whose title took several lines kept the inset measured for a
  one-line title (layer top 80px where the body starts at 108px), and a frame that
  only became scrollable after decoration got no layer at all: `overflow: hidden`
  with nothing to scroll, and no overflow warning either, because a scrolling frame
  is exempt from it. That was silent, unreachable content — on the `scroll-layers`
  fixture the last paragraph sat 558px past the bottom of the slide.

- **`h4` now takes the variant's structural accent, not the alert colour.** It
  was coloured with `--beamer-alert`, which under Madrid is Beamer's `alerted
  text` red `#ff0000` — only **3.93:1** against the light slide, below the 4.5:1
  that body-size text needs, so a fourth-level heading was the loudest and least
  legible text on the slide. It also meant the colour of a heading and the colour
  of `[text]{.alert}` were the same knob. `h4` now uses `--beamer-structure`, the
  accent the theme's other furniture (list markers, unfilled block titles, the
  minimal section look) already uses: Madrid `#3333b2` (9.15:1) and CambridgeUS
  `#cc0000` (5.79:1), both comfortably above AA. CambridgeUS is unchanged in
  practice because its `structure` and `alert` are the same darkred. `.alert`
  inline emphasis keeps `--beamer-alert` and is untouched. Beamer defines no
  heading-level colours at all — it has no `h4` — so this is a web-side choice,
  and `structure` is the consistent one.
- **`h5` and `h6` are themed, which fixes an inverted heading ladder.** The
  theme defined only `h3` and `h4`, so the two deeper levels fell through to
  Reveal's own `.reveal h1…h6` rule. That rule sets a *single*
  `--r-heading-font-size` for every level, so `h5`/`h6` rendered at the full
  30px — larger than `h3` (27.3px) and `h4` (23.4px), making a fifth-level
  heading look more important than a third-level one. They also inherited
  `--r-heading-color`, i.e. Quarto's `$presentation-heading-color` (`#1b3761`),
  which does not follow the variant palette at all — recolouring the deck left
  `h5`/`h6` on that fixed navy. Both now take `--beamer-structure` like `h3`/`h4`
  and step down by the same ratio, giving 27.3 / 23.4 / 20.4 / 18.0 px.
  Beamer has no `h5`/`h6` either, so this is a web-side choice; the reference
  `quarto-revealjs-clean` theme also stops at `h4` and leaves the same inversion.
  The `behavior` fixture now renders `h3`-`h6`, and `testBehavior` asserts each
  level's colour, its AA contrast, and that the sizes descend in order — so
  neither the `h4` colour nor this ladder can regress silently again.

- Chrome injection now also wins the race against Reveal's own `ready` class.
  Reveal publishes that class from a timer that can fire while the document is
  still loading (its deferred scripts are still being fetched), so waiting for
  `DOMContentLoaded` alone could lose the race and let the first frames paint the
  deck without its Beamer headline/footline on slower machines. Injection is now
  also driven by a `MutationObserver`, whose callback the browser drains before
  it paints, alongside the existing `DOMContentLoaded` and bounded-poll paths.
- **Block colours now follow Beamer's colour algebra instead of being
  hard-coded.** The extension previously gave every block the same body tint
  (a fixed `#eaeaf4`), so Madrid's example block was a green title band over a
  blue-grey body, its alert body lost the red tint, and even the plain block
  was slightly off (`#eaeaf4` against Beamer's `#e9e9f3`). Each kind now derives
  its body from its own title band (`block title bg!10!bg`, as orchid does),
  and the base colours are the values the themes actually use: Madrid
  `alerted text` = `red`, `example text` = `green!50!black`; the title bands are
  those at `!75!black` (`#bf0000` / `#006000`).
- **CambridgeUS blocks are no longer painted deep red.** CambridgeUS loads only
  `beaver`, which never defines `block title`, so Beamer renders the three block
  kinds with no fill and distinguishes them by title text colour. The extension
  was painting a solid `#a30000` band with a `#f8f2f2` body, which is not what
  the theme does. Blocks are now unfilled with coloured titles
  (`#3333b2` / `#008000` / `#bd1a1a`).
- `--beamer-structure` is now a separate role from `--beamer-primary`.
  Previously the single `--beamer-primary` variable drove bullets and block
  titles as well as the accent, which conflated two different Beamer colours.
  `structure` also now quantises to `#3333b2`, matching `rgb(0.2,0.2,0.7)`,
  rather than `#3333b3`.
- **Deliberate deviation from upstream:** CambridgeUS sets `structure` to its
  own `darkred` (`#cc0000`, with `!75!black`/`!50!black` steps) instead of
  keeping beamer's `blendedblue`. Upstream paints CambridgeUS bullets and
  unfilled block titles blue because beaver never redefines `structure`; in a
  red-and-grey deck that reads as a stray colour. Override
  `--beamer-structure` to restore the upstream blue.
- `example text` is `green!50!black` in `beamercolorthemedefault` and is NOT
  derived from `structure` -- neither beaver nor orchid redefines it -- so both
  variants keep the same value (`#008000`, band `#006000`) even though
  CambridgeUS moves `structure`.
- `testPaletteAlgebra` now also asserts that the bullet and numbered-list
  markers use `--beamer-structure`, so the two roles cannot be conflated again.
- CambridgeUS alert block titles are now unfilled yellow text (`#ffcd00`) at
  `font-weight: 700`, against 650 for the other kinds. All three block titles
  are therefore unfilled and distinguished by text colour and weight alone.
  The title also carries a black outline to make that low-contrast fill
  readable: `#ffcd00` is only 1.48:1 against the light slide background on its
  own, while the stroke gives every glyph a 20.7:1 edge. Implemented with
  `-webkit-text-stroke` plus `paint-order: stroke fill`, without which the
  stroke centres on the glyph outline and eats into the yellow. Width was
  chosen by rendering a sweep at presentation size and comparing side by side in
  the deck: 2px reads as a timid hairline beside the plain block and 5px starts
  to read as a black bar that thins the yellow, leaving 3-4px usable; shipped at
  3px. Tunable via `--beamer-block-alert-title-stroke`;
  Madrid sets it to 0 because white on its `#bf0000` band is already 7.6:1.
  `--beamer-alert` stays red on purpose so `.alert` inline emphasis and `h4`
  remain legible.
- The alert title carrying `font-weight: 700` against 650 is as far as the
  bundled Libertinus Sans can go: it ships only Regular and Bold, and measured,
  everything from 600 upward renders at the same advance width.
- `green!50!black` is `#008000`, not `#004000`: xcolor defines `green` as
  `rgb(0,1,0)`, so the halved value comes from the 50% mix rather than from the
  base green. CambridgeUS's `alerted text` is `#bd1a1a`.
- Section pages now use the frame-title template, as Beamer does: the section
  title is a band pinned under the headline instead of a centred rounded badge
  with a drop shadow. `--beamer-section-title-bg`/`-fg` remain separately
  overridable, but on the stock themes they now hold the same values as
  `--beamer-frame-bg`/`-fg`.
- The section band is now built exactly like the frame title -- full-bleed with
  its text inset by the 58px body margin -- instead of being inset at both
  edges with no internal padding. The old form put the section title flush
  against its own band edge, 58px left of where every frame title starts, so
  the two never lined up. Section title, frame title and body text now all
  start on the same edge.
- The title page band now uses the 58px body inset instead of `10%`, so it
  spans the body measure (`\textwidth`) rather than 1024px against a 1164px
  measure.
- Band titles are now optically centred. `align-items: center` centres the line
  box, not the glyphs, so a CJK title -- which has no descenders and therefore
  puts almost all of its ink above the baseline -- sat about 5px high inside the
  58px band, while Latin text sat about 7px low. The two offsets run in opposite
  directions, so no single CSS value fixes both; `beamer.js` now measures each
  title's painted ink and nudges the text. The ink is read from the rasterised
  glyphs rather than from `actualBoundingBoxAscent/Descent`, because those
  report the CJK fallback's font bounding box, which is roughly twice as tall as
  what is actually painted and over-corrected by about 2x. The nudge is applied
  to an inner wrapper, not to the heading, so the coloured band stays put.
- The headline no longer draws a separator. It had
  `box-shadow: 0 1px 0`, a 1px coloured line spanning the slide at the
  headline/frametitle boundary; infolines butts the two colour boxes straight
  against the frametitle band and draws no such rule, and the line read as a
  seam cutting the slide in half.
- Frame titles no longer draw a `border-bottom`. Neither Madrid's `structure`
  band nor CambridgeUS's `gray!10!white` band has a rule, and beaver's
  `frametitle right` is unused by the default frametitle template.
- The footline date is centred within its box, matching infolines'
  `\hfill\insertshortdate{}\hfill`, instead of being pushed left by
  `justify-content: space-between`. The page number stays flush right.
- Blocks no longer draw a border, and use the `rounded` inner theme's radius
  and shadow rather than a custom 5px radius.

### Added

- **Reference lists now paginate, and can follow the `.bib` order.** A
  bibliography has no upper bound, so the references frame is the one slide that
  routinely overflows in practice.

  - `## References {item="6"}` declares a page of six entries. Page 1 also carries
    the `::: {#refs}` div; continuation pages carry nothing and are filled in.
    `item` is a *cap*, not a promise: the break is also bounded by the measured
    height, because one long entry can take twice the height of a short one, so a
    page that would still overflow is cut shorter and the surplus spills onto
    following pages (generated if the declared ones run out). Short entries do not
    pack past the cap either. Each generated page copies the declared page's layout
    and title.
    Continuation pages must follow the bibliography page with no frame in between:
    only the page holding `::: {#refs}` and the `item` pages contiguous with it are
    treated as reference pages, so an unrelated `## Frame {item="3"}` elsewhere in
    the deck is left alone. Taking every `item` page instead either handed the
    bibliography to that frame (no `#refs`, so nothing paginated at all) or moved
    entries into it.
  - Every reference page is marked `uncounted`, so the footline's page count does
    not move no matter how many pages the bibliography needs.
  - A reference page never needs a scrollbar: the break is measured, so the page the
    pagination produces fits. Four things had to be true for that to hold.
    The box classes are applied *before* the measurement — `beamer-frame-slide` is what
    reserves the frame title's height in the slide's padding, and applying it
    afterwards left the first page measured against 46px of room it does not have,
    cut one entry too late, overflowing by 37px on a page that was supposed to fit
    (and 638px of room on the pages that never got the class, against 592px on the
    page they continue).
    The pages *and their ancestor stack* are rendered for the duration of the
    measurement, and restored afterwards: a hidden box measures 0×0, so
    `scrollHeight > clientHeight` answered "no" for every entry. That is the state a
    deck is in when a reader opens it at the start — the references slide is far away
    — so the automatic path never paginated at all (26 entries left on one page, 909px
    of content in a 592px box) and a declared `item` larger than what fits was never
    cut back. Reveal hides these slides by writing `display` inline on the stack that
    holds them and only lays out the top-level sections within `viewDistance` (3 by
    default) of the current one, so forcing the page alone is not enough: a deck with
    its references at the end (h=3) kept measuring 0/0, and 560px of room against
    799px of content once the stack was forced too. Every fixture used to jump
    straight to the references slide — the one state where none of this can happen —
    and the first version of this fixture put the references one section in, still
    inside the rendered window; `refs-auto` now opens the deck normally, keeps the
    references four sections in, and asserts that the stack is hidden at load, so the
    fixture cannot quietly stop reproducing the condition.
    The slide list is re-read *after* the pagination appends its sections, because a
    page the pagination creates is a slide like any other: left out of the list, both
    generated pages of a three-page bibliography had no footline at all while every
    other slide had one.
    And `Reveal.sync()` runs before that list is read, because a section appended after
    Reveal initialised is not in its model: `Reveal.getSlideBackground()` answers
    `undefined` for it, and Quarto's own `support.js` dereferences that on every
    `slidechanged`, so navigating into a generated page threw
    `TypeError: Cannot read properties of undefined (reading 'classList')` out of the
    plugin and aborted Quarto's footer handling.
  - The declared page count is reconciled with what the bibliography actually needs,
    in both directions. Too few pages: the console reports how many were added and
    **which entry moved first**, so the author can move a break rather than hunt for
    it. Too many: the console names the pages left empty. A surplus page is **not**
    removed — deleting it could delete whatever the author put there — so the report
    is the whole remedy.
  - `refs-title: "…"` sets the base title for generated pages; without it they take
    the first declared page's heading. A page's own `##` heading always wins.
  - `refs-order: declaration` reorders the list into the order the keys appear in
    the `.bib` file(s). citeproc sorts by author, and nothing in the rendered HTML
    records the declaration order, so `beamer.lua` reads the keys out of the files
    and ships them; the default (`citation`) leaves citeproc's order alone, so
    existing documents do not change. If the key count and the rendered entry count
    disagree, the reorder is skipped with a warning rather than guessing — the
    `.bib` scan is a conservative pattern match and cannot read every legal file.
    Ordering runs **before** the page breaks are measured, so the split follows the
    declared order as well; applied afterwards it only reordered entries inside
    pages that had already been cut in citeproc's order.
  - `refs-overflow: scroll` opts out of pagination entirely: the bibliography stays on the
    one page Quarto produces and scrolls inside it, with the headline, frame title and
    footline still — the same treatment any `.scrollable` frame gets. The page is marked
    `uncounted` either way, so switching modes does not move the footline's page count.
    `item` asks for the opposite, so declaring both is reported and the breaks are ignored.
  - `--beamer-refs-font-size` (default `0.9em`) is the one size knob for the list;
    lowering it fits more entries per page and the automatic breaks follow.

  The pagination fixture gives entry `N` the author `Surname(14 - N)`, so citeproc
  sorts it into the exact reverse of the declared order. Without that the two orders
  agreed and the ordering assertion passed with the feature disabled. A second
  fixture (`refs-surplus`) declares one page more than the bibliography needs, which
  is what pins the "too many pages" report down.

- Section pages can now take one of three looks, chosen per heading with an
  attribute on the `#` line: the default full-bleed band, `{.section-badge}` for
  a centred rounded badge, and `{.section-minimal}` for plain centred text with
  no fill. In the badge look the title and any body text are centred as ONE
  block, and the body is constrained to the badge's own width. Achieving that
  with script proved to be a trap worth recording: the body's top padding was
  derived from the block's height, so every measurement of the block fed the
  solution back into its own input and the layout drifted between passes. The
  badge now lets flexbox do it -- the title joins the flow for that look and the
  section centres its children -- so there is nothing to measure. Quarto copies heading classes onto the `<section>`, so no AST
  rewriting is involved and the choice is genuinely per page. The look is
  expressed entirely in `--beamer-section-*` custom properties; `beamer.js` only
  supplies the numbers it alone can know (the band's rendered height and the
  centred offset), which keeps the styling declarative. The default is
  unchanged, so existing decks render exactly as before.
- `testSectionStyles`, covering all three looks in both variants: that each is
  still a section page, that the body clears the title, that the badge has an
  opaque fill distinct from its text, and that an ordinary `##` frame does not
  acquire a section look.
- `template.qmd` and `template-cambridgeus.qmd` now demonstrate the whole
  surface in one deck: all three section-page looks, the three block kinds,
  `.alert` / `.fg` / `.bg` / `.button`, nested lists, columns, tables with
  captions, code blocks with filenames, figures, citations and display maths.
  Each variant's template describes its own colours, so the two read as
  documentation rather than as duplicates.
- `--beamer-section-badge-bg` / `--beamer-section-badge-fg`. The badge is the
  only section look with a fill, and for CambridgeUS -- whose section band is
  transparent -- the fill defaults to the variant accent. Without it the badge's
  shadow was drawn around an invisible box and rendered as a stray rule under
  the title.
- `testPaletteAlgebra`, a regression test that derives the expected colours from
  the upstream theme sources and compares them against what the browser paints
  for both variants. The screenshot baselines are generated by this
  implementation and therefore cannot detect a palette that is self-consistently
  wrong; this test can. It fails on the old hard-coded block colours and on the
  old CambridgeUS block fill.
- `tests/fixtures/blocks-audit.qmd`, covering all three block kinds in one
  frame.

### Changed

- `testSectionStyles` measures both variants with the section header on and
  off, and asserts that turning it on moves the pinned looks down by exactly its
  height and re-centres the badge. The header's effect on section pages was
  previously uncovered: the two variants merely happened to differ in their
  default, which made the difference look tested when it was not.
- `BrowserPage.evaluate` retries probes that hit a not-yet-present element. Such
  a probe throws `Cannot read properties of null (reading '…')`, which is a race
  rather than a finding -- the page is laid out a moment later and the identical
  probe succeeds. Only those specific messages are retried, so a probe that
  genuinely observes a missing element still fails, through its own assertion.
  This was the last of the intermittent failures to be explained; it accounted
  for roughly one run in three.
- Interrupting the suite no longer leaks headless browsers. Chrome forks a tree
  of helper processes, and killing only the parent -- or letting it die from
  SIGTERM -- left that tree reparented to init. A batch of interrupted runs left
  five orphaned headless browsers holding ~2.9 GB, plus ~476 MB of profile
  directories and a stale lock file. Chrome is now spawned in its own process
  group and a synchronous signal handler kills the whole group and removes the
  profile directory; an `async` teardown cannot run on a signal, which is why
  the graceful path never covered this. Verified by SIGTERM-ing a live run: zero
  processes and zero directories left behind.
- The suite refuses to start when another run is already using the checkout.
  Fixed temporary input names in the repo root and a single `tests/_output` mean
  concurrent runs delete each other's inputs and overwrite each other's renders,
  which surfaced as unrelated DOM errors. Diagnosing that cost real time, so it
  now fails immediately with the holding pid instead.
- The harness retries two more external failures, both outside this project's
  code. `Page.printToPDF` intermittently returns a near-empty document -- one
  observed call produced 1,148 bytes where the same page yields ~100 KB -- and
  the `?print-pdf` footnote section is read before Reveal finishes switching to
  its print layout.
- The harness now retries the two external failures that were intermittently
  failing the suite, both of which happen outside this project's code.
  `quarto render` is retried (three attempts): Quarto's Deno runtime dies with
  SIGSEGV part-way through a render every so often -- the same input renders
  fine on the next attempt, and the crash predates any of this extension's code
  running. And `BrowserPage.waitForReady` reloads the page up to three times:
  Reveal occasionally never publishes itself, leaving `document.readyState` and
  the fonts settled but `window.Reveal` absent. Measured over 15 consecutive
  suite runs, these two accounted for 2 failures; a retry only rescues a page or
  a render that never completed, so a genuine failure still fails.
- The browser harness retries a stalled headless Chrome launch (three attempts,
  each with a fresh profile) and starts Chrome with shared-runner hardening
  flags (no background networking, component updates, extensions or desktop
  keyring) plus startup logging. A launch that used to fail after 30s with
  `(no stderr output)` now retries and, if it still fails, leaves per-attempt
  diagnostics in the uploaded artifacts.
- Print-layout validation now asserts that a section title band is pinned under
  the headline and spans the frame-title width, rather than that section content
  is vertically centred.

### Removed

- **Dead CSS variable `--beamer-section-offset`.** It was declared as `0px` and
  read only by the section-title `top` calc, but nothing ever wrote it, so that
  calc was always equal to `var(--beamer-active-headline-height)`. The `top`
  declaration now says that directly. Overriding the variable had no effect
  before and has no effect now. The README claim that `beamer.js` supplies a
  section "centring offset" was wrong and has been corrected — the section looks
  are entirely declarative.
- **Four classes nothing consumed.** `beamer-title-slide`,
  `beamer-has-headline`, `beamer-has-progress` and `beamer-uncounted-slide` were
  emitted by `beamer.js` but selected by no rule in the extension, the shipped
  examples or any documented hook. The title slide is already addressable as
  `#title-slide`, an uncounted slide as `[data-visibility="uncounted"]`, and the
  positive headline/progress states are the defaults — only
  `beamer-no-headline` encodes a non-default state and is kept. The redundant
  `beamer-<variant>` class on `<body>` went with them; the variant class stays
  on `<html>` (set by the in-header bootstrap) and on `.reveal`.
  Tests that asserted these classes now assert the rendered outcome instead: the
  headline element is present, and an uncounted slide carries no page number
  (the following slide reporting "5 / 5" is what proves it was excluded).
- Unreachable `var()` fallbacks on `--beamer-section-fill` / `--beamer-section-fg`
  in the badge look. The palette defines both badge variables unconditionally
  for every variant, so the fallbacks could never be reached. The fallbacks on
  the shared section-title rule are kept — those *are* reachable, since the
  minimal look sets no fill.
- The unused `printLayoutMeasurementSource` import in `run-tests.mjs`.

## [0.3.0] - 2026-09-08

### Added

- Overfull frames now log a console warning with the frame id and the exact
  overflow in pixels (`[beamerslides] #frame overflows its content area by Npx`)
  instead of silently clipping content. Frames that are allowed to scroll
  (`.scrollable`, `.smaller`, or a long frame title) stay silent, and the check
  is disabled in print/PDF layout, where Reveal paginates the deck and a slide's
  client height no longer describes its content box.
- `examples/custom-palette.css`: single-seed palette derivation with
  `color-mix()`, following Beamer's own colour algebra
  (`structure` / `structure!75!black` / `structure!50!black`). Usable through
  either `theme:` or `css:`.
- Regression coverage for chrome injection timing (frame-by-frame, no frame may
  paint a ready deck without its footline), invalid option fallbacks, overflow
  diagnostics (screen and print), block title markup, and every documented
  palette override path in both variants.
- `CHANGELOG.md`, `package.json` metadata (`description`, `license`, `engines`).

### Changed

- **Breaking for custom CSS that targeted `data-title`:** block titles are now
  real text nodes (`<div class="beamer-block-title">`) instead of a CSS
  `::before` fed by the `data-title` attribute. Titles are selectable,
  searchable with the browser's find-in-page, and exposed to assistive
  technology. Hand-written `data-title` markup keeps working through the
  `::before` fallback.
- The Madrid title block now spans the full text width, matching Beamer's
  `beamercolorbox` (which is used without an explicit width). It previously
  shrank to its content.
- The palette is declared at `:root` specificity for both variants
  (`:where(:root).beamer-cambridgeus` for CambridgeUS), so a document-level
  `:root { --beamer-… }` override wins. Previously `.reveal.beamer-madrid`
  re-declared the variables and shadowed such overrides, while the CambridgeUS
  selector outranked them.
- Frame-title size steps and the frame-title padding reserved for a logo are
  derived from `--beamer-frame-height` and from the measured logo box instead of
  duplicated hard-coded pixel values.
- Chrome injection no longer waits for a second poll, so the headline and
  footline exist before Reveal paints its first frame.
- Polling for Reveal and for the slide chrome is bounded (about 5s) and reports
  a warning instead of retrying forever.
- The test harness moved to `tests/lib/harness.mjs`, and external commands are
  bounded by a timeout so a hung render fails loudly instead of stalling the
  suite.

### Fixed

- Print and PDF export no longer report phantom overflows: the overflow check is
  skipped while the document is in print layout.
- A `:root`-level palette override is no longer ignored on CambridgeUS decks.

[0.3.0]: https://github.com/Farewe1ll/quarto-revealjs-beamer/releases/tag/v0.3.0
