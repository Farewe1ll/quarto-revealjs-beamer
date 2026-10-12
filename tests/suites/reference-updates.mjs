// New reference and delivery regressions share the serial runner and harness.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { withDistribution } from "../lib/distribution.mjs";
import { assertPrintLayout, BrowserPage, delay, showSlide, startServer } from "../lib/harness.mjs";

// check() also returns true for an undeclared family. Require an actual loaded
// FontFace so a missing @font-face rule cannot pass the installation check.
const installedFontSource = `(async (family = 'Beamerslides Libertinus Sans') => {
  const faces = await document.fonts.load('400 30px "' + family + '"');
  return faces.length > 0 && faces.every(face => face.status === 'loaded');
})`;

export const testReferencesDeclarationOrder = async (connection, origin) => {
  const cases = [
    ["refs-order", ["zulu", "alpha"], "zulu,delta,alpha,unused"],
    ["refs-order-all", ["zulu", "delta", "alpha", "unused"], "zulu,delta,alpha,unused"],
    ["refs-order-compensated", ["zulu", "delta", "alpha"], "zulu,delta,alpha"],
    ["refs-order-citation", ["alpha", "zulu"], null],
    ["refs-order-fallback", ["inline", "zulu"], "zulu,delta,alpha", /rendered key 'inline' has no declaration position/],
    ["refs-order-duplicate", ["alpha", "zulu"], null],
    ["refs-order-unsupported", ["alpha", "zulu"], null],
  ];
  for (const [name, keys, shipped, warning] of cases) {
    const page = await BrowserPage.create(connection, `${origin}/${name}.html`);
    try {
      const state = await page.evaluate(`(() => {
        const entries = [...document.querySelectorAll('.csl-entry')];
        const slides = [...document.querySelectorAll('section')].filter(s =>
          s.querySelector(':scope > h2') && s.querySelector('.csl-entry'));
        return {
          shipped: document.querySelector('meta[name="beamer-refs-keys"]')?.content ?? null,
          keys: entries.map(e => e.id.replace(/^ref-/, '')),
          uncounted: slides.every(s => s.dataset.visibility === 'uncounted'),
          chrome: slides.every(s => s.querySelector(':scope > .beamer-footline')),
          links: [...document.querySelectorAll('[role="doc-biblioref"]')].every(a =>
            document.getElementById(a.getAttribute('href').split('/').pop().replace(/^#/, '')))
        };
      })()`);
      assert.equal(state.shipped, shipped, `${name}: parsed declaration positions`);
      assert.deepEqual(state.keys, keys, `${name}: reference order`);
      assert.equal(new Set(state.keys).size, keys.length, `${name}: each entry once`);
      assert(state.uncounted && state.chrome && state.links, `${name}: reference integrity`);
      const warnings = connection.events.filter(e =>
        e.sessionId === page.sessionId && e.method === 'Runtime.consoleAPICalled' &&
        e.params.type === 'warning').map(e => e.params.args.map(a => a.value || '').join(' '));
      const orderWarnings = warnings.filter(w => w.includes('refs-order: declaration'));
      if (warning) assert.match(orderWarnings.join('\n'), warning, name);
      else assert.deepEqual(orderWarnings, [], `${name}: no false ordering warning`);
    } finally {
      await page.close();
    }
  }
};

