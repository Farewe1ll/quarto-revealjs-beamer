# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Earlier releases predate this file; their history is in the git log.

## [Unreleased]

### Changed

- **The two templates became complete feature tours, and their front matter now
  shows each variant's defaults.** They previously showed the frame title, three
  blocks and a few inline classes, and the README called them "complete examples"
  while they demonstrated no YAML option beyond the `short-*` values and the
  variant. Both now walk the whole surface, page for page in parallel: the three
  section looks, `data-section` alongside `data-subsection`, the block aliases and
  the `data-title` fallback, a native callout, a panel tabset, a task list, the
  `start` / `value` / `reversed` numbering semantics, the `h3`–`h6` ladder,
  `{.center}`, `visibility="uncounted"`, the auto-shrinking long frame title, and a
  `.scrollable` frame. The front matter itself keeps only the document's own data —
  title, author, date, `bibliography`, `lang` — plus `beamer-variant`, so a template
  opens on the stock look: Madrid without a headline, CambridgeUS with one,
  references in citation order and paginated. Every optional switch
  (`beamer-secheader`, `beamer-progress`, the four `short-*`, `refs-title`,
  `refs-order`, `refs-overflow`, `embed-resources`) moved to a new 「可选开关」 page,
  whose YAML block is meant to be copied whole, and the summary page and the KaTeX
  note now describe them as options instead of as settings this template has already
  applied.
- **Both templates fit every page.** An audit of all 23 leaves per template — walk
  every leaf, compare its `scrollHeight` against the 720px content area — found two
  pages over: Madrid's `#内容组织` by 307px and `#beamer-组件` by 321px, CambridgeUS's
  by 339px and 430px, the last one with the third block already overlapping the
  footline. `#内容组织` split into the list-and-hierarchy frame plus a new 「编号、嵌套
  与任务列表」 frame, and `#beamer-组件` into the three-block frame plus a new 「原生
  callout 与 data-title」 frame; CambridgeUS's remaining prose lost two lines that
  only repeated the colour algebra the README documents. Re-audited: **0 overflow
  warnings on either template**, 21 counted pages each (23 leaves, two reference
  pages being `uncounted`). The `::: {.notes}` block that sat before the first
  heading — which Pandoc turns into a slide of its own, so both decks opened on a
  blank second page — moved onto the first section page, where it still demonstrates
  `.notes`.
- The two templates both use the default `paginate` reference mode now
  (`item="3"`, measured — it really cuts six entries into 3 + 3) instead of splitting
  the modes between them, because a template that sets `refs-overflow: scroll` is no
  longer showing defaults. `scroll` is documented in the 可选开关 table, and
  `references.bib` kept the four extra entries so the pagination actually spills
  instead of being declared but empty.
- **The visual baselines were regenerated, and inline code now has visual
  coverage.** None of the screenshotted pages carried an inline-code span, which is
  why the chip's size could drift unnoticed; `tests/fixtures/madrid.qmd` gained one
  on its `#content-formats` page, and that baseline moved by 8% — five times the
  suite's 1.5% tolerance, so the fixture change could not have landed without
  regenerating. The rest of the set moved by at most 115 pixels: the fixtures render
  `date: today`, so their footline date differs by one digit from the run that made
  the previous baselines. `cambridgeus-content-formats.png` is byte-different with
  zero changed pixels — Chrome's PNG encoder is not byte-deterministic, which is
  also why the suite compares pixels rather than files.
- **README reorganised and recalibrated against the repository.** Facts that were
  scattered are now tables: `变量参考` lists all 48 `--beamer-*` variables with both
  variants' values, and the test section lists the six environment variables.
  Content that had drifted into the wrong section moved — math and the title-page
  note out of 配色, the palette test coverage into 测试, the page-geometry
  paragraphs into their own 版面几何 section. The section band's relationship to
  Beamer's frametitle template, the CambridgeUS badge-shadow rationale, and the
  alert title's contrast figures were each stated once instead of two or three
  times. The upstream fidelity claims are now sourced to the theme files they come
  from, including `\beamer@secheaderfalse` in `beamerthemeMadrid.sty` — which is
  what makes Madrid's default no-headline layout faithful rather than a deviation.

### Fixed

