import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runLockFile = join(projectRoot, "tests", ".run-tests.lock");

const lockHolder = () => {
  const holder = readFileSync(runLockFile, "utf8").trim();
  const pid = Number.parseInt(holder, 10);
  const alive =
    Number.isFinite(pid) &&
    (() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return error.code === "EPERM";
      }
    })();
  return { holder, alive };
};

const describeConflict = (holder) =>
  `Another test run (pid ${holder}) is already using this checkout. ` +
  "The suite writes fixed temporary files into the repo root and a " +
  "single tests/_output, so concurrent runs corrupt each other. " +
  `Wait for it, or delete ${relative(projectRoot, runLockFile)} if stale.`;

// Claim the lock, or report that someone else holds it. The pid is written to a
// private file first and then `link`ed into place, because `link` is the atomic
// create-if-absent primitive: the lock only becomes visible once it already
// contains the pid. `writeFileSync(..., { flag: "wx" })` looks atomic but is not
// enough here -- it creates the file and *then* writes it, so a concurrent run
// that loses the race can read an empty lock, find no live pid in it, and
// "reclaim" the winner's lock as stale.
const claimRunLock = () => {
  const claimPath = `${runLockFile}.claim-${process.pid}`;
  writeFileSync(claimPath, String(process.pid));
  try {
    linkSync(claimPath, runLockFile);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    return false;
  } finally {
    rmSync(claimPath, { force: true });
  }
};

// A stale lock (holder no longer alive) is reclaimed once and the claim retried;
// a second failure means a live run claimed it in the meantime, so this one loses.
const acquireRunLock = () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (claimRunLock()) {
      releaseRunLockOnExit();
      return;
    }
    let current;
    try {
      current = lockHolder();
    } catch (readError) {
      if (readError.code === "ENOENT") {
        // The holder released it between the failed link and this read.
        continue;
      }
      throw readError;
    }
    if (current.alive || attempt === 1) {
      throw new Error(describeConflict(current.holder));
    }
    try {
      unlinkSync(runLockFile);
    } catch (unlinkError) {
      if (unlinkError.code !== "ENOENT") {
        throw unlinkError;
      }
    }
  }
  throw new Error(
    `Could not claim ${relative(projectRoot, runLockFile)} after reclaiming a ` +
      "stale lock; another run keeps taking it."
  );
};

const releaseRunLockOnExit = () => {
  process.on("exit", () => {
    try {
      if (
        existsSync(runLockFile) &&
        readFileSync(runLockFile, "utf8").trim() === String(process.pid)
      ) {
        unlinkSync(runLockFile);
      }
    } catch (error) {
      // Nothing useful to do while tearing down.
    }
  });
};

import {
  BrowserPage,
  artifactsDir,
  assertNoBrowserErrors,
  assertPrintLayout,
  chromeTemporaryDir,
  debugCleanup,
  delay,
  fixtureIgnoreExisted,
  generatedFixtureIgnore,
  launchChrome,
  outputDir,
  removeTemporaryDirectory,
  renderFixture,
  renderTemplate,
  resetDirectory,
  rootDir,
  run,
  showSlide,
  shutdownChrome,
  startServer,
  temporaryInputs,
  visibleInkMeasurementSource,
} from "./lib/harness.mjs";

const testMadrid = async (connection, origin) => {
  const listsPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/lists`
  );
  const state = await listsPage.evaluate(`(() => {
    ${visibleInkMeasurementSource}
    const reveal = document.querySelector(".reveal");
    const slide = document.getElementById("lists");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const footerBoxes = Array.from(footer.querySelectorAll(":scope > span"));
    const directLists = Array.from(slide.children).filter((node) =>
      node.matches("ul, ol")
    );
    const unordered = directLists.find((node) => node.tagName === "UL");
    const ordered = directLists.find((node) => node.tagName === "OL");
    const unorderedRect = unordered.getBoundingClientRect();
    const orderedRect = ordered.getBoundingClientRect();
    const orderedItem = ordered.querySelector("li");
    const orderedItems = Array.from(ordered.querySelectorAll(":scope > li"));
    const orderedItemRect = orderedItem.getBoundingClientRect();
    const orderedTextRange = document.createRange();
    orderedTextRange.selectNodeContents(orderedItem);
    const orderedTextRect = orderedTextRange.getBoundingClientRect();
    const orderedMarker = getComputedStyle(orderedItem, "::before");
    const orderedMarkerTop =
      orderedItemRect.top + parseFloat(orderedMarker.top);
    const orderedMarkerHeight = parseFloat(orderedMarker.height);
    const unorderedItems = [
      unordered.querySelector(":scope > li"),
      unordered.querySelector(":scope > li > ul > li"),
      unordered.querySelector(":scope > li > ul > li > ul > li")
    ];
    const unorderedMarkerCenterDeltas = unorderedItems.map((item) => {
      const marker = getComputedStyle(item, "::before");
      const itemStyle = getComputedStyle(item);
      const outerHeight =
        parseFloat(marker.height) +
        parseFloat(marker.borderTopWidth) +
        parseFloat(marker.borderBottomWidth);
      const translateY =
        marker.transform === "none"
          ? 0
          : new DOMMatrixReadOnly(marker.transform).m42;
      return (
        parseFloat(marker.top) +
        outerHeight / 2 +
        translateY -
        parseFloat(itemStyle.lineHeight) / 2
      );
    });
    const block = slide.querySelector(".beamer-block");
    return {
      classes: reveal.className,
      leafSlides: document.querySelectorAll("section.beamer-leaf-slide").length,
      headlineCount: document.querySelectorAll("section.beamer-leaf-slide > .beamer-headline").length,
      footerBoxCount: footerBoxes.length,
      footerWidths: footerBoxes.map((node) => node.getBoundingClientRect().width),
      author: footer.querySelector(".beamer-footline-author").textContent,
      date: footer.querySelector(".beamer-footline-date-text").textContent,
      progressCount: footer.querySelectorAll(".beamer-footline-progress").length,
      unorderedDisplay: getComputedStyle(unordered).display,
      unorderedMarkerCenterDeltas,
      orderedDisplay: getComputedStyle(ordered).display,
      orderedMarkerDisplay: orderedMarker.display,
      orderedMarkerContent: orderedMarker.content,
      orderedMarkerValue: orderedItem.dataset.beamerMarkerValue,
      orderedMarkerHeight,
      orderedMarkerLineHeight: parseFloat(orderedMarker.lineHeight),
      orderedMarkerPaddingBottom: parseFloat(orderedMarker.paddingBottom),
      orderedMarkerAligned: orderedItem.dataset.beamerMarkerAligned === "true",
      orderedMarkerInk: orderedItems.slice(0, 3).map((item, index) =>
        measureVisibleInk(item, String(index + 1), "::before")
      ),
      orderedMarkerCenterDelta:
        orderedMarkerTop + orderedMarkerHeight / 2 -
        (orderedTextRect.top + orderedTextRect.height / 2),
      listsAreStacked: orderedRect.top >= unorderedRect.bottom - 1,
      blockTitleText:
        block
          .querySelector(":scope > .beamer-block-title")
          ?.textContent.trim() || "",
      blockTitleIsRealText: slide.textContent.includes("定义"),
      blockTitleHasNoDataAttribute: !block.hasAttribute("data-title"),
      blockTitleInk: (() => {
        const title = block.querySelector(":scope > .beamer-block-title");
        return title ? measureVisibleInk(title, "定义") : null;
      })()
    };
  })()`);

  assert.match(state.classes, /beamer-madrid/);
  assert.match(state.classes, /beamer-no-headline/);
  assert.equal(state.leafSlides, 10);
  assert.equal(state.headlineCount, 0);
  assert.equal(state.footerBoxCount, 3);
  assert(Math.max(...state.footerWidths) - Math.min(...state.footerWidths) < 1);
  assert.equal(state.author, "Ada Lovelace (Analytical Society)");
  assert.equal(state.date, "1843");
  assert.equal(state.progressCount, 0);
  assert.equal(state.unorderedDisplay, "block");
  for (const centerDelta of state.unorderedMarkerCenterDeltas) {
    assert(Math.abs(centerDelta) < 0.75, JSON.stringify(state));
  }
  assert.equal(state.orderedDisplay, "block");
  assert.equal(state.orderedMarkerDisplay, "flex");
  assert(state.orderedMarkerLineHeight < state.orderedMarkerHeight);
  assert(state.orderedMarkerPaddingBottom > 0);
  assert.equal(state.orderedMarkerAligned, true, JSON.stringify(state));
  assert(Math.abs(state.orderedMarkerCenterDelta) < 1.5, JSON.stringify(state));
  for (const marker of state.orderedMarkerInk) {
    assert(Math.abs(marker.centerDelta) < 1, JSON.stringify(marker));
    assert(Math.abs(marker.topSpace - marker.bottomSpace) < 2, JSON.stringify(marker));
  }
  assert.equal(state.listsAreStacked, true);
  assert.equal(state.blockTitleText, "定义");
  assert.equal(
    state.blockTitleIsRealText,
    true,
    "block titles must be real text so they stay selectable and searchable"
  );
  assert.equal(state.blockTitleHasNoDataAttribute, true);
  assert(
    state.blockTitleInk !== null,
    "block title element is missing; the Lua filter must emit .beamer-block-title"
  );
  assert(Math.abs(state.blockTitleInk.centerDelta) < 1, JSON.stringify(state));
  await listsPage.screenshot("madrid-lists");
  await listsPage.close();

  const titlePage = await BrowserPage.create(connection, `${origin}/madrid.html`);
  const titleState = await titlePage.evaluate(`(() => {
    const slide = document.getElementById("title-slide");
    const slideRect = slide.getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    const headline = slide.querySelector(":scope > .beamer-headline");
    const headlineRect = headline?.getBoundingClientRect();
    const contentRects = Array.from(slide.children)
      .filter(
        (node) =>
          !node.matches(
            ".beamer-headline, .beamer-footline, .aside-footnotes, aside.notes"
          ) && getComputedStyle(node).display !== "none"
      )
      .map((node) => node.getBoundingClientRect());
    const contentCenter =
      (Math.min(...contentRects.map((rect) => rect.top)) +
        Math.max(...contentRects.map((rect) => rect.bottom))) /
      2;
    const availableCenter =
      ((headlineRect?.bottom ?? slideRect.top) + footerRect.top) / 2;
    const name = document.querySelector("#title-slide .quarto-title-author-name");
    const email = document.querySelector("#title-slide .quarto-title-author-email");
    const affiliation = document.querySelector("#title-slide .quarto-title-affiliation");
    const date = document.querySelector("#title-slide .date");
    const emailLink = email.querySelector("a");
    const orcid = document.querySelector("#title-slide .quarto-title-author-orcid");
    const icon = orcid.querySelector("svg");
    const nameRect = name.getBoundingClientRect();
    const emailRect = email.getBoundingClientRect();
    const affiliationRect = affiliation.getBoundingClientRect();
    const dateRect = date.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const revealScale = Math.max(0.0001, window.Reveal.getScale());
    // Beamer's title page uses a beamercolorbox without an explicit width, so
    // the box must span the full text width instead of shrinking to content.
    const slideStyle = getComputedStyle(slide);
    const textWidth =
      slideRect.width -
      parseFloat(slideStyle.paddingLeft) -
      parseFloat(slideStyle.paddingRight);
    const titleBoxWidth = slide
      .querySelector(".beamer-title-box")
      .getBoundingClientRect().width;
    return {
      titleBoxWidth,
      slideTextWidth: textWidth,
      titleBoxSpansTextWidth: Math.abs(titleBoxWidth - textWidth) < 1,
      emailDisplay: getComputedStyle(email).display,
      emailHref: emailLink.getAttribute("href"),
      affiliationGapAbove:
        (affiliationRect.top - emailRect.bottom) / revealScale,
      affiliationGapBelow:
        (dateRect.top - affiliationRect.bottom) / revealScale,
      orcidDisplay: getComputedStyle(orcid).display,
      orcidVerticalAlign: getComputedStyle(orcid).verticalAlign,
      iconViewBox: icon.getAttribute("viewBox"),
      originalImageRemoved: !orcid.querySelector("img"),
      nameFontSize: parseFloat(getComputedStyle(name).fontSize),
      iconWidth: iconRect.width,
      iconHeight: iconRect.height,
      iconAboveNameCenter: iconRect.bottom < nameRect.top + nameRect.height * 0.7,
      display: getComputedStyle(slide).display,
      verticalCenterDelta: contentCenter - availableCenter,
      slideStartsAtViewportTop: Math.abs(slideRect.top) <= 1,
      footerVisible:
        footerRect.top >= -1 && footerRect.bottom <= window.innerHeight + 1
    };
  })()`);
  assert.notEqual(titleState.emailDisplay, "none");
  assert.equal(titleState.emailHref, "mailto:ada@example.org");
  assert.equal(
    titleState.titleBoxSpansTextWidth,
    true,
    `title box ${titleState.titleBoxWidth}px must fill the text width ${titleState.slideTextWidth}px`
  );
  assert(
    Math.abs(
      titleState.affiliationGapAbove - titleState.affiliationGapBelow
    ) < 1,
    JSON.stringify(titleState)
  );
  assert.equal(titleState.orcidDisplay, "inline-flex");
  assert.equal(titleState.orcidVerticalAlign, "super");
  assert.equal(titleState.iconViewBox, "0 0 256 256");
  assert.equal(titleState.originalImageRemoved, true);
  assert(titleState.iconWidth > 8);
  assert(titleState.iconHeight < titleState.nameFontSize * 0.65);
  assert.equal(titleState.iconAboveNameCenter, true);
  assert.equal(titleState.display, "flex");
  assert(Math.abs(titleState.verticalCenterDelta) < 12, JSON.stringify(titleState));
  assert.equal(titleState.slideStartsAtViewportTop, true);
  assert.equal(titleState.footerVisible, true);
  await titlePage.screenshot("madrid-title");
  await titlePage.close();

  const sectionPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/foundations`
  );
  const sectionState = await sectionPage.evaluate(`(() => {
    const slide = document.getElementById("foundations");
    const slideRect = slide.getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    const headline = slide.querySelector(":scope > .beamer-headline");
    const headlineRect = headline?.getBoundingClientRect();
    // Beamer routes a \section page through the frametitle template, so the
    // title is a full-bleed band pinned under the headline, with its text on
    // the body margin.
    const band = slide.querySelector(":scope > h1");
    const bandRect = band.getBoundingClientRect();
    const bandText = document.createRange();
    bandText.selectNodeContents(band);
    const frameTitle = document.querySelector(
      ".slides section.beamer-frame-slide > h2:first-of-type"
    );
    const frameText = document.createRange();
    frameText.selectNodeContents(frameTitle);
    const body = document.getElementById("lists");
    const bodyList = body.querySelector("ul").getBoundingClientRect();
    return {
      display: getComputedStyle(slide).display,
      bandLeft: bandRect.left,
      bandTop: bandRect.top,
      bandTextAlign: getComputedStyle(band).textAlign,
      bandTextLeft: bandText.getBoundingClientRect().left,
      frameTitleTextLeft: frameText.getBoundingClientRect().left,
      bodyTextLeft: bodyList.left,
      // Madrid hides the headline (height 0), so the band starts at the active
      // headline height; a visible headline would end exactly there.
      headlineBottom: headlineRect?.bottom || slideRect.top,
      slideStartsAtViewportTop: Math.abs(slideRect.top) <= 1,
      footerVisible:
        footerRect.top >= -1 && footerRect.bottom <= window.innerHeight + 1
    };
  })()`);
  assert.equal(sectionState.display, "flex");
  // The band is built exactly like the frame title: full-bleed, with its text
  // inset by the body margin. Insetting the band itself would push the section
  // title 58px left of where every frame title starts.
  assert.equal(sectionState.bandLeft, 0, JSON.stringify(sectionState));
  // Section title, frame title and body text must all start on the same edge:
  // the bands are full-bleed and carry the margin as padding.
  for (const edge of ["bodyTextLeft", "frameTitleTextLeft"]) {
    assert(
      Math.abs(sectionState.bandTextLeft - sectionState[edge]) < 1,
      `section title must align with ${edge}: ${JSON.stringify(sectionState)}`
    );
  }
  // It sits immediately below the headline rather than centred on the slide.
  assert(
    Math.abs(sectionState.bandTop - sectionState.headlineBottom) < 1,
    JSON.stringify(sectionState)
  );
  assert.equal(sectionState.bandTextAlign, "left");
  assert.equal(sectionState.slideStartsAtViewportTop, true);
  assert.equal(sectionState.footerVisible, true);
  await sectionPage.screenshot("madrid-section");
  await sectionPage.close();

  const navigatedLongTitlePage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html`
  );
  for (let step = 0; step < 4; step += 1) {
    await navigatedLongTitlePage.pressKey("ArrowRight", "ArrowRight", 39);
  }
  const navigatedLongTitle = await navigatedLongTitlePage.evaluate(`(() => {
    const slide = window.Reveal.getCurrentSlide();
    const heading = slide.querySelector(":scope > h2");
    const paragraph = slide.querySelector(":scope > p");
    const headingRect = heading.getBoundingClientRect();
    const paragraphRect = paragraph.getBoundingClientRect();
    return {
      id: slide.id,
      frameHeight: parseFloat(
        getComputedStyle(slide).getPropertyValue("--beamer-frame-height")
      ),
      titleFits: heading.scrollHeight <= heading.clientHeight + 1,
      bodyBelowTitle: paragraphRect.top >= headingRect.bottom
    };
  })()`);
  assert.equal(navigatedLongTitle.id, "long-title");
  assert(navigatedLongTitle.frameHeight > 58);
  assert.equal(navigatedLongTitle.titleFits, true);
  assert.equal(navigatedLongTitle.bodyBelowTitle, true);
  await navigatedLongTitlePage.close();

  const longTitlePage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/long-title`
  );
  const longTitle = await longTitlePage.evaluate(`(() => {
    const slide = document.getElementById("long-title");
    const heading = slide.querySelector(":scope > h2");
    const paragraph = slide.querySelector(":scope > p");
    const headingRect = heading.getBoundingClientRect();
    const paragraphRect = paragraph.getBoundingClientRect();
    return {
      clientHeight: heading.clientHeight,
      scrollHeight: heading.scrollHeight,
      frameHeight: parseFloat(getComputedStyle(slide).getPropertyValue("--beamer-frame-height")),
      bodyBelowTitle: paragraphRect.top >= headingRect.bottom,
      overflow: getComputedStyle(heading).overflow
    };
  })()`);
  assert(longTitle.scrollHeight <= longTitle.clientHeight + 1);
  assert(longTitle.frameHeight > 58);
  assert.equal(longTitle.bodyBelowTitle, true);
  assert.notEqual(longTitle.overflow, "hidden");
  await longTitlePage.screenshot("madrid-long-title");
  await longTitlePage.close();

  const mathPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/mathematics`
  );
  const mathState = await mathPage.evaluate(`(() => {
    const slide = document.getElementById("mathematics");
    const inlineWrapper = slide.querySelector(".math.inline");
    const displayWrapper = slide.querySelector(".math.display");
    const inlineMath = inlineWrapper.querySelector(".katex");
    const displayMath = displayWrapper.querySelector(".katex");
    const formula = displayMath.querySelector(".katex-html > .katex-base");
    const radical = displayMath.querySelector(".sqrt svg path");
    return {
      inlineRendered: Boolean(inlineMath),
      displayRendered: Boolean(displayMath),
      radicalRendered: Boolean(radical),
      localKaTeX: Array.from(document.scripts).some((script) =>
        script.src.endsWith("/katex/katex.min.js")
      ),
      externalRuntimeResources: [
        ...Array.from(document.scripts, (script) => script.src),
        ...Array.from(
          document.querySelectorAll('link[rel="stylesheet"]'),
          (link) => link.href
        )
      ].filter((url) => url && new URL(url).origin !== location.origin),
      bodyFontFamily: getComputedStyle(slide).fontFamily,
      regularFontLoaded: document.fonts.check(
        '400 30px "Beamerslides Libertinus Sans"'
      ),
      boldFontLoaded: document.fonts.check(
        '700 30px "Beamerslides Libertinus Sans"'
      ),
      italicFontLoaded: document.fonts.check(
        'italic 400 30px "Beamerslides Libertinus Sans"'
      ),
      inlineFontSize: parseFloat(getComputedStyle(inlineWrapper).fontSize),
      displayFontSize: parseFloat(getComputedStyle(displayWrapper).fontSize),
      formulaWidth: formula.getBoundingClientRect().width,
      formulaHeight: formula.getBoundingClientRect().height
    };
  })()`);
  assert.equal(mathState.inlineRendered, true);
  assert.equal(mathState.displayRendered, true);
  assert.equal(mathState.radicalRendered, true);
  assert.equal(mathState.localKaTeX, true);
  assert.deepEqual(mathState.externalRuntimeResources, []);
  assert.match(mathState.bodyFontFamily, /Beamerslides Libertinus Sans/);
  assert.equal(mathState.regularFontLoaded, true);
  assert.equal(mathState.boldFontLoaded, true);
  assert.equal(mathState.italicFontLoaded, true);
  assert(mathState.displayFontSize > mathState.inlineFontSize);
  assert(mathState.inlineFontSize > 30);
  assert(mathState.formulaWidth > 100);
  assert(mathState.formulaHeight > 30);
  await mathPage.screenshot("madrid-mathematics");
  await mathPage.close();

  const formatsPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/content-formats`
  );
  const formatsState = await formatsPage.evaluate(`(() => {
    ${visibleInkMeasurementSource}
    const slide = document.getElementById("content-formats");
    const measureInline = (selector) => {
      const element = slide.querySelector(selector);
      return measureVisibleInk(element, element.textContent.trim());
    };
    const header = slide.querySelector("table thead th");
    const caption = slide.querySelector("table caption");
    const code = slide.querySelector("div.sourceCode");
    const filename = slide.querySelector(".code-with-filename-file");
    const filenameLabel = filename.querySelector("pre");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const backgroundRect = slide.querySelector(".bg").getBoundingClientRect();
    const buttonRect = slide.querySelector(".button").getBoundingClientRect();
    // The inline-code chip: its own size against the paragraph's, which is the
    // quantity the stylesheet variable is trying to control. Reading the
    // computed size rather than a theme constant is the point -- Quarto derives
    // the chip from a shared base (\`$code-font-size * 0.875\`), so naming a size
    // on the wrong variable leaves the page at a size nobody intended.
    const chip = slide.querySelector("p code");
    const chipParagraph = chip.closest("p");
    const contentBottom = Math.max(
      slide.querySelector("table").getBoundingClientRect().bottom,
      filename.closest(".code-with-filename").getBoundingClientRect().bottom
    );
    return {
      backgroundLabel: measureInline(".bg"),
      button: measureInline(".button"),
      chip: {
        fontSize: parseFloat(getComputedStyle(chip).fontSize),
        bodyFontSize: parseFloat(getComputedStyle(chipParagraph).fontSize),
        ratio:
          parseFloat(getComputedStyle(chip).fontSize) /
          parseFloat(getComputedStyle(chipParagraph).fontSize),
        chipTop: chip.getBoundingClientRect().top,
        chipBottom: chip.getBoundingClientRect().bottom,
        lineTop: chipParagraph.getBoundingClientRect().top,
        lineBottom: chipParagraph.getBoundingClientRect().bottom
      },
      inlineBoxCenterDelta:
        (buttonRect.top + buttonRect.bottom -
          backgroundRect.top - backgroundRect.bottom) /
        2,
      headerText: header.textContent.trim(),
      headerColor: getComputedStyle(header).color,
      headerBackground: getComputedStyle(header).backgroundColor,
      headerBorderWidth: parseFloat(getComputedStyle(header).borderBottomWidth),
      captionAlign: getComputedStyle(caption).textAlign,
      codeBorderWidth: parseFloat(getComputedStyle(code).borderWidth),
      codeBackground: getComputedStyle(code).backgroundColor,
      filenameBackground: getComputedStyle(filename).backgroundColor,
      filenameColor: getComputedStyle(filename).color,
      filenameLabelBorderWidth: parseFloat(getComputedStyle(filenameLabel).borderWidth),
      filenameLabelFontSize: parseFloat(getComputedStyle(filenameLabel).fontSize),
      contentFits: contentBottom < footer.getBoundingClientRect().top
    };
  })()`);
  assert.equal(formatsState.backgroundLabel.display, "inline-block");
  assert(
    Math.abs(formatsState.backgroundLabel.centerDelta) < 1,
    JSON.stringify(formatsState.backgroundLabel)
  );
  assert(
    formatsState.backgroundLabel.paddingBottom ===
      formatsState.backgroundLabel.paddingTop
  );
  assert.equal(formatsState.backgroundLabel.textAligned, true);
  assert.equal(formatsState.button.display, "inline-block");
  assert.equal(formatsState.button.verticalAlign, "middle");
  assert(
    Math.abs(formatsState.button.centerDelta) < 1,
    JSON.stringify(formatsState.button)
  );
  assert.equal(formatsState.button.paddingBottom, formatsState.button.paddingTop);
  assert.equal(formatsState.button.textAligned, true);
  assert(
    Math.abs(formatsState.inlineBoxCenterDelta) < 1.5,
    JSON.stringify(formatsState)
  );
  assert.equal(formatsState.headerText, "Theme");
  // beamer@blendedblue = rgb(0.2,0.2,0.7) quantises to 178, not 179.
  assert.equal(formatsState.headerColor, "rgb(51, 51, 178)");
  assert.equal(formatsState.headerBackground, "rgba(0, 0, 0, 0)");
  assert.equal(formatsState.headerBorderWidth, 2);
  assert.equal(formatsState.captionAlign, "center");
  assert.equal(formatsState.codeBorderWidth, 1);
  assert.notEqual(formatsState.codeBackground, "rgba(0, 0, 0, 0)");
  // Inline code is deliberately NOT Quarto's 0.875em: the monospace stack the
  // theme asks for has an x-height about 8% larger than the body face, so at the
  // default size the chip read as bigger than the words around it (measured: a
  // 1.077 x-height ratio against the body, and a chip box whose bottom edge sat
  // 0.2px past its line box). `$code-inline-font-size` is set to 0.8125em, which
  // brings the x-height to parity -- and it has to be that variable, not the
  // shared `$code-font-size`, because Quarto multiplies the latter by 0.875 on
  // its way here. Asserting the RATIO pins the effect rather than the constant:
  // the first attempt at this fix named the shared variable and produced 0.7175.
  assert(
    Math.abs(formatsState.chip.ratio - 0.8125) < 0.01,
    `inline code must render at 0.8125em of the body: ` +
      JSON.stringify(formatsState.chip)
  );
  assert(
    formatsState.chip.fontSize < formatsState.chip.bodyFontSize,
    `inline code must not be larger than the body text: ` +
      JSON.stringify(formatsState.chip)
  );
  assert.notEqual(formatsState.filenameBackground, formatsState.filenameColor);
  assert.equal(formatsState.filenameLabelBorderWidth, 0);
  assert(formatsState.filenameLabelFontSize >= 14);
  assert.equal(formatsState.contentFits, true);
  await formatsPage.screenshot("madrid-content-formats");
  await formatsPage.close();

  const figurePage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/figures-citations`
  );
  const figureState = await figurePage.evaluate(`(() => {
    const slide = document.getElementById("figures-citations");
    const image = slide.querySelector("figure img");
    const caption = slide.querySelector("figcaption");
    const citation = slide.querySelector(".citation a");
    const quote = slide.querySelector("blockquote");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const imageRect = image.getBoundingClientRect();
    return {
      imageComplete: image.complete,
      imageNaturalWidth: image.naturalWidth,
      imageVisible: imageRect.width > 0 && imageRect.height > 0,
      captionText: caption.textContent.trim(),
      captionAlign: getComputedStyle(caption).textAlign,
      citationHref: citation.getAttribute("href"),
      quoteBackground: getComputedStyle(quote).backgroundColor,
      contentFits:
        Math.max(
          caption.getBoundingClientRect().bottom,
          quote.getBoundingClientRect().bottom
        ) < footer.getBoundingClientRect().top
    };
  })()`);
  assert.equal(figureState.imageComplete, true);
  assert.equal(figureState.imageNaturalWidth, 720);
  assert.equal(figureState.imageVisible, true);
  assert.match(figureState.captionText, /Standard normal density/);
  assert.equal(figureState.captionAlign, "center");
  assert.match(figureState.citationHref, /#\/references$/);
  assert.notEqual(figureState.quoteBackground, "rgba(0, 0, 0, 0)");
  assert.equal(figureState.contentFits, true);
  await figurePage.screenshot("madrid-figures-citations");
  await figurePage.close();

  const referencesPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/references`
  );
  const referencesState = await referencesPage.evaluate(`(() => {
    const references = document.querySelector("#references #refs");
    const footer = document.querySelector("#references > .beamer-footline");
    return {
      entries: references.querySelectorAll(".csl-entry").length,
      fontSize: parseFloat(getComputedStyle(references).fontSize),
      contentFits:
        references.getBoundingClientRect().bottom < footer.getBoundingClientRect().top
    };
  })()`);
  assert.equal(referencesState.entries, 1);
  assert(referencesState.fontSize >= 18);
  assert.equal(referencesState.contentFits, true);
  await referencesPage.screenshot("madrid-references");
  await referencesPage.close();

  const orderedPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/ordered-semantics`
  );
  const orderedState = await orderedPage.evaluate(`(() => {
    const values = (selector) =>
      Array.from(document.querySelectorAll(selector + " > li")).map(
        (item) => item.dataset.beamerMarkerValue
      );
    const marker = (selector) => {
      const item = document.querySelector(selector);
      const style = getComputedStyle(item, "::before");
      return {
        backgroundColor: style.backgroundColor,
        borderLeftStyle: style.borderLeftStyle,
        borderLeftWidth: parseFloat(style.borderLeftWidth),
        borderRadius: style.borderRadius
      };
    };
    return {
      start: values("#ordered-start"),
      nested: values("#ordered-nested"),
      explicitValue: values("#ordered-value"),
      reversed: values("#ordered-reversed"),
      topMarker: marker("#ordered-start > li"),
      nestedMarker: marker("#ordered-nested > li")
    };
  })()`);
  assert.deepEqual(orderedState.start, ["3", "4"]);
  assert.deepEqual(orderedState.nested, ["12"]);
  assert.deepEqual(orderedState.explicitValue, ["G", "H"]);
  assert.deepEqual(orderedState.reversed, ["iii", "ii"]);
  assert.notEqual(
    orderedState.topMarker.backgroundColor,
    "rgba(0, 0, 0, 0)",
    JSON.stringify(orderedState)
  );
  assert.equal(
    orderedState.nestedMarker.backgroundColor,
    "rgba(0, 0, 0, 0)",
    JSON.stringify(orderedState)
  );
  assert.equal(orderedState.nestedMarker.borderLeftStyle, "solid");
  assert(orderedState.nestedMarker.borderLeftWidth >= 2.5);
  assert.equal(orderedState.nestedMarker.borderRadius, "0px");
  await orderedPage.screenshot("madrid-ordered-semantics");
  await orderedPage.close();

  const printPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html?print-pdf`
  );
  await printPage.emulateMedia("print");
  const printButtonState = await printPage.evaluate(`(async () => {
    ${visibleInkMeasurementSource}
    const button = document.querySelector("#content-formats .button");
    const textNode = button.querySelector(":scope > .beamer-inline-label-text");
    textNode.style.top = "0.5em";
    window.dispatchEvent(new Event("beforeprint"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const backgroundRect = document
      .querySelector("#content-formats .bg")
      .getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      ink: measureVisibleInk(button, textNode.textContent.trim()),
      correctedTop: textNode.style.top,
      inlineBoxCenterDelta:
        (buttonRect.top + buttonRect.bottom -
          backgroundRect.top - backgroundRect.bottom) /
        2
    };
  })()`);
  assert(
    Math.abs(printButtonState.ink.centerDelta) < 1,
    JSON.stringify(printButtonState)
  );
  assert.notEqual(printButtonState.correctedTop, "0.5em");
  assert(
    Math.abs(printButtonState.inlineBoxCenterDelta) < 1.5,
    JSON.stringify(printButtonState)
  );
  await assertPrintLayout(printPage);
  await printPage.printPdf("madrid-print");
  await printPage.close();
};