export const testDistribution = async (connection) => withDistribution(async ({ scratch, isolated }) => {
  const local = await startServer({ directory: scratch });
  try {
    for (const [path, variant] of [
      ["template/template.html", "madrid"],
      ["template/template-cambridgeus.html", "cambridgeus"],
      ["added/madrid.html", "madrid"],
      ["added/cambridgeus.html", "cambridgeus"],
    ]) {
      const page = await BrowserPage.create(connection, `${local.origin}/${path}`);
      try {
        if (path.startsWith('added/')) await showSlide(page, 'installed-math');
        const state = await page.evaluate(`(async () => ({
          variant: document.querySelector('.reveal').classList.contains('beamer-${variant}'),
          math: document.querySelectorAll('.math .katex').length,
          font: await ${installedFontSource}(),
          footers: document.querySelectorAll('.beamer-footline').length,
          image: [...document.querySelectorAll('#installed-math img')].some(image =>
            image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0 &&
            image.getBoundingClientRect().height > 0)
        }))()`);
        assert(state.variant && state.font && state.math > 0 && state.footers > 0, `installed ${path}: ${JSON.stringify(state)}`);
        if (path.startsWith('added/')) assert(state.image, `installed ${path}: visible media`);
        assert.equal(await page.evaluate(`${installedFontSource}('Beamerslides missing font')`), false,
          'an undeclared font family must not pass the resource check');
      } finally { await page.close(); }
    }
    // The isolated file has no support directory; forbid HTTP(S) before navigating.
    const offline = await BrowserPage.create(connection, pathToFileURL(join(isolated, "slides.html")).href,
      undefined, { blockedURLs: ["http://*", "https://*"] });
    try {
      await showSlide(offline, 'installed-math');
      const state = await offline.evaluate(`(async () => {
        const graphic = document.querySelector('#installed-math img[src^="data:"], #installed-math svg[role="img"]');
        if (graphic?.tagName === 'IMG') await graphic.decode();
        const box = graphic?.getBoundingClientRect();
        const image = Boolean(box?.width > 0 && box.height > 0 &&
          (graphic.tagName === 'IMG' ? graphic.naturalWidth > 0 :
            graphic.querySelector('path, rect, circle, ellipse, polygon, polyline, line, text')));
        return {
        math: document.querySelectorAll('.math .katex').length,
        font: await ${installedFontSource}(),
        externalScripts: [...document.scripts].filter(s => s.src && !s.src.startsWith('data:')).length,
        externalStyles: [...document.querySelectorAll('link[rel="stylesheet"]')].filter(s => !s.href.startsWith('data:')).length,
        image,
        graphic: graphic ? {tag:graphic.tagName, width:box.width, height:box.height,
          naturalWidth:graphic.naturalWidth} : null
      }; })()`);
      assert.equal(state.math, 1, JSON.stringify(state));
      assert(state.font && state.image, JSON.stringify(state));
      assert.equal(state.externalScripts + state.externalStyles, 0, JSON.stringify(state));
    } finally { await offline.close(); }
  } finally {
    local.server.closeIdleConnections?.();
    local.server.closeAllConnections?.();
    await new Promise(resolve => local.server.close(resolve));
  }
});

// Final geometry is read after navigation so hidden pages cannot pass with 0x0 boxes.
const referencesGeometrySource = `(async () => {
  const pages = [...document.querySelectorAll('section.beamer-leaf-slide')].filter(s => s.querySelector('#refs, .beamer-refs'));
  const result = [];
  for (const slide of pages) {
    const index = Reveal.getIndices(slide);
    Reveal.slide(index.h, index.v);
    await new Promise(resolve => setTimeout(resolve, 100));
    const layer = slide.querySelector(':scope > .beamer-scroll') || slide;
    result.push({id:slide.id, keys:[...slide.querySelectorAll('.csl-entry')].map(e=>e.id),
      visible:Reveal.getCurrentSlide()===slide && layer.clientHeight>0 && layer.getBoundingClientRect().width>0,
      overflow:layer.scrollHeight-layer.clientHeight,
      titleHeight:parseFloat(getComputedStyle(slide).getPropertyValue('--beamer-frame-height')),
      uncounted:slide.dataset.visibility==='uncounted',
      chrome:slide.querySelectorAll(':scope > .beamer-footline').length,
      known:Boolean(Reveal.getSlideBackground(slide))});
  }
  return result;
})()`;

const assertReferencesFit = (state, label, allowOversize = false) => {
  const keys = state.flatMap(p=>p.keys);
  assert.equal(keys.length,13,`${label}: entry count`);
  assert.equal(new Set(keys).size,13,`${label}: entry uniqueness`);
  for(const page of state) {
    assert(page.visible,`${label}: measure the active, visible page ${page.id}`);
    assert(page.keys.length>0,`${label}: no stale generated pages`);
    assert(page.overflow<=1 || (allowOversize && page.keys.length===1),`${label}: final overflow ${JSON.stringify(page)}`);
    assert(page.uncounted && page.known && page.chrome===1,`${label}: chrome and Reveal model`);
  }
};

