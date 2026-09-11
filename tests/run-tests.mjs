import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";

import {
  BrowserPage,
  artifactsDir,
  assertNoBrowserErrors,
  assertPrintLayout,
  baselinesDir,
  chromeTemporaryDir,
  debugCleanup,
  delay,
  fixtureIgnoreExisted,
  generatedFixtureIgnore,
  launchChrome,
  outputDir,
  printLayoutMeasurementSource,
  removeTemporaryDirectory,
  renderFixture,
  renderTemplate,
  resetDirectory,
  rootDir,
  run,
  runCapture,
  showSlide,
  shutdownChrome,
  startServer,
  temporaryInputs,
  testsDir,
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
      leafSlides: document.querySelectorAll(".beamer-leaf-slide").length,
      headlineCount: document.querySelectorAll(".beamer-leaf-slide > .beamer-headline").length,
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
    const contentBottom = Math.max(
      slide.querySelector("table").getBoundingClientRect().bottom,
      filename.closest(".code-with-filename").getBoundingClientRect().bottom
    );
    return {
      backgroundLabel: measureInline(".bg"),
      button: measureInline(".button"),
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
  assert.match(titleState.classes, /beamer-has-headline/);
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
  assert.match(state.classes, /beamer-has-headline/);
  assert.match(state.classes, /beamer-has-progress/);
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
      uncountedClass: slide.classList.contains("beamer-uncounted-slide"),
      numberCount: footer.querySelectorAll(".beamer-footline-number").length,
      progressWidth: footer
        .querySelector(".beamer-footline-progress")
        .getBoundingClientRect().width
    };
  })()`);
  assert.equal(optionalState.visibility, "uncounted");
  assert.equal(optionalState.uncountedClass, true);
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

const readDocumentFootnoteState = `(() => {
  const slide = document.querySelector("section.footnotes");
  const list = slide?.querySelector(":scope > ol");
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
  const state = await page.evaluate(readDocumentFootnoteState);
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
  const printState = await printPage.evaluate(readDocumentFootnoteState);
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
          if (window.__beamerTimeline.frames === undefined) {
            window.__beamerTimeline.frames = 0;
          }
          window.__beamerTimeline.frames += 1;
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
      headlineCount: document.querySelectorAll(".beamer-leaf-slide > .beamer-headline").length,
      progressCount: document.querySelectorAll(".beamer-footline-progress").length,
      slideCount: document.querySelectorAll(".beamer-leaf-slide").length,
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
    return {
      warnings: window.__beamerWarnings,
      overflows: slide.scrollHeight > slide.clientHeight + 2,
      overflowBy: slide.scrollHeight - slide.clientHeight,
      scrollableOverflow: scrollable.scrollHeight - scrollable.clientHeight
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

  // Reveal paginates the deck in print/PDF layout, so a slide's client height no
  // longer describes its content box: the check must stay silent there. The
  // Madrid fixture is used because it does not overflow on screen, so any
  // warning below can only come from a phantom print measurement.
  const printPage = await BrowserPage.create(
    connection,
    `${origin}/madrid.html?print-pdf`,
    undefined,
    { preloadScript: consoleWarningCaptureSource }
  );
  const screenWarnings = await printPage.evaluate(`window.__beamerWarnings`);
  assert.deepEqual(
    screenWarnings,
    [],
    `the madrid fixture must not overflow on screen, otherwise this check is meaningless: ${JSON.stringify(screenWarnings)}`
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
        },
        Example: {
          background: toHex(madridExampleBand),
          body: bodyOf(madridExampleBand),
          color: "#ffffff",
        },
        Alert: {
          background: toHex(madridAlertBand),
          body: bodyOf(madridAlertBand),
          color: "#ffffff",
        },
      },
    },
    cambridgeus: {
      // beaver: frametitle bg = gray!10!white.
      frameTitle: toHex(mix(GRAY, 0.1, WHITE)),
      blocks: {
        // No orchid -> `block title` keeps parent=structure with an empty bg,
        // so every kind is unfilled and the parent colour shows as text.
        // Alert uses the undiluted darkred, not beaver's grey-mixed
        // `darkred!80!gray`: the grey was what made the alert read quieter
        // than the plain block.
        // Plain block titles are a deliberate amber, not `structure`: red is
        // reserved for the markers and the alert signal, so the plain block
        // sits in the middle of the warm range instead of competing.
        Plain: { background: "transparent", body: "transparent", color: "#b45309" },
        Example: {
          background: "transparent",
          body: "transparent",
          color: toHex(EXAMPLE_TEXT),
        },
        Alert: { background: "transparent", body: "transparent", color: toHex(DARKRED) },
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
      if (actual == null) continue;
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
    }
    await page.close();
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

let server;
let chrome;
try {
  resetDirectory(outputDir);
  resetDirectory(artifactsDir);
  run("node", ["--check", "_extensions/beamerslides/beamer.js"]);
  renderTemplate("template");
  renderTemplate("template-cambridgeus");
  for (const fixture of [
    "madrid",
    "cambridgeus",
    "options",
    "offline",
    "centering",
    "behavior",
  ]) {
    renderFixture(fixture);
  }
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
  await testPaletteAlgebra(chrome.connection, local.origin);
  assertNoBrowserErrors(chrome.connection);

  console.log("All beamerslides regression tests passed.");
  console.log(`Artifacts: ${relative(rootDir, artifactsDir)}`);
} finally {
  debugCleanup("start");
  for (const temporaryInput of temporaryInputs) {
    if (existsSync(temporaryInput)) unlinkSync(temporaryInput);
  }
  if (!fixtureIgnoreExisted && existsSync(generatedFixtureIgnore)) {
    unlinkSync(generatedFixtureIgnore);
  }
  debugCleanup("temporary inputs removed");
  if (chrome) {
    debugCleanup("stopping Chrome");
    await shutdownChrome(chrome);
    debugCleanup("Chrome stopped", chrome.processHandle.exitCode, chrome.processHandle.signalCode);
  }
  if (server) {
    debugCleanup("closing HTTP server");
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise((resolveClose) => {
      server.close((error) => {
        if (error) console.warn(`Warning: could not close HTTP server: ${error.message}`);
        resolveClose();
      });
    });
    debugCleanup("HTTP server closed");
  }
  await removeTemporaryDirectory(chromeTemporaryDir);
  debugCleanup(
    "done",
    process._getActiveHandles().map((handle) => handle.constructor?.name)
  );
}
