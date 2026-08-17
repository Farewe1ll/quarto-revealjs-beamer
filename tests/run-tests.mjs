import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import pngjs from "pngjs";

const { PNG } = pngjs;

const testsDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testsDir, "..");
const outputDir = join(testsDir, "_output");
const artifactsDir = join(testsDir, "_artifacts");
const baselinesDir = join(testsDir, "baselines");
const chromeTemporaryDir = mkdtempSync(join(tmpdir(), "beamerslides-chrome-"));
const chromeProfileDir = join(chromeTemporaryDir, "profile");
const chromeStderrPath = join(chromeTemporaryDir, "chrome-stderr.log");
mkdirSync(chromeProfileDir, { recursive: true });
const temporaryInputs = [];
const generatedFixtureIgnore = join(testsDir, "fixtures", ".gitignore");
const fixtureIgnoreExisted = existsSync(generatedFixtureIgnore);
const updateVisualBaselines = process.env.UPDATE_VISUAL_BASELINES === "1";
const skipVisualRegression = process.env.SKIP_VISUAL_REGRESSION === "1";
const quartoCommand = process.env.BEAMERSLIDES_QUARTO_BIN || "quarto";
const maximumVisualDifference = 0.015;
const requestedChromeStartupTimeout = Number.parseInt(
  process.env.BEAMERSLIDES_CHROME_STARTUP_TIMEOUT_MS || "",
  10
);
const chromeStartupTimeout =
  Number.isFinite(requestedChromeStartupTimeout) &&
  requestedChromeStartupTimeout > 0
    ? requestedChromeStartupTimeout
    : 30_000;
const debugCleanup = (...values) => {
  if (process.env.BEAMERSLIDES_DEBUG_CLEANUP === "1") {
    console.error("[cleanup]", ...values);
  }
};

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const waitForChildExit = (processHandle, milliseconds) => {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolveExit) => {
    let settled = false;
    let timeoutHandle;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      processHandle.off("exit", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    processHandle.once("exit", onExit);
    timeoutHandle = setTimeout(() => finish(false), milliseconds);
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      finish(true);
    }
  });
};

const childIsRunning = (processHandle) =>
  processHandle.pid !== undefined &&
  processHandle.exitCode === null &&
  processHandle.signalCode === null;

const stopChildProcess = async (processHandle) => {
  if (!processHandle) return;

  if (childIsRunning(processHandle)) {
    try {
      processHandle.kill("SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") {
        console.warn(`Warning: could not stop Chrome gracefully: ${error.message}`);
      }
    }
    await waitForChildExit(processHandle, 3000);
  }
  if (childIsRunning(processHandle)) {
    try {
      processHandle.kill("SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") {
        console.warn(`Warning: could not force Chrome to stop: ${error.message}`);
      }
    }
    await waitForChildExit(processHandle, 5000);
  }
  processHandle.unref();
};

const removeTemporaryDirectory = async (target) => {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(target, { force: true, recursive: true });
      return;
    } catch (error) {
      lastError = error;
      if (!["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code)) {
        break;
      }
      await delay(Math.min(1000, 100 * 2 ** attempt));
    }
  }

  // A GitHub-hosted runner removes its own /tmp directory. A late Chrome
  // helper must not turn an otherwise successful regression run into a failure.
  console.warn(
    `Warning: could not remove temporary Chrome directory ${target}: ${lastError?.message}`
  );
};

const ensureTestPath = (target) => {
  const relativePath = relative(join(rootDir, "tests"), target);
  assert(!relativePath.startsWith(".."), `Unsafe test path: ${target}`);
};

const resetDirectory = (target) => {
  ensureTestPath(target);
  rmSync(target, { force: true, recursive: true });
  mkdirSync(target, { recursive: true });
};

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result.stdout;
};

