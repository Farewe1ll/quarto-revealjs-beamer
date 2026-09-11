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

  // CSS centers line boxes; this pass centers the painted glyphs inside each label.
  const alignInlineLabels = () => {
    const labels = Array.from(document.querySelectorAll(".bg, .button"));
    if (labels.length === 0) {
      return;
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
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

      context.font = [
        style.fontStyle,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].join(" ");
      const metrics = context.measureText(value);
      const actualAscent = metrics.actualBoundingBoxAscent;
      const actualDescent = metrics.actualBoundingBoxDescent;
      const fontAscent = Number.isFinite(metrics.fontBoundingBoxAscent)
        ? metrics.fontBoundingBoxAscent
        : actualAscent;
      const fontDescent = Number.isFinite(metrics.fontBoundingBoxDescent)
        ? metrics.fontBoundingBoxDescent
        : actualDescent;
      if (
        !Number.isFinite(actualAscent) ||
        !Number.isFinite(actualDescent) ||
        !Number.isFinite(fontAscent) ||
        !Number.isFinite(fontDescent)
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

  // Shared 2D context for glyph metrics. The ink is measured from the DRAWN
  // pixels rather than from `actualBoundingBoxAscent/Descent`: those report the
  // font's own bounding box, which for the CJK fallback runs about twice as tall
  // as the glyphs actually painted, and using them over-corrected by roughly 2x.
  let metricsContext = null;
  const fontMetrics = (style, text, contentBoxHeight) => {
    if (!metricsContext) {
      metricsContext = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      });
      if (!metricsContext) {
        return null;
      }
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
    const canvas = metricsContext.canvas;
    const styled = (size) =>
      [style.fontStyle, style.fontWeight, `${size}px`, style.fontFamily].join(
        " "
      );
    metricsContext.font = styled(fontSize);
    const measured = metricsContext.measureText(text);
    const fontAscent = Number.isFinite(measured.fontBoundingBoxAscent)
      ? measured.fontBoundingBoxAscent
      : measured.actualBoundingBoxAscent;
    const fontDescent = Number.isFinite(measured.fontBoundingBoxDescent)
      ? measured.fontBoundingBoxDescent
      : measured.actualBoundingBoxDescent;
    if (!Number.isFinite(fontAscent) || !Number.isFinite(fontDescent)) {
      return null;
    }
    const width = Math.ceil(measured.width) + 8;
    const height = Math.ceil(lineHeight * 3);
    canvas.width = width;
    canvas.height = height;
    metricsContext.font = styled(fontSize);
    metricsContext.clearRect(0, 0, width, height);
    metricsContext.fillStyle = "#000";
    const baseline = Math.round(height / 2);
    metricsContext.textBaseline = "alphabetic";
    metricsContext.fillText(text, 4, baseline);

    const pixels = metricsContext.getImageData(0, 0, width, height).data;
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
        (lineHeight - (fontAscent + fontDescent)) / 2 +
        fontAscent +
        (lastRow - firstRow) / 2 -
        (baseline - firstRow),
    };
  };

  // `align-items: center` centres the LINE BOX, not the ink. A CJK title has no
  // descenders, so its ink sits entirely above the baseline and the band reads
  // as top-heavy; Latin text pulls the other way. Both are corrected here so
  // the optical centre matches the geometric centre of the band. The two shifts
  // run in opposite directions, which is why CSS alone cannot fix both.
  //
  // The nudge has to move the TEXT, not the band: transforming the heading
  // moves its coloured band along with it and drags the bar off the headline.
  // So the text is wrapped once and the wrapper carries the transform.
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

  const centerTitleInk = () => {
    const titles = document.querySelectorAll(
      ".reveal .slides section.beamer-section-slide > h1:first-of-type, " +
        ".reveal .slides section.beamer-frame-slide > h2:first-of-type"
    );
    titles.forEach((title) => {
      const text = title.textContent.trim();
      if (!text || title.clientHeight <= 0) {
        return;
      }
      const wrapper = titleTextWrapper(title);
      wrapper.style.removeProperty("transform");
      // getBoundingClientRect is in device pixels, so undo Reveal's scale before
      // comparing the text height against the CSS line height.
      const revealScale =
        window.Reveal && typeof window.Reveal.getScale === "function"
          ? window.Reveal.getScale()
          : 1;
      const metrics = fontMetrics(
        window.getComputedStyle(title),
        text,
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

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
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
      const paddingBottom = Number.parseFloat(style.paddingBottom);
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

      if (!item.dataset.beamerMarkerPaddingEm) {
        item.dataset.beamerMarkerPaddingEm = String(paddingBottom / fontSize);
      }
      const basePaddingBottom =
        Number.parseFloat(item.dataset.beamerMarkerPaddingEm) * fontSize;

      context.font = [
        style.fontStyle,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
      ].join(" ");
      const metrics = context.measureText(value);
      const actualAscent = metrics.actualBoundingBoxAscent;
      const actualDescent = metrics.actualBoundingBoxDescent;
      const fontAscent = Number.isFinite(metrics.fontBoundingBoxAscent)
        ? metrics.fontBoundingBoxAscent
        : actualAscent;
      const fontDescent = Number.isFinite(metrics.fontBoundingBoxDescent)
        ? metrics.fontBoundingBoxDescent
        : actualDescent;
      if (
        !Number.isFinite(actualAscent) ||
        !Number.isFinite(actualDescent) ||
        !Number.isFinite(fontAscent) ||
        !Number.isFinite(fontDescent)
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

  // In print/PDF layout Reveal paginates the deck, so a slide's client height no
  // longer describes the space its content has. Measuring there reports phantom
  // overflows, so the check is screen-only.
  const isPrintLayout = () =>
    document.documentElement.classList.contains("reveal-print") ||
    document.documentElement.classList.contains("print-pdf") ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("print").matches);

  // Beamer reports an overfull vbox; on the web the equivalent failure is
  // silent, because the slide box hides its overflow. Warn once per slide state
  // so an author notices instead of shipping a frame with invisible content.
  const reportOverflow = (slide) => {
    if (
      isPrintLayout() ||
      slide.getBoundingClientRect().width <= 0 ||
      slideScrolls(slide)
    ) {
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
    console.warn(
      `[beamerslides] ${slide.id ? `#${slide.id}` : "a frame"} overflows its ` +
        `content area by ${overflow}px (${slide.scrollHeight}px of content in ` +
        `${slide.clientHeight}px). Add \`.smaller\` to the frame title, split ` +
        "the frame, or add `.scrollable` so it can scroll."
    );
  };

  const measureFrameTitle = (slide) => {
    const heading = directHeading(slide, "h2");
    const minHeight = baseFrameTitleHeight();
    if (!heading || heading.getBoundingClientRect().width <= 0) {
      reportOverflow(slide);
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
    reportOverflow(slide);
  };

  let frameTitleAnimation = 0;
  const fitFrameTitles = (slides) => {
    window.cancelAnimationFrame(frameTitleAnimation);
    frameTitleAnimation = window.requestAnimationFrame(() => {
      slides.forEach(measureFrameTitle);
    });
  };

  const watchFrameTitles = (slides) => {
    let resizeTimer = 0;
    const refit = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => fitFrameTitles(slides), 40);
    };

    window.addEventListener("resize", refit, { passive: true });
    if (window.Reveal && typeof window.Reveal.on === "function") {
      window.Reveal.on("resize", refit);
      window.Reveal.on("slidechanged", (event) => {
        const currentSlide = event?.currentSlide || window.Reveal.getCurrentSlide();
        if (currentSlide) {
          fitFrameTitles([currentSlide]);
        }
      });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refit);
    }
    if (typeof window.ResizeObserver === "function") {
      const observer = new window.ResizeObserver((entries) => {
        const visibleSlides = entries
          .map((entry) => entry.target)
          .filter(
            (slide) =>
              slide && slide.getBoundingClientRect().width > 0
          );
        if (visibleSlides.length > 0) {
          fitFrameTitles(visibleSlides);
        }
      });
      slides.forEach((slide) => observer.observe(slide));
    }
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

    const slideRect = slide.getBoundingClientRect();
    const revealRect = reveal.getBoundingClientRect();
    const scale = Math.max(
      0.0001,
      typeof window.Reveal.getScale === "function"
        ? window.Reveal.getScale()
        : 1
    );
    const headline = slide.querySelector(":scope > .beamer-headline");
    const frameTitle = directHeading(slide, "h2");
    const logo = reveal.querySelector(".slide-logo");
    const headlineRect = headline?.getBoundingClientRect();
    const frameTitleRect = frameTitle?.getBoundingClientRect();
    const logoRect = logo?.getBoundingClientRect();
    const footerRect = slide
      .querySelector(":scope > .beamer-footline")
      ?.getBoundingClientRect();
    const spacing = 8 * scale;
    const chromeBottom =
      frameTitleRect?.bottom ?? headlineRect?.bottom ?? slideRect.top;
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
      // Reserve exactly as much title padding as the rendered logo needs,
      // measured in canvas pixels rather than a fixed guess.
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

  // Phase 1: chrome injection. This only needs the parsed slide markup, so it
  // runs as soon as that markup is final - before Reveal paints - so the Beamer
  // headline/footline never flash in after the slides are already visible.
  let chromePollHandle = 0;
  let chromeAttempts = 0;
  let chromeObserver = null;
  let chromeInjected = false;

  const decorateChrome = () => {
    const reveal = document.querySelector(".reveal");
    if (!reveal) {
      return false;
    }
    if (reveal.dataset.beamerChrome === "true") {
      return true;
    }

    const slides = leafSlides();
    if (slides.length === 0) {
      return false;
    }

    // The slide markup is final by the time this runs (see `chromeIsSettled`),
    // so injecting here keeps the chrome ahead of Reveal's first paint and no
    // frame renders without its Beamer headline/footline.
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

    document.documentElement.classList.add(`beamer-${variant}`);
    document.body.classList.add(`beamer-${variant}`);
    reveal.classList.add(`beamer-${variant}`);
    reveal.classList.toggle("beamer-has-headline", showHeadline);
    reveal.classList.toggle("beamer-no-headline", !showHeadline);

    const info = titleMetadata();
    const counts = slideCounts(slides);
    let section = info.title;

    slides.forEach((slide) => {
      const h1 = directHeading(slide, "h1");
      const h2 = directHeading(slide, "h2");

      slide.classList.add("beamer-leaf-slide");
      slide.classList.toggle(
        "beamer-center-slide",
        slide.classList.contains("center")
      );
      // Reveal measures the slide before Beamer's full-height layout is added.
      // Its earlier top offset is stale once flex centering owns the content area.
      slide.style.removeProperty("top");
      slide.classList.toggle(
        "beamer-uncounted-slide",
        slide.dataset.visibility === "uncounted"
      );

      if (slide.id === "title-slide") {
        slide.classList.add("beamer-title-slide");
      } else if (h1) {
        section = text(h1) || section;
        slide.classList.add("beamer-section-slide");
      }

      if (h2) {
        slide.classList.add("beamer-frame-slide");
      }

      const context = {
        section: slide.dataset.section || section,
        subsection: slide.dataset.subsection || (h2 ? text(h2) : ""),
      };
      addChrome(slide, context, info, counts.get(slide), options);
    });

    replaceOrcidIcons();
    arrangeTitleSlide();
    alignInlineLabels();
    alignOrderedMarkers();
    centerTitleInk();
    return true;
  };

  // The slide markup is only final once the parser has passed it. Waiting for
  // DOMContentLoaded is not enough: Reveal adds its `.ready` class from a timer
  // that fires as soon as its bundle is parsed, which can happen while the
  // document is still loading (deferred scripts are still being fetched), and
  // the deck then paints a chrome-less frame. `.reveal.ready` therefore also
  // proves the markup is settled - Reveal can only be ready after it has read
  // the slides - so the chrome is injected the moment that class shows up.
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
    if (!chromeIsSettled() || !decorateChrome()) {
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

    const slides = leafSlides();
    const revealConfig =
      typeof window.Reveal.getConfig === "function"
        ? window.Reveal.getConfig()
        : {};
    const showProgress = metaBoolean(
      "beamer-progress",
      revealConfig.progress === true
    );

    if (revealConfig.center === true) {
      slides.forEach((slide) => slide.classList.add("beamer-center-slide"));
    }
    reveal.classList.toggle("beamer-has-progress", showProgress);
    if (showProgress) {
      const counts = slideCounts(slides);
      slides.forEach((slide) => {
        appendProgress(slide.querySelector(":scope > .beamer-footline"), counts.get(slide));
      });
    }

    fitFrameTitles(slides);
    watchFrameTitles(slides);
    positionNativeUi(reveal);

    const realignOpticalLabels = () => {
      window.requestAnimationFrame(alignInlineLabels);
      window.requestAnimationFrame(alignOrderedMarkers);
      window.requestAnimationFrame(centerTitleInk);
    };
    const realignForPrint = () => {
      alignInlineLabels();
      alignOrderedMarkers();
      centerTitleInk();
      slides.forEach(measureFrameTitle);
    };
    const repositionNativeUi = (event) => {
      const currentSlide =
        event?.currentSlide ||
        (typeof window.Reveal.getCurrentSlide === "function"
          ? window.Reveal.getCurrentSlide()
          : null);
      const reposition = () => positionNativeUi(reveal, currentSlide);
      window.requestAnimationFrame(reposition);
      window.setTimeout(reposition, 80);
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