const testCambridgeUs = async (connection, origin) => {
  const titlePage = await BrowserPage.create(
    connection,
    `${origin}/cambridgeus.html`
  );
  const titleState = await titlePage.evaluate(`(() => {
    const reveal = document.querySelector(".reveal");
    const slide = document.getElementById("title-slide");
    const box = document.querySelector(".beamer-title-box");
    const title = box.querySelector(".title");
    const headline = slide.querySelector(":scope > .beamer-headline");
    const headlineRect = headline?.getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    const contentRects = Array.from(slide.children)
      .filter(
        (node) =>
          !node.matches(
            ".beamer-headline, .beamer-footline, .aside-footnotes, aside.notes"
          ) && getComputedStyle(node).display !== "none"
      )
      .map((node) => node.getBoundingClientRect());
    const contentCenter =
      (Math.min(...contentRects.map((rect) => rect.top)) +
        Math.max(...contentRects.map((rect) => rect.bottom))) /
      2;
    const availableCenter =
      ((headlineRect?.bottom ?? slideRect.top) + footerRect.top) / 2;
    return {
      classes: reveal.className,
      boxBackground: getComputedStyle(box).backgroundColor,
      boxMarginBottom: parseFloat(getComputedStyle(box).marginBottom),
      boxFontSize: parseFloat(getComputedStyle(box).fontSize),
      authorsTopGap:
        (document
          .querySelector("#title-slide .quarto-title-authors")
          .getBoundingClientRect().top -
          box.getBoundingClientRect().bottom) /
        Math.max(0.0001, window.Reveal.getScale()),
      titleColor: getComputedStyle(title).color,
      display: getComputedStyle(slide).display,
      verticalCenterDelta: contentCenter - availableCenter,
      headlineCount: headline ? 1 : 0,
      headlineVisible:
        Boolean(headlineRect) &&
        getComputedStyle(headline).display !== "none" &&
        headlineRect.top >= -1 &&
        headlineRect.bottom <= window.innerHeight + 1,
      footerVisible:
        footerRect.top >= -1 && footerRect.bottom <= window.innerHeight + 1
    };
  })()`);
  assert.match(titleState.classes, /beamer-cambridgeus/);
  // CambridgeUS keeps no filled title box: transparent background and a
  // tighter gap above the author metadata than Madrid's filled box.
  assert.equal(titleState.boxBackground, "rgba(0, 0, 0, 0)");
  assert(
    Math.abs(
      titleState.boxMarginBottom - titleState.boxFontSize * 0.5
    ) < 0.6,
    JSON.stringify(titleState)
  );
  assert(titleState.authorsTopGap < 24, JSON.stringify(titleState));
  assert.equal(titleState.titleColor, "rgb(204, 0, 0)");
  assert.equal(titleState.headlineCount, 1);
  assert.equal(titleState.headlineVisible, true);
  assert.equal(titleState.display, "flex");
  assert(Math.abs(titleState.verticalCenterDelta) < 12, JSON.stringify(titleState));
  assert.equal(titleState.footerVisible, true);
  await titlePage.screenshot("cambridgeus-title");
  await titlePage.close();

  const sectionPage = await BrowserPage.create(
    connection,
    `${origin}/cambridgeus.html#/theme-palette`
  );
  const sectionState = await sectionPage.evaluate(`(() => {
    const slide = document.getElementById("theme-palette");
    const slideRect = slide.getBoundingClientRect();
    const headlineRect = slide
      .querySelector(":scope > .beamer-headline")
      .getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    // Same frametitle-template contract as Madrid: a full-bleed band pinned
    // directly under the headline, with its text on the body margin.
    const band = slide.querySelector(":scope > h1");
    const bandRect = band.getBoundingClientRect();
    const bandText = document.createRange();
    bandText.selectNodeContents(band);
    const frameTitle = document.querySelector(
      ".slides section.beamer-frame-slide > h2:first-of-type"
    );
    const frameText = document.createRange();
    frameText.selectNodeContents(frameTitle);
    return {
      display: getComputedStyle(slide).display,
      bandLeft: bandRect.left,
      bandTop: bandRect.top,
      bandTextAlign: getComputedStyle(band).textAlign,
      bandTextLeft: bandText.getBoundingClientRect().left,
      frameTitleTextLeft: frameText.getBoundingClientRect().left,
      headlineBottom: headlineRect.bottom,
      contained:
        headlineRect.top >= slideRect.top - 1 &&
        footerRect.bottom <= slideRect.bottom + 1
    };
  })()`);
  assert.equal(sectionState.display, "flex");
  assert(
    Math.abs(sectionState.bandTop - sectionState.headlineBottom) < 1,
    JSON.stringify(sectionState)
  );
  assert.equal(sectionState.bandTextAlign, "left");
  assert.equal(sectionState.bandLeft, 0, JSON.stringify(sectionState));
  assert(
    Math.abs(sectionState.bandTextLeft - sectionState.frameTitleTextLeft) < 1,
    `section title must align with the frame title text: ${JSON.stringify(sectionState)}`
  );
  assert.equal(sectionState.contained, true);
  await sectionPage.screenshot("cambridgeus-section");
  await sectionPage.close();

  const contentPage = await BrowserPage.create(
    connection,
    `${origin}/cambridgeus.html#/cambridge-roles`
  );
  const contentState = await contentPage.evaluate(`(() => {
    const slide = document.getElementById("cambridge-roles");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const footerBoxes = Array.from(footer.querySelectorAll(":scope > span"));
    const style = (selector) => {
      const computed = getComputedStyle(slide.querySelector(selector));
      return { background: computed.backgroundColor, color: computed.color };
    };
    return {
      headlineCount: slide.querySelectorAll(":scope > .beamer-headline").length,
      section: style(".beamer-headline-section"),
      subsection: style(".beamer-headline-subsection"),
      frameTitle: style(":scope > h2"),
      footerAuthor: style(".beamer-footline-author"),
      footerTitle: style(".beamer-footline-title"),
      footerDate: style(".beamer-footline-date"),
      footerBoxCount: footerBoxes.length,
      footerWidths: footerBoxes.map((node) => node.getBoundingClientRect().width),
      author: footer.querySelector(".beamer-footline-author").textContent
    };
  })()`);
  assert.equal(contentState.headlineCount, 1);
  assert.deepEqual(contentState.section, {
    background: "rgb(163, 0, 0)",
    color: "rgb(242, 242, 242)",
  });
  assert.deepEqual(contentState.subsection, {
    background: "rgb(217, 217, 217)",
    color: "rgb(122, 0, 0)",
  });
  assert.deepEqual(contentState.frameTitle, {
    background: "rgb(242, 242, 242)",
    color: "rgb(204, 0, 0)",
  });
  assert.equal(contentState.footerAuthor.background, "rgb(163, 0, 0)");
  assert.equal(contentState.footerTitle.background, "rgb(236, 236, 236)");
  assert.equal(contentState.footerDate.background, "rgb(217, 217, 217)");
  assert.equal(contentState.footerBoxCount, 3);
  assert(
    Math.max(...contentState.footerWidths) - Math.min(...contentState.footerWidths) < 1
  );
  assert.equal(contentState.author, "Test Author (Test Institute)");
  await contentPage.screenshot("cambridgeus-content");
  await contentPage.close();

  const formatsPage = await BrowserPage.create(
    connection,
    `${origin}/cambridgeus.html#/cambridge-formats`
  );
  const formatsState = await formatsPage.evaluate(`(() => {
    ${visibleInkMeasurementSource}
    const slide = document.getElementById("cambridge-formats");
    const header = slide.querySelector("table thead th");
    const label = slide.querySelector(".bg");
    const button = slide.querySelector(".button");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const table = slide.querySelector("table");
    return {
      headerColor: getComputedStyle(header).color,
      headerBackground: getComputedStyle(header).backgroundColor,
      headerBorderWidth: parseFloat(getComputedStyle(header).borderBottomWidth),
      label: measureVisibleInk(label, label.textContent.trim()),
      button: measureVisibleInk(button, button.textContent.trim()),
      contentFits: table.getBoundingClientRect().bottom < footer.getBoundingClientRect().top
    };
  })()`);
  // The table header follows the variant's accent, which beaver sets from
  // palette primary = darkred (204,0,0) -- not structure, and not the darker
  // darkred!80!black used by the footline/headline.
  assert.equal(formatsState.headerColor, "rgb(204, 0, 0)");
  assert.equal(formatsState.headerBackground, "rgba(0, 0, 0, 0)");
  assert.equal(formatsState.headerBorderWidth, 2);
  assert.equal(formatsState.label.display, "inline-block");
  assert(
    Math.abs(formatsState.label.centerDelta) < 1,
    JSON.stringify(formatsState.label)
  );
  assert.equal(formatsState.label.paddingBottom, formatsState.label.paddingTop);
  assert.equal(formatsState.label.textAligned, true);
  assert.equal(formatsState.button.display, "inline-block");
  assert.equal(formatsState.button.verticalAlign, "middle");
  assert(
    Math.abs(formatsState.button.centerDelta) < 1,
    JSON.stringify(formatsState.button)
  );
  assert.equal(formatsState.button.paddingBottom, formatsState.button.paddingTop);
  assert.equal(formatsState.button.textAligned, true);
  assert.equal(formatsState.contentFits, true);
  await formatsPage.screenshot("cambridgeus-content-formats");
  await formatsPage.close();

  const printPage = await BrowserPage.create(
    connection,
    `${origin}/cambridgeus.html?print-pdf`
  );
  await assertPrintLayout(printPage);
  await printPage.printPdf("cambridgeus-print");
  await printPage.close();
};