const renderFixture = (name) => {
  const fixture = join(testsDir, "fixtures", `${name}.qmd`);
  const temporaryInput = join(rootDir, `.beamerslides-test-${name}.qmd`);
  temporaryInputs.push(temporaryInput);
  copyFileSync(fixture, temporaryInput);
  try {
    run(quartoCommand, [
      "render",
      basename(temporaryInput),
      "--output",
      `${name}.html`,
      "--output-dir",
      "tests/_output",
      "--no-clean",
    ]);
  } finally {
    if (existsSync(temporaryInput)) {
      unlinkSync(temporaryInput);
    }
  }
};

const findChrome = () => {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(sep) && existsSync(candidate)) {
      return candidate;
    }
    const located = spawnSync("which", [candidate], { encoding: "utf8" });
    if (located.status === 0 && located.stdout.trim()) {
      return located.stdout.trim();
    }
  }
  throw new Error("Chrome or Chromium is required for browser regression tests.");
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".eot": "application/vnd.ms-fontobject",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const startServer = async () => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const target = resolve(outputDir, `.${decodedPath}`);
    if (target !== outputDir && !target.startsWith(`${outputDir}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    let file = target;
    if (existsSync(file) && statSync(file).isDirectory()) {
      file = join(file, "index.html");
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(file)] || "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  return { server, origin: `http://127.0.0.1:${address.port}` };
};

class CdpConnection {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    webSocket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result || {});
        }
      } else {
        this.events.push(message);
      }
    });
    webSocket.addEventListener("close", () => {
      const error = new Error("Chrome DevTools connection closed.");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  static async connect(url, timeoutMilliseconds = 1000) {
    const webSocket = new WebSocket(url);
    try {
      await Promise.race([
        new Promise((resolveOpen, rejectOpen) => {
          webSocket.addEventListener("open", resolveOpen, { once: true });
          webSocket.addEventListener(
            "error",
            () => rejectOpen(new Error(`Unable to connect to ${url}`)),
            { once: true }
          );
        }),
        delay(timeoutMilliseconds).then(() => {
          throw new Error(`Timed out connecting to ${url}`);
        }),
      ]);
    } catch (error) {
      try {
        webSocket.close();
      } catch {
        // The socket may still be in its initial connection state.
      }
      throw error;
    }
    return new CdpConnection(webSocket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.webSocket.send(JSON.stringify(message));
    });
  }

  close() {
    if (this.webSocket.readyState >= WebSocket.CLOSING) {
      return Promise.resolve();
    }

    return new Promise((resolveClose) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolveClose();
      };
      this.webSocket.addEventListener("close", finish, { once: true });
      this.webSocket.addEventListener("error", finish, { once: true });
      this.webSocket.close();
      delay(1000).then(finish);
    });
  }
}

const readChromeStderr = () =>
  existsSync(chromeStderrPath)
    ? readFileSync(chromeStderrPath, "utf8")
    : "";

const preserveChromeStartupDiagnostics = (details) => {
  try {
    mkdirSync(artifactsDir, { recursive: true });
    if (existsSync(chromeStderrPath)) {
      copyFileSync(chromeStderrPath, join(artifactsDir, "chrome-stderr.log"));
    }
    writeFileSync(
      join(artifactsDir, "chrome-startup.json"),
      `${JSON.stringify(details, null, 2)}\n`
    );
  } catch (error) {
    console.warn(`Warning: could not preserve Chrome diagnostics: ${error.message}`);
  }
};

