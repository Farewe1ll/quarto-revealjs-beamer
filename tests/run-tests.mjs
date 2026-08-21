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
const requestedPageReadyTimeout = Number.parseInt(
  process.env.BEAMERSLIDES_PAGE_READY_TIMEOUT_MS || "",
  10
);
const pageReadyTimeout =
  Number.isFinite(requestedPageReadyTimeout) && requestedPageReadyTimeout > 0
    ? requestedPageReadyTimeout
    : 20_000;
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

const renderFixture = (name, options = {}) => {
  const source = options.source || name;
  const fixture = join(testsDir, "fixtures", `${source}.qmd`);
  const temporaryInput = join(rootDir, `.beamerslides-test-${name}.qmd`);
  temporaryInputs.push(temporaryInput);
  copyFileSync(fixture, temporaryInput);
  const metadataArgs = Object.entries(options.metadata || {}).flatMap(
    ([key, value]) => ["-M", `${key}:${value}`]
  );
  try {
    run(quartoCommand, [
      "render",
      basename(temporaryInput),
      "--output",
      `${name}.html`,
      "--output-dir",
      "tests/_output",
      "--no-clean",
      ...metadataArgs,
    ]);
  } finally {
    if (existsSync(temporaryInput)) {
      unlinkSync(temporaryInput);
    }
  }
};

const renderTemplate = (source) => {
  const output = `${source}-smoke.html`;
  run(quartoCommand, [
    "render",
    `${source}.qmd`,
    "--output",
    output,
    "--output-dir",
    "tests/_output",
    "--no-clean",
  ]);
  assert(
    existsSync(join(outputDir, output)),
    `The template ${source}.qmd did not produce an HTML presentation.`
  );
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
    const startedAt = Date.now();
    let ready = null;
    while (Date.now() - startedAt < pageReadyTimeout) {
      ready = await this.evaluate(`(() => ({
        documentReady: document.readyState === "complete",
        revealReady: Boolean(window.Reveal && window.Reveal.isReady && window.Reveal.isReady()),
        decorated: document.querySelector(".reveal")?.dataset.beamerDecorated === "true",
        mathReady: !document.querySelector(".math") || Boolean(document.querySelector(".math .katex")),
        fontsReady: !document.fonts || document.fonts.status === "loaded"
      }))()`);
      if (
        ready.documentReady &&
        ready.revealReady &&
        ready.decorated &&
        ready.mathReady &&
        ready.fontsReady
      ) {
        await delay(140);
        return;
      }
      await delay(50);
    }
    throw new Error(
      `Timed out waiting for ${this.url} after ${pageReadyTimeout} ms; ` +
        `last state: ${JSON.stringify(ready)}`
    );
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

const showSlide = (page, id) =>
  page.evaluate(`(async () => {
    const slide = document.getElementById(${JSON.stringify(id)});
    const indices = window.Reveal.getIndices(slide);
    window.Reveal.slide(indices.h, indices.v);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
    return true;
  })()`);

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
    return {
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