const testOffline = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/offline.html#/offline-math`
  );
  const state = await page.evaluate(`(() => {
    const slide = document.getElementById("offline-math");
    const runtimeResources = [
      ...Array.from(document.scripts, (script) => script.src),
      ...Array.from(
        document.querySelectorAll('link[rel="stylesheet"]'),
        (link) => link.href
      )
    ].filter((url) => /^https?:/.test(url));
    return {
      inlineRendered: Boolean(slide.querySelector(".math.inline .katex")),
      displayRendered: Boolean(slide.querySelector(".math.display .katex")),
      radicalRendered: Boolean(slide.querySelector(".sqrt svg path")),
      runtimeResources,
      fontLoaded: document.fonts.check(
        '400 30px "Beamerslides Libertinus Sans"'
      )
    };
  })()`);
  assert.equal(state.inlineRendered, true);
  assert.equal(state.displayRendered, true);
  assert.equal(state.radicalRendered, true);
  assert.deepEqual(state.runtimeResources, []);
  assert.equal(state.fontLoaded, true);
  await page.screenshot("offline-mathematics");
  await page.close();
};

const testOptions = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/options.html#/option-frame`
  );
  const state = await page.evaluate(`(() => {
    const reveal = document.querySelector(".reveal");
    const slide = document.getElementById("option-frame");
    const footer = slide.querySelector(":scope > .beamer-footline");
    return {
      classes: reveal.className,
      headlineCount: slide.querySelectorAll(":scope > .beamer-headline").length,
      progressCount: footer.querySelectorAll(".beamer-footline-progress").length,
      progressWidth: footer.querySelector(".beamer-footline-progress")?.getBoundingClientRect().width || 0,
      date: footer.querySelector(".beamer-footline-date-text").textContent
    };
  })()`);
  assert.equal(state.headlineCount, 1);
  assert.equal(state.progressCount, 1);
  assert(state.progressWidth > 0);
  assert.equal(state.date, "Short date");
  await page.screenshot("explicit-options");
  await page.close();
};

const testCentering = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/centering.html#/global-center`
  );
  const state = await page.evaluate(`(() => {
    const slide = document.getElementById("global-center");
    const headingRect = slide
      .querySelector(":scope > h2")
      .getBoundingClientRect();
    const paragraphRect = slide
      .querySelector(":scope > p")
      .getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    return {
      originalCenterClass: slide.classList.contains("center"),
      beamerCenterClass: slide.classList.contains("beamer-center-slide"),
      display: getComputedStyle(slide).display,
      verticalCenterDelta:
        (paragraphRect.top + paragraphRect.bottom) / 2 -
        (headingRect.bottom + footerRect.top) / 2
    };
  })()`);
  assert.equal(state.originalCenterClass, true);
  assert.equal(state.beamerCenterClass, true);
  assert.equal(state.display, "flex");
  assert(Math.abs(state.verticalCenterDelta) < 12, JSON.stringify(state));
  await page.close();
};

const testBehavior = async (connection, origin) => {
  const titlePage = await BrowserPage.create(connection, `${origin}/behavior.html`);
  const titleState = await titlePage.evaluate(`(() => {
    const slide = document.getElementById("title-slide");
    return {
      originalCenterClass: slide.classList.contains("center"),
      beamerCenterClass: slide.classList.contains("beamer-center-slide"),
      display: getComputedStyle(slide).display
    };
  })()`);
  assert.equal(titleState.originalCenterClass, false);
  assert.equal(titleState.beamerCenterClass, false);
  assert.equal(titleState.display, "block");
  await titlePage.close();

  const topPage = await BrowserPage.create(
    connection,
    `${origin}/behavior.html#/top-aligned`
  );
  const topState = await topPage.evaluate(`(() => {
    const overlaps = (first, second) =>
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top;
    const slide = document.getElementById("top-aligned");
    const slideRect = slide.getBoundingClientRect();
    const headingRect = slide.querySelector(":scope > h2").getBoundingClientRect();
    const paragraphRect = slide.querySelector(":scope > p").getBoundingClientRect();
    const headlineRect = slide
      .querySelector(":scope > .beamer-headline")
      ?.getBoundingClientRect();
    const footer = slide.querySelector(":scope > .beamer-footline");
    const footerRect = footer.getBoundingClientRect();
    const logoRect = document.querySelector(".slide-logo")?.getBoundingClientRect();
    const menu = document.querySelector(".slide-menu-button");
    const menuRect = menu.getBoundingClientRect();
    const nativeProgress = document.querySelector(".reveal > .progress");
    const nativeNumber = document.querySelector(".reveal > .slide-number");
    return {
      beamerCenterClass: slide.classList.contains("beamer-center-slide"),
      display: getComputedStyle(slide).display,
      bodyNearTop: paragraphRect.top < (headingRect.bottom + footerRect.top) / 2,
      menuVisible: menuRect.width > 0 && menuRect.height > 0,
      menuInsideSlide:
        menuRect.left >= slideRect.left - 1 && menuRect.right <= slideRect.right + 1,
      menuOverlapsHeading: overlaps(menuRect, headingRect),
      menuOverlapsHeadline: headlineRect ? overlaps(menuRect, headlineRect) : false,
      menuOverlapsFooter: overlaps(menuRect, footerRect),
      menuOverlapsLogo:
        logoRect && logoRect.width > 0 ? overlaps(menuRect, logoRect) : false,
      nativeProgressDisplay: getComputedStyle(nativeProgress).display,
      nativeNumberDisplay: getComputedStyle(nativeNumber).display,
      customProgressCount: footer.querySelectorAll(".beamer-footline-progress").length,
      customNumber: footer.querySelector(".beamer-footline-number").textContent
    };
  })()`);
  assert.equal(topState.beamerCenterClass, false);
  assert.equal(topState.display, "block");
  assert.equal(topState.bodyNearTop, true);
  assert.equal(topState.menuVisible, true);
  assert.equal(topState.menuInsideSlide, true);
  assert.equal(topState.menuOverlapsHeading, false);
  assert.equal(topState.menuOverlapsHeadline, false);
  assert.equal(topState.menuOverlapsFooter, false);
  assert.equal(topState.menuOverlapsLogo, false);
  assert.equal(topState.nativeProgressDisplay, "none");
  assert.equal(topState.nativeNumberDisplay, "none");
  assert.equal(topState.customProgressCount, 1);
  assert.equal(topState.customNumber, "3 / 5");
  await topPage.close();

  // Levels 3-6 are themed by this extension and had no coverage at all before
  // this fixture rendered them: h4 took `--beamer-alert`, which under Madrid is
  // `#ff0000` at 3.93:1 against the light slide, and h5/h6 were never defined,
  // so they fell through to Reveal's single-size heading rule and rendered
  // larger than h3.
  const headingPage = await BrowserPage.create(
    connection,
    `${origin}/behavior.html#/top-aligned`
  );
  const headingState = await headingPage.evaluate(`(() => {
    const slide = document.getElementById("top-aligned");
    const slideStyle = getComputedStyle(slide);
    // The custom property is a hex literal while getComputedStyle reports
    // "rgb(r, g, b)", so both sides go through the same parser before they are
    // compared.
    const parseRgb = (value) => {
      const text = String(value).trim();
      const hex = text.match(/^#([0-9a-f]{6})$/i);
      if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      const parts = text.match(/[\\d.]+/g);
      return parts ? parts.slice(0, 3).map(Number) : null;
    };
    const relativeLuminance = (value) => {
      const rgb = parseRgb(value);
      if (!rgb) return null;
      const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (foreground, background) => {
      const a = relativeLuminance(foreground);
      const b = relativeLuminance(background);
      if (a === null || b === null) return null;
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    // The slide itself has no background colour; walk up to the first ancestor
    // that paints one, which is where the slide actually sits.
    const opaqueBackground = (element) => {
      let node = element;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        if (value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const bodyBackground = opaqueBackground(slide);
    const levels = {};
    for (const tag of ["h3", "h4", "h5", "h6"]) {
      const el = slide.querySelector(":scope > " + tag);
      if (!el) continue;
      const style = getComputedStyle(el);
      levels[tag] = {
        color: style.color,
        rgb: parseRgb(style.color),
        fontSize: parseFloat(style.fontSize),
        contrast: contrastRatio(style.color, bodyBackground)
      };
    }
    return {
      structureRgb: parseRgb(slideStyle.getPropertyValue("--beamer-structure")),
      bodyBackground,
      levels
    };
  })()`);
  // Every explicitly themed level is pinned: colour, AA contrast, and the
  // descending size ladder (h3 > h4 > h5 > h6). The ladder assertion is what
  // stops h5/h6 from silently falling back to Reveal's single heading size and
  // rendering larger than h3.
  let previousSize = null;
  for (const tag of ["h3", "h4", "h5", "h6"]) {
    const level = headingState.levels[tag];
    assert(level, `${tag} must be present on the fixture slide`);
    assert.deepEqual(
      level.rgb,
      headingState.structureRgb,
      `${tag} must use the variant's structure colour: ` + JSON.stringify(headingState)
    );
    assert(
      level.contrast >= 4.5,
      `${tag} must reach 4.5:1 against the slide background: ` +
        JSON.stringify({ tag, ...level, bg: headingState.bodyBackground })
    );
    if (previousSize !== null) {
      assert(
        level.fontSize < previousSize,
        `${tag} must be smaller than the level above it: ` +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(headingState.levels).map(([k, v]) => [k, v.fontSize])
            )
          )
      );
    }
    previousSize = level.fontSize;
  }
  await headingPage.close();

  const centeredPage = await BrowserPage.create(
    connection,
    `${origin}/behavior.html#/per-page-center`
  );
  const centeredState = await centeredPage.evaluate(`(() => {
    const slide = document.getElementById("per-page-center");
    const headingRect = slide.querySelector(":scope > h2").getBoundingClientRect();
    const paragraphRect = slide.querySelector(":scope > p").getBoundingClientRect();
    const footer = slide.querySelector(":scope > .beamer-footline");
    const footerRect = footer.getBoundingClientRect();
    return {
      originalCenterClass: slide.classList.contains("center"),
      beamerCenterClass: slide.classList.contains("beamer-center-slide"),
      display: getComputedStyle(slide).display,
      verticalCenterDelta:
        (paragraphRect.top + paragraphRect.bottom) / 2 -
        (headingRect.bottom + footerRect.top) / 2,
      progressWidth: footer
        .querySelector(".beamer-footline-progress")
        .getBoundingClientRect().width
    };
  })()`);
  assert.equal(centeredState.originalCenterClass, true);
  assert.equal(centeredState.beamerCenterClass, true);
  assert.equal(centeredState.display, "flex");
  assert(
    Math.abs(centeredState.verticalCenterDelta) < 12,
    JSON.stringify(centeredState)
  );
  await centeredPage.close();

  const optionalPage = await BrowserPage.create(
    connection,
    `${origin}/behavior.html#/optional-material`
  );
  const optionalState = await optionalPage.evaluate(`(() => {
    const slide = document.getElementById("optional-material");
    const footer = slide.querySelector(":scope > .beamer-footline");
    return {
      visibility: slide.dataset.visibility,
      // There is no marker class for an uncounted slide, so assert the rendered
      // consequences instead. The page number is the real one: numberCount is
      // 0 here, and the next slide reports "5 / 5" rather than "6 / 6", which is
      // what proves the uncounted slide was left out of the count. The progress
      // rule is injected at runtime rather than present in the rendered HTML, so
      // the comparison below is against the previous slide's bar width.
      numberCount: footer.querySelectorAll(".beamer-footline-number").length,
      progressWidth: footer
        .querySelector(".beamer-footline-progress")
        .getBoundingClientRect().width
    };
  })()`);
  assert.equal(optionalState.visibility, "uncounted");
  assert.equal(optionalState.numberCount, 0);
  assert(
    Math.abs(optionalState.progressWidth - centeredState.progressWidth) < 1,
    JSON.stringify({ centeredState, optionalState })
  );
  await optionalPage.close();

  const finalPage = await BrowserPage.create(
    connection,
    `${origin}/behavior.html#/final-counted`
  );
  const finalState = await finalPage.evaluate(`(() => {
    const slide = document.getElementById("final-counted");
    const footer = slide.querySelector(":scope > .beamer-footline");
    return {
      number: footer.querySelector(".beamer-footline-number").textContent,
      progressWidth: footer
        .querySelector(".beamer-footline-progress")
        .getBoundingClientRect().width,
      footerWidth: footer.getBoundingClientRect().width
    };
  })()`);
  assert.equal(finalState.number, "5 / 5");
  assert(Math.abs(finalState.progressWidth - finalState.footerWidth) < 1);
  await finalPage.close();
};

const testFourThreeViewport = async (connection, origin) => {
  const listsPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/lists`,
    { width: 1024, height: 768 }
  );
  const listsState = await listsPage.evaluate(`(() => {
    ${visibleInkMeasurementSource}
    const item = document.querySelector("#lists ol > li");
    const marker = getComputedStyle(item, "::before");
    return {
      aligned: item.dataset.beamerMarkerAligned === "true",
      ink: measureVisibleInk(item, "1", "::before"),
      paddingBottom: parseFloat(marker.paddingBottom)
    };
  })()`);
  assert.equal(listsState.aligned, true);
  assert(listsState.paddingBottom > 0);
  assert(
    Math.abs(listsState.ink.centerDelta) < 1,
    JSON.stringify(listsState.ink)
  );
  await listsPage.screenshot("madrid-lists-4x3");
  await listsPage.close();

  const longTitlePage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/long-title`,
    { width: 1024, height: 768 }
  );
  const state = await longTitlePage.evaluate(`(() => {
    const slide = document.getElementById("long-title");
    const heading = slide.querySelector(":scope > h2");
    const paragraph = slide.querySelector(":scope > p");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const headingRect = heading.getBoundingClientRect();
    const paragraphRect = paragraph.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      titleFits: heading.scrollHeight <= heading.clientHeight + 1,
      bodyBelowTitle: paragraphRect.top >= headingRect.bottom,
      footerVisible: footerRect.bottom <= window.innerHeight + 1,
      footerBoxes: Array.from(footer.querySelectorAll(":scope > span")).map(
        (node) => node.getBoundingClientRect().width
      )
    };
  })()`);
  assert.equal(state.titleFits, true);
  assert.equal(state.bodyBelowTitle, true);
  assert.equal(state.footerVisible, true);
  assert.equal(state.footerBoxes.length, 3);
  assert(Math.max(...state.footerBoxes) - Math.min(...state.footerBoxes) < 1);
  await longTitlePage.screenshot("madrid-long-title-4x3");
  await longTitlePage.close();

  const mathPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/mathematics`,
    { width: 1024, height: 768 }
  );
  const mathState = await mathPage.evaluate(`(() => {
    const slide = document.getElementById("mathematics");
    const formula = slide.querySelector(".math.display .katex-html");
    const radical = formula.querySelector(".sqrt svg path");
    const formulaRect = formula.getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    return {
      radicalRendered: Boolean(radical),
      formulaVisible:
        formulaRect.left >= 0 &&
        formulaRect.right <= window.innerWidth &&
        formulaRect.top >= 0 &&
        formulaRect.bottom <= footerRect.top
    };
  })()`);
  assert.equal(mathState.radicalRendered, true);
  assert.equal(mathState.formulaVisible, true);
  await mathPage.screenshot("madrid-mathematics-4x3");
  await mathPage.close();

  const formatsPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html#/content-formats`,
    { width: 1024, height: 768 }
  );
  const formatsState = await formatsPage.evaluate(`(() => {
    ${visibleInkMeasurementSource}
    const slide = document.getElementById("content-formats");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const label = slide.querySelector(".bg");
    const button = slide.querySelector(".button");
    const contentBottom = Math.max(
      slide.querySelector("table").getBoundingClientRect().bottom,
      slide.querySelector(".code-with-filename").getBoundingClientRect().bottom
    );
    return {
      contentFits: contentBottom < footer.getBoundingClientRect().top,
      tableFits: slide.querySelector("table").getBoundingClientRect().right <= window.innerWidth,
      codeFits:
        slide.querySelector(".code-with-filename").getBoundingClientRect().right <=
        window.innerWidth,
      labelInk: measureVisibleInk(label, label.textContent.trim()),
      buttonInk: measureVisibleInk(button, button.textContent.trim())
    };
  })()`);
  assert.equal(formatsState.contentFits, true);
  assert.equal(formatsState.tableFits, true);
  assert.equal(formatsState.codeFits, true);
  assert(
    Math.abs(formatsState.labelInk.centerDelta) < 1,
    JSON.stringify(formatsState.labelInk)
  );
  assert(
    Math.abs(formatsState.buttonInk.centerDelta) < 1,
    JSON.stringify(formatsState.buttonInk)
  );
  await formatsPage.screenshot("madrid-content-formats-4x3");
  await formatsPage.close();
};