- **Inline code no longer reads as larger than the sentence around it, and no
  longer hangs out of its line.** The theme asked for a monospace stack whose
  x-height is about 8% larger than Libertinus Sans's, so at Quarto's default
  `0.875em` the chip's lowercase measured 14px against the body's 13px and its box
  ended 0.2px *below* its line box — a highlight that sits low in the line even
  though its baseline is exact. `$code-inline-font-size` is now `0.8125em`
  (= 0.875 / 1.077), which measures at x-height parity (ratio 1.000) with the
  baseline unmoved and the chip back inside the line (3.8px of air above it, 1.2px
  below). Cap height ends up about a tenth under the body's, the usual trade for a
  monospace face. The size is declared in the theme's own rule as well as in
  `$code-inline-font-size`, because the versions disagree about where it comes from:
  1.10 derives `.reveal code`'s size as `$code-font-size * 0.875` (so naming a size
  on the *shared* `$code-font-size` shrinks the chip to 0.7175em instead — which is
  what the first attempt did, and what the new assertion on the computed ratio now
  catches), while 1.4 and 1.5 set no inline size at all and let the chip inherit the
  body's 1em. `tests/fixtures/madrid.qmd` gained an inline-code span on a
  screenshotted page, so the chip has visual coverage it previously had none of.
- **The `.section-minimal` section page splits its air evenly instead of leaving
  the title floating.** The look kept the band's `min-height` and the heading's
  bottom margin, which around bare text pushed the body away and left 13px of air
  above the title against 43px below it. It now takes `min-height: 0`,
  `margin-bottom: 0` and padding on both sides that reads as one value
  (`--beamer-section-minimal-gap`, default 18px), so the title still starts flush
  under the headline — which the print and section assertions check — while the
  gaps to the headline and to the first body line measure 21px and 15px on a probe
  page with a CJK title and a headline showing, against 13 and 43 before. The suite
  now asserts that the two gaps match within 10px, an asymmetry the old geometry
  missed by 30. The optical ink nudge stays: on that probe it moves the title 3px
  *towards* symmetry (20/29 without it), so cancelling it would have made the
  reported defect worse.
- README claimed `color-mix()` differs from xcolor by at most **1/255**; the
  regression test tolerates **2/255**, and its own comment says why (xcolor's
  sp-quantised rounding, plus Chrome ≥ 118 interpolating `color-mix()` in oklab
  rather than srgb). The README now states the tolerance the suite guarantees.
- Two README claims were made precise: the scroll threshold for a long frame title
  is 2.28× the base height (not "twice"), and the two shrink steps trigger at 1.59×
  and 2.03×.
- Upstream CambridgeUS sets `titlelike`'s background to white, not to nothing; the
  theme writes `transparent`, which is equivalent on a light page. The README now
  says that instead of implying upstream leaves it unset.

## [0.4.0] - 2026-09-12

### Fixed

- **A section page's title band is sized by its own content, so it can no longer
  bury the first line of the body.** The band reserved a fixed
  `headline + var(--beamer-frame-height) + 22px`, and nothing ever measured a
  section title: `measureFrameTitle` only handles a frame's `h2`. A two-line title
  therefore reached 15.2px into the body's box and a three-line one buried a whole
  line — measured with the body's top at 90.9px under a band ending at 132.7px, and
  a screenshot of the reader seeing prose that started mid-sentence. The band now
  sits in the document flow, which is *less* machinery rather than more: it
  reserves its own height and the body simply follows it, so the stylesheet never
  needs to be told how tall a section title is. `beamer.js` still only adds the
  `beamer-section-slide` class, so the look stays declarative.
  A full-bleed band is preserved through a negative inline margin against the
  section's own 58px padding, which puts the title text back at `x=58` and keeps it
  flush with the frame titles. Measured after: `left:0`, `width:1280`, top flush
  under the headline, body clear by 36.4px in both variants.
  Two consequences worth knowing. Section-page prose now starts directly under the
  band instead of being vertically centred — that is what Beamer does, and it is
  what makes the overlap structurally impossible rather than merely unlikely (with
  `flex-start` an overfull page clips at the bottom and keeps its first line;
  centring clips both ends). **No visual baseline changed** — no baseline covers a section
  page that carries prose, and the band's own geometry is identical.
- **A section page's overflow warning no longer gives frame advice.** It told the
  reader to "add `.smaller` to the frame title", which a section page does not
  have, and which would have led straight into the `.scrollable` section bug fixed
  below. The advice now depends on the slide kind. (The metric was also
  misleading — it reported "4px" while 41.8px of body text sat under the band —
  but that failure mode is what the flow change above removes.)
- **A decoration pass that fails part-way now says so.** `decorateChrome` marks the
  deck decorated before it starts, deliberately: the pass appends reference pages
  and rewrites slide structure, so a half-finished run must not be repeated. That
  fail-stop is right, but it was also silent — the deck shipped with frames that
  had no headline, footline or numbering and nothing was reported. It now logs what
  happened and why it is not retried.