const launchChrome = async () => {
  const chromePath = findChrome();
  const startupStartedAt = Date.now();
  const stderrFd = openSync(chromeStderrPath, "w");
  let processHandle;
  try {
    processHandle = spawn(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-breakpad",
        "--disable-crash-reporter",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${chromeProfileDir}`,
        "--window-size=1280,720",
        "--force-device-scale-factor=1",
      ],
      { stdio: ["ignore", "ignore", stderrFd] }
    );
  } finally {
    closeSync(stderrFd);
  }

  let spawnError;
  let lastActivePortContents = "";
  let lastConnectionError = "";
  processHandle.once("error", (error) => {
    spawnError = error;
  });

  const startupFailure = async (summary) => {
    const observedExitCode = processHandle.exitCode;
    const observedSignalCode = processHandle.signalCode;
    await stopChildProcess(processHandle);
    const stderr = readChromeStderr();
    const details = {
      summary,
      chromePath,
      elapsedMilliseconds: Date.now() - startupStartedAt,
      timeoutMilliseconds: chromeStartupTimeout,
      exitCode: observedExitCode,
      signalCode: observedSignalCode,
      spawnError: spawnError?.message || null,
      activePortFileContents: lastActivePortContents || null,
      lastConnectionError: lastConnectionError || null,
    };
    preserveChromeStartupDiagnostics(details);
    return new Error(
      [
        summary,
        `Chrome executable: ${chromePath}`,
        `Startup wait: ${details.elapsedMilliseconds} ms`,
        lastConnectionError && `Last connection error: ${lastConnectionError}`,
        "Chrome stderr:",
        stderr.trim() || "(no stderr output)",
      ]
        .filter(Boolean)
        .join("\n")
    );
  };

  const activePortFile = join(chromeProfileDir, "DevToolsActivePort");
  while (Date.now() - startupStartedAt < chromeStartupTimeout) {
    if (spawnError) {
      throw await startupFailure(`Chrome failed to launch: ${spawnError.message}`);
    }
    if (existsSync(activePortFile)) {
      let port;
      let browserPath;
      try {
        lastActivePortContents = readFileSync(activePortFile, "utf8").trim();
        [port, browserPath] = lastActivePortContents.split(/\r?\n/);
      } catch (error) {
        lastConnectionError = `Could not read DevToolsActivePort: ${error.message}`;
      }
      if (/^\d+$/.test(port || "") && browserPath?.startsWith("/")) {
        try {
          const connection = await CdpConnection.connect(
            `ws://127.0.0.1:${port}${browserPath}`
          );
          return { connection, processHandle, stderr: readChromeStderr };
        } catch (error) {
          lastConnectionError = error.message;
          // Chrome can publish the port just before the socket accepts clients.
        }
      }
    }
    if (!childIsRunning(processHandle)) {
      throw await startupFailure("Chrome exited before startup.");
    }
    await delay(50);
  }
  throw await startupFailure(
    `Chrome did not expose a debugging port within ${chromeStartupTimeout} ms.`
  );
};

const shutdownChrome = async ({ connection, processHandle }) => {
  if (childIsRunning(processHandle)) {
    try {
      await Promise.race([
        connection.send("Browser.close").catch(() => undefined),
        delay(1500),
      ]);
      await waitForChildExit(processHandle, 3000);
    } catch (error) {
      console.warn(`Warning: Chrome rejected graceful shutdown: ${error.message}`);
    }
  }

  try {
    await connection.close();
  } catch (error) {
    console.warn(`Warning: could not close Chrome DevTools connection: ${error.message}`);
  }
  await stopChildProcess(processHandle);
};

