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
