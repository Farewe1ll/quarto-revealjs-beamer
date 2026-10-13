import assert from "node:assert/strict";
import { BrowserPage, delay, startServer } from "../lib/harness.mjs";

// Screen pages must be exposed through navigation; PDF pages are all visible.
// Compare entry boxes with fixed chrome, not just scrollHeight: a visible
// overflow rule must not hide a failed pagination measurement.
const geometrySource = `(async () => {
  const print = document.documentElement.classList.contains('print-pdf') ||
    document.documentElement.classList.contains('reveal-print');
  const slides = [...document.querySelectorAll('section.beamer-leaf-slide')]
    .filter(s => s.querySelector('#refs, .beamer-refs'));
  const pages = [];
  for (const slide of slides) {
    if (!print) {
      const index = Reveal.getIndices(slide);
      Reveal.slide(index.h, index.v);
      await new Promise(r => setTimeout(r, 100));
    }
    const layer = slide.querySelector(':scope > .beamer-scroll') || slide;
    const box = layer.getBoundingClientRect();
    const footer = slide.querySelector(':scope > .beamer-footline');
    const entries = [...slide.querySelectorAll('.csl-entry')];
    pages.push({
      keys: entries.map(e => e.id),
      visible: box.width > 0 && box.height > 0,
      belowTitle: entries.every(e => e.getBoundingClientRect().top >= box.top - 1),
      aboveFooter: entries.every(e => e.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top + 1),
      overflow: layer.scrollHeight - layer.clientHeight,
      wrapperHeight:slide.parentElement.clientHeight,
      // The first, ordinary PDF page is created by Reveal and is untouched by
      // reference pagination. Use it as an independent paper-size reference.
      expectedPrintHeight:document.querySelector('.pdf-page')?.clientHeight,
      overflowMode: getComputedStyle(layer).overflowY,
      wrapped: slide.parentElement.classList.contains('pdf-page'),
      chrome: slide.querySelectorAll(':scope > .beamer-footline').length,
      uncounted: slide.dataset.visibility === 'uncounted',
      background: Boolean(slide.slideBackgroundElement),
      notes: slide.querySelector('aside.notes')?.textContent || ''
    });
  }
  return {print, pages, documentHeight:document.documentElement.scrollHeight,
    emptyWrappers: [...document.querySelectorAll('.pdf-page')]
    .filter(p => !p.querySelector('section')).length};
})()`;

const groups = state => state.pages.map(p => p.keys);
const assertGeometry = (state, label, {print = false, oversized = false} = {}) => {
  assert.equal(state.print, print, `${label}: actual print layout`);
  const keys = state.pages.flatMap(p => p.keys);
  assert.equal(keys.length, 13, `${label}: all references retained`);
  assert.equal(new Set(keys).size, 13, `${label}: each reference once`);
  assert.equal(state.emptyWrappers, 0, `${label}: no stale PDF pages`);
  for (const page of state.pages) {
    assert(page.visible && page.keys.length > 0, `${label}: visible nonempty page`);
    assert(page.chrome === 1 && page.uncounted && page.background, `${label}: chrome and background`);
    if (print) {
      assert(page.wrapped, `${label}: each reference slide has a PDF wrapper`);
      assert.equal(page.wrapperHeight, page.expectedPrintHeight, `${label}: one logical slide per PDF wrapper`);
    }
    const oversize = oversized && page.keys.length === 1 && page.overflow > 1;
    if (oversize) {
      assert.equal(page.overflowMode, 'auto', `${label}: oversized entry retains scrolling`);
    } else {
      assert(page.belowTitle && page.aboveFooter, `${label}: entries stay between title and footer`);
      if (print) assert(page.overflow <= 1 || page.overflowMode === 'visible', `${label}: fitting entries require no scrolling`);
      else assert(page.overflow <= 1, `${label}: screen content fits`);
    }
  }
};