- **A nested ordered list's marker no longer inherits its parent's alignment
  correction.** The correction is written to a custom property on the `<li>`, and
  custom properties inherit, so a nested marker resolved it to the padding the pass
  had just written on its ancestor; a first-write-wins cache then froze that
  inherited value as the nested marker's own baseline. Measured: the nested marker
  cached `0.11614em` against the outer marker's `0.1em`, making its correction
  depend on the parent's glyphs. The baseline is now the constant that the
  stylesheet's `0.1em` fallback already defines.
- **The print-layout probe was measuring Reveal's background wrappers as if they
  were slides.** Reveal copies a slide's class list onto its `div.slide-background`
  once `Reveal.sync()` runs (which the theme calls when it generates reference
  pages), so the probe's `.beamer-leaf-slide` selector matched seven extra empty
  divs on the paginated-references fixture. Every per-slide check is null-guarded,
  so those divs passed all of them vacuously and inflated the array the assertions
  filter. The selector is now `section.beamer-leaf-slide`, and the same
  qualification was applied to the six other places in the suite that counted the
  bare class — they were only accidentally safe, because they happened to run on
  decks where `sync()` had not copied the classes yet.
- **The suite can no longer pass by measuring nothing.** Three checks were vacuous
  or skippable: `assertPrintLayout`'s two assertions are "this filter found
  nothing", which an empty array satisfies, and it had no coverage canary; a bullet
  or numbered marker that was not measured hit `continue` and left the
  `--beamer-structure` check green; and a section look whose paragraph disappeared
  took the body-contrast check with it. All three now fail loudly instead. The
  canary earns its keep immediately: it is what surfaced the background-wrapper
  defect above.
- The print-layout canary cannot use `Reveal.getTotalSlides()` as its reference
  count — the theme marks reference pages `data-visibility="uncounted"` and Reveal
  leaves those out of its model (measured: 10 leaf sections, 9 reported). It counts
  leaf sections from the DOM instead.

- **A `.scrollable` (or `.smaller`) section page kept its title band.** The pass
  that moves a slide's body into the `.beamer-scroll` layer treated only an `h2`
  as the fixed title, so a section page's `h1` band was moved into the layer with
  the body. The band is positioned by a rule that requires a *direct child* of the
  `<section>`, so it silently lost everything: measured with no fill
  (`rgba(0,0,0,0)` against `rgb(51,51,178)`), `position: static`, and its title
  promoted from 32.4px to 52.5px by Quarto's
  `.reveal[data-navigation-mode=linear] .title-slide h1` rule once the theme's own
  more specific rule stopped matching — and the title scrolled away with the body.
  A section page's `h1` and a frame's `h2` are now both treated as fixed, so a
  scrollable section page renders identically to a plain one and only its body
  scrolls. The reachable input was undocumented (`.scrollable` is documented for
  frames), but the failure was silent and the theme's own overflow warning
  recommends `.scrollable`, so the combination was easy to reach by accident.
- **Optical re-alignment runs once per frame instead of once per resize event.**
  `alignInlineLabels`, `alignOrderedMarkers` and `centerTitleInk` were each
  scheduled on their own `requestAnimationFrame` for every call, and one real
  resize produces several calls — measured 2 native `resize` events plus 1
  re-emission from Reveal, i.e. 3 full passes per resize, multiplied by the event
  rate during a window drag. Each pass reads `getComputedStyle` per list item and
  one `getImageData` per title. The work is unchanged; a coalescing flag now
  collapses any number of requests in one frame into a single pass.
  `realignForPrint` stays synchronous, since `beforeprint` has no frame to wait
  for. **No visual baseline changed.**
- The alert block title's stroke **colour** is now asserted where a stroke is
  painted. The suite collected it and never checked it, so only the width was
  pinned while CambridgeUS's legibility depends on `#000000` specifically.
- The contrast of white on the Madrid alert band is **6.53:1**, not the 7.6:1 that
  three comments claimed. The conclusion is unaffected — it is still far above the
  4.5:1 that body-size text needs, so Madrid still needs no stroke.