const testSpacingVariant = async (connection, origin, variant) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/spacing-${variant}.html`
  );
  const state = await page.evaluate(`(async () => {
    const frame = () => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    const show = async (id) => {
      const slide = document.getElementById(id);
      const indices = window.Reveal.getIndices(slide);
      window.Reveal.slide(indices.h, indices.v);
      await frame();
      return slide;
    };
    const number = (value) => Number.parseFloat(value) || 0;
    const scale = () => Math.max(0.0001, window.Reveal.getScale());
    const codeBlockSelector =
      ":scope > .code-copy-outer-scaffold, :scope > .sourceCode, :scope > pre";
    const frameGap = (slide, element) => {
      const heading = slide.querySelector(":scope > h2");
      return (
        element.getBoundingClientRect().top - heading.getBoundingClientRect().bottom
      ) / scale();
    };
    const firstGap = async (id, selector) => {
      const slide = await show(id);
      const element = slide.querySelector(selector);
      if (!element) {
        const children = Array.from(slide.children)
          .map(
            (child) =>
              child.tagName.toLowerCase() +
              (child.id ? "#" + child.id : "." + child.className)
          )
          .join(", ");
        throw new Error(
          "Missing spacing target " +
            selector +
            " in #" +
            id +
            "; direct children: " +
            children
        );
      }
      return frameGap(slide, element);
    };
    const columnState = async (id) => {
      const slide = await show(id);
      const columns = slide.querySelector(":scope > .columns");
      const items = Array.from(columns.children);
      const columnsRect = columns.getBoundingClientRect();
      const itemRects = items.map((item) => item.getBoundingClientRect());
      return {
        display: getComputedStyle(columns).display,
        computedGap: number(getComputedStyle(columns).gap),
        actualGap: (itemRects[1].left - itemRects[0].right) / scale(),
        widths: itemRects.map((rect) => rect.width / scale()),
        contained:
          itemRects[0].left >= columnsRect.left - 0.5 &&
          itemRects.at(-1).right <= columnsRect.right + 0.5
      };
    };

    const firstContentGaps = {
      paragraph: await firstGap("paragraph-first", ":scope > p"),
      list: await firstGap("list-first", ":scope > ul"),
      code: await firstGap("code-first", codeBlockSelector),
      callout: await firstGap("callout-first", ":scope > .callout"),
      columns: await firstGap("equal-columns", ":scope > .columns")
    };

    let slide = await show("list-first");
    const unordered = slide.querySelector(":scope > ul");
    const unorderedItems = [
      unordered.querySelector(":scope > li"),
      unordered.querySelector(":scope > li > ul > li"),
      unordered.querySelector(":scope > li > ul > li > ul > li")
    ];
    const unorderedMarkers = unorderedItems.map((item) => {
      const style = getComputedStyle(item, "::before");
      return {
        width: number(style.width),
        height: number(style.height),
        backgroundColor: style.backgroundColor,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: number(style.borderTopWidth)
      };
    });

    slide = await show("list-columns");
    const taskItem = slide.querySelector("ul.task-list > li");
    const taskMarker = getComputedStyle(taskItem, "::before");
    const taskList = {
      checkboxPresent: Boolean(taskItem.querySelector("input[type='checkbox']")),
      markerContent: taskMarker.content
    };

    slide = await show("panel-tabset");
    const tabList = slide.querySelector(".panel-tabset-tabby");
    const tabItem = tabList.querySelector("li");
    const tabListStyle = getComputedStyle(tabList);
    const tabItemStyle = getComputedStyle(tabItem);
    const tabMarkerStyle = getComputedStyle(tabItem, "::before");
    const tabset = {
      paddingLeft: number(tabListStyle.paddingLeft),
      marginTop: number(tabListStyle.marginTop),
      marginBottom: number(tabListStyle.marginBottom),
      itemMarginTop: number(tabItemStyle.marginTop),
      itemMarginBottom: number(tabItemStyle.marginBottom),
      markerContent: tabMarkerStyle.content,
      markerDisplay: tabMarkerStyle.display
    };

    slide = await show("footnote");
    const footnoteList = slide.querySelector(".aside-footnotes");
    const footnoteItem = footnoteList.querySelector("li");
    const footline = slide.querySelector(":scope > .beamer-footline");
    const footnoteMarker = getComputedStyle(footnoteItem, "::before");
    const footnote = {
      gapAboveFootline:
        (footline.getBoundingClientRect().top -
          footnoteList.getBoundingClientRect().bottom) /
        scale(),
      markerContent: footnoteMarker.content,
      markerDisplay: footnoteMarker.display
    };

    const equalColumns = await columnState("equal-columns");
    const listColumns = await columnState("list-columns");
    const proportionalColumns = await columnState("proportional-columns");

    slide = await show("code-first");
    const sourceCode = slide.querySelector("div.sourceCode");
    if (!sourceCode) {
      throw new Error("Missing source code element in #code-first");
    }
    const sourceStyle = getComputedStyle(sourceCode);
    const codeWrapper = slide.querySelector(codeBlockSelector);
    if (!codeWrapper) {
      throw new Error("Missing code block wrapper in #code-first");
    }
    const slideStyle = getComputedStyle(slide);
    const availableWidth =
      slide.offsetWidth -
      number(slideStyle.paddingLeft) -
      number(slideStyle.paddingRight);
    const code = {
      boxSizing: sourceStyle.boxSizing,
      overflow:
        sourceCode.getBoundingClientRect().width / scale() - availableWidth,
      wrapperMarginBottom: number(getComputedStyle(codeWrapper).marginBottom)
    };

    slide = await show("callout-first");
    const callout = slide.querySelector(":scope > .callout");
    const calloutStyle = getComputedStyle(callout);
    const calloutState = {
      fontSize: number(calloutStyle.fontSize),
      marginBottom: number(calloutStyle.marginBottom)
    };

    slide = await show("title-slide");
    const title = slide.querySelector(".beamer-title-box .title");
    const titleStyle = getComputedStyle(title);
    const authors = slide.querySelector(".quarto-title-authors");
    const authorRects = Array.from(authors.children).map((author) =>
      author.getBoundingClientRect()
    );
    const slideRect = slide.getBoundingClientRect();
    const authorRows = new Set(
      authorRects.map((rect) => Math.round(rect.top / scale()))
    ).size;
    const titleState = {
      hasSubtitle: Boolean(slide.querySelector(".subtitle")),
      paddingTop: number(titleStyle.paddingTop),
      paddingBottom: number(titleStyle.paddingBottom),
      authorRows,
      authorsContained:
        Math.min(...authorRects.map((rect) => rect.left)) >= slideRect.left - 0.5 &&
        Math.max(...authorRects.map((rect) => rect.right)) <= slideRect.right + 0.5
    };

    return {
      revealClasses: document.querySelector(".reveal").className,
      firstContentGaps,
      unorderedMarkers,
      taskList,
      tabset,
      footnote,
      equalColumns,
      listColumns,
      proportionalColumns,
      code,
      callout: calloutState,
      title: titleState
    };
  })()`);

  assert.match(state.revealClasses, new RegExp(`beamer-${variant}`));
  const [firstMarker, secondMarker, thirdMarker] = state.unorderedMarkers;
  assert(
    Math.abs(firstMarker.width - firstMarker.height) < 0.5,
    JSON.stringify(state.unorderedMarkers)
  );
  assert.notEqual(firstMarker.backgroundColor, "rgba(0, 0, 0, 0)");
  assert(
    secondMarker.width > secondMarker.height * 3,
    JSON.stringify(state.unorderedMarkers)
  );
  assert.notEqual(secondMarker.backgroundColor, "rgba(0, 0, 0, 0)");
  assert(
    Math.abs(thirdMarker.width - thirdMarker.height) < 0.5,
    JSON.stringify(state.unorderedMarkers)
  );
  assert.equal(thirdMarker.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(thirdMarker.borderTopStyle, "solid");
  assert(thirdMarker.borderTopWidth >= 1.5);
  assert.equal(state.taskList.checkboxPresent, true);
  assert.equal(state.taskList.markerContent, "none", JSON.stringify(state.taskList));

  assert.equal(state.tabset.paddingLeft, 0, JSON.stringify(state.tabset));
  assert.equal(state.tabset.marginTop, 0, JSON.stringify(state.tabset));
  assert.equal(state.tabset.marginBottom, 0, JSON.stringify(state.tabset));
  assert.equal(state.tabset.itemMarginTop, 0, JSON.stringify(state.tabset));
  assert.equal(state.tabset.itemMarginBottom, 0, JSON.stringify(state.tabset));
  assert.equal(state.tabset.markerContent, "none", JSON.stringify(state.tabset));
  assert.notEqual(state.tabset.markerDisplay, "block", JSON.stringify(state.tabset));

  assert(state.footnote.gapAboveFootline >= 8, JSON.stringify(state.footnote));
  assert.notEqual(state.footnote.markerContent, '"1"', JSON.stringify(state.footnote));
  assert.notEqual(state.footnote.markerDisplay, "flex", JSON.stringify(state.footnote));

  for (const columns of [
    state.equalColumns,
    state.listColumns,
    state.proportionalColumns,
  ]) {
    assert.equal(columns.display, "flex", JSON.stringify(columns));
    assert(Math.abs(columns.computedGap - 33) < 0.5, JSON.stringify(columns));
    assert(Math.abs(columns.actualGap - 33) < 1, JSON.stringify(columns));
    assert.equal(columns.contained, true, JSON.stringify(columns));
  }
  assert(
    Math.abs(state.equalColumns.widths[0] - state.equalColumns.widths[1]) < 1,
    JSON.stringify(state.equalColumns)
  );
  const proportionalRatio =
    state.proportionalColumns.widths[0] / state.proportionalColumns.widths[1];
  assert(proportionalRatio > 1.25 && proportionalRatio < 1.32, proportionalRatio);

  assert.equal(state.code.boxSizing, "border-box", JSON.stringify(state.code));
  assert(state.code.overflow <= 0.5, JSON.stringify(state.code));
  assert(state.code.wrapperMarginBottom >= 17, JSON.stringify(state.code));

  assert(Math.abs(state.callout.fontSize - 25.2) < 0.2, JSON.stringify(state.callout));
  assert(state.callout.marginBottom >= 17, JSON.stringify(state.callout));

  const gaps = Object.values(state.firstContentGaps);
  assert(Math.max(...gaps) - Math.min(...gaps) < 3, JSON.stringify(gaps));
  for (const gap of gaps) {
    assert(Math.abs(gap - 22) < 2, JSON.stringify(gaps));
  }

  assert.equal(state.title.hasSubtitle, false);
  assert(
    state.title.paddingBottom >= state.title.paddingTop * 0.75,
    JSON.stringify(state.title)
  );
  assert(state.title.authorRows >= 2, JSON.stringify(state.title));
  assert.equal(state.title.authorsContained, true, JSON.stringify(state.title));

  if (variant === "madrid") {
    for (const [id, name] of [
      ["title-slide", "spacing-madrid-title"],
      ["panel-tabset", "spacing-madrid-tabset"],
      ["footnote", "spacing-madrid-footnote"],
      ["equal-columns", "spacing-madrid-columns"],
      ["list-columns", "spacing-madrid-list-columns"],
    ]) {
      await showSlide(page, id);
      await page.screenshot(name);
    }
  }
  await page.close();

  const printPage = await BrowserPage.create(
    connection,
    `${origin}/spacing-${variant}.html?print-pdf`
  );
  await printPage.emulateMedia("print");
  const printFootnoteGap = await printPage.evaluate(`(() => {
    const slide = document.getElementById("footnote");
    const footnote = slide.querySelector(".aside-footnotes").getBoundingClientRect();
    const footline = slide
      .querySelector(":scope > .beamer-footline")
      .getBoundingClientRect();
    const scale = Math.max(0.0001, window.Reveal.getScale());
    return (footline.top - footnote.bottom) / scale;
  })()`);
  assert(printFootnoteGap >= 8, printFootnoteGap);
  await assertPrintLayout(printPage);
  await printPage.close();
};

const testSpacing = async (connection, origin) => {
  await testSpacingVariant(connection, origin, "madrid");
  await testSpacingVariant(connection, origin, "cambridgeus");
};

// The `?print-pdf` query switches Reveal into its print layout, and the
// document footnote section is only built as part of that. Reading it the
// moment the page reports ready sometimes beats the switch; the same page has
// it a moment later. Retrying the read is enough -- a page that genuinely
// lacks the section still fails every attempt.
const footnoteStateAttempts = 5;

const readDocumentFootnoteStateWithRetry = async (page, context) => {
  let state = null;
  for (let attempt = 1; attempt <= footnoteStateAttempts; attempt += 1) {
    state = await page.evaluate(readDocumentFootnoteState);
    if (state.slidePresent) {
      return state;
    }
    if (attempt < footnoteStateAttempts) {
      await delay(200 * attempt);
    }
  }
  assert.equal(
    state.slidePresent,
    true,
    `${context}: footnote slide (after ${footnoteStateAttempts} reads)`
  );
};

const readDocumentFootnoteState = `(() => {
  const slide = document.querySelector("section.footnotes");
  // A scrollable slide keeps its chrome still by moving the body into a
  // \`.beamer-scroll\` layer, so the footnote list may be one level down. The
  // list itself is unchanged by that.
  const scope = slide?.querySelector(":scope > .beamer-scroll") || slide;
  const list = scope?.querySelector(":scope > ol");
  const item = list?.querySelector(":scope > li");
  const marker = item ? getComputedStyle(item, "::before") : null;
  return {
    slidePresent: Boolean(slide),
    listPresent: Boolean(list),
    itemText: item?.textContent.trim() || "",
    hasMarkerValue: Boolean(item?.dataset.beamerMarkerValue),
    listStyleType: list ? getComputedStyle(list).listStyleType : null,
    markerContent: marker?.content || null,
    markerDisplay: marker?.display || null,
    markerPosition: marker?.position || null,
    markerBackground: marker?.backgroundColor || null,
    markerBorderRadius: marker?.borderRadius || null
  };
})()`;

const assertDocumentFootnoteState = (state, context) => {
  assert.equal(state.slidePresent, true, `${context}: footnote slide`);
  assert.equal(state.listPresent, true, `${context}: footnote list`);
  assert.match(state.itemText, /Footnote content with descenders/, context);
  assert.equal(state.hasMarkerValue, false, `${context}: custom marker data`);
  assert.equal(state.listStyleType, "none", `${context}: list style`);
  assert.match(state.markerContent, /counter\(ol\)/, `${context}: native marker`);
  assert.equal(state.markerDisplay, "inline", `${context}: marker display`);
  assert.equal(state.markerPosition, "static", `${context}: marker position`);
  assert.equal(
    state.markerBackground,
    "rgba(0, 0, 0, 0)",
    `${context}: marker background`
  );
  assert.equal(state.markerBorderRadius, "0px", `${context}: marker shape`);
};

const testDocumentFootnotesVariant = async (connection, origin, variant) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/spacing-endnotes-${variant}.html`
  );
  const state = await readDocumentFootnoteStateWithRetry(
    page,
    `${variant} screen`
  );
  assertDocumentFootnoteState(state, `${variant} screen`);

  if (variant === "madrid") {
    await showSlide(page, "footnotes");
    await page.screenshot("spacing-madrid-endnotes");
  }
  await page.close();

  const printPage = await BrowserPage.create(
    connection,
    `${origin}/spacing-endnotes-${variant}.html?print-pdf`
  );
  await printPage.emulateMedia("print");
  const printState = await readDocumentFootnoteStateWithRetry(
    printPage,
    `${variant} print`
  );
  assertDocumentFootnoteState(printState, `${variant} print`);
  await assertPrintLayout(printPage);
  await printPage.close();
};

const testDocumentFootnotes = async (connection, origin) => {
  await testDocumentFootnotesVariant(connection, origin, "madrid");
  await testDocumentFootnotesVariant(connection, origin, "cambridgeus");
};