export const testReferencesPrintParity = async (connection, origin) => {
  for (const name of ['refs-auto', 'refs-print', 'refs-print-margin', 'refs-print-percentage',
    'refs-print-four-three', 'refs-long-title-cambridgeus', 'refs-long-section', 'refs-continuation']) {
    const screen = await BrowserPage.create(connection, `${origin}/${name}.html`);
    let expected;
    let version;
    try {
      await delay(150);
      version = await screen.evaluate('Reveal.VERSION');
      expected = await screen.evaluate(geometrySource);
      assertGeometry(expected, `${name}: screen`);
    } finally { await screen.close(); }
    // Reveal 4 (Quarto 1.4) supports print-pdf, but ignores view=print.
    const queries = Number.parseInt(version, 10) >= 5 ? ['?view=print', '?print-pdf'] : ['?print-pdf'];
    for (const query of queries) {
      const page = await BrowserPage.create(connection, `${origin}/${name}.html${query}`);
      try {
        await delay(150);
        await page.emulateMedia('print');
        const actual = await page.evaluate(geometrySource);
        assertGeometry(actual, `${name}${query}`, {print:true});
        assert.deepEqual(groups(actual), groups(expected), `${name}${query}: same per-page entries as screen`);
        assert.deepEqual(actual.pages.map(p => p.notes), expected.pages.map(p => p.notes), `${name}: declared notes retained`);
        await delay(200);
        const settled = await page.evaluate(geometrySource);
        assertGeometry(settled, `${name}${query}: settled`, {print:true});
        assert.deepEqual(groups(settled), groups(actual), `${name}: repeated updates preserve grouping`);
        assert.equal(settled.documentHeight, actual.documentHeight, `${name}: PDF dimensions stop changing`);
      } finally { await page.close(); }
    }
  }
};

export const testReferencesPrintResources = async (connection) => {
  const local = await startServer();
  const serve = local.server.listeners('request')[0];
  local.server.removeAllListeners('request');
  local.server.on('request', (request, response) => {
    if (request.url === '/print-reference.svg') {
      setTimeout(() => {
        response.writeHead(200, {'content-type':'image/svg+xml'});
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="red"/></svg>');
      }, 800);
    } else if (request.url.endsWith('.woff2')) setTimeout(() => serve(request, response), 800);
    else serve(request, response);
  });
  const preloadScript = `(() => {
    let inserted = false;
    const observer = new MutationObserver(() => {
      const entry = document.querySelector('.csl-entry');
      if (entry && !inserted) {
        inserted = true;
        const image = document.createElement('img');
        image.src = '/print-reference.svg'; image.style.width = '200px';
        entry.appendChild(image);
      }
      if (document.querySelector('.reveal')?.dataset.beamerChrome === 'true') {
        window.__initialResources = {fonts:document.fonts.status,
          imageLoaded:document.querySelector('.csl-entry img')?.complete};
        observer.disconnect();
      }
    });
    observer.observe(document, {childList:true, subtree:true, attributes:true});
  })()`;
  try {
    let expected;
    for (const query of ['', '?print-pdf']) {
      const page = await BrowserPage.create(connection, `${local.origin}/refs-long-title-progress.html${query}`,
        undefined, {preloadScript});
      try {
        const initial = await page.evaluate('window.__initialResources');
        assert.equal(initial.fonts, 'loading', 'fonts load after initial pagination');
        assert.equal(initial.imageLoaded, false, 'image loads after initial pagination');
        await delay(150);
        const first = await page.evaluate(geometrySource);
        assertGeometry(first, `delayed resources${query}`, {print:Boolean(query)});
        const states = [groups(first)];
        for (const height of [420, 900, 0]) {
          await page.evaluate(`(() => {
            const image = document.querySelector('.csl-entry img');
            image.style.height = '${height}px'; image.style.maxHeight = 'none';
            window.dispatchEvent(new Event('resize'));
          })()`);
          await delay(200);
          const state = await page.evaluate(geometrySource);
          assertGeometry(state, `image ${height}${query}`, {print:Boolean(query), oversized:height === 900});
          assert.deepEqual(state.pages.flatMap(p => p.keys), first.pages.flatMap(p => p.keys), 'updates preserve order');
          states.push(groups(state));
        }
        assert(states[2].length > states[3].length, 'expansion and contraction exercise generated page removal');
        if (query) assert.deepEqual(states, expected, 'print resource updates match screen at each size');
        else expected = states;
      } finally { await page.close(); }
    }
  } finally {
    local.server.closeIdleConnections?.();
    local.server.closeAllConnections?.();
    await new Promise(resolve => local.server.close(resolve));
  }
};