- **The harness's three teardown gaps are closed** (all test-side; no rendering
  change):
  - The run lock was claimed *after* `resetDirectory(outputDir)`, so a second run
    refused to start only once it had already deleted the first run's output —
    the opposite of what the guard's own comment promises. It is now the first
    statement of the run, verified by planting a live lock: the run refuses and
    all 33 files in `tests/_output` survive. The claim is also atomic now
    (`wx` instead of check-then-write, which let two simultaneous runs both see no
    lock and both write their own pid).
  - Chrome's process-group kill was wired only to the signal handler.
    `stopChildProcess` signalled the parent pid alone, so the `detached` group the
    spawn comment exists for was never used on the ordinary path. It is used now,
    and the pid is dropped from the registry once the group is gone so a later
    signal cannot aim a `SIGKILL` at a recycled pid. **Honest scope:** the leak
    this was expected to fix could *not* be reproduced — with the browser process
    wedged with `SIGSTOP` and then killed parent-only, all 10 Chrome processes
    still exited by themselves. This is a consistency fix that makes the ordinary
    path match the documented intent, not a demonstrated leak fix.
  - Every CDP command now has a watchdog (default 120s,
    `BEAMERSLIDES_CDP_TIMEOUT_MS`). Without one a single lost reply hung the suite
    forever and left a lock to delete by hand; with a 1ms watchdog the run now
    fails in 19s naming the stuck command, and releases the lock on the way out.

- **A test that could not fail was replaced by one that can.** The print-layout control asserted that the Madrid fixture "must not overflow on screen", but it read the warnings off a `?print-pdf` page — and `isPrintLayout()` short-circuits `reportOverflow`, so a deck loaded in print layout can never report an overflow, however badly it overflows. The control passed for every fixture. It is now measured on a real screen page, where the property it claims can actually be observed.
- **A command that never started is no longer retried as if it had crashed.** The render retry exists for Quarto's intermittent Deno SIGSEGV, but it caught every failure — including `ENOENT` — so a missing or non-executable Quarto burnt all three attempts and both blocking sleeps, then reported the same error, under a warning that claimed the Deno runtime had crashed. `runCapture` now carries `spawnSync`'s error code out, and the retry stops immediately on `ENOENT`/`EACCES`. Observed for real: a download that failed left `BEAMERSLIDES_QUARTO_BIN` pointing at nothing.
- **A DevTools socket error now fails the commands waiting on it.** The connection had a listener for `close` but not for `error`, and Node's WebSocket is an EventTarget, so an unhandled `error` event neither throws nor settles anything: a browser that died mid-run left every pending command waiting out the 300s watchdog instead of failing immediately. The new listener mirrors the `close` handler.
- The `CdpConnection.close` fallback timer is cleared when the close settles. It used to outlive the connection and hold the event loop open for up to a second after the last slide was measured.
- `process._getActiveHandles()` is guarded. It is a private Node API, and `debugCleanup` evaluates its arguments whether or not the debug output is enabled — so the call ran on every `npm test`, not only in debug runs, and would have thrown at the end of an otherwise green run the day the API moved.
- Each teardown step now runs on its own, so one failure cannot skip the rest. A throw in `shutdownChrome` (or in the temporary-input loop before it) used to leave the browser and its profile directory behind, and to replace the real test failure with a teardown error.

### Changed

- **`h3` now reads `--beamer-structure`.** The README and the regression test both
  said `h3`–`h6` take the structural accent; the stylesheet gave `h3`
  `--beamer-primary`. The two are equal in both stock variants, so nothing looked
  wrong — but `structure` is the role `h4`–`h6`, the list markers and the README's
  own "override this to recolour the theme" recipe all use, and reading `primary`
  meant that documented override silently skipped `h3`. No visual change in either
  stock theme, confirmed by the unchanged baselines.

