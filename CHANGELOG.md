# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Earlier releases predate this file; their history is in the git log.

## [Unreleased]

### Fixed

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
- CambridgeUS block titles are now differentiated by semantic weight rather
  than all deriving from `structure`: alert `#cc0000` (the same red as the list
  markers, so red means "attention" in exactly one place), example `#008000`
  (unchanged, beamer-pinned) and plain `#b45309` amber. Previously the alert
  was beaver's grey-mixed `#bd1a1a`, which was the *lowest*-chroma of the three
  and therefore read quieter than the plain block it was meant to outrank.
  Amber rather than a true orange because a legible orange on the light slide
  background does not exist: `#f76707` is 2.99:1, `orange` 1.94:1, `yellow`
  1.06:1, against the 4.5:1 needed for body text.
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

- `testPaletteAlgebra`, a regression test that derives the expected colours from
  the upstream theme sources and compares them against what the browser paints
  for both variants. The screenshot baselines are generated by this
  implementation and therefore cannot detect a palette that is self-consistently
  wrong; this test can. It fails on the old hard-coded block colours and on the
  old CambridgeUS block fill.
- `tests/fixtures/blocks-audit.qmd`, covering all three block kinds in one
  frame.

### Changed

- The browser harness retries a stalled headless Chrome launch (three attempts,
  each with a fresh profile) and starts Chrome with shared-runner hardening
  flags (no background networking, component updates, extensions or desktop
  keyring) plus startup logging. A launch that used to fail after 30s with
  `(no stderr output)` now retries and, if it still fails, leaves per-attempt
  diagnostics in the uploaded artifacts.
- Print-layout validation now asserts that a section title band is pinned under
  the headline and spans the frame-title width, rather than that section content
  is vertically centred.

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