// The chrome must be injected before Reveal paints, otherwise the first frames
// show slides without the Beamer headline/footline.
const testInjectionTiming = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/madrid.html`,
    undefined,
    {
      preloadScript: `(() => {
        window.__beamerTimeline = {
          footlineAt: null,
          readyAt: null,
          readyFrames: 0,
          bareFrames: 0,
          bareFrameAt: null
        };
        const mark = (key) => {
          if (window.__beamerTimeline[key] === null) {
            window.__beamerTimeline[key] = performance.now();
          }
        };
        const tick = () => {
          const reveal = document.querySelector(".reveal");
          const ready = Boolean(reveal && reveal.classList.contains("ready"));
          const footline = Boolean(document.querySelector(".reveal .beamer-footline"));
          if (ready) {
            window.__beamerTimeline.readyFrames += 1;
            if (!footline) {
              window.__beamerTimeline.bareFrames += 1;
              if (window.__beamerTimeline.bareFrameAt === null) {
                window.__beamerTimeline.bareFrameAt = performance.now();
              }
            }
          }
          // Keep observing until the first ready frame plus 30 more, so a slow
          // renderer cannot end the window before the deck ever paints ready
          // (which would make the bare-frame check pass vacuously).
          if (window.__beamerTimeline.readyFrames < 30) {
            requestAnimationFrame(tick);
          }
        };
        // Diagnostics only: mutation timestamps cannot express the ordering the
        // deck must respect, because a mutation callback may observe Reveal's
        // ready class one microtask before the chrome injection that the same
        // microtask checkpoint performs. Only the frame timeline shows what
        // actually reached the screen.
        const observer = new MutationObserver(() => {
          if (document.querySelector(".reveal .beamer-footline")) mark("footlineAt");
          if (document.querySelector(".reveal.ready")) mark("readyAt");
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"]
        });
        requestAnimationFrame(tick);
      })();`,
    }
  );
  const state = await page.evaluate(`(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const timeline = window.__beamerTimeline;
    return {
      footlineAt: timeline.footlineAt,
      readyAt: timeline.readyAt,
      readyFrames: timeline.readyFrames,
      bareFrames: timeline.bareFrames,
      bareFrameAt: timeline.bareFrameAt,
      footlineCount: document.querySelectorAll(".beamer-footline").length
    };
  })()`);
  assert(state.footlineCount > 0, "expected footlines to be injected");
  assert(
    Number.isFinite(state.footlineAt) && Number.isFinite(state.readyAt),
    `timeline incomplete: ${JSON.stringify(state)}`
  );
  assert(
    state.readyFrames > 0,
    `the deck never painted as ready: ${JSON.stringify(state)}`
  );
  assert.equal(
    state.bareFrames,
    0,
    `no frame may paint a ready deck without its footline: ${JSON.stringify(state)}`
  );
  await page.close();
};

// Documented behaviour: unknown option values warn and fall back safely.
const testInvalidOptions = async (connection, origin) => {
  const stderr = renderFixture("invalid");
  assert.match(stderr, /Unknown beamer-variant 'bogus'; using 'madrid'\./);
  assert.match(stderr, /Unknown beamer-secheader value 'maybe'; ignoring it\./);
  assert.match(stderr, /Unknown beamer-progress value 'nonsense'; ignoring it\./);

  const page = await BrowserPage.create(connection, `${origin}/invalid.html`);
  const state = await page.evaluate(`(() => {
    const slide = document.getElementById("defaulted");
    return {
      classes: document.querySelector(".reveal").className,
      variantMeta: document.querySelector('meta[name="beamer-variant"]').content,
      headlineCount: document.querySelectorAll("section.beamer-leaf-slide > .beamer-headline").length,
      progressCount: document.querySelectorAll(".beamer-footline-progress").length,
      slideCount: document.querySelectorAll("section.beamer-leaf-slide").length,
      hasFootline: Boolean(slide.querySelector(":scope > .beamer-footline"))
    };
  })()`);
  assert.match(state.classes, /beamer-madrid/);
  assert.equal(state.variantMeta, "madrid");
  assert.equal(state.headlineCount, 0);
  assert.equal(state.progressCount, 0);
  assert.equal(state.slideCount, 3);
  assert.equal(state.hasFootline, true);
  await page.close();
};

// An overfull frame is silently clipped by CSS, so the theme has to report it.
const consoleWarningCaptureSource = `(() => {
  window.__beamerWarnings = [];
  const warn = console.warn;
  console.warn = function (...args) {
    window.__beamerWarnings.push(args.join(" "));
    warn.apply(console, args);
  };
})();`;

const testOverflowDiagnostics = async (connection, origin) => {
  renderFixture("overflow");
  const page = await BrowserPage.create(
    connection,
    `${origin}/overflow.html`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  const state = await page.evaluate(`(async () => {
    const wait = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visit = async (id) => {
      const indices = window.Reveal.getIndices(document.getElementById(id));
      window.Reveal.slide(indices.h, indices.v, 0);
      await wait();
      await wait();
    };
    // Both frames must actually be laid out: an unvisited slide is never
    // measured, which would make the "scrollable stays silent" check vacuous.
    await visit("overfull");
    await visit("scrollable-frame");
    await visit("overfull");
    const slide = document.getElementById("overfull");
    const scrollable = document.getElementById("scrollable-frame");
    // A scrollable frame keeps its chrome still by moving the body into a
    // \`.beamer-scroll\` layer, so that layer is what overflows now -- the frame
    // itself no longer does. Measure whichever element actually scrolls.
    const scrollBody =
      scrollable.querySelector(":scope > .beamer-scroll") || scrollable;
    const overflowBody = slide.querySelector(":scope > .beamer-scroll") || slide;
    return {
      warnings: window.__beamerWarnings,
      overflows: overflowBody.scrollHeight > overflowBody.clientHeight + 2,
      overflowBy: overflowBody.scrollHeight - overflowBody.clientHeight,
      scrollableOverflow: scrollBody.scrollHeight - scrollBody.clientHeight
    };
  })()`);
  assert.equal(state.overflows, true, "fixture must actually overflow");
  assert(
    state.scrollableOverflow > 2,
    `the scrollable fixture must overflow for the silence check to mean anything: ${JSON.stringify(state)}`
  );
  assert.equal(
    state.warnings.filter((warning) => warning.includes("#overfull")).length,
    1,
    `expected exactly one warning for #overfull: ${JSON.stringify(state)}`
  );
  assert.match(state.warnings.join("\n"), /#overfull overflows its content area by \d+px/);
  assert.doesNotMatch(
    state.warnings.join("\n"),
    /scrollable-frame/,
    "a `.scrollable` frame must not warn"
  );

  // Scrolling a `.scrollable` frame must not carry its chrome away. The frame
  // used to be the scroll container itself, and because the headline/footline are
  // its absolutely-positioned children they scrolled with the content: the
  // footline moved from top:690 to top:490 and permanently covered the last line.
  // Nothing asserted this before, which is why the bug survived.
  const scrollPage = await BrowserPage.create(
    connection,
    `${origin}/overflow.html#/scrollable-frame`
  );
  const scrollState = await scrollPage.evaluate(`(() => {
    const slide = document.getElementById("scrollable-frame");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const body = slide.querySelector(":scope > .beamer-scroll") || slide;
    const before = footer.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    const footerRect = footer.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    // The last piece of content must not end up permanently hidden behind the
    // footline once the frame is scrolled to the end.
    const blocks = Array.from(
      body.querySelectorAll("p, ul, ol, h1, h2, h3, h4, h5, h6, table, pre")
    );
    const last = blocks.length ? blocks[blocks.length - 1].getBoundingClientRect() : null;
    return {
      scrolled: Math.round(body.scrollTop),
      footerTopBefore: Math.round(before),
      footerTopAfter: Math.round(footerRect.top),
      footerStillInFrame:
        footerRect.top >= slideRect.top - 1 && footerRect.bottom <= slideRect.bottom + 1,
      lastBlockBottom: last ? Math.round(last.bottom) : null,
      lastBlockClear: last ? last.bottom <= footerRect.top + 1 : null
    };
  })()`);
  assert(scrollState.scrolled > 2, `the fixture must scroll: ${JSON.stringify(scrollState)}`);
  assert.equal(
    scrollState.footerStillInFrame,
    true,
    `the footline must stay inside the frame while scrolling: ${JSON.stringify(scrollState)}`
  );
  assert(
    Math.abs(scrollState.footerTopAfter - scrollState.footerTopBefore) < 1,
    `the footline must not move with the content: ${JSON.stringify(scrollState)}`
  );
  assert.equal(
    scrollState.lastBlockClear,
    true,
    `scrolled to the end, no content may stay hidden behind the footline: ${JSON.stringify(scrollState)}`
  );
  await scrollPage.close();


  // Reveal's overview grid scales every slide down and lays them out together. A
  // chrome pinned with `position: fixed` is not part of that transform, so it
  // detaches from its own thumbnail -- the reason this fix keeps the chrome on the
  // slide and scrolls an inner layer instead. The invariant is scale-free: the
  // footline must stay within its own slide's box, and in its lower half.
  const overviewPage = await BrowserPage.create(
    connection,
    `${origin}/overflow.html#/scrollable-frame`
  );
  const overviewState = await overviewPage.evaluate(`(async () => {
    const measure = () => {
      const slide = document.getElementById("scrollable-frame");
      const footer = slide.querySelector(":scope > .beamer-footline");
      const slideRect = slide.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        slide: [slideRect.left, slideRect.top, slideRect.right, slideRect.bottom],
        footer: [footerRect.left, footerRect.top, footerRect.right, footerRect.bottom],
        position: getComputedStyle(footer).position
      };
    };
    const before = measure();
    window.Reveal.toggleOverview(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const inOverview = measure();
    window.Reveal.toggleOverview(false);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { before, inOverview, isOverview: window.Reveal.isOverview() };
  })()`);
  const ov = overviewState.inOverview;
  const [sl, st, sr, sb] = ov.slide;
  const [fl, ft, fr, fb] = ov.footer;
  assert.equal(ov.position, "absolute", "the footline must not be viewport-pinned");
  assert(
    fl >= sl - 0.5 && fr <= sr + 0.5,
    `in overview the footline must stay within its own slide horizontally: ${JSON.stringify(overviewState)}`
  );
  assert(
    ft >= st - 0.5 && fb <= sb + 0.5,
    `in overview the footline must stay within its own slide vertically: ${JSON.stringify(overviewState)}`
  );
  assert(
    ft > st + (sb - st) / 2,
    `in overview the footline must still sit in the lower half of its slide: ${JSON.stringify(overviewState)}`
  );
  assert.equal(
    Math.round(overviewState.isOverview),
    0,
    "the overview probe must leave overview mode"
  );
  await overviewPage.close();

  // The control has to be measured on a SCREEN page. Reading it off the
  // `?print-pdf` page below was vacuous: `isPrintLayout()` short-circuits
  // `reportOverflow`, so a deck loaded in print layout can never warn about an
  // overflow however badly it overflows -- the control passed for every fixture,
  // including ones that overflow. It exists to prove the deck used below is clean
  // on screen, so it is measured where that can actually be observed.
  const screenPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  await delay(400);
  const screenWarnings = await screenPage.evaluate(`window.__beamerWarnings`);
  await screenPage.close();
  assert.deepEqual(
    screenWarnings,
    [],
    `the madrid fixture must not overflow on screen, otherwise the print check below is meaningless: ${JSON.stringify(screenWarnings)}`
  );

  // Reveal paginates the deck in print/PDF layout, so a slide's client height no
  // longer describes its content box: the check must stay silent there.
  const printPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html?print-pdf`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  await printPage.emulateMedia("print");
  const printWarnings = await printPage.evaluate(`(async () => {
    window.dispatchEvent(new Event("beforeprint"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    return window.__beamerWarnings;
  })()`);
  assert.deepEqual(
    printWarnings,
    [],
    `print layout must not report phantom overflows: ${JSON.stringify(printWarnings)}`
  );
  await printPage.close();
  await page.close();
};

// Documented customisation paths: an extra stylesheet, and re-referencing the
// extension theme by path. Both must reach the palette variables, and a
// `:root`-level override must not be shadowed by the theme - for either variant.
const testPaletteOverrides = async (connection, origin) => {
  for (const [
    fixture,
    label,
    expectedAuthorBox,
    expectedPrimary,
    expectedFrameTitle,
  ] of [
    ["palette-css", "css:", "rgb(18, 52, 86)", "#2c7550", "rgb(44, 117, 80)"],
    ["palette-theme", "theme:", "rgb(18, 52, 86)", "#2c7550", "rgb(44, 117, 80)"],
    ["palette-example", "examples/custom-palette.css", null, "#2c7550", "rgb(44, 117, 80)"],
    // CambridgeUS keeps its own palette, but a `.reveal.beamer-cambridgeus`
    // override must still win. The stock accent here is darkred (#cc0000);
    // #a30000 is the override, so this also proves the override is reaching
    // the variant class rather than being shadowed.
    ["palette-cambridgeus", "cambridgeus override", "rgb(18, 52, 86)", "#a30000", "rgb(242, 242, 242)"],
  ]) {
    renderFixture(fixture);
    const page = await BrowserPage.create(connection, `${origin}/${fixture}.html`);
    const state = await page.evaluate(`(() => {
      const reveal = document.querySelector(".reveal");
      const slide = document.getElementById("palette-frame");
      return {
        primary: getComputedStyle(reveal).getPropertyValue("--beamer-primary").trim(),
        structure: getComputedStyle(document.documentElement)
          .getPropertyValue("--beamer-structure")
          .trim(),
        authorBoxBackground: getComputedStyle(
          slide.querySelector(":scope > .beamer-footline .beamer-footline-author")
        ).backgroundColor,
        frameTitleBackground: getComputedStyle(slide.querySelector(":scope > h2")).backgroundColor,
        frameTitlePosition: getComputedStyle(slide.querySelector(":scope > h2")).position,
        hasFootline: Boolean(slide.querySelector(":scope > .beamer-footline"))
      };
    })()`);
    assert.equal(state.hasFootline, true, `${label} lost the Beamer footline`);
    assert.equal(state.frameTitlePosition, "absolute", `${label} lost the Beamer frame title`);
    assert.equal(
      state.primary,
      expectedPrimary,
      `${label} ignored the --beamer-primary override`
    );
    assert.equal(
      state.frameTitleBackground,
      expectedFrameTitle,
      `${label} ignored the frame title colour override`
    );
    // Overriding the variant accent must not drag `structure` with it: they are
    // separate roles, and `structure` is what bullets and block titles use.
    // Madrid keeps Beamer's blendedblue; CambridgeUS stocks its own darkred.
    assert.equal(
      state.structure,
      label.startsWith("cambridgeus") ? "#cc0000" : "#3333b2",
      `${label} must leave --beamer-structure at the variant's stock value`
    );
    if (expectedAuthorBox) {
      assert.equal(
        state.authorBoxBackground,
        expectedAuthorBox,
        `${label} ignored the footline colour override`
      );
    } else {
      assert.notEqual(
        state.authorBoxBackground,
        "rgb(26, 26, 89)",
        `${label} left the stock Madrid footline colour in place`
      );
    }
    await page.close();
  }
};

// Beamer's palette is algebra, not taste. xcolor mixes in the DECIMAL rgb or
// gray model -- `A!p!B` is p% of A plus (100-p)% of B -- and only converts to
// 8 bits at the end, using floor(255*x + 0.5) on sp-quantised dimens. Exact-.5
// products therefore quantise DOWN (0.7 -> 178, 0.9 -> 229).
//
// The base colours matter: xcolor defines `green` as rgb(0, 1, 0), while
// black/white/gray are gray-model values 0 / 1 / 0.5. Getting `green` wrong
// turns `green!50!black` into #004000 instead of #008000.
//
// These expectations are derived from the upstream theme sources rather than
// from this implementation's output, which is the point: the screenshot
// baselines are generated by the implementation itself and so cannot detect a
// palette that is self-consistently wrong.
const paletteModel = (() => {
  const mix = (a, p, b) => a.map((channel, i) => p * channel + (1 - p) * b[i]);
  // xcolor's real->8bit map is floor(255*x + 0.5) in principle, but it runs on
  // sp-quantised dimens, so an exact .5 tie can land just under and truncate
  // (0.7 * 255 = 178.5 -> 178). Where the tie survives, it resolves upward
  // (0.5 * 255 = 127.5 -> 128). Producing that exactly would mean reimplementing
  // TeX's dimens, so the assertions below allow a one-step delta against these
  // values, which are enough to catch any real drift.
  const toHex = (rgb) =>
    "#" +
    rgb
      .map((channel) => Math.round(255 * channel).toString(16).padStart(2, "0"))
      .join("");
  const BLACK = [0, 0, 0];
  const WHITE = [1, 1, 1];
  const GRAY = [0.5, 0.5, 0.5];
  const BLENDED_BLUE = [0.2, 0.2, 0.7]; // beamer@blendedblue
  const DARKRED = [0.8, 0, 0]; // beaver \definecolor{darkred}
  const RED = [1, 0, 0]; // xcolor red
  const GREEN = [0, 1, 0]; // xcolor green -- NOT (0, 128, 0)
  // green!50!black. NOT derived from `structure`: beamercolorthemedefault
  // pins it, and no theme in either chain redefines it, so it is the same
  // value for both variants even though CambridgeUS moves `structure`.
  const EXAMPLE_TEXT = mix(GREEN, 0.5, BLACK);

  const structure = toHex(BLENDED_BLUE);
  const bodyOf = (band) => toHex(mix(band, 0.1, WHITE));

  // beamerinnerthemedefault/colortheme orchid: block body bg = title bg!10!bg.
  const madridPlainBand = mix(BLENDED_BLUE, 0.75, BLACK);
  const madridExampleBand = mix(EXAMPLE_TEXT, 0.75, BLACK);
  const madridAlertBand = mix(RED, 0.75, BLACK);

  return {
    // Madrid keeps Beamer's `structure`; CambridgeUS deliberately re-points it
    // at its own darkred instead of beaver's blendedblue (documented deviation
    // -- see _palette.scss), stepped down with the same algebra.
    structureByVariant: {
      madrid: structure,
      cambridgeus: toHex(DARKRED),
    },
    madrid: {
      frameTitle: structure,
      blocks: {
        Plain: {
          background: toHex(madridPlainBand),
          body: bodyOf(madridPlainBand),
          color: "#ffffff",
          weight: "650",
          strokeWidth: 0,
        },
        Example: {
          background: toHex(madridExampleBand),
          body: bodyOf(madridExampleBand),
          color: "#ffffff",
          weight: "650",
          strokeWidth: 0,
        },
        Alert: {
          // White on the #bf0000 band is 6.53:1, so no outline is needed.
          background: toHex(madridAlertBand),
          body: bodyOf(madridAlertBand),
          color: "#ffffff",
          weight: "650",
          strokeWidth: 0,
        },
      },
    },
    cambridgeus: {
      // beaver: frametitle bg = gray!10!white.
      frameTitle: toHex(mix(GRAY, 0.1, WHITE)),
      blocks: {
        // Plain and example are unfilled, coloured by text alone, as upstream.
        Plain: {
          background: "transparent",
          body: "transparent",
          color: toHex(DARKRED),
          weight: "650",
          strokeWidth: 0,
        },
        Example: {
          background: "transparent",
          body: "transparent",
          color: toHex(EXAMPLE_TEXT),
          weight: "650",
          strokeWidth: 0,
        },
        // Yellow on the light slide is 1.48:1 on its own, so this is the one
        // title that carries an outline -- and the heaviest weight.
        Alert: {
          background: "transparent",
          body: "transparent",
          color: "#ffcd00",
          weight: "700",
          strokeWidth: 3,
          // A stroke in the wrong colour is invisible in exactly the case it
          // exists for, so the colour is pinned wherever one is painted.
          strokeColor: "#000000",
        },
      },
    },
  };
})();

const testPaletteAlgebra = async (connection, origin) => {
  for (const variant of ["madrid", "cambridgeus"]) {
    renderFixture("blocks-audit", { metadata: { "beamer-variant": variant } });
    const page = await BrowserPage.create(
      connection,
      `${origin}/blocks-audit.html#/blocks`
    );
    const state = await page.evaluate(`(() => {
      const hex = (value) => {
        const text = String(value).trim();
        if (text === "rgba(0, 0, 0, 0)") return "transparent";
        let match = text.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);
        if (match) {
          return "#" + [1, 2, 3]
            .map((i) => Math.round(Number(match[i]) * 255).toString(16).padStart(2, "0"))
            .join("");
        }
        match = text.match(/(\\d+),\\s*(\\d+),\\s*(\\d+)/);
        return match
          ? "#" + [1, 2, 3]
              .map((i) => Number(match[i]).toString(16).padStart(2, "0"))
              .join("")
          : text;
      };
      const kinds = {};
      document.querySelectorAll(".beamer-block").forEach((block) => {
        const title = block.querySelector(":scope > .beamer-block-title");
        if (!title) return;
        const kind = block.classList.contains("beamer-example")
          ? "Example"
          : block.classList.contains("beamer-alert")
            ? "Alert"
            : "Plain";
        const style = getComputedStyle(title);
        kinds[kind] = {
          background: hex(style.backgroundColor),
          body: hex(getComputedStyle(block).backgroundColor),
          color: hex(style.color),
          weight: style.fontWeight,
          strokeWidth: style.webkitTextStrokeWidth || style.getPropertyValue("-webkit-text-stroke-width"),
          strokeColor: hex(
            style.webkitTextStrokeColor || style.getPropertyValue("-webkit-text-stroke-color")
          ),
        };
      });
      const root = getComputedStyle(document.documentElement);
      const frame = document.querySelector(".slides section.beamer-frame-slide > h2");
      if (!frame) {
        return { error: "no .beamer-frame-slide > h2 in the rendered page" };
      }
      const bullet = document.querySelector(".slides section ul > li");
      const numbered = document.querySelector(".slides section ol > li");
      return {
        kinds,
        structure: root.getPropertyValue("--beamer-structure").trim(),
        frameTitle: hex(getComputedStyle(frame).backgroundColor),
        bulletMarker: bullet
          ? hex(getComputedStyle(bullet, "::before").backgroundColor)
          : null,
        numberMarker: numbered
          ? hex(getComputedStyle(numbered, "::before").backgroundColor)
          : null,
      };
    })()`);

    assert(
      !state.error,
      `${variant}: ${state.error} -- the fixture did not render as expected`
    );
    const expected = paletteModel[variant];
    // A one-step delta is the rgb conversion gap described above; anything
    // larger is a genuine palette regression (the old hard-coded block colours
    // were off by 30+ steps, and CambridgeUS painted every block deep red).
    const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const closeTo = (got, want, label) => {
      if (want === "transparent") {
        assert.equal(got, want, label);
        return;
      }
      const delta = channels(got).map((c, i) => Math.abs(c - channels(want)[i]));
      // Two steps covers both gaps: xcolor's sp-quantised rounding, and
      // Chrome >= 118 interpolating color-mix() in oklab rather than srgb.
      assert(Math.max(...delta) <= 2, `${label}: got ${got}, Beamer gives ${want}`);
    };
    // List markers track `structure`: blue on Madrid, the deliberate darkred on
    // CambridgeUS. They used to follow the variant accent instead, which is how
    // CambridgeUS ended up with red bullets while its `structure` stayed blue.
    for (const [label, actual] of [
      ["bullet marker", state.bulletMarker],
      ["numbered marker", state.numberMarker],
    ]) {
      // Not a skip. The fixture is required to carry both list kinds, so a marker
      // that was not measured means the markup or the probe lost it -- and a
      // `continue` here turned exactly that into a green test.
      assert(
        actual != null,
        `${variant}: ${label} was not measured; the fixture must contain both an ` +
          "unordered and an ordered list on the same slide"
      );
      closeTo(
        actual,
        paletteModel.structureByVariant[variant],
        `${variant}: ${label} must use --beamer-structure`
      );
    }
    // Madrid keeps beamer@blendedblue (0.2/0.2/0.7, which renders as #3333b2
    // under Poppler/xcolor and #3333b3 under Ghostscript). CambridgeUS is a
    // DELIBERATE DEVIATION: upstream leaves `structure` at blendedblue, and we
    // re-point it at the variant's darkred so bullets and unfilled block titles
    // are not a stray blue inside a red-and-grey deck.
    closeTo(
      state.structure,
      paletteModel.structureByVariant[variant],
      variant === "madrid"
        ? "--beamer-structure must stay beamer@blendedblue"
        : "--beamer-structure deviates to CambridgeUS darkred (documented)"
    );
    closeTo(
      state.frameTitle,
      expected.frameTitle,
      `${variant}: frametitle background must match the theme source`
    );
    for (const [kind, want] of Object.entries(expected.blocks)) {
      const got = state.kinds[kind];
      assert(got, `${variant}: the ${kind} block was not rendered`);
      closeTo(got.background, want.background, `${variant} ${kind} block title background`);
      closeTo(got.body, want.body, `${variant} ${kind} block body`);
      closeTo(got.color, want.color, `${variant} ${kind} block title colour`);
      assert.equal(
        got.weight,
        want.weight,
        `${variant} ${kind} block title weight`
      );
    }
    // The alert title's outline is the only thing making a low-contrast fill
    // legible, so assert it is actually applied where it is wanted and absent
    // where it is not.
    for (const [kind, want] of Object.entries(expected.blocks)) {
      const got = state.kinds[kind].strokeWidth;
      assert.equal(
        parseFloat(got),
        want.strokeWidth,
        `${variant} ${kind} block title stroke width`
      );
      if (want.strokeWidth > 0) {
        assert.equal(
          state.kinds[kind].strokeColor,
          want.strokeColor,
          `${variant} ${kind} block title stroke colour`
        );
      }
    }
    await page.close();
  }
};