export const testReferencesFinalGeometry = async (connection, origin) => {
  for(const name of ['refs-long-title','refs-long-title-cambridgeus','refs-long-title-tall','refs-long-section']) {
    const page=await BrowserPage.create(connection,`${origin}/${name}.html`);
    try {
      const state=await page.evaluate(referencesGeometrySource);
      assertReferencesFit(state,name);
      if(name==='refs-long-title') {
        assert(state[0].titleHeight>58 && state[0].titleHeight<132,'exercise growth below the scrolling threshold');
        assert(state[0].keys.length<9,'the old 9-entry slice no longer fits');
      }
      if(name==='refs-long-title-tall') assert(state.some(p=>p.titleHeight>132),'exercise titles above the scrolling threshold');
      const changed = await page.evaluate(`(async()=>{
        const before=[...document.querySelectorAll('.csl-entry')].map(e=>e.id);
        for(let i=0;i<8;i++) window.dispatchEvent(new Event('resize'));
        await new Promise(r=>setTimeout(r,200));
        return {before,after:[...document.querySelectorAll('.csl-entry')].map(e=>e.id)};
      })()`);
      assert.deepEqual(changed.after,changed.before,`${name}: repeated layout events preserve order`);
      assertReferencesFit(await page.evaluate(referencesGeometrySource),`${name}: repeated resize`);
      if(name==='refs-long-title') {
        await page.evaluate(`Reveal.configure({width:960,height:720})`);
        await delay(200);
        assertReferencesFit(await page.evaluate(referencesGeometrySource),'4:3 reference geometry');
        await page.evaluate(`(() => {
          Reveal.configure({width:1280,height:720});
          document.querySelector('.reveal').style.setProperty('--beamer-frame-height','84px');
          window.dispatchEvent(new Event('resize'));
        })()`);
        await delay(200);
        assertReferencesFit(await page.evaluate(referencesGeometrySource),'custom base title height');
        assert.equal(await page.evaluate("document.querySelector('.reveal').style.getPropertyValue('--beamer-frame-height')"),'84px','measurements do not overwrite the theme input');
      }
    } finally {await page.close();}
  }
  const declared = await BrowserPage.create(connection, `${origin}/refs-continuation.html`);
  try {
    const before = await declared.evaluate(`({notes:document.querySelector('#refs-two aside.notes')?.textContent, pages:[...document.querySelectorAll('section[data-item]')].map(s=>s.id)})`);
    assert(before.notes, 'declared continuation carries authored notes');
    await declared.evaluate(`(() => {document.querySelector('.reveal').style.setProperty('--beamer-frame-height','84px');window.dispatchEvent(new Event('resize'));})()`);
    await delay(200);
    assertReferencesFit(await declared.evaluate(referencesGeometrySource),'declared continuations');
    assert.deepEqual(await declared.evaluate(`({notes:document.querySelector('#refs-two aside.notes')?.textContent, pages:[...document.querySelectorAll('section[data-item]')].filter(s=>['refs-one','refs-two'].includes(s.id)).map(s=>s.id)})`),before,'author-declared pages and notes survive updates');
  } finally { await declared.close(); }
  const print = await BrowserPage.create(connection, `${origin}/refs-long-title.html?print-pdf`);
  try {
    await print.emulateMedia('print');
    await assertPrintLayout(print);
    assert.equal(await print.evaluate("new Set([...document.querySelectorAll('.csl-entry')].map(e=>e.id)).size"),13,'printing retains unique references');
  } finally { await print.close(); }
};