class BrowserPage {
  constructor(connection, targetId, sessionId, url, viewport) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.url = url;
    this.viewport = viewport;
  }

  static async create(
    connection,
    url,
    viewport = { width: 1280, height: 720 }
  ) {
    const { targetId } = await connection.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await connection.send("Target.attachToTarget", {
      flatten: true,
      targetId,
    });
    const page = new BrowserPage(connection, targetId, sessionId, url, viewport);
    await connection.send("Page.enable", {}, sessionId);
    await connection.send("Runtime.enable", {}, sessionId);
    await connection.send("Log.enable", {}, sessionId);
    await connection.send(
      "Emulation.setDeviceMetricsOverride",
      { ...viewport, deviceScaleFactor: 1, mobile: false },
      sessionId
    );
    await connection.send("Page.navigate", { url }, sessionId);
    await page.waitForReady();
    return page;
  }

  async evaluate(expression) {
    const response = await this.connection.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      this.sessionId
    );
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          "Browser evaluation failed"
      );
    }
    return response.result?.value;
  }

  async waitForReady() {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const ready = await this.evaluate(`(() => ({
        documentReady: document.readyState === "complete",
        revealReady: Boolean(window.Reveal && window.Reveal.isReady && window.Reveal.isReady()),
        decorated: document.querySelector(".reveal")?.dataset.beamerDecorated === "true",
        mathReady: !document.querySelector(".math") || Boolean(document.querySelector(".math .katex"))
      }))()`);
      if (
        ready.documentReady &&
        ready.revealReady &&
        ready.decorated &&
        ready.mathReady
      ) {
        await this.evaluate(`(async () => {
          if (document.fonts?.ready) await document.fonts.ready;
          await new Promise((resolve) => setTimeout(resolve, 140));
          return true;
        })()`);
        return;
      }
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${this.url}`);
  }

  async screenshot(name) {
    const { data } = await this.connection.send(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true, captureBeyondViewport: false },
      this.sessionId
    );
    const bytes = Buffer.from(data, "base64");
    assert(bytes.length > 10_000, `${name} screenshot is unexpectedly small`);
    assert.equal(
      bytes.readUInt32BE(16),
      this.viewport.width,
      `${name} screenshot width`
    );
    assert.equal(
      bytes.readUInt32BE(20),
      this.viewport.height,
      `${name} screenshot height`
    );
    const actualPath = join(artifactsDir, `${name}.png`);
    const baselinePath = join(baselinesDir, `${name}.png`);
    writeFileSync(actualPath, bytes);

    if (updateVisualBaselines) {
      mkdirSync(baselinesDir, { recursive: true });
      writeFileSync(baselinePath, bytes);
      return;
    }

    if (skipVisualRegression) {
      return;
    }

    assert(
      existsSync(baselinePath),
      `Missing visual baseline for ${name}; run npm run test:update-visuals`
    );
    const actual = PNG.sync.read(bytes);
    const expected = PNG.sync.read(readFileSync(baselinePath));
    assert.equal(actual.width, expected.width, `${name} baseline width`);
    assert.equal(actual.height, expected.height, `${name} baseline height`);

    const difference = new PNG({ width: actual.width, height: actual.height });
    const changedPixels = pixelmatch(
      expected.data,
      actual.data,
      difference.data,
      actual.width,
      actual.height,
      { includeAA: false, threshold: 0.2 }
    );
    const differenceRatio = changedPixels / (actual.width * actual.height);
    if (differenceRatio > maximumVisualDifference) {
      writeFileSync(
        join(artifactsDir, `${name}-diff.png`),
        PNG.sync.write(difference)
      );
    }
    assert(
      differenceRatio <= maximumVisualDifference,
      `${name} differs from its visual baseline by ${(
        differenceRatio * 100
      ).toFixed(3)}%`
    );
  }

  async pressKey(key, code, windowsVirtualKeyCode) {
    const event = { key, code, windowsVirtualKeyCode };
    await this.connection.send(
      "Input.dispatchKeyEvent",
      { ...event, type: "rawKeyDown" },
      this.sessionId
    );
    await this.connection.send(
      "Input.dispatchKeyEvent",
      { ...event, type: "keyUp" },
      this.sessionId
    );
    await delay(40);
  }

  async emulateMedia(media) {
    await this.connection.send(
      "Emulation.setEmulatedMedia",
      { media },
      this.sessionId
    );
  }

  async printPdf(name) {
    const { data } = await this.connection.send(
      "Page.printToPDF",
      { printBackground: true, preferCSSPageSize: true },
      this.sessionId
    );
    const bytes = Buffer.from(data, "base64");
    assert(bytes.subarray(0, 4).equals(Buffer.from("%PDF")), "PDF signature");
    assert(bytes.length > 20_000, "PDF output is unexpectedly small");
    writeFileSync(join(artifactsDir, `${name}.pdf`), bytes);
  }

  async close() {
    await this.connection.send("Target.closeTarget", { targetId: this.targetId });
  }
}

const assertNoBrowserErrors = (connection) => {
  const errors = connection.events
    .filter((event) => {
      if (event.method === "Runtime.exceptionThrown") return true;
      if (event.method === "Log.entryAdded") {
        return event.params.entry.level === "error";
      }
      if (event.method === "Runtime.consoleAPICalled") {
        return event.params.type === "error" || event.params.type === "assert";
      }
      return false;
    })
    .map((event) => JSON.stringify(event.params));
  assert.deepEqual(errors, [], `Browser errors:\n${errors.join("\n")}`);
};

const visibleInkMeasurementSource = `
  const measureVisibleInk = (element, text, pseudo = null) => {
    const style = getComputedStyle(element, pseudo);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = [
      style.fontStyle,
      style.fontWeight,
      style.fontSize,
      style.fontFamily
    ].join(" ");

    const metrics = context.measureText(text);
    const actualAscent = metrics.actualBoundingBoxAscent;
    const actualDescent = metrics.actualBoundingBoxDescent;
    const fontAscent = Number.isFinite(metrics.fontBoundingBoxAscent)
      ? metrics.fontBoundingBoxAscent
      : actualAscent;
    const fontDescent = Number.isFinite(metrics.fontBoundingBoxDescent)
      ? metrics.fontBoundingBoxDescent
      : actualDescent;
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);
    const borderTop = parseFloat(style.borderTopWidth);
    const borderBottom = parseFloat(style.borderBottomWidth);
    const declaredHeight = parseFloat(style.height);
    const boxHeight = pseudo && Number.isFinite(declaredHeight)
      ? style.boxSizing === "border-box"
        ? declaredHeight
        : borderTop + paddingTop + declaredHeight + paddingBottom + borderBottom
      : borderTop + paddingTop + lineHeight + paddingBottom + borderBottom;
    const lineTop = borderTop + paddingTop +
      (boxHeight - borderTop - borderBottom - paddingTop - paddingBottom - lineHeight) / 2;
    const textNode = element.querySelector(
      ":scope > .beamer-inline-label-text"
    );
    const textShift = textNode
      ? parseFloat(getComputedStyle(textNode).top) || 0
      : 0;
    const baseline =
      lineTop + (lineHeight - fontAscent - fontDescent) / 2 + fontAscent;
    const inkTop = baseline - actualAscent;
    const inkBottom = baseline + actualDescent;

    return {
      centerDelta: (inkTop + inkBottom) / 2 - boxHeight / 2 + textShift,
      topSpace: inkTop + textShift,
      bottomSpace: boxHeight - inkBottom - textShift,
      paddingTop,
      paddingBottom,
      display: style.display,
      verticalAlign: style.verticalAlign,
      textAligned: Boolean(textNode && element.dataset.beamerInlineAligned === "true")
    };
  };