// Section pages come in three looks, selected per heading with an attribute on
// the `#` line. Quarto copies heading classes onto the <section>, so this is a
// pure presentation choice -- it cannot decide whether the page exists, because
// Reveal has already split the sections by the time any of this runs.
const testReferencesPagination = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/refs-pagination.html#/refs-grouped`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  // The decoration pass that paginates the references is synchronous, and
  // `BrowserPage.create` already waits for the document to report
  // `data-beamer-decorated`, so this delay is not waiting out a reverter -- it only
  // lets layout and fonts settle before the heights below are read.
  await delay(400);
  const state = await page.evaluate(`(() => {
    const pages = [];
    document.querySelectorAll("section.beamer-leaf-slide").forEach((slide) => {
      const container = slide.querySelector("#refs");
      if (!container) return;
      const layer = slide.querySelector(":scope > .beamer-scroll") || slide;
      const style = getComputedStyle(layer);
      const available =
        layer.clientHeight -
        parseFloat(style.paddingTop || "0") -
        parseFloat(style.paddingBottom || "0");
      const list = Array.from(container.querySelectorAll(".csl-entry"));
      const used = list.length
        ? list[list.length - 1].getBoundingClientRect().bottom -
          list[0].getBoundingClientRect().top
        : 0;
      pages.push({
        id: slide.id,
        visibility: slide.dataset.visibility || null,
        title: (slide.querySelector(":scope > h2") || {}).textContent || null,
        isScrollable: slide.classList.contains("scrollable"),
        hasScrollLayer: Boolean(slide.querySelector(":scope > .beamer-scroll")),
        available: Math.round(available),
        used: Math.round(used),
        entries: list.length,
        keys: Array.from(container.querySelectorAll(".csl-entry")).map((entry) =>
          entry.id.replace(/^ref-/, "")
        ),
        // The fixture gives entry N the author "Surname(14 - N)", so citeproc sorts
        // it in the exact reverse of the declared order. Reading the author back is
        // what proves the assertion below is not passing by accident.
        authors: list.map((entry) => {
          const at = entry.textContent.indexOf("Surname");
          return at < 0 ? null : Number(entry.textContent.slice(at + 7, at + 9));
        }),
        hasNumber: Boolean(
          slide.querySelector(":scope > .beamer-footline .beamer-footline-number")
        )
      });
    });
    const ids = Array.from(document.querySelectorAll(".csl-entry")).map((e) => e.id);
    const unrelated = document.getElementById("body");
    return {
      pages,
      totalEntries: ids.length,
      uniqueEntries: new Set(ids).size,
      // A frame that declares "item" on its own account sits directly before the
      // bibliography in this fixture. It must keep its content and stay out of the
      // pagination entirely.
      unrelated: {
        entries: unrelated.querySelectorAll(".csl-entry").length,
        keepsText: unrelated.textContent.includes("keeps its own text"),
        visibility: unrelated.dataset.visibility || null
      },
      lastNormal: (
        document.querySelector(
          "#last-normal > .beamer-footline .beamer-footline-number"
        ) || {}
      ).textContent || null,
      warnings: window.__beamerWarnings
    };
  })()`);

  // The author declared two pages of five; the third is generated.
  assert.equal(state.pages.length, 3, JSON.stringify(state));
  assert.deepEqual(
    state.pages.map((entry) => entry.entries),
    [5, 5, 3],
    `declared \`item="5"\` must cut at five, and the rest must spill: ${JSON.stringify(state)}`
  );
  // No entry may appear twice, and none may be dropped.
  assert.equal(state.totalEntries, 13, JSON.stringify(state));
  assert.equal(state.uniqueEntries, 13, JSON.stringify(state));
  assert.deepEqual(
    state.pages.flatMap((entry) => entry.keys),
    Array.from({ length: 13 }, (unused, index) => `ref${index + 1}`),
    `\`refs-order: declaration\` must keep the .bib order: ${JSON.stringify(state)}`
  );
  // ...and the split must follow that order too, not just the list. With ordering
  // applied after pagination the pages came out as `ref13..ref9 / ref8..ref4 /
  // ref3..ref1`: the lists were reordered inside pages that had already been cut in
  // citeproc's order.
  //
  // The authors are read back because this fixture's citeproc order is the exact
  // reverse of its declared order (entry N is authored by `Surname(14 - N)`). So the
  // authors must descend while the keys ascend, and the assertion above can actually
  // fail: while the fixture's two orders agreed, it passed even with reordering
  // disabled entirely.
  assert.deepEqual(
    state.pages.flatMap((entry) => entry.authors),
    Array.from({ length: 13 }, (unused, index) => 13 - index),
    `the rendered order must be the declared order, not citeproc's: ${JSON.stringify(state)}`
  );
  // An author heading survives; a generated page falls back to \`refs-title\`.
  assert.equal(state.pages[0].title, "Grouped pages");
  assert.equal(state.pages[1].title, "Continues");
  assert.equal(state.pages[2].title, "参考文献");
  // Every page must carry the same layout, or the entry height differs per page and
  // the split is measured against the wrong capacity. Quarto gives `.smaller
  // .scrollable` only to the page holding `::: {#refs}`, so this is on the theme.
  for (const entry of state.pages) {
    assert.equal(entry.isScrollable, true, JSON.stringify(entry));
    assert.equal(entry.hasScrollLayer, true, JSON.stringify(entry));
  }
  // The real invariant: no page may clip. Measured per page, because the entry
  // height is not the same on every page until the classes are unified.
  for (const entry of state.pages) {
    assert(
      entry.used <= entry.available + 1,
      `no reference page may overflow: ${JSON.stringify(entry)}`
    );
  }
  // Every reference page must be laid out identically. They are not all present when the
  // box classes are applied -- `beamer-frame-slide` is what reserves the frame title's
  // height in the slide's padding -- and a page missing it has 46px more room than the
  // page it continues (measured 638px against 592px). Pagination that measures pages
  // against a different box than they end up with cuts them one entry too late, and the
  // page comes back needing a scrollbar.
  assert.equal(
    new Set(state.pages.map((entry) => entry.available)).size,
    1,
    `every reference page must reserve the same room: ${JSON.stringify(state.pages)}`
  );
  // Reference pages never join the page count or show a number of their own.
  assert.equal(state.lastNormal, "4 / 4", JSON.stringify(state));
  // `item` is a generic attribute name, so the frame that uses it for its own
  // reasons must be left alone: taking every `item` page in the deck made that frame
  // the master (it has no `#refs`, so nothing paginated) and, had it come after the
  // bibliography, entries would have been moved into it.
  assert.deepEqual(
    state.unrelated,
    {
      entries: 0,
      keepsText: true,
      visibility: null
    },
    `a frame using \`item\` for its own reasons must not join the bibliography: ${JSON.stringify(state)}`
  );
  for (const entry of state.pages) {
    assert.equal(entry.visibility, "uncounted", JSON.stringify(entry));
    assert.equal(entry.hasNumber, false, JSON.stringify(entry));
  }
  // Two pages were declared and the bibliography needs three, so the theme has to say
  // so and name the first entry it moved. The message was dead code until the
  // declared count was recorded before `ensurePage` started appending to `pages`:
  // measuring the spill as `slices.length - pages.length` afterwards is always 0.
  const refsWarnings = state.warnings.filter((line) =>
    line.includes("[beamerslides] the references")
  );
  assert.deepEqual(
    refsWarnings,
    [
      "[beamerslides] the references need 3 pages but 2 were declared, so 1 page " +
        "was added; the first entry moved is ref11. Move a page break earlier, or " +
        "lower --beamer-refs-font-size."
    ],
    `a short declaration must be reported: ${JSON.stringify(state.warnings)}`
  );
  await page.close();

  // The mirror case: more pages declared than the bibliography needs. The unused page
  // is left in the deck -- removing it would delete whatever the author put there --
  // but it renders as an empty frame, so it has to be reported.
  const surplusPage = await BrowserPage.create(
    connection,
    `${origin}/refs-surplus.html#/surplus-first`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  await delay(400);
  const surplus = await surplusPage.evaluate(`(() => {
    const pages = [];
    document.querySelectorAll("section.beamer-leaf-slide").forEach((slide) => {
      const container = slide.querySelector("#refs");
      if (!container) return;
      pages.push({
        id: slide.id,
        visibility: slide.dataset.visibility || null,
        entries: container.querySelectorAll(".csl-entry").length,
        hasNumber: Boolean(
          slide.querySelector(":scope > .beamer-footline .beamer-footline-number")
        )
      });
    });
    const unusedSlide = document.getElementById("surplus-third");
    return {
      pages,
      // The page the bibliography does not need must be left exactly as written: no
      // entries, no manufactured list, its own heading, and not counted.
      unused: {
        exists: Boolean(unusedSlide),
        entries: unusedSlide.querySelectorAll(".csl-entry").length,
        hasRefsContainer: Boolean(unusedSlide.querySelector("#refs")),
        title: (unusedSlide.querySelector(":scope > h2") || {}).textContent || null,
        visibility: unusedSlide.dataset.visibility || null
      },
      lastNormal: (
        document.querySelector(
          "#surplus-last > .beamer-footline .beamer-footline-number"
        ) || {}
      ).textContent || null,
      warnings: window.__beamerWarnings
    };
  })()`);
  assert.deepEqual(
    surplus.pages.map((entry) => entry.entries),
    [5, 1],
    `declared pages are consumed in order: ${JSON.stringify(surplus)}`
  );
  assert.deepEqual(
    surplus.unused,
    {
      exists: true,
      entries: 0,
      hasRefsContainer: false,
      title: "Third",
      visibility: "uncounted"
    },
    `a page the bibliography does not need is left alone: ${JSON.stringify(surplus)}`
  );
  assert.equal(
    surplus.pages.every((entry) => entry.visibility === "uncounted"),
    true,
    JSON.stringify(surplus)
  );
  // An empty frame must not shift the page count either.
  assert.equal(surplus.lastNormal, "4 / 4", JSON.stringify(surplus));
  assert.deepEqual(
    surplus.warnings.filter((line) => line.includes("[beamerslides] the references")),
    [
      "[beamerslides] the references fit on 2 pages but 3 were declared; " +
        "surplus-third is empty. Delete the unused page, or lower `item` so the " +
        "entries spread over every declared page."
    ],
    `a surplus declaration must be reported once: ${JSON.stringify(surplus.warnings)}`
  );
  await surplusPage.close();
};

// `refs-order: declaration` reads the keys straight out of every declared `.bib`, and
// the keys of several files are concatenated in the order the files are listed. That
// path had only ever been exercised with a SINGLE bibliography file, so a regression
// that read just the first file -- or that ordered entries within one file but not
// across them -- would not have been caught. The two entries are chosen so that
// citeproc's alphabetical order is the exact reverse of the declared one, which is what
// makes the assertion able to fail rather than agree by luck.
const testReferencesMultifile = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/refs-multifile.html#/references`
  );
  await delay(400);
  const state = await page.evaluate(`(() => {
    const meta = document.querySelector('meta[name="beamer-refs-keys"]');
    return {
      shipped: meta ? meta.content : null,
      keys: Array.from(document.querySelectorAll("#refs .csl-entry")).map((entry) =>
        (entry.id || "").replace(/^ref-/, "")
      )
    };
  })()`);
  await page.close();
  assert.equal(
    state.shipped,
    "ZuluLast2020,AlphaFirst2021",
    `the keys of every declared bibliography file must be concatenated in the order the files are listed: ${JSON.stringify(state)}`
  );
  assert.deepEqual(
    state.keys,
    ["ZuluLast2020", "AlphaFirst2021"],
    "'refs-order: declaration' must order entries across bibliography files, not only within one: " +
      JSON.stringify(state)
  );
};