export const testReferencesDelayedResources = async (connection) => {
  const local=await startServer();
  const serve=local.server.listeners('request')[0];
  local.server.removeAllListeners('request');
  local.server.on('request',(request,response)=>{
    if(request.url==='/late-reference.svg') {
      setTimeout(()=>{
        response.writeHead(200,{'content-type':'image/svg+xml'});
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="red"/></svg>');
      },800);
    } else if(request.url.endsWith('.woff2')) setTimeout(()=>serve(request,response),800);
    else serve(request,response);
  });
  try {
    const page=await BrowserPage.create(connection,`${local.origin}/refs-long-title-progress.html`,undefined,{preloadScript:`(()=>{
      let inserted=false;
      const observer=new MutationObserver(()=>{
        const entry=document.querySelector('.csl-entry');
        if(entry&&!inserted) {inserted=true;const image=document.createElement('img');image.src='/late-reference.svg';image.style.width='200px';entry.appendChild(image);}
        if(document.querySelector('.reveal')?.dataset.beamerChrome==='true') {
          window.__initialReferences={fonts:document.fonts.status, imageLoaded:document.querySelector('.csl-entry img')?.complete,
            entries:[...document.querySelectorAll('.csl-entry')].map(e=>e.id)};
          observer.disconnect();
        }
      });observer.observe(document,{childList:true,subtree:true,attributes:true});
    })()`});
    try {
      const initial=await page.evaluate('window.__initialReferences');
      assert.equal(initial.fonts,'loading','fonts must be delayed until after chrome');
      assert.equal(initial.imageLoaded,false,'image must be delayed until after initial pagination');
      assertReferencesFit(await page.evaluate(referencesGeometrySource),'delayed font/image load');
      const keys=await page.evaluate(`[...document.querySelectorAll('.csl-entry')].map(e=>e.id)`);
      assert.deepEqual(keys,initial.entries,'resource updates preserve citeproc order');
      // Create and then remove generated pages; declared pages and the originals survive.
      await page.evaluate(`(() => {document.querySelector('.csl-entry img').style.height='420px'; window.dispatchEvent(new Event('resize'));})()`);
      await delay(200);
      const expanded=await page.evaluate(referencesGeometrySource);
      assertReferencesFit(expanded,'expanded image');
      assert(await page.evaluate(`[...document.querySelectorAll('section.beamer-leaf-slide')].filter(s=>s.querySelector('.csl-entry')).every(s=>s.querySelector('.beamer-footline-progress'))`),'new pages inherit Reveal progress configuration');
      // A page added after observer setup must react without a window resize or
      // navigation (both would otherwise hide a missing ResizeObserver target).
      await showSlide(page, expanded.at(-1).id);
      const oldTitleHeight = await page.evaluate(`(() => {
        const slide = Reveal.getCurrentSlide();
        const height = parseFloat(slide.style.getPropertyValue('--beamer-frame-height'));
        slide.style.setProperty('width', '600px', 'important');
        return height;
      })()`);
      await delay(250);
      assert(await page.evaluate(`parseFloat(Reveal.getCurrentSlide().style.getPropertyValue('--beamer-frame-height'))`) > oldTitleHeight,
        'newly generated pages observe their own size changes');
      assertReferencesFit(await page.evaluate(referencesGeometrySource),'generated page width change');
      await page.evaluate(`document.getElementById(${JSON.stringify(expanded.at(-1).id)}).style.removeProperty('width')`);
      await delay(250);
      await page.evaluate(`(() => {const image=document.querySelector('.csl-entry img');image.style.height='900px';image.style.maxHeight='none';window.dispatchEvent(new Event('resize'));})()`);
      await delay(200);
      const oversized=await page.evaluate(referencesGeometrySource);
      assertReferencesFit(oversized,'single oversized entry',true);
      assert(oversized.some(p=>p.overflow>1 && p.keys.length===1),'oversized entry must progress with scrolling');
      await showSlide(page,oversized[0].id);
      const scroll=await page.evaluate(`(async()=>{
        const layer=Reveal.getCurrentSlide().querySelector('.beamer-scroll');
        layer.scrollTop=100;
        const before=layer.scrollTop;
        window.dispatchEvent(new Event('resize'));
        await new Promise(r=>setTimeout(r,200));
        return {before,after:Reveal.getCurrentSlide().querySelector('.beamer-scroll').scrollTop};
      })()`);
      assert.equal(scroll.before,100,'oversized entry must allow scrolling');
      assert.equal(scroll.after,scroll.before,'unchanged slices preserve scroll position');
      await showSlide(page,oversized.at(-1).id);
      await page.evaluate(`(() => {
        window.__removedReferencePage = Reveal.getCurrentSlide();
        window.__referenceAnchor = window.__removedReferencePage.querySelector('.csl-entry');
        document.querySelector('.csl-entry img').remove();
        window.dispatchEvent(new Event('resize'));
      })()`);
      await delay(200);
      // Check before the geometry helper navigates through every reference page.
      const selection = await page.evaluate(`({
        removed:!window.__removedReferencePage.isConnected,
        connected:Reveal.getCurrentSlide().isConnected,
        followsEntry:Reveal.getCurrentSlide()===window.__referenceAnchor.closest('section')
      })`);
      assert(selection.removed && selection.connected && selection.followsEntry,
        `selection follows the entry off its removed page: ${JSON.stringify(selection)}`);
      const contracted=await page.evaluate(referencesGeometrySource);
      assertReferencesFit(contracted,'removed image');
      assert.deepEqual(contracted.flatMap(p=>p.keys),initial.entries,'contraction retains original entries');
      assert(expanded.length>contracted.length,'unused generated pages are removed');
    } finally {await page.close();}
  } finally {
    local.server.closeIdleConnections?.();
    local.server.closeAllConnections?.();
    await new Promise(resolve=>local.server.close(resolve));
  }
};

