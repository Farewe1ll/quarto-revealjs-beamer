// Optional comparison capture; do not run alongside the regression suite.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserPage, renderFixture, rootDir, showSlide, startServer, withBrowser } from "../lib/harness.mjs";

const output = join(rootDir, "tmp/reference-beamer/output");
mkdirSync(output, { recursive: true });
for (const variant of ["madrid", "cambridgeus"]) {
  renderFixture(`reference-${variant}`, {
    source: "../reference-beamer/reference", metadata: { "beamer-variant": variant },
  });
}
const local = await startServer();
try {
  await withBrowser(async chrome => {
    for (const variant of ["madrid", "cambridgeus"]) {
      const page = await BrowserPage.create(chrome.connection, `${local.origin}/reference-${variant}.html`);
      try {
        const ids = await page.evaluate("[...document.querySelectorAll('section.beamer-leaf-slide')].map(s=>s.id)");
        console.log(variant, await page.evaluate(`({titleFont:getComputedStyle(document.querySelector('#title-slide h1')).fontFamily, bodyFont:getComputedStyle(document.querySelector('.reveal')).fontFamily, title:getComputedStyle(document.querySelector('#title-slide h1')).fontWeight})`));
        for (const [index, id] of ids.entries()) {
          await showSlide(page, id);
          const { data } = await chrome.connection.send("Page.captureScreenshot", {
            format: "png", fromSurface: true, captureBeyondViewport: false,
          }, page.sessionId);
          writeFileSync(join(output, `html-${variant}-${index + 1}.png`), Buffer.from(data, "base64"));
        }
        console.log(`${variant}: captured ${ids.length} HTML pages`);
      } finally {
        await page.close();
      }
    }
  });
} finally {
  local.server.closeIdleConnections?.();
  local.server.closeAllConnections?.();
  await new Promise(resolve => local.server.close(resolve));
}