- Documentation corrections, none of which change behaviour: `--beamer-alert` no
  longer drives `h4` (three places still said it did, including one contradicted by
  this same release's own entry); CambridgeUS's `--beamer-alert` is the undiluted
  darkred `#cc0000`, a deviation the code documents as deliberate while the README
  and CHANGELOG still quoted upstream's `#bd1a1a`; the CambridgeUS block-title
  colours were superseded later in this release; the "Added" entry for the section
  looks claimed `beamer.js` supplies the band's height and a centring offset, which
  the "Removed" entry for `--beamer-section-offset` in the same release says was
  never true; and the comments describing CambridgeUS `structure` were written
  before the theme re-pointed it at the variant's darkred.

- README now records that the bundled KaTeX is **not** single-file: Quarto compiles
  `html-math-method.url` into a runtime script that inserts the `<link>` and
  `<script>` by relative path, so `embed-resources: true` cannot inline them.
  Measured: HTML plus `_extensions/beamerslides/` renders offline (200), the HTML
  alone gets two 404s and degrades silently to raw `$…$` because the renderer sets
  `throwOnError: false`.


- The `overflow: hidden` rule for `.scrollable` / `.smaller` /
  `.beamer-long-frame-title` frames now carries a comment recording **why it must
  not be deleted**. It is inert against the shipped stylesheets — the base
  `.beamer-leaf-slide` rule already outranks Quarto's own
  `.reveal .slide.scrollable { overflow-y: auto }`, and deleting the rule was
  measured to change nothing — but it is the `(0,4,1)` guard that defeats a
  *document's* stylesheet writing the natural
  `.reveal .slides section.scrollable { overflow-y: auto }`, which ties the base
  rule at `(0,3,1)` and wins on source order. Measured: `hidden` with the rule,
  `auto` without it.
- README documents `BEAMERSLIDES_CDP_TIMEOUT_MS`, and its claim about overriding
  retry counts now matches the code: only the page-ready reload count is
  overridable, while the `quarto render` and `Page.printToPDF` attempts are fixed
  at 3 each.

- README documents the user-facing surface that had none: `.center` (per slide and via the format), `data-section`, and the block-div aliases `.beamer-block` / `.example-block` / `.alert-block`.
- README lists the Reveal.js options the format presets in `_extension.yml`, so it is clear what is already configured and can be overridden, and it states plainly that `slide-number` is force-hidden with `!important` — writing `slide-number: true` cannot bring the floating number back.
- README notes that unknown `refs-order` / `refs-overflow` values warn and fall back, not only invalid variants and booleans.

### Removed

- Dead code in the suite: an unreachable `return state` after an assertion that
  always throws, three imported-but-unused harness bindings (`baselinesDir`,
  `runCapture`, `testsDir`), and the `__beamerTimeline.frames` counter, which was
  written on every frame and never read by anything.

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
  (`#3333b2` / `#008000` / `#bd1a1a`; the plain and alert titles were retuned
  later in this same release — see the palette entries below).
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
  Madrid sets it to 0 because white on its `#bf0000` band is already 6.53:1.
  `--beamer-alert` stays red on purpose so `.alert` inline emphasis remains
  legible.
- The alert title carrying `font-weight: 700` against 650 is as far as the
  bundled Libertinus Sans can go: it ships only Regular and Bold, and measured,
  everything from 600 upward renders at the same advance width.
- `green!50!black` is `#008000`, not `#004000`: xcolor defines `green` as
  `rgb(0,1,0)`, so the halved value comes from the 50% mix rather than from the
  base green. Upstream CambridgeUS's `alerted text` is `#bd1a1a`; this theme
  deliberately ships the undiluted darkred `#cc0000` instead.
- Section pages now use the frame-title template, as Beamer does: the section
  title is a band pinned under the headline instead of a centred rounded badge
  with a drop shadow. `--beamer-section-title-bg`/`-fg` remain separately
  overridable. On Madrid they now hold the same values as `--beamer-frame-bg`/`-fg`,
  but on CambridgeUS the background deliberately does not: the section band keeps
  the variant's transparent-with-coloured-text treatment (see the section-look
  entries) while the frame title keeps beaver's `gray!10!white` fill (`#f2f2f2`,
  from `beamercolorthemebeaver.sty`).
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
  expressed entirely in `--beamer-section-*` custom properties and needs no
  measurement at all: the band is in the document flow, so it reserves its own
  height, and `beamer.js` only adds the `beamer-section-slide` class. The default is
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

- **`refs-order: declaration` is covered across several bibliography files.** The key list is built by reading every declared `.bib` and concatenating the keys in the order the files are listed, but that path had only ever been exercised with one file, so a regression that read just the first file — or that ordered entries within a file but not across files — would not have been caught. The fixture's two entries are chosen so citeproc's alphabetical order is the exact reverse of the declared order, which is what makes the assertion able to fail.
- **A regression guard for a `.scrollable` section page.** The fix that keeps a section page's band out of the scroll layer shipped without one. The new page asserts that the band stays a direct child of its `<section>`, keeps its fill, stays full bleed and spans the slide, while the body sits in the layer and remains reachable — with the fix reverted, five of those assertions fail. The band-fill check deliberately matches a colour shape rather than asserting "not transparent": in the broken state the heading lookup returns `null`, and a bare `notEqual` against `rgba(0, 0, 0, 0)` passes for `null`, so the obvious form of that assertion could not fail.

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
- The other two retries cover a stalled render and a deck that never becomes
  ready; both are external to this project's code.
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
- **Dead CSS variable `--beamer-section-inset` / `--beamer-section-margin`.** Both
  existed to position the section band absolutely. The band is now in the flow
  and spans the slide through a negative inline margin, so neither variable has a
  reader and both are gone.
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

[Unreleased]: https://github.com/Farewe1ll/quarto-revealjs-beamer/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Farewe1ll/quarto-revealjs-beamer/releases/tag/v0.4.0
[0.3.0]: https://github.com/Farewe1ll/quarto-revealjs-beamer/releases/tag/v0.3.0