// The other half of the reference pagination: no `item` is declared, so every break is
// measured. This path is also where two defects showed up at once -- the sections the
// pagination creates were missing from the list the decoration loop walked, so they got no
// footline, and the box classes were applied after the measurement, so the first page was
// cut against 46px of room it does not have and came back with a scrollbar.
const testReferencesAutoPages = async (connection, origin) => {
  // No hash on purpose: this is the path a reader takes. Reveal renders only the current
  // slide, so opening the deck at the start leaves the references slide `display: none`
  // while the theme decorates it -- and a hidden box measures 0x0, which made the overflow
  // check answer "no" for every entry. Every fixture here used to jump straight to the
  // references slide, which is the one state where that cannot happen.
  const page = await BrowserPage.create(
    connection,
    `${origin}/refs-auto.html`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  await delay(500);
  // Each page is shown before it is measured for the same reason: a hidden page reports a
  // zero-height box, so `needsScroll` on one would be meaningless.
  const state = await page.evaluate(`(async () => {
    const pages = [];
    const slides = Array.from(document.querySelectorAll("section.beamer-leaf-slide")).filter(
      (slide) => slide.querySelector("#refs")
    );
    // The fixture has to reproduce the state a reader's deck is in, or this test cannot see
    // the defect it exists for: Reveal renders only the top-level sections within
    // viewDistance of the current one, so the references stack at the end of a deck is
    // hidden while the theme decorates it.
    const firstStack = slides.length ? slides[0].parentElement : null;
    const hiddenAtLoad = firstStack
      ? getComputedStyle(firstStack).display === "none"
      : null;
    for (const slide of slides) {
      const indices = window.Reveal.getIndices(slide);
      window.Reveal.slide(indices.h, indices.v, 0);
      await new Promise((resolve) => setTimeout(resolve, 90));
      const container = slide.querySelector("#refs");
      const layer = slide.querySelector(":scope > .beamer-scroll") || slide;
      pages.push({
        id: slide.id,
        entries: container.querySelectorAll(".csl-entry").length,
        visibility: slide.dataset.visibility || null,
        hasFootline: Boolean(slide.querySelector(":scope > .beamer-footline")),
        available: layer.clientHeight,
        needsScroll: layer.scrollHeight > layer.clientHeight + 1,
        // A page appended after Reveal initialised is not in its model, and Quarto's
        // support.js reads getSlideBackground(currentSlide).classList on every
        // slidechanged: for an unknown slide that is undefined.classList, which threw
        // out of the plugin on every navigation into a generated page.
        knownToReveal: Boolean(window.Reveal.getSlideBackground(slide))
      });
    }
    const ids = Array.from(document.querySelectorAll(".csl-entry")).map((e) => e.id);
    return {
      pages,
      hiddenAtLoad,
      totalEntries: ids.length,
      uniqueEntries: new Set(ids).size,
      warnings: window.__beamerWarnings
    };
  })()`);

  assert.equal(
    state.hiddenAtLoad,
    true,
    `the fixture must hide the references stack at load, or it cannot see this defect: ${JSON.stringify(state)}`
  );
  // The blind measurement this replaces put all thirteen on one page.
  assert(
    state.pages.length >= 2,
    `thirteen entries must not fit on one page, and the deck must paginate without being opened on the references page: ${JSON.stringify(state)}`
  );
  assert.equal(state.totalEntries, 13, JSON.stringify(state));
  assert.equal(state.uniqueEntries, 13, JSON.stringify(state));
  for (const entry of state.pages) {
    // The references page carries Quarto's `.scrollable`, so a page cut too late does not
    // fail loudly -- it silently becomes a page the reader has to scroll. The whole point
    // of measuring the break is that the page it produces fits.
    assert.equal(
      entry.needsScroll,
      false,
      `no reference page may need scrolling: ${JSON.stringify(state)}`
    );
    assert.equal(entry.visibility, "uncounted", JSON.stringify(entry));
    assert(entry.entries > 0, JSON.stringify(entry));
    // A page created by the pagination is a slide like any other and needs its chrome.
    assert.equal(
      entry.hasFootline,
      true,
      `a generated reference page must carry the footline: ${JSON.stringify(state)}`
    );
    // ...and Reveal has to know about it, or Quarto's footer plugin throws on the way in.
    assert.equal(
      entry.knownToReveal,
      true,
      `Reveal must know every reference page: ${JSON.stringify(state)}`
    );
  }
  assert.equal(
    new Set(state.pages.map((entry) => entry.available)).size,
    1,
    `every reference page must reserve the same room: ${JSON.stringify(state.pages)}`
  );
  const refsWarnings = state.warnings.filter((line) =>
    line.includes("[beamerslides] the references")
  );
  assert.equal(refsWarnings.length, 1, JSON.stringify(state.warnings));
  // The split itself is measured, so only the shape of the report is pinned here.
  assert.match(
    refsWarnings[0],
    /^\[beamerslides\] the references need 2 pages but 1 was declared, so 1 page was added; the first entry moved is ref\d+\. Move a page break earlier, or lower --beamer-refs-font-size\.$/
  );
  await page.close();
};

// `refs-overflow: scroll` is the opt-out from pagination: the bibliography stays on the one
// page Quarto produces and scrolls there. The interesting part is that "it scrolls" has to
// mean the same thing as everywhere else in the theme -- the body moves, the chrome does not
// -- and that the page still stays out of the footline's page count.
const testReferencesScroll = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/refs-scroll.html`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  await delay(500);
  const state = await page.evaluate(`(async () => {
    const slide = Array.from(document.querySelectorAll("section.beamer-leaf-slide")).find(
      (entry) => entry.querySelector("#refs")
    );
    const indices = window.Reveal.getIndices(slide);
    window.Reveal.slide(indices.h, indices.v, 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const container = slide.querySelector("#refs");
    const layer = slide.querySelector(":scope > .beamer-scroll");
    const body = layer || slide;
    const footer = slide.querySelector(":scope > .beamer-footline");
    const blocks = Array.from(container.querySelectorAll(".csl-entry"));
    const last = blocks[blocks.length - 1];
    const footerTopBefore = footer.getBoundingClientRect().top;
    body.scrollTop = body.scrollHeight;
    const lastRect = last.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const result = {
      refsContainers: document.querySelectorAll("#refs").length,
      entries: blocks.length,
      uncounted: slide.dataset.visibility || null,
      hasLayer: Boolean(layer),
      overflows: body.scrollHeight > body.clientHeight + 1,
      scrolled: Math.round(body.scrollTop),
      lastEntryReachable: lastRect.bottom <= slide.getBoundingClientRect().bottom + 1,
      lastEntryClearOfFooter: lastRect.bottom <= footerRect.top + 1,
      footerStayedPut: Math.abs(footerRect.top - footerTopBefore) < 1,
      footerStillInSlide:
        footerRect.top >= slide.getBoundingClientRect().top - 1 &&
        footerRect.bottom <= slide.getBoundingClientRect().bottom + 1,
      warnings: window.__beamerWarnings
    };
    body.scrollTop = 0;
    return result;
  })()`);

  assert.equal(state.refsContainers, 1, JSON.stringify(state));
  assert.equal(state.entries, 13, JSON.stringify(state));
  assert.equal(state.uncounted, "uncounted", JSON.stringify(state));
  assert.equal(state.hasLayer, true, JSON.stringify(state));
  assert(
    state.overflows,
    `the fixture must actually overflow, or this test proves nothing: ${JSON.stringify(state)}`
  );
  assert(state.scrolled > 2, JSON.stringify(state));
  assert.equal(state.lastEntryReachable, true, JSON.stringify(state));
  assert.equal(state.lastEntryClearOfFooter, true, JSON.stringify(state));
  // Scrolling must not carry the chrome away, exactly as for any other scrolling frame.
  assert.equal(state.footerStayedPut, true, JSON.stringify(state));
  assert.equal(state.footerStillInSlide, true, JSON.stringify(state));
  // No page was added, so there is nothing to report.
  assert.deepEqual(
    state.warnings.filter((line) => line.includes("[beamerslides] the references")),
    [],
    JSON.stringify(state.warnings)
  );
  await page.close();

  // A declared page break contradicts the mode, so it is reported rather than obeyed.
  const itemPage = await BrowserPage.create(
    connection,
    `${origin}/refs-scroll-item.html#/refs-grouped`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  await delay(500);
  const itemState = await itemPage.evaluate(`(() => ({
    refsContainers: document.querySelectorAll("#refs").length,
    entriesOnFirst: document.querySelectorAll("#refs .csl-entry").length,
    totalEntries: document.querySelectorAll(".csl-entry").length,
    warnings: window.__beamerWarnings.filter((line) =>
      line.includes("[beamerslides]")
    )
  }))()`);
  assert.equal(
    itemState.refsContainers,
    1,
    `the mode must not paginate: ${JSON.stringify(itemState)}`
  );
  assert.equal(itemState.entriesOnFirst, 13, JSON.stringify(itemState));
  assert.equal(itemState.totalEntries, 13, JSON.stringify(itemState));
  assert.deepEqual(
    itemState.warnings,
    [
      "[beamerslides] refs-overflow: scroll keeps the references on one page, so the " +
        "`item` page breaks are ignored. Remove them, or drop refs-overflow: scroll."
    ],
    JSON.stringify(itemState.warnings)
  );
  await itemPage.close();

  // An unknown value must land on the default, not on whichever branch happens to be last.
  // The fixture declares `item="5"`, so a paginating deck shows more than one `#refs`.
  const bogusPage = await BrowserPage.create(
    connection,
    `${origin}/refs-bogus.html#/refs-grouped`
  );
  await delay(400);
  const bogusState = await bogusPage.evaluate(`(() => ({
    refsContainers: document.querySelectorAll("#refs").length
  }))()`);
  assert(
    bogusState.refsContainers > 1,
    `an unknown refs-overflow must fall back to paginating: ${JSON.stringify(bogusState)}`
  );
  await bogusPage.close();

  // A bibliography with nothing cited is still a references page, and the two modes must not
  // disagree about what that does to the page count: marking it uncounted only on the
  // paginated path made the same deck read 5/5 in one mode and 4/4 in the other.
  const emptyCounts = {};
  for (const [mode, file] of [
    ["paginate", "refs-empty.html"],
    ["scroll", "refs-empty-scroll.html"]
  ]) {
    const emptyPage = await BrowserPage.create(
      connection,
      `${origin}/${file}#/empty-refs`
    );
    await delay(400);
    emptyCounts[mode] = await emptyPage.evaluate(`(() => {
      const refs = document.getElementById("empty-refs");
      return {
        entries: refs.querySelectorAll(".csl-entry").length,
        visibility: refs.dataset.visibility || null,
        lastNormal: (
          document.querySelector(
            "#empty-last > .beamer-footline .beamer-footline-number"
          ) || {}
        ).textContent || null
      };
    })()`);
    await emptyPage.close();
  }
  assert.equal(emptyCounts.paginate.entries, 0, JSON.stringify(emptyCounts));
  assert.equal(emptyCounts.scroll.entries, 0, JSON.stringify(emptyCounts));
  assert.equal(
    emptyCounts.paginate.visibility,
    "uncounted",
    `an empty references page is still a references page: ${JSON.stringify(emptyCounts)}`
  );
  assert.equal(
    emptyCounts.scroll.visibility,
    "uncounted",
    JSON.stringify(emptyCounts)
  );
  assert.equal(
    emptyCounts.paginate.lastNormal,
    emptyCounts.scroll.lastNormal,
    `refs-overflow must not move the page count: ${JSON.stringify(emptyCounts)}`
  );
};

// The scroll layer is built once, but both of its inputs are rewritten later: the
// reserved frame height is re-measured on every resize, font load and slide change, and
// `beamer-long-frame-title` is only ever added by that measurement. A layer built
// against the wrong one of those two is either inset for a one-line title on a frame
// whose title takes several lines -- the body ends up under the title band -- or missing
// altogether on a frame that became scrollable after the decoration pass, which leaves
// `overflow: hidden` with nothing to scroll, and because a scrolling frame is exempt
// from the overflow warning, silently.
const testScrollLayers = async (connection, origin) => {
  const page = await BrowserPage.create(
    connection,
    `${origin}/scroll-layers.html#/wrapped-scroll`
  );
  // The frame title is measured after the decoration pass, on a `requestAnimationFrame`
  // that follows `document.fonts.ready`, so the layers are only final once that ran.
  await delay(600);
  const state = await page.evaluate(`(() => {
    const measure = (id) => {
      const slide = document.getElementById(id);
      const layer = slide.querySelector(":scope > .beamer-scroll");
      const heading = slide.querySelector(":scope > h2");
      const footer = slide.querySelector(":scope > .beamer-footline");
      const blocks = layer ? Array.from(layer.querySelectorAll("p")) : [];
      const last = blocks.length ? blocks[blocks.length - 1] : null;
      const report = {
        hasLayer: Boolean(layer),
        longFrameTitle: slide.classList.contains("beamer-long-frame-title"),
        titleHeight: Math.round(heading.getBoundingClientRect().height),
        paddingTop: Math.round(parseFloat(getComputedStyle(slide).paddingTop)),
        layerTop: layer ? Math.round(layer.getBoundingClientRect().top) : null,
        overflows: layer ? layer.scrollHeight > layer.clientHeight + 1 : false
      };
      if (layer && last) {
        layer.scrollTop = layer.scrollHeight;
        const rect = last.getBoundingClientRect();
        report.lastBlockReachable =
          rect.bottom <= slide.getBoundingClientRect().bottom + 1;
        report.lastBlockClearOfFooter = footer
          ? rect.bottom <= footer.getBoundingClientRect().top + 1
          : null;
        layer.scrollTop = 0;
      }
      return report;
    };
    // A scrollable SECTION page. Its title is an h1, and the pass that builds the
    // layer used to treat only a frame's h2 as fixed UI, so the band was moved into
    // the layer and lost everything the stylesheet gives a direct child: no fill,
    // position static, and the frame's 32.4px title promoted to 52.5px by
    // Quarto's linear-navigation title-slide rule once the theme's own (more
    // specific) rule stopped matching.
    const measureSectionPage = () => {
      const slide = document.getElementById("scroll-section");
      // Reveal only lays a slide out once it is the current one, and this page is a
      // separate horizontal section from the frames measured above. Present it, then
      // put the deck back where it was: the later probes in this test measure
      // late-scroll's geometry and need its stack rendered.
      const restore = window.Reveal.getIndices(document.getElementById("wrapped-scroll"));
      const indices = window.Reveal.getIndices(slide);
      window.Reveal.slide(indices.h, indices.v);
      const heading = slide.querySelector(":scope > h1");
      const layer = slide.querySelector(":scope > .beamer-scroll");
      const slideRect = slide.getBoundingClientRect();
      const style = heading ? getComputedStyle(heading) : null;
      const rect = heading ? heading.getBoundingClientRect() : null;
      const paragraphs = layer ? Array.from(layer.querySelectorAll("p")) : [];
      const report = {
        isSectionSlide: slide.classList.contains("beamer-section-slide"),
        headingIsDirectChild: Boolean(heading),
        headingInLayer: Boolean(layer && layer.querySelector("h1")),
        paragraphsInLayer: paragraphs.length,
        bandFill: style ? style.backgroundColor : null,
        bandLeft: rect ? Math.round(rect.left - slideRect.left) : null,
        bandWidth: rect ? Math.round(rect.width) : null,
        slideWidth: Math.round(slideRect.width),
        overflows: layer ? layer.scrollHeight > layer.clientHeight + 1 : false
      };
      if (paragraphs.length) {
        const last = paragraphs[paragraphs.length - 1];
        layer.scrollTop = layer.scrollHeight;
        report.lastParagraphReachable =
          last.getBoundingClientRect().bottom <= slideRect.bottom + 1;
        layer.scrollTop = 0;
      }
      window.Reveal.slide(restore.h, restore.v);
      return report;
    };
    return {
      wrapped: measure("wrapped-scroll"),
      late: measure("late-scroll"),
      section: measureSectionPage()
    };
  })()`);

  // Case 1: the layer exists (`.scrollable` was in the source), but its inset has to
  // follow the measured title height. Before the fix the inset was the one measured for
  // a one-line title: layer top 80px against the 108px the body actually starts at.
  assert.equal(state.wrapped.hasLayer, true, JSON.stringify(state));
  assert(
    state.wrapped.titleHeight > 58,
    `the fixture title must span several lines: ${JSON.stringify(state)}`
  );
  assert.equal(
    state.wrapped.layerTop,
    state.wrapped.paddingTop,
    `the scroll layer must be inset to the measured title height, not the default one: ${JSON.stringify(state)}`
  );
  assert.equal(state.wrapped.overflows, true, JSON.stringify(state));

  // Case 2: the frame only becomes scrollable when the title is measured, which happens
  // after the decoration pass created the layers. It must get one anyway, and the body
  // it holds must be reachable.
  assert.equal(state.late.longFrameTitle, true, JSON.stringify(state));
  assert.equal(
    state.late.hasLayer,
    true,
    `a frame that becomes scrollable after decoration still needs its layer: ${JSON.stringify(state)}`
  );
  assert.equal(state.late.layerTop, state.late.paddingTop, JSON.stringify(state));
  assert.equal(state.late.overflows, true, JSON.stringify(state));
  assert.equal(state.late.lastBlockReachable, true, JSON.stringify(state));
  assert.equal(state.late.lastBlockClearOfFooter, true, JSON.stringify(state));

  // Case 3: a `.scrollable` SECTION page. Its title is an `h1`, and the layer pass
  // used to treat only a frame's `h2` as fixed UI -- so the band was moved into the
  // layer, where the stylesheet rule that gives it a fill, a position and its size
  // (all of which require a DIRECT child of the `<section>`) stopped matching. The
  // band rendered with no fill, `position: static`, and the frame's 32.4px title
  // promoted to 52.5px, and it scrolled away with the body. Each assertion below
  // failed in that state.
  assert.equal(state.section.isSectionSlide, true, JSON.stringify(state.section));
  assert.equal(
    state.section.headingIsDirectChild,
    true,
    `a section page's band must stay a direct child of its <section>, or it loses its fill, position and size: ${JSON.stringify(state.section)}`
  );
  assert.equal(
    state.section.headingInLayer,
    false,
    `the band must not be moved into the scroll layer: ${JSON.stringify(state.section)}`
  );
  // Matching a colour shape rather than "not transparent": when the band is moved
  // into the layer the heading lookup returns null, and a bare `notEqual` against
  // `rgba(0, 0, 0, 0)` passes for `null` -- so that form of the assertion could not
  // fail in the state it exists for.
  assert.match(
    String(state.section.bandFill),
    /^rgb\(/,
    `a scrollable section page must keep its band fill: ${JSON.stringify(state.section)}`
  );
  assert.equal(
    state.section.bandLeft,
    0,
    `the band must stay full bleed: ${JSON.stringify(state.section)}`
  );
  assert.equal(
    state.section.bandWidth,
    state.section.slideWidth,
    `the band must span the slide: ${JSON.stringify(state.section)}`
  );
  assert.equal(
    state.section.paragraphsInLayer,
    12,
    `the section page's body must be in the layer, and the fixture must keep 12 paragraphs: ${JSON.stringify(state.section)}`
  );
  assert.equal(state.section.overflows, true, JSON.stringify(state.section));
  assert.equal(
    state.section.lastParagraphReachable,
    true,
    `the body must remain reachable even with the band pinned: ${JSON.stringify(state.section)}`
  );

  // The other direction: a frame that stops scrolling gets its body back. Left inside an
  // absolutely positioned layer, the content no longer contributes to the section's
  // scroll height, so the overflow check could never see it again.
  const unwrapped = await page.evaluate(`(async () => {
    const slide = document.getElementById("late-scroll");
    slide.querySelector(":scope > h2").textContent = "Short again";
    window.dispatchEvent(new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const layer = slide.querySelector(":scope > .beamer-scroll");
    return {
      longFrameTitle: slide.classList.contains("beamer-long-frame-title"),
      hasLayer: Boolean(layer),
      directParagraphs: Array.from(slide.children).filter(
        (child) => child.tagName === "P"
      ).length,
      paddingTop: Math.round(parseFloat(getComputedStyle(slide).paddingTop))
    };
  })()`);
  assert.equal(unwrapped.longFrameTitle, false, JSON.stringify(unwrapped));
  assert.equal(
    unwrapped.hasLayer,
    false,
    `a frame that stopped scrolling must get its body back: ${JSON.stringify(unwrapped)}`
  );
  assert(
    unwrapped.directParagraphs > 0,
    `the body must be a direct child again: ${JSON.stringify(unwrapped)}`
  );
  await page.close();
};

const testSectionStyles = async (connection, origin) => {
  // Both variants are measured twice, with the section header on and off, so
  // the header's effect on section-page geometry is actually covered. It was
  // not: the two variants merely happened to differ in their default, which
  // made the difference look covered when it was not.
  const measured = {};
  for (const variant of ["madrid", "cambridgeus"]) {
    for (const secheader of [false, true]) {
      renderFixture("section-styles", {
        metadata: {
          "beamer-variant": variant,
          "beamer-secheader": String(secheader),
        },
      });
      measured[`${variant}:${secheader}`] = await measureSectionStyles(
        connection,
        origin,
        variant
      );
    }
    const state = measured[`${variant}:false`];
    const withHeader = measured[`${variant}:true`];
    assertSectionStyles(variant, state);
    // The same per-style properties must hold with the header showing: measuring
    // a state and never asserting on it leaves half the coverage nominal.
    assertSectionStyles(`${variant} + header`, withHeader);

    // Showing the header must move the pinned section looks down by exactly its
    // height -- both of them read `--beamer-active-headline-height`, so this is
    // what proves one switch still moves them.
    const headerHeight = withHeader.band.headlineHeight;
    assert(
      headerHeight > 0,
      `${variant}: enabling beamer-secheader must show a header`
    );
    for (const kind of ["band", "minimal"]) {
      const shift = withHeader[kind].top - state[kind].top;
      assert(
        Math.abs(shift - headerHeight) < 1.5,
        `${variant}: ${kind} must move down by the header height when the ` +
          `header is shown: ` +
          JSON.stringify({ shift, headerHeight, kind })
      );
      // The stronger claim: the pinned title sits exactly at the header's
      // bottom edge, so it tracks the header rather than merely shifting with
      // it. Checking the shift alone passes even if the title ignores the
      // header entirely and is pushed down by padding meant for something else.
      assert(
        Math.abs(withHeader[kind].top - headerHeight) < 1.5,
        `${variant}: ${kind} title must sit exactly at the header's bottom ` +
          `edge: ` + JSON.stringify({ top: withHeader[kind].top, headerHeight })
      );
    }
    // The badge is centred, not pinned, so it must NOT move by the full header
    // height: it re-centres inside a region that just shrank by `headerHeight`,
    // which moves it by half that. Asserting the full shift here was simply
    // wrong geometry.
    const badgeShift = withHeader.badge.top - state.badge.top;
    assert(
      Math.abs(badgeShift - headerHeight / 2) < 2,
      `${variant}: the centred badge must re-centre when the header appears, ` +
        `moving half its height: ` +
        JSON.stringify({ badgeShift, headerHeight })
    );
    // And it stays centred either way, which is the property that matters.
    for (const [label, look] of [
      ["with header", withHeader.badge],
      ["without header", state.badge],
    ]) {
      assert(
        Math.abs(look.groupCentre - look.areaCentre) < 12,
        `${variant}: badge title+body must stay centred ${label}: ` +
          JSON.stringify({
            groupCentre: look.groupCentre,
            areaCentre: look.areaCentre,
          })
      );
    }
  }
};

const measureSectionStyles = async (connection, origin, variant) => {
  {
    const page = await BrowserPage.create(
      connection,
      `${origin}/section-styles.html`
    );
    const state = await page.evaluate(`(() => {
      const headlineHeight = (slide) => {
        const headline = slide.querySelector(":scope > .beamer-headline");
        const rect = headline ? headline.getBoundingClientRect() : null;
        return rect && rect.height > 0
          ? rect.bottom - slide.getBoundingClientRect().top
          : 0;
      };
      const read = (id) => {
        const slide = document.getElementById(id);
        if (!slide) return null;
        // Reveal only lays a slide out once it is the current one, so present
        // it before measuring anything.
        if (window.Reveal && typeof window.Reveal.slide === "function") {
          const indices = window.Reveal.getIndices(slide);
          window.Reveal.slide(indices.h, indices.v);
        }
        const heading = slide.querySelector(":scope > h1");
        const body = slide.querySelector(":scope > p");
        const style = getComputedStyle(heading);
        const headingRect = heading.getBoundingClientRect();
        const slideRect = slide.getBoundingClientRect();
        const headerHeight = headlineHeight(slide);
        // The line box that carries the title's text. \`centerTitleInk\` transforms
        // the wrapper (not the heading) so the heading's own box stays the band
        // for the filled looks; the wrapper's rect is therefore what moves when
        // the ink is centred, and what the eye reads as the title's edge.
        const ink = heading.querySelector(":scope > .beamer-title-ink") || heading;
        const inkRect = ink.getBoundingClientRect();
        const bodyRect = body ? body.getBoundingClientRect() : null;
        return {
          isSectionSlide: slide.classList.contains("beamer-section-slide"),
          headlineHeight: headerHeight,
          // Air above the title's text and air below it, both to the next box the
          // eye sees: the headline's bottom edge, and the first body line.
          airAbove: inkRect.top - (slideRect.top + headerHeight),
          airBelow: bodyRect ? bodyRect.top - inkRect.bottom : null,
          left: headingRect.left - slideRect.left,
          width: headingRect.width,
          top: headingRect.top - slideRect.top,
          height: headingRect.height,
          radius: parseFloat(style.borderTopLeftRadius),
          color: style.color,
          // A transparent fill means the text sits on the page background, so
          // that is what its contrast must be measured against.
          effectiveBackground:
            style.backgroundColor === "rgba(0, 0, 0, 0)"
              ? opaqueBackdrop(slide)
              : style.backgroundColor,
          hasShadow: style.boxShadow !== "none" && style.boxShadow !== "",
          align: style.textAlign,
          fontSize: parseFloat(style.fontSize),
          background: style.backgroundColor,
          bodyTop: body ? body.getBoundingClientRect().top - slideRect.top : null,
          bodyBelowHeading: body
            ? body.getBoundingClientRect().top >= headingRect.bottom - 0.5
            : null,
          // Centre of the title together with every body block, and the centre
          // of the space between the headline and the footline.
          bodyColor: body ? getComputedStyle(body).color : null,
          // The body sits on the page, not on the title's band, so it needs its
          // own backdrop rather than reusing the title's.
          bodyBackground: body ? opaqueBackdrop(body) : null,
          groupCentre: (() => {
            const boxes = Array.from(slide.children)
              .filter(
                (node) =>
                  !node.matches(
                    ".beamer-headline, .beamer-footline, .aside-footnotes, aside.notes"
                  )
              )
              .map((node) => node.getBoundingClientRect())
              .filter((rect) => rect.height > 0);
            if (!boxes.length) return null;
            return (
              (Math.min(...boxes.map((r) => r.top)) +
                Math.max(...boxes.map((r) => r.bottom))) /
              2
            );
          })(),
          areaCentre: (() => {
            const headline = slide.querySelector(":scope > .beamer-headline");
            const footline = slide.querySelector(":scope > .beamer-footline");
            const top = headline
              ? headline.getBoundingClientRect().bottom
              : slideRect.top;
            const bottom = footline
              ? footline.getBoundingClientRect().top
              : slideRect.bottom;
            return (top + bottom) / 2;
          })(),
        };
      };
      // A slide's own background is usually transparent, so the real backdrop
      // is whatever opaque colour an ancestor paints.
      const opaqueBackdrop = (element) => {
        let node = element;
        while (node && node.nodeType === 1) {
          const value = getComputedStyle(node).backgroundColor;
          const parts = String(value).match(/[\d.]+/g);
          const alpha = parts && parts.length > 3 ? Number(parts[3]) : 1;
          if (parts && alpha > 0.05) return value;
          node = node.parentElement;
        }
        return "rgb(255, 255, 255)";
      };
      return {
        backdrop: opaqueBackdrop(document.getElementById("sec-default")),
        band: read("sec-default"),
        badge: read("sec-badge"),
        minimal: read("sec-minimal"),
        // A title that wraps. The band is in the document flow, so its own height
        // is what reserves the space -- a fixed reservation buried the first line
        // of the body once the title ran past one line.
        longTitle: read("sec-long"),
        // An H2 is an ordinary frame: it must NOT pick up a section look, which
        // is what keeps the attribute meaningful rather than universal.
        frameIsSection: Boolean(
          document
            .getElementById("sec-frame")
            ?.classList.contains("beamer-section-slide")
        ),
      };
    })()`);
    await page.close();
    return state;
  }
};

const assertSectionStyles = (variant, state) => {
  {
    assert.equal(
      state.frameIsSection,
      false,
      `${variant}: an ordinary frame must not become a section page`
    );
    const parseRgb = (value) => {
      const parts = String(value).match(/[\d.]+/g);
      return parts ? parts.slice(0, 3).map(Number) : null;
    };
    const relativeLuminance = (value) => {
      const rgb = parseRgb(value);
      if (!rgb) return null;
      const [r, g, b] = rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrastRatio = (foreground, background) => {
      const a = relativeLuminance(foreground);
      const b = relativeLuminance(background);
      if (a === null || b === null) return null;
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    for (const kind of ["band", "badge", "minimal"]) {
      const look = state[kind];
      assert(look, `${variant}: the ${kind} section page was not rendered`);
      assert.equal(
        look.isSectionSlide,
        true,
        `${variant}: ${kind} must still be a section page`
      );
      assert.equal(
        look.bodyBelowHeading,
        true,
        `${variant}: ${kind} body must clear the title`
      );
      // The minimal look drops the band's fill but used to keep the band's
      // white text, which rendered white-on-white for Madrid. Asserting only
      // that the fill is transparent did not catch it; legibility has to be
      // checked directly.
      const titleContrast = contrastRatio(look.color, look.effectiveBackground);
      assert(
        titleContrast !== null && titleContrast >= 4.5,
        `${variant}: ${kind} title must be legible against its background: ` +
          JSON.stringify({
            color: look.color,
            background: look.effectiveBackground,
            contrast: titleContrast,
          })
      );
      // Not a skip: every look in the fixture carries prose, so a missing body
      // colour means the paragraph went away and with it the legibility check.
      assert(
        look.bodyColor,
        `${variant}: the ${kind} section page carries no body text to check for ` +
          "legibility; the fixture must keep a paragraph on every look"
      );
      const bodyContrast = contrastRatio(
        look.bodyColor,
        look.bodyBackground
      );
      assert(
        bodyContrast !== null && bodyContrast >= 4.5,
        `${variant}: ${kind} body text must be legible: ` +
          JSON.stringify({ color: look.bodyColor, bg: look.bodyBackground, contrast: bodyContrast })
      );
    }
    // The regression guard for the band's height. `bodyBelowHeading` is checked
    // for every look above, but only this page has a title tall enough to make it
    // mean anything: with a fixed reservation the band reached 52.7px into the
    // body and the first line was painted underneath it.
    assert(state.longTitle, `${variant}: the wrapping section page was not rendered`);
    assert.equal(
      state.longTitle.bodyBelowHeading,
      true,
      `${variant}: a wrapping section title must not reach into its body: ` +
        JSON.stringify(state.longTitle)
    );
    assert(
      state.longTitle.height > state.band.height,
      `${variant}: the wrapping section page must actually wrap, or this check is ` +
        `vacuous: ${JSON.stringify({ long: state.longTitle.height, band: state.band.height })}`
    );

    assert.equal(state.band.align, "left", `${variant}: default band alignment`);

    // Default: full-bleed band flush under the headline.
    assert.equal(state.band.left, 0, `${variant}: default band inset`);
    assert(
      Math.abs(state.band.top - state.band.headlineHeight) < 1,
      `${variant}: default band must sit flush under the headline`
    );
    assert.equal(state.band.radius, 0, `${variant}: default band radius`);
    assert.equal(state.band.hasShadow, false, `${variant}: default band shadow`);

    // Badge: inset, rounded, shadowed, centred, larger text.
    assert(state.badge.left > 0, `${variant}: badge must be inset`);
    assert(state.badge.width < state.band.width, `${variant}: badge must be narrower`);
    assert(
      state.badge.top > state.badge.headlineHeight + 1,
      `${variant}: badge must be pushed below the headline`
    );
    // Title and body are centred as ONE block. Centring the title alone left
    // the pair bottom-heavy by ~100px once the page carried any prose.
    assert(
      Math.abs(state.badge.groupCentre - state.badge.areaCentre) < 12,
      `${variant}: badge title+body must be centred as a block: ` +
        JSON.stringify({
          groupCentre: state.badge.groupCentre,
          areaCentre: state.badge.areaCentre,
        })
    );
    assert(state.badge.radius > 0, `${variant}: badge radius`);
    assert.equal(state.badge.hasShadow, true, `${variant}: badge shadow`);
    assert.equal(state.badge.align, "center", `${variant}: badge alignment`);
    // A badge must be a solid object. If its fill is transparent the shadow is
    // drawn around nothing and renders as a stray rule under the text.
    assert.notEqual(
      state.badge.background,
      "rgba(0, 0, 0, 0)",
      `${variant}: badge must have an opaque fill, or its shadow outlines nothing`
    );
    assert.notEqual(
      state.badge.color,
      state.badge.background,
      `${variant}: badge text must contrast with its fill`
    );
    assert(
      state.badge.fontSize > state.band.fontSize,
      `${variant}: badge must be set larger than the default band`
    );

    // Minimal: centred text, no fill at all.
    assert.equal(state.minimal.align, "center", `${variant}: minimal alignment`);
    assert.equal(
      state.minimal.background,
      "rgba(0, 0, 0, 0)",
      `${variant}: minimal must have no fill`
    );
    assert.equal(state.minimal.hasShadow, false, `${variant}: minimal shadow`);
    assert(
      Math.abs(state.minimal.top - state.minimal.headlineHeight) < 1,
      `${variant}: minimal stays flush under the headline`
    );
    // Staying flush is not enough on its own: the look shipped with the title's
    // air split 13px above / 43px below, because it kept the band's `min-height`
    // and the heading's bottom margin. The two gaps are what a reader sees, so
    // they are what has to match. Measured 21/15 with a Latin title and a
    // headline showing; the tolerance leaves room for font metrics but is far
    // below the ~30px asymmetry this regressed to. `assertSectionStyles` runs
    // twice, so this holds with and without the headline.
    if (state.minimal.airBelow !== null) {
      assert(
        Math.abs(state.minimal.airAbove - state.minimal.airBelow) <= 10,
        `${variant}: the minimal look's air must read as symmetric: ` +
          JSON.stringify({
            airAbove: state.minimal.airAbove,
            airBelow: state.minimal.airBelow,
          })
      );
    }
  }
};

// Block titles are real text nodes built from an attribute value: they must
// survive UTF-8, escaping, and multiple words without being split or dropped.
const testBlockTitles = async (connection, origin) => {
  renderFixture("block-titles");
  const page = await BrowserPage.create(
    connection,
    `${origin}/block-titles.html#/block-titles`
  );
  const state = await page.evaluate(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const blocks = Array.from(document.querySelectorAll("#block-titles .beamer-block"));
    return blocks.map((block) => {
      const title = block.querySelector(":scope > .beamer-block-title");
      const blockRect = block.getBoundingClientRect();
      const titleRect = title?.getBoundingClientRect();
      return {
        text: title ? title.textContent.trim() : null,
        html: title ? title.innerHTML : null,
        hasTitle: Boolean(title),
        hasDataTitle: block.hasAttribute("data-title"),
        pseudoContent: getComputedStyle(block, "::before").content,
        titleCoversBlock: titleRect
          ? titleRect.width >= blockRect.width - 12
          : null,
        searchable: title
          ? document.body.innerText.includes(title.textContent.trim())
          : null
      };
    });
  })()`);
  assert.equal(state.length, 4, JSON.stringify(state));
  assert.equal(state[0].text, "Definition & scope of the model");
  assert.equal(state[0].html.includes("&amp;"), true, JSON.stringify(state[0]));
  assert.equal(state[1].text, "多词 中文 标题");
  // Titles stay literal: markdown syntax must not be interpreted.
  assert.equal(state[2].text, "含 **强调** 与 `代码` 的标题");
  assert.doesNotMatch(state[2].html, /<strong>/);
  assert.equal(state[3].hasTitle, false);
  for (const block of state) {
    assert.equal(block.hasDataTitle, false, JSON.stringify(block));
    assert.equal(block.pseudoContent, "none", JSON.stringify(block));
    if (block.hasTitle) {
      assert.equal(block.searchable, true, JSON.stringify(block));
      assert.equal(block.titleCoversBlock, true, JSON.stringify(block));
    }
  }
  await page.close();
};

// `process._getActiveHandles` is a private Node API, and `debugCleanup`'s arguments
// are evaluated whether or not the debug output is enabled -- so an unguarded call
// would not stay confined to debug runs. It would throw at the very end of every
// run, CI included, the day that API is renamed or removed, and it would do it while
// the run was otherwise green.
const activeHandleNames = () => {
  try {
    return typeof process._getActiveHandles === "function"
      ? process._getActiveHandles().map((handle) => handle?.constructor?.name)
      : "(process._getActiveHandles is not available)";
  } catch (error) {
    return `(could not read the active handles: ${error.message})`;
  }
};

// Each teardown step runs on its own, so a failure in one cannot skip the rest. The
// steps are ordered most-important-last for the reader, not for safety: without this,
// a throw in `shutdownChrome` (or in the temporary-input loop above it) left the
// browser running and the profile directory on disk, and it also replaced the real
// test failure with a teardown error.
const teardownStep = async (name, run) => {
  try {
    await run();
  } catch (error) {
    console.warn(`Warning: teardown step "${name}" failed: ${error.message}`);
  }
};

let server;
let chrome;
try {
  // Before anything destructive. Two suites at once share this checkout: fixed
  // temporary input names in the repo root and a single `tests/_output`.
  // Interleaved runs delete each other's inputs and overwrite each other's
  // renders, which shows up as unrelated DOM errors deep inside a probe.
  // Refusing to start beats debugging that -- but only if the refusal happens
  // before `resetDirectory` wipes the other run's output, which is why this is
  // the first statement of the run rather than the last one before the browser
  // phase.
  acquireRunLock();

  resetDirectory(outputDir);
  resetDirectory(artifactsDir);
  run("node", ["--check", "_extensions/beamerslides/beamer.js"]);
  renderTemplate("template");
  renderTemplate("template-cambridgeus");
  let bogusRefsOverflowStderr = "";
  for (const fixture of [
    "madrid",
    "cambridgeus",
    "options",
    "offline",
    "centering",
    "behavior",
    "refs-pagination",
    "refs-multifile",
    "refs-surplus",
    "refs-auto",
    "refs-empty",
    "scroll-layers",
  ]) {
    renderFixture(fixture);
  }
  // `refs-overflow: scroll` keeps the bibliography on one page; reused sources keep the
  // fixtures to a minimum, and one of them declares `item` so the ignored-breaks warning is
  // covered too.
  renderFixture("refs-scroll", {
    source: "refs-auto",
    metadata: { "refs-overflow": "scroll" },
  });
  renderFixture("refs-scroll-item", {
    source: "refs-pagination",
    metadata: { "refs-overflow": "scroll" },
  });
  // The same deck with nothing cited, in both modes, plus an unknown value: the Lua side has
  // to warn and fall back to paginating rather than guess.
  renderFixture("refs-empty-scroll", {
    source: "refs-empty",
    metadata: { "refs-overflow": "scroll" },
  });
  bogusRefsOverflowStderr = renderFixture("refs-bogus", {
    source: "refs-pagination",
    metadata: { "refs-overflow": "bogus", "refs-order": "bogus" },
  });
  renderFixture("spacing-madrid", {
    source: "spacing",
    metadata: { "beamer-variant": "madrid" },
  });
  renderFixture("spacing-cambridgeus", {
    source: "spacing",
    metadata: { "beamer-variant": "cambridgeus" },
  });
  renderFixture("spacing-endnotes-madrid", {
    source: "spacing",
    metadata: {
      "beamer-variant": "madrid",
      "reference-location": "document",
    },
  });
  renderFixture("spacing-endnotes-cambridgeus", {
    source: "spacing",
    metadata: {
      "beamer-variant": "cambridgeus",
      "reference-location": "document",
    },
  });
  assert.doesNotMatch(
    readFileSync(join(outputDir, "offline.html"), "utf8"),
    /https:\/\/cdn\.jsdelivr\.net\/npm\/katex/
  );
  // An unusable `refs-overflow` is reported by the filter and falls back to the default; the
  // test below also checks that the deck really paginated rather than silently scrolling.
  assert.match(
    bogusRefsOverflowStderr,
    /Unknown refs-overflow 'bogus'; using 'paginate'\./
  );
  assert.match(
    bogusRefsOverflowStderr,
    /Unknown refs-order 'bogus'; using 'citation'\./
  );

  // The run lock is already held: it was claimed at the top of this block, before
  // the destructive output reset (see there).

  const local = await startServer();
  server = local.server;
  chrome = await launchChrome();

  await testMadrid(chrome.connection, local.origin);
  await testCambridgeUs(chrome.connection, local.origin);
  await testOptions(chrome.connection, local.origin);
  await testOffline(chrome.connection, local.origin);
  await testCentering(chrome.connection, local.origin);
  await testBehavior(chrome.connection, local.origin);
  await testFourThreeViewport(chrome.connection, local.origin);
  await testSpacing(chrome.connection, local.origin);
  await testDocumentFootnotes(chrome.connection, local.origin);
  await testInjectionTiming(chrome.connection, local.origin);
  await testInvalidOptions(chrome.connection, local.origin);
  await testOverflowDiagnostics(chrome.connection, local.origin);
  await testPaletteOverrides(chrome.connection, local.origin);
  await testBlockTitles(chrome.connection, local.origin);
  await testReferencesPagination(chrome.connection, local.origin);
  await testReferencesMultifile(chrome.connection, local.origin);
  await testReferencesAutoPages(chrome.connection, local.origin);
  await testReferencesScroll(chrome.connection, local.origin);
  await testScrollLayers(chrome.connection, local.origin);
  await testPaletteAlgebra(chrome.connection, local.origin);
  await testSectionStyles(chrome.connection, local.origin);
  assertNoBrowserErrors(chrome.connection);

  console.log("All beamerslides regression tests passed.");
  console.log(`Artifacts: ${relative(rootDir, artifactsDir)}`);
} finally {
  debugCleanup("start");
  await teardownStep("remove the temporary inputs", () => {
    for (const temporaryInput of temporaryInputs) {
      try {
        if (existsSync(temporaryInput)) unlinkSync(temporaryInput);
      } catch (error) {
        console.warn(
          `Warning: could not remove ${temporaryInput}: ${error.message}`
        );
      }
    }
  });
  await teardownStep("restore tests/fixtures/.gitignore", () => {
    if (!fixtureIgnoreExisted && existsSync(generatedFixtureIgnore)) {
      unlinkSync(generatedFixtureIgnore);
    }
  });
  debugCleanup("temporary inputs removed");
  if (chrome) {
    debugCleanup("stopping Chrome");
    // Chrome first: it holds the profile directory that is removed last.
    await teardownStep("stop Chrome", () => shutdownChrome(chrome));
    debugCleanup("Chrome stopped", chrome.processHandle.exitCode, chrome.processHandle.signalCode);
  }
  if (server) {
    debugCleanup("closing HTTP server");
    await teardownStep("close the HTTP server", async () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise((resolveClose) => {
        server.close((error) => {
          if (error) console.warn(`Warning: could not close HTTP server: ${error.message}`);
          resolveClose();
        });
      });
    });
    debugCleanup("HTTP server closed");
  }
  await teardownStep("remove the Chrome profile directory", () =>
    removeTemporaryDirectory(chromeTemporaryDir)
  );
  debugCleanup("done", activeHandleNames());
}
