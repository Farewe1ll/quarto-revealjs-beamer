(function () {
  "use strict";

  const DEFAULT_FRAME_TITLE_HEIGHT = 58;
  // Frame-title steps are multiples of the base height so a theme that changes
  // `--beamer-frame-height` keeps the same proportions. The ratios reproduce
  // the 92 / 118 / 132 px breakpoints of the default 58px title bar.
  const COMPACT_FRAME_TITLE_RATIO = 1.5862;
  const TIGHT_FRAME_TITLE_RATIO = 2.0345;
  const SCROLLING_FRAME_TITLE_RATIO = 2.2759;
  const POLL_INTERVAL_MS = 25;
  const MAX_POLL_ATTEMPTS = 200;
  // Mirrors the `0.1em` fallback in beamer.scss's ordered-marker rule
  // (`padding: 0 0 var(--beamer-marker-padding-bottom, 0.1em)`), in em of the
  // marker's own font size. It is deliberately a constant rather than a read-back
  // of the computed value: `--beamer-marker-padding-bottom` inherits, so a nested
  // list's marker resolves it to the padding this pass wrote on its ANCESTOR.
  // Caching that as the nested marker's own baseline is what made its correction
  // depend on the parent's glyphs -- measured 0.11614em against the outer
  // marker's 0.1em.
  const MARKER_PADDING_BASE_EM = 0.1;

  const text = (node) => (node ? node.textContent.trim() : "");
  const meta = (name) => {
    const node = document.querySelector(`meta[name="${name}"]`);
    return node ? node.content.trim() : "";
  };

  const metaBoolean = (name, fallback) => {
    const value = meta(name).toLowerCase();
    if (value === "true" || value === "1" || value === "yes") {
      return true;
    }
    if (value === "false" || value === "0" || value === "no") {
      return false;
    }
    return fallback;
  };

  const directHeading = (slide, selector) => {
    for (const child of slide.children) {
      if (child.matches && child.matches(selector)) {
        return child;
      }
    }
    return null;
  };

  // Read the base height from the element that owns the theme variables, not
  // from the slide (whose inline `--beamer-frame-height` this script rewrites).
  const baseFrameTitleHeight = () => {
    const reveal = document.querySelector(".reveal");
    const read = (element) =>
      element
        ? Number.parseFloat(
            window
              .getComputedStyle(element)
              .getPropertyValue("--beamer-frame-height")
          )
        : Number.NaN;
    const value = read(reveal);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
    const rootValue = read(document.documentElement);
    return Number.isFinite(rootValue) && rootValue > 0
      ? rootValue
      : DEFAULT_FRAME_TITLE_HEIGHT;
  };

  const leafSlides = () =>
    Array.from(document.querySelectorAll(".reveal .slides section")).filter(
      (slide) => {
        const hasNestedSection = Array.from(slide.children).some(
          (child) => child.tagName.toLowerCase() === "section"
        );
        const hasContent = Array.from(slide.children).some(
          (child) => !child.matches(".beamer-headline, .beamer-footline")
        );

        return !hasNestedSection && (slide.id !== "" || hasContent);
      }
    );

  const titleMetadata = () => {
    const titleSlide = document.querySelector("#title-slide");
    const authorNodes = titleSlide
      ? titleSlide.querySelectorAll(".quarto-title-author-name, .author")
      : [];
    const authors = Array.from(authorNodes)
      .map(text)
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(", ");

    return {
      title:
        meta("beamer-short-title") ||
        text(titleSlide && titleSlide.querySelector(".title")) ||
        document.title,
      author: meta("beamer-short-author") || authors,
      institute:
        meta("beamer-short-institute") ||
        text(
          titleSlide &&
            titleSlide.querySelector(".institute, .quarto-title-affiliation")
        ),
      date:
        meta("beamer-short-date") ||
        text(titleSlide && titleSlide.querySelector(".date")),
    };
  };

  // Replace the small raster ORCID mark with a vector at presentation size.
  // Public hook ownership: docs/architecture.md, '公共接口与内部状态'.
  const createOrcidIcon = () => {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 256 256");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("beamer-orcid-icon");

    const path = (fill, d) => {
      const node = document.createElementNS(svgNamespace, "path");
      node.setAttribute("fill", fill);
      node.setAttribute("d", d);
      svg.appendChild(node);
    };

    path(
      "#A6CE39",
      "M256,128c0,70.7-57.3,128-128,128C57.3,256,0,198.7,0,128C0,57.3,57.3,0,128,0S256,57.3,256,128z"
    );
    path(
      "#FFFFFF",
      "M86.3,186.2H70.9V79.1h15.4v48.4V186.2z M108.9,79.1h41.6c39.6,0,57,28.3,57,53.6c0,27.5-21.5,53.6-56.8,53.6h-41.8V79.1z M124.3,172.5h24.5c34.9,0,42.9-26.5,42.9-39.9c0-21.8-13.9-39.9-43.7-39.9h-23.7V172.5z M88.7,56.8c0,5.5-4.5,10.1-10.1,10.1c-5.6,0-10.1-4.6-10.1-10.1c0-5.6,4.5-10.1,10.1-10.1C84.2,46.7,88.7,51.2,88.7,56.8z"
    );
    return svg;
  };

  const replaceOrcidIcons = () => {
    document
      .querySelectorAll(".quarto-title-author-orcid img")
      .forEach((image) => image.replaceWith(createOrcidIcon()));
  };

  // ---- Shared glyph metrics -------------------------------------------------
  // Reuse one canvas context for metrics and pixel reads. Resizing clears context
  // state, so drawnInk restores the font and measureFont sets it on each call.
  let metricsContext = null;
  const glyphContext = () => {
    if (!metricsContext) {
      metricsContext = document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true });
    }
    return metricsContext;
  };

  const fontShorthand = (style, size) =>
    [style.fontStyle, style.fontWeight, size, style.fontFamily].join(" ");

  // Return null when the font box is unavailable, so callers leave it unchanged.
  // Keep actualBoundingBox* unfiltered: marker/label callers validate that pair,
  // while drawnInk measures pixels and only needs the already-finite font box.
  const measureFont = (context, style, text) => {
    context.font = fontShorthand(style, style.fontSize);
    const measured = context.measureText(text);
    const actualAscent = measured.actualBoundingBoxAscent;
    const actualDescent = measured.actualBoundingBoxDescent;
    const fontAscent = Number.isFinite(measured.fontBoundingBoxAscent)
      ? measured.fontBoundingBoxAscent
      : actualAscent;
    const fontDescent = Number.isFinite(measured.fontBoundingBoxDescent)
      ? measured.fontBoundingBoxDescent
      : actualDescent;
    if (!Number.isFinite(fontAscent) || !Number.isFinite(fontDescent)) {
      return null;
    }
    return { measured, actualAscent, actualDescent, fontAscent, fontDescent };
  };

  // Fallback-font bounds can be much larger than the painted glyphs; title
  // correction reads drawn pixels rather than trusting those bounds.
  const drawnInk = (context, style, text, font, lineHeight) => {
    const canvas = context.canvas;
    const width = Math.ceil(font.measured.width) + 8;
    const height = Math.ceil(lineHeight * 3);
    canvas.width = width;
    canvas.height = height;
    context.font = fontShorthand(style, style.fontSize);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#000";
    const baseline = Math.round(height / 2);
    context.textBaseline = "alphabetic";
    context.fillText(text, 4, baseline);

    const pixels = context.getImageData(0, 0, width, height).data;
    let firstRow = -1;
    let lastRow = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] > 20) {
          if (firstRow < 0) {
            firstRow = y;
          }
          lastRow = y;
          break;
        }
      }
    }
    if (firstRow < 0) {
      return null;
    }
    return {
      lineHeight,
      // Distance from the line box's top down to the painted ink's centre: the
      // half-leading term places the baseline inside the line box, then the
      // ink's midpoint sits half its own sign-height below that baseline.
      inkCentreFromLineTop:
        (lineHeight - (font.fontAscent + font.fontDescent)) / 2 +
        font.fontAscent +
        (lastRow - firstRow) / 2 -
        (baseline - firstRow),
    };
  };

  // CSS centers line boxes; this pass centers the painted glyphs inside each label.
  const alignInlineLabels = () => {
    const labels = Array.from(document.querySelectorAll(".bg, .button"));
    if (labels.length === 0) {
      return;
    }

    const context = glyphContext();
    if (!context) {
      return;
    }

    labels.forEach((label) => {
      let textNode = label.querySelector(
        ":scope > .beamer-inline-label-text"
      );

      if (!textNode) {
        const hasElementChild = Array.from(label.childNodes).some(
          (node) => node.nodeType === Node.ELEMENT_NODE
        );
        if (hasElementChild) {
          return;
        }

        textNode = document.createElement("span");
        textNode.className = "beamer-inline-label-text";
        while (label.firstChild) {
          textNode.appendChild(label.firstChild);
        }
        label.appendChild(textNode);
      }

      const value = textNode.textContent.trim();
      if (!value) {
        return;
      }

      textNode.style.top = "0px";
      const style = window.getComputedStyle(textNode);
      const fontSize = Number.parseFloat(style.fontSize);
      const lineHeight = Number.parseFloat(style.lineHeight);
      if (!Number.isFinite(fontSize) || !Number.isFinite(lineHeight)) {
        return;
      }

      const font = measureFont(context, style, value);
      if (!font) {
        return;
      }
      const { actualAscent, actualDescent, fontAscent, fontDescent } = font;
      if (
        !Number.isFinite(actualAscent) ||
        !Number.isFinite(actualDescent)
      ) {
        return;
      }

      const revealScale = Math.max(
        0.0001,
        window.Reveal && typeof window.Reveal.getScale === "function"
          ? window.Reveal.getScale()
          : 1
      );
      const labelRect = label.getBoundingClientRect();
      const textRect = textNode.getBoundingClientRect();
      if (labelRect.height === 0 || textRect.height === 0) {
        return;
      }
      const inkOffset =
        (lineHeight - fontAscent - fontDescent) / 2 +
        fontAscent +
        (actualDescent - actualAscent) / 2;
      const inkCenter = textRect.top + revealScale * inkOffset;
      const labelCenter = labelRect.top + labelRect.height / 2;
      const shiftEm =
        -(inkCenter - labelCenter) / revealScale / fontSize;

      textNode.style.top = `${shiftEm}em`;
      label.style.setProperty("--beamer-inline-label-shift", `${shiftEm}em`);
      label.dataset.beamerInlineAligned = "true";
    });
  };

  const fontMetrics = (style, text, contentBoxHeight) => {
    const context = glyphContext();
    if (!context) {
      return null;
    }
    const fontSize = Number.parseFloat(style.fontSize);
    const lineHeight = Number.parseFloat(style.lineHeight);
    if (!Number.isFinite(fontSize) || !Number.isFinite(lineHeight)) {
      return null;
    }
    // One line only: with several lines the band is laid out from the top, so
    // centring the first line's ink would just push the whole block around.
    if (contentBoxHeight > lineHeight * 1.5) {
      return null;
    }
    const font = measureFont(context, style, text);
    if (!font) {
      return null;
    }
    return drawnInk(context, style, text, font, lineHeight);
  };

  // The line box and painted glyphs have different centres. Only the text
  // wrapper is transformed; band geometry follows docs/architecture.md, G2.
  const titleTextWrapper = (title) => {
    let wrapper = title.querySelector(":scope > .beamer-title-ink");
    if (!wrapper) {
      wrapper = document.createElement("span");
      wrapper.className = "beamer-title-ink";
      while (title.firstChild) {
        wrapper.appendChild(title.firstChild);
      }
      title.appendChild(wrapper);
    }
    return wrapper;
  };

  // CSS centres a badge's title/body group; this pass only aligns title ink.
  // Computing the group's offset here would feed measured height back into
  // its own padding. Band/minimal positioning is the extension's design (G1).
  const centerTitleInk = () => {
    const titles = document.querySelectorAll(
      ".reveal .slides section.beamer-section-slide > h1:first-of-type, " +
        ".reveal .slides section.beamer-frame-slide > h2:first-of-type"
    );
    titles.forEach((title) => {
      const titleText = title.textContent.trim();
      if (!titleText || title.clientHeight <= 0) {
        return;
      }
      const wrapper = titleTextWrapper(title);
      wrapper.style.removeProperty("transform");
      // Viewport rects include Reveal's transform scale; undo it before
      // comparing the text height against the unscaled CSS line height.
      const revealScale =
        window.Reveal && typeof window.Reveal.getScale === "function"
          ? window.Reveal.getScale()
          : 1;
      const metrics = fontMetrics(
        window.getComputedStyle(title),
        titleText,
        wrapper.getBoundingClientRect().height / Math.max(0.0001, revealScale)
      );
      if (!metrics) {
        return;
      }
      const boxHeight = title.clientHeight;
      const inkCentre =
        (boxHeight - metrics.lineHeight) / 2 + metrics.inkCentreFromLineTop;
      const shift = boxHeight / 2 - inkCentre;
      if (Math.abs(shift) < 0.25) {
        return;
      }
      wrapper.style.transform = "translateY(" + shift.toFixed(2) + "px)";
    });
  };

  const alphabeticOrderedMarker = (value) => {
    if (!Number.isInteger(value) || value < 1) {
      return String(value);
    }

    let marker = "";
    let remaining = value;
    while (remaining > 0) {
      remaining -= 1;
      marker = String.fromCharCode(97 + (remaining % 26)) + marker;
      remaining = Math.floor(remaining / 26);
    }
    return marker;
  };

  const romanOrderedMarker = (value) => {
    if (!Number.isInteger(value) || value < 1 || value > 3999) {
      return String(value);
    }

    const numerals = [
      [1000, "m"],
      [900, "cm"],
      [500, "d"],
      [400, "cd"],
      [100, "c"],
      [90, "xc"],
      [50, "l"],
      [40, "xl"],
      [10, "x"],
      [9, "ix"],
      [5, "v"],
      [4, "iv"],
      [1, "i"],
    ];
    let marker = "";
    let remaining = value;
    numerals.forEach(([number, numeral]) => {
      while (remaining >= number) {
        marker += numeral;
        remaining -= number;
      }
    });
    return marker;
  };

  const orderedMarker = (value, type) => {
    if (type === "a" || type === "A") {
      const marker = alphabeticOrderedMarker(value);
      return type === "A" ? marker.toUpperCase() : marker;
    }
    if (type === "i" || type === "I") {
      const marker = romanOrderedMarker(value);
      return type === "I" ? marker.toUpperCase() : marker;
    }
    return String(value);
  };

  const alignOrderedMarkers = () => {
    const lists = Array.from(
      document.querySelectorAll(".reveal .slides section ol")
    ).filter(
      (list) =>
        !list.matches(".aside-footnotes") && !list.closest(".footnotes")
    );
    lists.forEach((list) => {
      const directItems = Array.from(list.children).filter((node) =>
        node.matches("li")
      );
      const reversed = list.hasAttribute("reversed");
      const type = list.getAttribute("type") || "1";
      const parsedStart = Number.parseInt(list.getAttribute("start"), 10);
      let value = Number.isFinite(parsedStart)
        ? parsedStart
        : reversed
          ? directItems.length
          : 1;

      directItems.forEach((item) => {
        const explicitValue = Number.parseInt(item.getAttribute("value"), 10);
        if (Number.isFinite(explicitValue)) {
          value = explicitValue;
        }
        item.dataset.beamerMarkerValue = orderedMarker(value, type);
        value += reversed ? -1 : 1;
      });
    });

    const items = Array.from(
      document.querySelectorAll(".reveal .slides section ol > li")
    );
    if (items.length === 0) {
      return;
    }

    const context = glyphContext();
    if (!context) {
      return;
    }

    items.forEach((item) => {
      const style = window.getComputedStyle(item, "::before");
      const content = style.content;
      if (!content || content === "none" || content === "normal") {
        return;
      }

      const value = item.dataset.beamerMarkerValue;
      const fontSize = Number.parseFloat(style.fontSize);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const boxHeight = Number.parseFloat(style.height);
      const paddingTop = Number.parseFloat(style.paddingTop);
      const borderTop = Number.parseFloat(style.borderTopWidth);
      const borderBottom = Number.parseFloat(style.borderBottomWidth);
      if (
        !value ||
        !Number.isFinite(fontSize) ||
        !Number.isFinite(lineHeight) ||
        !Number.isFinite(boxHeight)
      ) {
        return;
      }

      const basePaddingBottom = MARKER_PADDING_BASE_EM * fontSize;

      const font = measureFont(context, style, value);
      if (!font) {
        return;
      }
      const { actualAscent, actualDescent, fontAscent, fontDescent } = font;
      if (
        !Number.isFinite(actualAscent) ||
        !Number.isFinite(actualDescent)
      ) {
        return;
      }

      const innerHeight = boxHeight - borderTop - borderBottom;
      const lineTop =
        borderTop +
        paddingTop +
        (innerHeight - paddingTop - basePaddingBottom - lineHeight) / 2;
      const baseline =
        lineTop +
        (lineHeight - fontAscent - fontDescent) / 2 +
        fontAscent;
      const inkCenter =
        baseline + (actualDescent - actualAscent) / 2;
      const centerDelta = inkCenter - boxHeight / 2;
      const maxPaddingBottom = Math.max(
        0,
        innerHeight - paddingTop - lineHeight
      );
      const adjustedPaddingBottom = Math.min(
        maxPaddingBottom,
        Math.max(0, basePaddingBottom + centerDelta * 2)
      );
      item.style.setProperty(
        "--beamer-marker-padding-bottom",
        `${adjustedPaddingBottom}px`
      );
      item.dataset.beamerMarkerAligned = "true";
    });
  };

  // citeproc gives every entry the id `ref-<key>`; the key is what the .bib shipped
  // and therefore what an author recognises in a warning.
  const entryKey = (entry) => {
    const id = entry.id || "";
    return id.startsWith("ref-") ? id.slice(4) : id;
  };

  // Declaration ordering and fallback policy: docs/architecture.md, R3.
  const reorderReferences = () => {
    const raw = meta("beamer-refs-keys");
    if (!raw) {
      return;
    }
    const keys = raw
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      return;
    }

    const containers = Array.from(
      document.querySelectorAll("#refs, .beamer-refs")
    );
    const entries = containers.flatMap((container) =>
      Array.from(container.querySelectorAll(".csl-entry"))
    );
    if (entries.length === 0) {
      return;
    }
    const rank = new Map(keys.map((key, index) => [key, index]));
    const renderedKeys = entries.map(entryKey);
    if (rank.size !== keys.length || new Set(renderedKeys).size !== entries.length) {
      console.warn(
        "[beamerslides] refs-order: declaration is ignored: duplicate " +
          "declaration or rendered keys make the order ambiguous."
      );
      return;
    }
    const unmatched = renderedKeys.find((key) => !rank.has(key));
    if (unmatched !== undefined) {
      console.warn(
        `[beamerslides] refs-order: declaration is ignored: rendered key '${unmatched}' ` +
          "has no declaration position."
      );
      return;
    }

    // Sort within each existing container. Filling from a shared entry list
    // would move an already-paginated bibliography back onto its first page.
    containers.forEach((container) => {
      const list = container.querySelector(".csl-entry")?.parentElement;
      if (!list) {
        return;
      }
      Array.from(list.querySelectorAll(":scope > .csl-entry"))
        .sort((left, right) => rank.get(entryKey(left)) - rank.get(entryKey(right)))
        .forEach((entry) => list.appendChild(entry));
    });
  };

  // ---- Reference pagination -------------------------------------------------
  // Cross-file contract: docs/architecture.md, R1-R3.
  // refsPages is called before and after applySlideBox builds scroll layers.
  // Read through that wrapper so it is not mistaken for authored content.
  const authoredChildren = (slide) =>
    Array.from(slide.children).flatMap((child) =>
      child.matches(".beamer-scroll") ? Array.from(child.children) : [child]
    );

  const hasAuthoredBody = (slide) =>
    authoredChildren(slide).some(
      (child) =>
        !/^H[12]$/.test(child.tagName) &&
        !child.matches(
          // Generated containers use the class; only the author's keeps #refs.
          "#refs, .beamer-refs, .beamer-headline, .beamer-footline, aside.notes"
        )
    );

  const refsPages = () => {
    const order = leafSlides();
    const first = order.findIndex((slide) => slide.querySelector("#refs"));
    if (first === -1) {
      return [];
    }
    const pages = [order[first]];
    for (let index = first + 1; index < order.length; index += 1) {
      const slide = order[index];
      if (
        !slide.querySelector("#refs") &&
        (slide.dataset.item === undefined || hasAuthoredBody(slide))
      ) {
        break;
      }
      pages.push(slide);
    }
    return pages;
  };

  const refsItemCount = (slide) => {
    const parsed = Number.parseInt(slide.dataset.item, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  // Does this page's scroll layer have room for the entries currently in it?
  const layerOverflows = (slide) => {
    const layer = slide.querySelector(":scope > .beamer-scroll");
    if (layer) {
      return layer.scrollHeight > layer.clientHeight + 1;
    }
    return slide.scrollHeight > slide.clientHeight + 1;
  };

  const cloneEntry = (entry) => {
    const copy = entry.cloneNode(true);
    copy.style.visibility = "hidden";
    return copy;
  };

  // Container identity and public CSS hooks: docs/architecture.md, R1.
  const refsContainer = (slide) => slide.querySelector("#refs, .beamer-refs");

  // A continuation starts without a list. Put its new list inside an existing
  // scroll layer: layerOverflows measures that layer, so a sibling list would
  // leave the measured box empty regardless of how many entries it holds.
  const entryList = (slide, master) => {
    let container = refsContainer(slide);
    if (!container) {
      container = document.createElement("div");
      container.className = [master.className, "beamer-refs"]
        .filter(Boolean)
        .join(" ");
      container.setAttribute("role", master.getAttribute("role") || "list");
      const layer = slide.querySelector(":scope > .beamer-scroll");
      const before = slide.querySelector(":scope > .beamer-footline");
      if (layer) {
        layer.appendChild(container);
      } else if (before) {
        slide.insertBefore(container, before);
      } else {
        slide.appendChild(container);
      }
    }
    return container.querySelector(".csl-entry")?.parentElement || container;
  };

  // Single-page bibliography mode: docs/architecture.md, R1.
  const refsOverflowScroll = () => meta("beamer-refs-overflow") === "scroll";

  // Shared page-count rule, including empty bibliographies: R1.
  const markReferencesUncounted = (pages) => {
    pages.forEach((slide) => {
      slide.dataset.visibility = "uncounted";
    });
  };

  const prepareScrollableReferences = () => {
    const pages = refsPages();
    if (pages.length === 0) {
      return;
    }
    // The two are contradictory: `item` asks for breaks, this mode asks for one page.
    if (pages.some((slide) => slide.dataset.item !== undefined)) {
      console.warn(
        "[beamerslides] refs-overflow: scroll keeps the references on one page, so the " +
          "`item` page breaks are ignored. Remove them, or drop refs-overflow: scroll."
      );
    }
    pages.forEach((slide) => {
      // Quarto gives the references page `.smaller .scrollable`, but the mode promises a
      // scrollable page, so it does not depend on that.
      slide.classList.add("scrollable");
    });
    markReferencesUncounted(pages);
  };

  let referencePagination = null;
  let referenceChromeOptions = null;

  const paginateReferences = () => {
    const pages = referencePagination?.pages || refsPages();
    if (pages.length === 0) {
      return;
    }
    const master = pages[0].querySelector("#refs");
    if (!master) {
      return;
    }
    const all = referencePagination?.entries || Array.from(master.querySelectorAll(".csl-entry"));
    if (all.length === 0) {
      markReferencesUncounted(pages);
      return;
    }
    if (!referencePagination) {
      referencePagination = { pages, declared: pages.slice(), entries: all, warning: null };
    }
    const scrollPositions = new Map(pages.map((slide) => {
      const layer = slide.querySelector(":scope > .beamer-scroll");
      return [slide, {
        entries: Array.from(slide.querySelectorAll(".csl-entry")),
        top: layer?.scrollTop || 0,
        left: layer?.scrollLeft || 0,
      }];
    }));

    // This synchronous measurement pass temporarily exposes hidden pages.
    // finally restores inline display values before the next paint (R2).
    const previousDisplay = new Map();
    const previousSize = new Map();
    const previousFit = new Map();
    // Reveal's PDF wrapper is shorter by pdfPageHeightOffset. Use the same
    // logical slide box as screen pagination, then restore the print geometry.
    // Calling getComputedSlideSize() without viewport arguments in print view
    // uses the already-expanded PDF document height. Percentage slide sizes then
    // feed that height back into the next pagination pass. Reveal resolves the
    // logical percentage size against the viewport, so pass it explicitly.
    const printSize = isPrintLayout()
      ? window.Reveal?.getComputedSlideSize?.(window.innerWidth, window.innerHeight)
      : null;
    const renderForMeasurement = (slide) => {
      if (!previousFit.has(slide)) {
        previousFit.set(slide, slide.classList.contains("beamer-refs-fit"));
        slide.classList.remove("beamer-refs-fit");
      }
      if (printSize && !previousSize.has(slide)) {
        previousSize.set(slide, ["width", "height", "min-height"].map((name) =>
          [name, slide.style.getPropertyValue(name), slide.style.getPropertyPriority(name)]));
        slide.style.setProperty("width", `${printSize.width}px`, "important");
        slide.style.setProperty("height", `${printSize.height}px`, "important");
        slide.style.setProperty("min-height", `${printSize.height}px`, "important");
      }
      // Reveal may hide the ancestor stack too; exposing only its child page
      // still gives zero geometry.
      for (
        let node = slide;
        node && node.tagName === "SECTION";
        node = node.parentElement
      ) {
        if (!previousDisplay.has(node)) {
          previousDisplay.set(node, node.style.display);
          node.style.display = "block";
        }
      }
      return slide;
    };
    const restoreDisplay = () => {
      previousDisplay.forEach((value, slide) => {
        slide.style.display = value;
      });
      previousDisplay.clear();
      previousSize.forEach((properties, slide) => properties.forEach(([name, value, priority]) => {
        if (value) slide.style.setProperty(name, value, priority);
        else slide.style.removeProperty(name);
      }));
      previousSize.clear();
      previousFit.forEach((fits, slide) => slide.classList.toggle("beamer-refs-fit", fits));
      previousFit.clear();
    };

    // Quarto gives layout classes only to the page holding #refs.
    // Merge those classes onto continuations without replacing author classes;
    // Reveal's current/past/future state is not part of that layout (R1).
    const transientClasses = new Set(["present", "past", "future", "beamer-refs-fit"]);
    const layoutClasses = master
      .closest("section")
      .className.split(/\s+/)
      .filter(
        (name) =>
          name && name !== "beamer-leaf-slide" && !transientClasses.has(name)
      );

    const declared = referencePagination.declared.map(refsItemCount);
    // Read both h1 and h2: section-level bibliographies have their own title
    // text as well as a different heading tag.
    const pageHeading = (slide) =>
      directHeading(slide, "h1") || directHeading(slide, "h2");
    const baseTitle =
      meta("beamer-refs-title") || text(pageHeading(pages[0])) || "References";

    // Page `index` may not exist yet. It is modelled on the LAST page rather than on
    // page 1: after the class unification above, every page carries page 1's layout
    // classes, so the two agree on everything that decides the box -- while a class the
    // author put on the last page (`.scrollable`, say) is the look this page continues.
    const ensurePage = (index) => {
      if (pages[index]) {
        return pages[index];
      }
      const template = pages[pages.length - 1];
      const slide = document.createElement("section");
      // Reveal's own state classes are dropped, for the reason the unification above
      // excludes them: they say which slide is current, and a page created while the
      // template happens to be current would otherwise be marked `present` as well.
      slide.className = template.className
        .split(/\s+/)
        .filter((name) => name && !transientClasses.has(name))
        .join(" ");
      slide.id = `${template.id || "references"}-${index + 1}`;
      if (baseTitle) {
        // Preserve the tag: CSS lays out h1 in flow and h2 as a frame band.
        const tag = directHeading(template, "h1") ? "h1" : "h2";
        const heading = document.createElement(tag);
        heading.textContent = baseTitle;
        slide.appendChild(heading);
      }
      const container = document.createElement("div");
      container.className = [master.className, "beamer-refs"]
        .filter(Boolean)
        .join(" ");
      container.setAttribute("role", master.getAttribute("role") || "list");
      slide.appendChild(container);
      const printPage = template.parentElement;
      if (printPage.classList.contains("pdf-page")) {
        // Reveal has already wrapped the deck. sync() does not rebuild PDF
        // pages; a new bibliography page needs its own matching wrapper.
        const wrapper = document.createElement("div");
        wrapper.className = "pdf-page";
        wrapper.style.cssText = printPage.style.cssText;
        ["width", "left", "top"].forEach((name) =>
          slide.style.setProperty(name, template.style.getPropertyValue(name)));
        const background = template.slideBackgroundElement?.cloneNode(true);
        if (background) {
          wrapper.appendChild(background);
          slide.slideBackgroundElement = background;
        }
        wrapper.appendChild(slide);
        printPage.after(wrapper);
      } else {
        template.after(slide);
      }
      slide.classList.add("beamer-leaf-slide");
      renderForMeasurement(slide);
      wrapScrollableSlide(slide);
      measureFrameTitle(slide, false);
      pages.push(slide);
      return slide;
    };

    // Which entries each page will hold, decided by filling the real pages.
    //
    // `pages` grows while this runs -- `ensurePage` appends the pages it creates -- so
    // the number the author declared has to be recorded first. Measuring the spill as
    // `slices.length - pages.length` after the loop always gives 0, which silently
    // killed the "pages were added" warning below.
    const declaredCount = referencePagination.declared.length;
    const slices = [];
    const fits = [];
    // The forced display only has to last as long as the pages are being measured --
    // the fill below moves the real entries and does not measure anything -- and it is
    // restored in a `finally`, because a page left rendered that Reveal believes is
    // hidden would sit on top of the deck.
    try {
      pages.forEach((slide) => {
        layoutClasses.forEach((name) => slide.classList.add(name));
        slide.classList.add("beamer-leaf-slide");
        renderForMeasurement(slide);
        wrapScrollableSlide(slide);
        // Fit the actual heading before measuring the clones, not the base band.
        // Overflow diagnostics must wait until the real entries have been divided.
        measureFrameTitle(slide, false);
      });
      let index = 0;
      let pageIndex = 0;
      while (index < all.length) {
        const slide = ensurePage(pageIndex);
        const list = entryList(slide, master);
        // Start from an emptied list: the clones are the only content while measuring.
        // Only the entries are removed -- clearing `textContent` also deletes the list
        // element itself when the container has no inner wrapper, which was measured as
        // the whole bibliography collapsing onto one page.
        Array.from(list.querySelectorAll(".csl-entry")).forEach((entry) =>
          entry.remove()
        );
        const wanted = (() => {
          const value = declared[Math.min(pageIndex, declared.length - 1)];
          return value === null || value === undefined ? null : value;
        })();

        const slice = [];
        while (index + slice.length < all.length) {
          if (wanted !== null && slice.length >= wanted) {
            break;
          }
          const clone = cloneEntry(all[index + slice.length]);
          list.appendChild(clone);
          if (layerOverflows(slide) && slice.length > 0) {
            clone.remove();
            break;
          }
          slice.push(all[index + slice.length]);
        }
        // Progress guard. With the overflow test above requiring a non-empty slice the
        // first entry is always kept, so this cannot trigger today -- it is here so that
        // a future change to that test fails one page late instead of hanging the tab.
        if (slice.length === 0) {
          slice.push(all[index]);
        }
        slices.push(slice);
        fits.push(!layerOverflows(slide));
        index += slice.length;
        pageIndex += 1;
      }
    } finally {
      restoreDisplay();
    }

    // Move originals before removing obsolete generated pages. Author-declared
    // pages, including unused pages and their notes, always remain in the deck.
    pages.forEach((slide, i) => {
      const slice = slices[i];
      if (slice) {
        const list = entryList(slide, master);
        Array.from(list.querySelectorAll(".csl-entry")).forEach((entry) => entry.remove());
        slice.forEach((entry) => list.appendChild(entry));
        const previous = scrollPositions.get(slide);
        const layer = slide.querySelector(":scope > .beamer-scroll");
        if (layer && previous?.entries.length === slice.length &&
            previous.entries.every((entry, index) => entry === slice[index])) {
          layer.scrollTop = previous.top;
          layer.scrollLeft = previous.left;
        }
      }
      slide.dataset.visibility = "uncounted";
      slide.classList.toggle("beamer-refs-fit", fits[i] === true);
      const wrapper = slide.parentElement;
      if (printSize && wrapper.classList.contains("pdf-page")) {
        // Reveal may have allocated several sheets from the stale, pre-font
        // content height. Each paginated reference slide owns one sheet.
        const config = window.Reveal.getConfig();
        const margin = Number(config.margin) || 0;
        const pageHeight = Math.floor(printSize.height * (1 + margin));
        const offset = Number(config.pdfPageHeightOffset ?? -1);
        wrapper.style.height = `${Math.max(1, pageHeight + offset)}px`;
      }
    });
    while (pages.length > Math.max(declaredCount, slices.length)) {
      const slide = pages.pop();
      const wrapper = slide.parentElement;
      slide.remove();
      if (wrapper.classList.contains("pdf-page") && !wrapper.querySelector("section")) {
        wrapper.remove();
      }
    }

    const added = slices.length - declaredCount;
    let paginationWarning = null;
    if (added > 0) {
      const firstMoved = slices[declaredCount]
        ? entryKey(slices[declaredCount][0])
        : "";
      paginationWarning = (
        `[beamerslides] the references need ${slices.length} pages but ` +
          `${declaredCount} ${declaredCount === 1 ? "was" : "were"} declared, so ` +
          `${added} ${added === 1 ? "page was" : "pages were"} added` +
          (firstMoved ? `; the first entry moved is ${firstMoved}` : "") +
          ". Move a page break earlier, or lower --beamer-refs-font-size."
      );
    } else if (declaredCount > slices.length) {
      // The mirror case: a declared continuation page the bibliography does not need.
      // It is left in the deck (removing it would delete whatever the author put
      // there) but it renders as an empty frame, so the author gets told.
      const unused = pages
        .slice(slices.length)
        .map((slide) => slide.id || "(unnamed)")
        .join(", ");
      paginationWarning = (
        `[beamerslides] the references fit on ${slices.length} ` +
          `${slices.length === 1 ? "page" : "pages"} but ${declaredCount} were ` +
          `declared; ${unused} ${declaredCount - slices.length === 1 ? "is" : "are"} ` +
          "empty. Delete the unused page, or lower `item` so the entries spread " +
          "over every declared page."
      );
    }
    if (paginationWarning && paginationWarning !== referencePagination.warning) {
      console.warn(paginationWarning);
    }
    referencePagination.warning = paginationWarning;

    // Reported to the caller: sections appended after Reveal initialised are not in
    // Reveal's model, and Quarto's `support.js` plugin dereferences
    // `Reveal.getSlideBackground(currentSlide)` on every `slidechanged`.
    return added;
  };

  const appendSpan = (parent, className, value) => {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = value || "";
    parent.appendChild(node);
    return node;
  };

  const authorLabel = (info) => {
    if (info.author && info.institute) {
      return `${info.author} (${info.institute})`;
    }
    return info.author || info.institute || "";
  };

  const appendProgress = (footer, count) => {
    if (!footer || footer.querySelector(":scope > .beamer-footline-progress")) {
      return;
    }
    const progress = document.createElement("i");
    progress.className = "beamer-footline-progress";
    progress.style.width = `${
      count && count.total > 0 ? (count.progress / count.total) * 100 : 0
    }%`;
    footer.appendChild(progress);
  };

  const addChrome = (slide, context, info, count, options) => {
    if (slide.querySelector(":scope > .beamer-footline")) {
      return;
    }

    if (options.showHeadline) {
      const header = document.createElement("div");
      header.className = "beamer-headline";
      header.setAttribute("aria-hidden", "true");
      appendSpan(header, "beamer-headline-section", context.section);
      appendSpan(header, "beamer-headline-subsection", context.subsection);
      slide.prepend(header);
    }

    const footer = document.createElement("div");
    footer.className = "beamer-footline";
    footer.setAttribute("aria-hidden", "true");
    appendSpan(footer, "beamer-footline-author", authorLabel(info));
    appendSpan(footer, "beamer-footline-title", info.title);

    const dateBox = appendSpan(footer, "beamer-footline-date", "");
    appendSpan(dateBox, "beamer-footline-date-text", info.date);
    if (count.current !== null) {
      appendSpan(
        dateBox,
        "beamer-footline-number",
        `${count.current} / ${count.total}`
      );
    }

    if (options.showProgress) {
      appendProgress(footer, count);
    }

    slide.appendChild(footer);
  };

  const slideCounts = (slides) => {
    const total = slides.filter(
      (slide) => slide.dataset.visibility !== "uncounted"
    ).length;
    let current = 0;

    return new Map(
      slides.map((slide) => {
        const uncounted = slide.dataset.visibility === "uncounted";
        if (!uncounted) {
          current += 1;
        }
        return [
          slide,
          {
            current: uncounted ? null : current,
            progress: current,
            total,
          },
        ];
      })
    );
  };

  const decorateSlideChrome = (slides, options) => {
    const info = titleMetadata();
    const counts = slideCounts(slides);
    let section = info.title;
    slides.forEach((slide) => {
      const h1 = directHeading(slide, "h1");
      const h2 = directHeading(slide, "h2");
      // Reveal's earlier top offset is stale once our full-height box owns layout.
      slide.style.removeProperty("top");
      if (slide.id !== "title-slide" && h1) section = text(h1) || section;
      addChrome(slide, {
        section: slide.dataset.section || section,
        subsection: slide.dataset.subsection || (h2 ? text(h2) : ""),
      }, info, counts.get(slide), options);
    });
  };

  const arrangeTitleSlide = () => {
    const slide = document.querySelector("#title-slide");
    if (!slide || slide.querySelector(":scope > .beamer-title-box")) {
      return;
    }

    const title = slide.querySelector(":scope > .title");
    const subtitle = slide.querySelector(":scope > .subtitle");
    if (!title) {
      return;
    }

    const box = document.createElement("div");
    box.className = "beamer-title-box";
    title.before(box);
    box.appendChild(title);
    if (subtitle) {
      box.appendChild(subtitle);
    }
  };

  const overflowReported = new Set();

  const slideScrolls = (slide) =>
    slide.classList.contains("scrollable") ||
    slide.classList.contains("smaller") ||
    slide.classList.contains("beamer-long-frame-title");

  // Current badge/scroll limitation: docs/architecture.md, G1.
  const badgeCannotScroll = (slide) =>
    slide.classList.contains("beamer-section-slide") &&
    slide.classList.contains("section-badge");

  const isScrollLayer = (node) => node.classList.contains("beamer-scroll");
  const isChrome = (node) =>
    node.classList.contains("beamer-headline") ||
    node.classList.contains("beamer-footline");
  // Both heading selectors require a direct child of the slide. Moving h1 or
  // h2 into the layer would lose the matching band style and title measurement.
  const isSlideTitle = (slide, node) =>
    node.tagName === "H2" ||
    (node.tagName === "H1" &&
      slide.classList.contains("beamer-section-slide"));

  // Section bands stay in flow: the body starts after their bottom and margin.
  // null asks the caller to use padding-top for frames, centred badges, or
  // hidden sections with no measurable band. measureSectionBand revisits the
  // latter once layout is available.
  const sectionBodyTop = (slide) => {
    if (!slide.classList.contains("beamer-section-slide")) {
      return null;
    }
    if (slide.classList.contains("section-badge")) {
      return null;
    }
    const band = directHeading(slide, "h1");
    if (!band) {
      return null;
    }
    const bandRect = band.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    if (bandRect.height <= 0 || slideRect.height <= 0) {
      return null;
    }
    const scale = Math.max(
      0.0001,
      window.Reveal && typeof window.Reveal.getScale === "function"
        ? window.Reveal.getScale()
        : 1
    );
    const marginBottom =
      Number.parseFloat(window.getComputedStyle(band).marginBottom) || 0;
    const top = (bandRect.bottom - slideRect.top) / scale + marginBottom;
    if (!Number.isFinite(top) || top <= 0) {
      return null;
    }
    return top;
  };

  // Scroll-layer contract: docs/architecture.md, G1.
  // Absolute offsets start at the padding box's outer edge, so an inset of zero
  // ignores reserved chrome. Frames use padding; sectionBodyTop measures the
  // section's in-flow band instead.
  const wrapScrollableSlide = (slide) => {
    if (!slideScrolls(slide) || badgeCannotScroll(slide)) {
      // A frame can stop scrolling again -- `beamer-long-frame-title` is toggled on
      // every measurement -- and then its body has to come back out of the layer. Left
      // in an absolutely positioned child, the content no longer contributes to the
      // section's scroll height, so `reportOverflow` would report nothing no matter
      // how far the body overflowed.
      const stale = slide.querySelector(":scope > .beamer-scroll");
      if (stale) {
        for (const child of Array.from(stale.children)) {
          slide.insertBefore(child, stale);
        }
        stale.remove();
      }
      return;
    }

    // Everything that should live in the layer: the slide's own children except
    // the chrome and the frame title, plus anything an earlier pass already parked
    // in a layer.
    const layer = slide.querySelector(":scope > .beamer-scroll");
    const content = [];
    for (const child of Array.from(slide.children)) {
      if (isScrollLayer(child) || isChrome(child) || isSlideTitle(slide, child)) {
        continue;
      }
      content.push(child);
    }
    if (layer) {
      for (const child of Array.from(layer.children)) {
        if (isSlideTitle(slide, child)) {
          // Not a state this builder produces -- it never moves a title in -- but a
          // title that ended up in the layer has to come back OUT before the layer is
          // discarded, or `layer.remove()` deletes the frame title along with it. A
          // later reordering that places the title after the layer would otherwise
          // drop it silently.
          slide.insertBefore(child, layer);
        } else {
          content.push(child);
        }
      }
      layer.remove();
    }
    if (content.length === 0) {
      return;
    }

    // Build the layer detached, then place it deterministically: after the frame
    // title, or before the chrome when there is no title. Placing it last is what
    // makes this order-independent -- moving the content in first and inserting
    // afterwards left the title inside the layer, which pushed the body down by the
    // title's height.
    const built = document.createElement("div");
    built.className = "beamer-scroll";
    const title = directHeading(slide, "h2");
    const style = window.getComputedStyle(slide);
    const inset = sectionBodyTop(slide);
    // Remembered numerically rather than read back out of `style.top`: the pass
    // that re-measures a section page compares against this, and a string
    // comparison would treat sub-pixel jitter from Reveal's scale as a change and
    // rebuild the layer -- throwing away the reader's scroll position -- on every
    // resize event.
    built.dataset.beamerInset = inset === null ? "" : String(inset);
    built.style.top = inset === null ? style.paddingTop : `${inset}px`;
    built.style.right = style.paddingRight;
    built.style.bottom = style.paddingBottom;
    built.style.left = style.paddingLeft;
    content.forEach((child) => built.appendChild(child));

    const footer = slide.querySelector(":scope > .beamer-footline");
    if (title) {
      title.after(built);
    } else if (footer) {
      slide.insertBefore(built, footer);
    } else {
      slide.appendChild(built);
    }

    // Keep the footline last so the layer cannot paint over it.
    if (footer && footer !== slide.lastElementChild) {
      slide.appendChild(footer);
    }
  };

  // Initial box preparation used before pagination (docs/architecture.md, L1).
  // Generated pages copy those classes and get wrapped by ensurePage.
  const applySlideBox = (slide) => {
    slide.classList.add("beamer-leaf-slide");
    slide.classList.toggle(
      "beamer-center-slide",
      slide.classList.contains("center")
    );
    // The title slide needs no marker class of its own: it is `#title-slide`,
    // and the stylesheet selects it by that id.
    if (slide.id !== "title-slide" && directHeading(slide, "h1")) {
      slide.classList.add("beamer-section-slide");
    }
    if (directHeading(slide, "h2")) {
      slide.classList.add("beamer-frame-slide");
    }
    wrapScrollableSlide(slide);
  };

  // In print/PDF layout Reveal paginates the deck, so a slide's client height no
  // longer describes the space its content has. Measuring there reports phantom
  // overflows, so the check is screen-only.
  const isPrintLayout = () =>
    window.Reveal?.isPrintView?.() ||
    window.Reveal?.isPrintingPDF?.() ||
    document.documentElement.classList.contains("reveal-print") ||
    document.documentElement.classList.contains("print-pdf") ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("print").matches);

  // One message per badge page, triggered by `.scrollable` -- the class that asks for
  // scrolling and that this theme documents as the way to get it. `.smaller` on its own
  // does not trigger it, because that is a text-size hint first; Quarto puts both on a
  // bibliography page, so a badge-styled `# References` does get the message, and it
  // should: that page really cannot scroll, and it is the one most likely to overflow.
  const inertBadgeScrollReported = new Set();
  const reportInertBadgeScroll = (slide) => {
    if (!slide.classList.contains("scrollable")) {
      return;
    }
    const key = slide.id || "(unnamed)";
    if (inertBadgeScrollReported.has(key)) {
      return;
    }
    inertBadgeScrollReported.add(key);
    console.warn(
      `[beamerslides] ${slide.id ? `#${slide.id}` : "a section page"} is a ` +
        "`.section-badge` page, and that look cannot scroll: it centres its title " +
        "and its body as one block, which the scroll layer cannot do. `.scrollable` " +
        "is ignored here, so the page renders as a plain badge page and any overflow " +
        "is clipped. Split the page, drop `.section-badge`, or move the prose to the " +
        "following frame."
    );
  };

  // Beamer reports an overfull vbox; on the web the equivalent failure is
  // silent, because the slide box hides its overflow. Warn once per slide state
  // so an author notices instead of shipping a frame with invisible content.
  const reportOverflow = (slide) => {
    if (isPrintLayout() || slide.getBoundingClientRect().width <= 0) {
      return;
    }
    // A badge page renders as a plain one whatever its classes say, so it is judged
    // as one -- `.scrollable` on it is inert rather than an exemption.
    if (badgeCannotScroll(slide)) {
      reportInertBadgeScroll(slide);
    } else if (slideScrolls(slide)) {
      return;
    }
    const overflow = slide.scrollHeight - slide.clientHeight;
    if (overflow <= 2) {
      return;
    }
    const key = `${slide.id || "unnamed"}:${slide.scrollHeight}`;
    if (overflowReported.has(key)) {
      return;
    }
    overflowReported.add(key);
    // A section page has no frame title, so the frame advice would name something
    // that does not exist there -- and a badge page cannot take the `.scrollable`
    // the section advice offers, because that is the class it already has and the
    // one this run just reported as inert.
    const remedy = badgeCannotScroll(slide)
      ? "Split the badge page, or move the prose to the following frame."
      : slide.classList.contains("beamer-section-slide")
        ? "Move the prose to the following frame, or add `.scrollable` so the page " +
          "can scroll."
        : "Add `.smaller` to the frame title, split the frame, or add `.scrollable` " +
          "so it can scroll.";
    console.warn(
      `[beamerslides] ${slide.id ? `#${slide.id}` : "a frame"} overflows its ` +
        `content area by ${overflow}px (${slide.scrollHeight}px of content in ` +
        `${slide.clientHeight}px). ` +
        remedy
    );
  };

  // An in-flow h1 needs a measured inset, unlike the padding reserved for h2.
  // Revisit empty continuation pages after entries arrive: the initial wrapper
  // pass may have found no body to move. A 0.5px tolerance avoids rebuilding
  // the layer for scale-rounding jitter and losing its scroll position.
  const measureSectionBand = (slide) => {
    if (!slide.classList.contains("beamer-section-slide")) {
      return;
    }
    const top = sectionBodyTop(slide);
    if (top === null) {
      return;
    }
    const layer = slide.querySelector(":scope > .beamer-scroll");
    const previous = Number.parseFloat(layer?.dataset.beamerInset ?? "");
    if (layer && Number.isFinite(previous) && Math.abs(previous - top) < 0.5) {
      return;
    }
    wrapScrollableSlide(slide);
  };

  const measureFrameTitle = (slide, diagnose = true) => {
    const heading = directHeading(slide, "h2");
    const minHeight = baseFrameTitleHeight();
    // Both of the scroll layer's inputs are rewritten below -- the reserved frame
    // height and the `beamer-long-frame-title` class -- so they are read first. A layer
    // built earlier is inset from the section's padding, which is
    // `headline + frame-height + 22px` for a frame slide: leave it alone and a frame
    // whose title grew past one line keeps the inset measured for a one-line title,
    // measured at layer top 80px against the 108px the body actually starts at.
    const wasScrolling = slideScrolls(slide);
    const previousHeight = slide.style.getPropertyValue("--beamer-frame-height");
    if (!heading || heading.getBoundingClientRect().width <= 0) {
      measureSectionBand(slide);
      if (diagnose) reportOverflow(slide);
      return;
    }

    slide.classList.remove("beamer-long-frame-title");
    heading.classList.remove(
      "beamer-frame-title-compact",
      "beamer-frame-title-tight"
    );
    slide.style.setProperty("--beamer-frame-height", `${minHeight}px`);

    let height = Math.ceil(heading.scrollHeight);
    if (height > Math.round(minHeight * COMPACT_FRAME_TITLE_RATIO)) {
      heading.classList.add("beamer-frame-title-compact");
      height = Math.ceil(heading.scrollHeight);
    }
    if (height > Math.round(minHeight * TIGHT_FRAME_TITLE_RATIO)) {
      heading.classList.add("beamer-frame-title-tight");
      height = Math.ceil(heading.scrollHeight);
    }

    const finalHeight = Math.max(minHeight, height);
    slide.style.setProperty("--beamer-frame-height", `${finalHeight}px`);
    slide.classList.toggle(
      "beamer-long-frame-title",
      finalHeight > Math.round(minHeight * SCROLLING_FRAME_TITLE_RATIO)
    );
    // Re-wrap only when one of those inputs actually moved. This runs on every resize
    // and every slide change, and re-wrapping rebuilds the layer, which would throw
    // away the reader's scroll position for nothing.
    if (
      previousHeight !== `${finalHeight}px` ||
      slideScrolls(slide) !== wasScrolling
    ) {
      wrapScrollableSlide(slide);
    }
    if (diagnose) reportOverflow(slide);
  };

  let frameTitleAnimation = 0;
  const fitFrameTitles = (slides) => {
    window.cancelAnimationFrame(frameTitleAnimation);
    frameTitleAnimation = window.requestAnimationFrame(() => {
      slides.forEach((slide) => measureFrameTitle(slide));
    });
  };

  let frameTitleObserver = null;
  const watchFrameTitles = (slides) => {
    let resizeTimer = 0;
    const refit = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        refreshReferences();
        fitFrameTitles(leafSlides());
      }, 40);
    };

    window.addEventListener("resize", refit, { passive: true });
    window.addEventListener("afterprint", refit);
    if (window.Reveal && typeof window.Reveal.on === "function") {
      window.Reveal.on("resize", refit);
      window.Reveal.on("pdf-ready", () => {
        refreshReferences();
        fitFrameTitles(leafSlides());
      });
      window.Reveal.on("slidechanged", (event) => {
        const currentSlide = event?.currentSlide || window.Reveal.getCurrentSlide();
        if (currentSlide) {
          fitFrameTitles([currentSlide]);
        }
      });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refit);
      document.fonts.addEventListener?.("loadingdone", refit);
      document.fonts.addEventListener?.("loadingerror", refit);
    }
    const referenceImageLoaded = (event) => {
      if (event.target?.tagName === "IMG" && event.target.closest("#refs, .beamer-refs")) refit();
    };
    document.addEventListener("load", referenceImageLoaded, true);
    document.addEventListener("error", referenceImageLoaded, true);
    if (typeof window.ResizeObserver === "function") {
      frameTitleObserver = new window.ResizeObserver((entries) => {
        const visibleSlides = entries
          .map((entry) => entry.target)
          .filter(
            (slide) =>
              slide && slide.getBoundingClientRect().width > 0
          );
        if (visibleSlides.length > 0) {
          fitFrameTitles(visibleSlides);
          if (visibleSlides.some((slide) => referencePagination?.pages.includes(slide))) {
            refit();
          }
        }
      });
      slides.forEach((slide) => frameTitleObserver.observe(slide));
    }
  };

  // Fixed chrome bottom in viewport pixels; null means no measurable box.
  // Include the section h1 as well as frame h2/headline. A centred badge is
  // excluded because it does not occupy the logo's top corner.
  const fixedChromeBottom = (slide) => {
    const candidates = [
      directHeading(slide, "h2"),
      slide.classList.contains("beamer-section-slide") &&
      !slide.classList.contains("section-badge")
        ? directHeading(slide, "h1")
        : null,
      slide.querySelector(":scope > .beamer-headline"),
    ];
    for (const node of candidates) {
      if (!node) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.height > 0) {
        return rect.bottom;
      }
    }
    return null;
  };

  // Write the logo's measured line to --beamer-logo-top (ownership: C3).
  // Titleless generated pages fall back to this slide's top, never another
  // slide's title. Horizontal reserve is updated by positionNativeUi.
  const positionLogo = (reveal, slide) => {
    const logo = reveal.querySelector(".slide-logo");
    if (!logo) {
      return;
    }
    const logoRect = logo.getBoundingClientRect();
    if (logoRect.width <= 0 || logoRect.height <= 0) {
      return;
    }
    const revealRect = reveal.getBoundingClientRect();
    const scale = Math.max(
      0.0001,
      typeof window.Reveal?.getScale === "function"
        ? window.Reveal.getScale()
        : 1
    );
    const chromeBottom =
      fixedChromeBottom(slide) ?? slide.getBoundingClientRect().top;
    // `chromeBottom` falls back to the slide's top when no chrome box can be
    // measured -- the print and PDF paths -- and there the offset is just
    // `spacing`, i.e. a positive 8px rather than a value this pass guessed.
    const top =
      (Math.max(chromeBottom, revealRect.top) - revealRect.top + 8 * scale) /
      scale;
    reveal.style.setProperty("--beamer-logo-top", `${Math.round(top)}px`);
  };

  const positionNativeUi = (reveal, requestedSlide) => {
    const slide =
      requestedSlide ||
      (typeof window.Reveal.getCurrentSlide === "function"
        ? window.Reveal.getCurrentSlide()
        : null);
    if (!slide) {
      return;
    }

    // The logo moves first: `--beamer-menu-top` below is `max(chrome, logo)`, so
    // reading the logo's box before its new line is in force would place the menu
    // against the old one.
    positionLogo(reveal, slide);

    const slideRect = slide.getBoundingClientRect();
    const revealRect = reveal.getBoundingClientRect();
    const scale = Math.max(
      0.0001,
      typeof window.Reveal.getScale === "function"
        ? window.Reveal.getScale()
        : 1
    );
    const logo = reveal.querySelector(".slide-logo");
    const logoRect = logo?.getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      ?.getBoundingClientRect();
    const spacing = 8 * scale;
    const chromeBottom = fixedChromeBottom(slide) ?? slideRect.top;
    const logoBottom =
      logoRect && logoRect.width > 0 && logoRect.height > 0
        ? logoRect.bottom
        : slideRect.top;

    reveal.style.setProperty(
      "--beamer-menu-top",
      `${Math.max(chromeBottom, logoBottom) + spacing}px`
    );
    reveal.style.setProperty(
      "--beamer-menu-right",
      `${Math.max(spacing, window.innerWidth - slideRect.right + spacing)}px`
    );
    if (logoRect && logoRect.width > 0 && logoRect.height > 0) {
      // Convert the logo's viewport width and right gap to unscaled slide units.
      const logoRightGap = Math.max(0, slideRect.right - logoRect.right);
      reveal.style.setProperty(
        "--beamer-logo-reserve",
        `${Math.round((logoRect.width + logoRightGap + spacing) / scale)}px`
      );
    }
    if (footerRect) {
      reveal.style.setProperty(
        "--beamer-native-footline-offset",
        `${Math.max(spacing, revealRect.bottom - footerRect.top + spacing)}px`
      );
    }
  };

  // Phase 1: parsed-DOM decoration. Lifecycle contract: docs/architecture.md, L1.
  let chromePollHandle = 0;
  let chromeAttempts = 0;
  let chromeObserver = null;
  let chromeInjected = false;
  let generatedRefsPages = 0;

  const decorateChrome = () => {
    const reveal = document.querySelector(".reveal");
    if (!reveal) {
      return false;
    }
    if (reveal.dataset.beamerChrome === "true") {
      return true;
    }

    let slides = leafSlides();
    if (slides.length === 0) {
      return false;
    }

    reveal.dataset.beamerChrome = "true";

    const variant = meta("beamer-variant") || "madrid";
    const showHeadline = metaBoolean(
      "beamer-secheader",
      variant === "cambridgeus"
    );
    const options = {
      showHeadline,
      showProgress: metaBoolean("beamer-progress", false),
    };

    // Only beamer-no-headline has a stylesheet rule; headline-on needs no class.
    document.documentElement.classList.add(`beamer-${variant}`);
    reveal.classList.add(`beamer-${variant}`);
    reveal.classList.toggle("beamer-no-headline", !showHeadline);

    // The mode is resolved before the boxes are applied: it is what makes the references page
    // scrollable, and the scroll layer is built from those classes.
    const scrollReferences = refsOverflowScroll();
    if (scrollReferences) {
      prepareScrollableReferences();
    }

    // Structural dependencies: docs/architecture.md, L1 and R2.
    // Reference pagination also fits headings synchronously before measuring.
    slides.forEach(applySlideBox);

    reorderReferences();

    if (!scrollReferences) {
      generatedRefsPages = paginateReferences() || 0;
    }

    slides = leafSlides();

    referenceChromeOptions = options;
    decorateSlideChrome(slides, options);

    replaceOrcidIcons();
    arrangeTitleSlide();
    alignInlineLabels();
    alignOrderedMarkers();
    centerTitleInk();
    return true;
  };

  // Resource/viewport events are coalesced by watchFrameTitles. Do not retry a
  // partially changed bibliography after failure. Print updates wait until
  // Reveal finishes creating its page wrappers (docs/architecture.md, R2).
  const refreshReferences = () => {
    if (!referencePagination || referencePagination.failed) return;
    if (isPrintLayout() && referencePagination.pages.some((slide) =>
      !slide.isConnected || !slide.parentElement?.classList.contains("pdf-page"))) return;
    const reveal = window.Reveal;
    if (!reveal?.isReady?.()) return;
    const before = referencePagination.pages.slice();
    const current = reveal.getCurrentSlide();
    const anchor = current?.querySelector(".csl-entry");
    try {
      paginateReferences();
      const slides = leafSlides();
      decorateSlideChrome(slides, referenceChromeOptions);
      alignInlineLabels();
      const changed = before.length !== referencePagination.pages.length ||
        before.some((slide, index) => slide !== referencePagination.pages[index]);
      if (changed) {
        before.filter((slide) => !slide.isConnected)
          .forEach((slide) => frameTitleObserver?.unobserve(slide));
        referencePagination.pages.filter((slide) => !before.includes(slide))
          .forEach((slide) => frameTitleObserver?.observe(slide));
        if (isPrintLayout()) return;
        reveal.sync();
        const target = current?.isConnected ? current : anchor?.closest("section") || referencePagination.declared[0];
        if (target && reveal.getCurrentSlide() !== target) {
          const indices = reveal.getIndices(target);
          reveal.slide(indices.h, indices.v);
        }
      }
    } catch (error) {
      referencePagination.failed = true;
      console.error("[beamerslides] Reference layout update failed; further pagination updates are disabled.", error);
    }
  };

  // Reveal can become ready before DOMContentLoaded while deferred resources
  // are still loading. Its ready class proves it has read the slide markup;
  // chromeIsSettled accepts that earlier point as well as parser completion.
  const chromeIsSettled = () =>
    document.readyState !== "loading" ||
    Boolean(document.querySelector(".reveal.ready"));

  const stopWatchingChrome = () => {
    if (chromeObserver) {
      chromeObserver.disconnect();
      chromeObserver = null;
    }
    window.clearTimeout(chromePollHandle);
  };

  const injectChrome = () => {
    if (chromeInjected) {
      return true;
    }
    if (!chromeIsSettled()) {
      return false;
    }
    let decorated;
    try {
      decorated = decorateChrome();
    } catch (error) {
      // Partly rewritten DOM is unsafe to retry; report the fail-stop (L2).
      console.error(
        "[beamerslides] The slide decoration pass failed part-way, so this deck " +
          "is only partly decorated: frames after the failure point have no " +
          "headline, footline or numbering. It is deliberately not retried, " +
          "because the pass appends reference pages and a second run would " +
          "duplicate them.",
        error
      );
      throw error;
    }
    if (!decorated) {
      return false;
    }
    chromeInjected = true;
    stopWatchingChrome();
    // When Reveal's `ready` event is what unblocked the injection, phase 2 has
    // already run and skipped the missing chrome, so finish it now rather than
    // letting the poll paint a half-decorated frame first.
    if (
      window.Reveal &&
      typeof window.Reveal.isReady === "function" &&
      window.Reveal.isReady()
    ) {
      finishDecorate();
    }
    return true;
  };

  const startChrome = () => {
    window.clearTimeout(chromePollHandle);
    if (injectChrome()) {
      return;
    }
    chromeAttempts += 1;
    if (chromeAttempts >= MAX_POLL_ATTEMPTS) {
      stopWatchingChrome();
      console.warn(
        "[beamerslides] Could not decorate the slides; giving up after " +
          `${Math.round((MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000)}s.`
      );
      return;
    }
    chromePollHandle = window.setTimeout(startChrome, POLL_INTERVAL_MS);
  };

  // A MutationObserver callback is a microtask, which the browser always drains
  // before it paints, so reacting to the `.ready` class here beats the frame it
  // would otherwise show bare. A timer cannot: it can miss the window entirely.
  const watchChrome = () => {
    if (typeof window.MutationObserver !== "function") {
      return;
    }
    chromeObserver = new window.MutationObserver(() => {
      injectChrome();
    });
    chromeObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  };

  // Phase 2: everything that depends on Reveal's layout or configuration.
  let decorateAttempts = 0;
  const finishDecorate = () => {
    const reveal = document.querySelector(".reveal");
    if (!reveal || reveal.dataset.beamerDecorated === "true") {
      return;
    }
    if (reveal.dataset.beamerChrome !== "true") {
      decorateAttempts += 1;
      if (decorateAttempts >= MAX_POLL_ATTEMPTS) {
        console.warn(
          "[beamerslides] The slide chrome was never injected; skipping " +
            "layout integration."
        );
        return;
      }
      window.setTimeout(finishDecorate, POLL_INTERVAL_MS);
      return;
    }
    reveal.dataset.beamerDecorated = "true";

    // Register appended sections before navigation: Quarto's support plugin
    // reads each slide's Reveal background, which otherwise does not exist (L1).
    if (generatedRefsPages > 0 && typeof window.Reveal.sync === "function") {
      window.Reveal.sync();
    }

    const slides = leafSlides();
    const revealConfig =
      typeof window.Reveal.getConfig === "function"
        ? window.Reveal.getConfig()
        : {};
    const showProgress = metaBoolean(
      "beamer-progress",
      revealConfig.progress === true
    );
    referenceChromeOptions.showProgress = showProgress;

    if (revealConfig.center === true) {
      slides.forEach((slide) => slide.classList.add("beamer-center-slide"));
    }
    if (showProgress) {
      const counts = slideCounts(slides);
      slides.forEach((slide) => {
        appendProgress(slide.querySelector(":scope > .beamer-footline"), counts.get(slide));
      });
    }

    fitFrameTitles(slides);
    watchFrameTitles(slides);
    positionNativeUi(reveal);

    // Coalesce costly font/pixel measurements into one pass per frame (L2).
    // beforeprint has no frame to wait for, so realignForPrint runs synchronously.
    const runRealign = () => {
      alignInlineLabels();
      alignOrderedMarkers();
      centerTitleInk();
    };
    let realignScheduled = false;
    const realignOpticalLabels = () => {
      if (realignScheduled) {
        return;
      }
      realignScheduled = true;
      window.requestAnimationFrame(() => {
        realignScheduled = false;
        runRealign();
      });
    };
    const realignForPrint = () => {
      refreshReferences();
      runRealign();
      leafSlides().forEach((slide) => measureFrameTitle(slide));
    };
    // Keep one frame pass and one trailing timeout: the latter catches chrome
    // after title fitting changes it. Both use the latest requested slide.
    let repositionFrame = 0;
    let repositionTimer = 0;
    let repositionSlide = null;
    const repositionNativeUi = (event) => {
      repositionSlide =
        event?.currentSlide ||
        (typeof window.Reveal.getCurrentSlide === "function"
          ? window.Reveal.getCurrentSlide()
          : null);
      window.cancelAnimationFrame(repositionFrame);
      window.clearTimeout(repositionTimer);
      const reposition = () => positionNativeUi(reveal, repositionSlide);
      repositionFrame = window.requestAnimationFrame(reposition);
      repositionTimer = window.setTimeout(reposition, 80);
    };
    window.addEventListener("resize", realignOpticalLabels, { passive: true });
    window.addEventListener("resize", repositionNativeUi, { passive: true });
    window.addEventListener("beforeprint", realignForPrint);
    window.addEventListener("afterprint", realignOpticalLabels);
    if (window.Reveal && typeof window.Reveal.on === "function") {
      window.Reveal.on("resize", realignOpticalLabels);
      window.Reveal.on("slidechanged", realignOpticalLabels);
      window.Reveal.on("resize", repositionNativeUi);
      window.Reveal.on("slidechanged", repositionNativeUi);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(realignOpticalLabels);
      document.fonts.ready.then(repositionNativeUi);
    }
    window.setTimeout(realignOpticalLabels, 100);
    window.setTimeout(repositionNativeUi, 100);
  };

  let connectAttempts = 0;
  const connect = () => {
    if (!window.Reveal || typeof window.Reveal.on !== "function") {
      connectAttempts += 1;
      if (connectAttempts >= MAX_POLL_ATTEMPTS) {
        console.warn(
          "[beamerslides] Reveal.js was not found; skipping layout integration."
        );
        return;
      }
      window.setTimeout(connect, POLL_INTERVAL_MS);
      return;
    }

    if (window.Reveal.isReady && window.Reveal.isReady()) {
      finishDecorate();
    } else {
      window.Reveal.on("ready", finishDecorate);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startChrome, { once: true });
  } else {
    startChrome();
  }
  watchChrome();
  connect();
})();