`;

const printLayoutMeasurementSource = `(() => {
  const directContent = (slide) =>
    Array.from(slide.children).find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.matches("h2, .beamer-headline, .beamer-footline, .aside-footnotes")) {
        return false;
      }
      return getComputedStyle(node).display !== "none";
    });

  return Array.from(document.querySelectorAll(".beamer-leaf-slide")).map((slide) => {
    const slideRect = slide.getBoundingClientRect();
    const heading = slide.querySelector(":scope > h2");
    const content = heading ? directContent(slide) : null;
    const headline = slide.querySelector(":scope > .beamer-headline");
    const footer = slide.querySelector(":scope > .beamer-footline");
    const headingRect = heading?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const headlineRect = headline?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    const isSpecialSlide =
      slide.id === "title-slide" || slide.classList.contains("beamer-section-slide");
    const specialContentRects = isSpecialSlide
      ? Array.from(slide.children)
          .filter(
            (node) =>
              node instanceof HTMLElement &&
              !node.matches(
                ".beamer-headline, .beamer-footline, .aside-footnotes, aside.notes"
              ) &&
              getComputedStyle(node).display !== "none"
          )
          .map((node) => node.getBoundingClientRect())
      : [];
    const specialContentCenter = specialContentRects.length
      ? (Math.min(...specialContentRects.map((rect) => rect.top)) +
          Math.max(...specialContentRects.map((rect) => rect.bottom))) /
        2
      : null;
    const availableCenter = isSpecialSlide
      ? ((headlineRect?.bottom ?? slideRect.top) +
          (footerRect?.top ?? slideRect.bottom)) /
        2
      : null;
    return {
      id: slide.id,
      frameContentBelowTitle:
        !headingRect || !contentRect || contentRect.top >= headingRect.bottom - 0.5,
      headlineContained:
        !headlineRect ||
        (headlineRect.top >= slideRect.top - 0.5 &&
          headlineRect.bottom <= slideRect.bottom + 0.5),
      footerContained:
        !footerRect ||
        (footerRect.top >= slideRect.top - 0.5 &&
          footerRect.bottom <= slideRect.bottom + 0.5),
      specialSlideCentered:
        !isSpecialSlide ||
        (getComputedStyle(slide).display === "flex" &&
          specialContentCenter !== null &&
          Math.abs(specialContentCenter - availableCenter) < 12)
    };
  });
})()`;

const assertPrintLayout = async (page) => {
  const printLayout = await page.evaluate(printLayoutMeasurementSource);
  assert.deepEqual(
    printLayout.filter((slide) => !slide.frameContentBelowTitle),
    [],
    JSON.stringify(printLayout)
  );
  assert.deepEqual(
    printLayout.filter(
      (slide) =>
        !slide.headlineContained ||
        !slide.footerContained ||
        !slide.specialSlideCentered
    ),
    [],
    JSON.stringify(printLayout)
  );
};

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
      blockNormalized: Boolean(slide.querySelector(".beamer-block[data-title='定义']")),
      blockTitleInk: measureVisibleInk(block, "定义", "::before")
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
  assert.equal(state.blockNormalized, true);
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
    const emailLink = email.querySelector("a");
    const orcid = document.querySelector("#title-slide .quarto-title-author-orcid");
    const icon = orcid.querySelector("svg");
    const nameRect = name.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      emailDisplay: getComputedStyle(email).display,
      emailHref: emailLink.getAttribute("href"),
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
      display: getComputedStyle(slide).display,
      verticalCenterDelta: contentCenter - availableCenter,
      slideStartsAtViewportTop: Math.abs(slideRect.top) <= 1,
      footerVisible:
        footerRect.top >= -1 && footerRect.bottom <= window.innerHeight + 1
    };
  })()`);
  assert.equal(sectionState.display, "flex");
  assert(Math.abs(sectionState.verticalCenterDelta) < 12, JSON.stringify(sectionState));
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
  assert.equal(formatsState.headerColor, "rgb(51, 51, 179)");
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
    return {
      start: values("#ordered-start"),
      nested: values("#ordered-nested"),
      explicitValue: values("#ordered-value"),
      reversed: values("#ordered-reversed")
    };
  })()`);
  assert.deepEqual(orderedState.start, ["3", "4"]);
  assert.deepEqual(orderedState.nested, ["12"]);
  assert.deepEqual(orderedState.explicitValue, ["7", "8"]);
  assert.deepEqual(orderedState.reversed, ["3", "2"]);
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
  assert.equal(titleState.boxBackground, "rgb(255, 255, 255)");
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
    const availableCenter = (headlineRect.bottom + footerRect.top) / 2;
    return {
      display: getComputedStyle(slide).display,
      verticalCenterDelta: contentCenter - availableCenter,
      contained:
        headlineRect.top >= slideRect.top - 1 &&
        footerRect.bottom <= slideRect.bottom + 1
    };
  })()`);
  assert.equal(sectionState.display, "flex");
  assert(Math.abs(sectionState.verticalCenterDelta) < 12, JSON.stringify(sectionState));
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
  assert.equal(formatsState.headerColor, "rgb(163, 0, 0)");
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

let server;
let chrome;
try {
  resetDirectory(outputDir);
  resetDirectory(artifactsDir);
  run("node", ["--check", "_extensions/beamerslides/beamer.js"]);
  for (const fixture of ["madrid", "cambridgeus", "options", "offline"]) {
    renderFixture(fixture);
  }
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
  await testFourThreeViewport(chrome.connection, local.origin);
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
