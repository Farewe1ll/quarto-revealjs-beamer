// Browser/render harness shared by the regression suites.
// This module owns Chrome (CDP), the fixture renderer, the static server,
// screenshot/baseline comparison, and the shared measurement snippets.

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
  readdirSync,
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

const testsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(testsDir, "..");
const outputDir = join(testsDir, "_output");
const artifactsDir = join(testsDir, "_artifacts");
const baselinesDir = join(testsDir, "baselines");
const chromeTemporaryDir = mkdtempSync(join(tmpdir(), "beamerslides-chrome-"));
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
    : 45_000;
const requestedChromeLaunchAttempts = Number.parseInt(
  process.env.BEAMERSLIDES_CHROME_LAUNCH_ATTEMPTS || "",
  10
);
const chromeLaunchAttempts =
  Number.isFinite(requestedChromeLaunchAttempts) &&
  requestedChromeLaunchAttempts > 0
    ? requestedChromeLaunchAttempts
    : 3;
const pdfAttempts = 3;
const evaluateAttempts = 4;
const requestedPageReadyAttempts = Number.parseInt(
  process.env.BEAMERSLIDES_PAGE_READY_ATTEMPTS || "",
  10
);
const pageReadyAttempts =
  Number.isFinite(requestedPageReadyAttempts) && requestedPageReadyAttempts > 0
    ? requestedPageReadyAttempts
    : 3;
const requestedPageReadyTimeout = Number.parseInt(
  process.env.BEAMERSLIDES_PAGE_READY_TIMEOUT_MS || "",
  10
);
const pageReadyTimeout =
  Number.isFinite(requestedPageReadyTimeout) && requestedPageReadyTimeout > 0
    ? requestedPageReadyTimeout
    : 20_000;
// A CDP reply can simply never arrive: a renderer wedged mid-`Runtime.evaluate`,
// or a `Page.printToPDF` that never finishes. Without a bound the awaiting
// promise stays pending forever, so the run hangs with no witness and the next
// attempt has to delete a stale run lock by hand. Override with
// BEAMERSLIDES_CDP_TIMEOUT_MS.
//
// The default matches `BEAMERSLIDES_COMMAND_TIMEOUT_MS` below rather than being
// tighter: the hazard is the same one, and the commands that go through here
// (`printToPDF`, `captureScreenshot`) are the slowest ones in the suite, run on
// the same shared CI runners. A bound that is too generous only makes a real hang
// take longer to report; a bound that is too tight turns a slow runner into a
// failure, which is the worse of the two.
const requestedCdpTimeout = Number.parseInt(
  process.env.BEAMERSLIDES_CDP_TIMEOUT_MS || "",
  10
);
const cdpTimeout =
  Number.isFinite(requestedCdpTimeout) && requestedCdpTimeout > 0
    ? requestedCdpTimeout
    : 300_000;
const debugCleanup = (...values) => {
  if (process.env.BEAMERSLIDES_DEBUG_CLEANUP === "1") {
    console.error("[cleanup]", ...values);
  }
};

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

// Chrome forks a tree of helper processes (renderers, GPU, network). Killing
// only the parent -- or letting the parent die from SIGTERM -- leaves that tree
// reparented to init and running until the machine is rebooted. Measured after
// a batch of interrupted runs: five orphaned headless browsers holding ~2.9 GB.
//
// Two guards, because no graceful path can cover a signal: the child is spawned
// `detached`, which makes it a process-group leader, and this handler kills that
// whole group. Signal handlers must be synchronous -- an `async` teardown never
// gets to run before the process dies.
//
// The group kill runs on the ordinary teardown path too, not only here -- see
// `signalChild` below, which `stopChildProcess` uses. The machinery was built for
// the signal path and the ordinary path kept signalling the parent pid alone, so
// the group the spawn site creates was never used for the case it documents.
// Measured, that gap did NOT leak on its own: with the browser process wedged with
// SIGSTOP and then killed parent-only, all ten Chrome processes still exited by
// themselves. This is consistency with the documented intent, not a demonstrated
// leak fix.
const childProcessGroups = new Set();

const terminateChildProcessGroups = () => {
  for (const pid of childProcessGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      // The group is already gone.
    }
  }
  childProcessGroups.clear();
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    terminateChildProcessGroups();
    // The graceful teardown is async and so never runs on a signal; remove the
    // profile directory synchronously or it is left behind for good.
    try {
      rmSync(chromeTemporaryDir, { recursive: true, force: true });
    } catch (error) {
      // Best effort.
    }
    process.exit(128);
  });
}

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

// Signal the child's whole process group when it is a group leader. The child is
// spawned `detached` (see `childProcessGroups`), so a negative pid addresses the
// group Chrome created for itself and its helpers, where `processHandle.kill`
// addresses the parent alone. Anything not in the registry -- a child that starts
// before it is registered, or a future spawn that is not detached -- falls back to
// the single-process signal rather than failing.
//
// The pid is also dropped from the registry once the group has been signalled, so
// a later signal handler cannot `SIGKILL` a recycled pid's group.
const signalChild = (processHandle, signal) => {
  const pid = processHandle.pid;
  if (typeof pid === "number" && childProcessGroups.has(pid)) {
    try {
      process.kill(-pid, signal);
      if (signal === "SIGKILL") {
        childProcessGroups.delete(pid);
      }
      return;
    } catch (error) {
      if (error.code === "ESRCH") {
        // The whole group is already gone.
        childProcessGroups.delete(pid);
        return;
      }
      // Anything else (EPERM, EINVAL) falls through to the single-process kill,
      // which reports its own failure to the caller.
    }
  }
  processHandle.kill(signal);
};

const stopChildProcess = async (processHandle) => {
  if (!processHandle) return;

  if (childIsRunning(processHandle)) {
    try {
      signalChild(processHandle, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") {
        console.warn(`Warning: could not stop Chrome gracefully: ${error.message}`);
      }
    }
    await waitForChildExit(processHandle, 3000);
  }
  if (childIsRunning(processHandle)) {
    try {
      signalChild(processHandle, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") {
        console.warn(`Warning: could not force Chrome to stop: ${error.message}`);
      }
    }
    await waitForChildExit(processHandle, 5000);
  }
  // Nothing left to signal, and holding the pid would let a later signal handler
  // aim a group kill at whatever process inherits that pid.
  if (typeof processHandle.pid === "number") {
    childProcessGroups.delete(processHandle.pid);
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

// A render that never returns would hang the whole suite with no diagnostics,
// so external commands are bounded. Override with BEAMERSLIDES_COMMAND_TIMEOUT_MS.
const commandTimeout = Number.parseInt(
  process.env.BEAMERSLIDES_COMMAND_TIMEOUT_MS || "",
  10
);
const resolvedCommandTimeout =
  Number.isFinite(commandTimeout) && commandTimeout > 0 ? commandTimeout : 300_000;

const runCapture = (command, args) => {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
    timeout: resolvedCommandTimeout,
    killSignal: "SIGKILL",
  });
  if (process.env.BEAMERSLIDES_DEBUG === "1") {
    console.log(
      `[harness] ${command} ${args.slice(0, 2).join(" ")} ` +
        `${Date.now() - startedAt}ms status=${result.status} signal=${result.signal}`
    );
  }
  if (result.status !== 0) {
    const error = new Error(
      [
        `${command} ${args.join(" ")} failed` +
          (result.signal === "SIGKILL"
            ? ` (timed out after ${resolvedCommandTimeout}ms)`
            : ""),
        result.stdout,
        result.stderr,
        result.error ? String(result.error) : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    // `spawnSync` reports "the process never started" here rather than in `status`
    // (a missing or non-executable binary), and that failure is permanent. Carrying
    // the code out lets the retry wrapper tell it apart from the intermittent crash
    // the retries exist for; without it a missing Quarto burnt two extra attempts and
    // two blocking sleeps before reporting the same error, under a warning that said
    // the Deno runtime had crashed.
    error.code = result.error ? result.error.code : undefined;
    throw error;
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
};

const run = (command, args) => runCapture(command, args).stdout;


// Quarto's Deno runtime occasionally dies with SIGSEGV part-way through a
// render. It is not caused by the document -- the same input renders fine on
// the next attempt, and the crash happens before any of this project's code
// runs -- but it fails the suite hard, so renders are retried. A render that
// fails for a real reason still fails, just after the retries.
const renderAttempts = 3;

// The retry wraps the THUNK, not the argument list: `renderFixture` deletes its
// temporary input in a `finally`, so retrying a bare command list would re-run
// Quarto against a file that no longer exists. That mistake made the suite worse
// rather than better -- the retries burned all three attempts on "No valid input
// files passed to render" and turned an intermittent crash into a guaranteed
// failure.
const withRenderRetries = (operation) => {
  let lastError = null;
  for (let attempt = 1; attempt <= renderAttempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      // A command that never started will not start on the next attempt either, and
      // its failure has nothing to do with the crash this retry exists for.
      const permanent = error.code === "ENOENT" || error.code === "EACCES";
      if (attempt === renderAttempts || permanent) {
        break;
      }
      console.warn(
        `[harness] quarto render failed (attempt ${attempt}/${renderAttempts}); ` +
          "retrying -- Quarto's Deno runtime crashes intermittently"
      );
      // Synchronous sleep: the callers of this helper are synchronous.
      const until = Date.now() + 400 * attempt;
      while (Date.now() < until) {
        // deliberately blocking
      }
    }
  }
  throw lastError;
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
    // Quarto writes extension warnings to stderr; callers that assert on them
    // receive the captured text.
    return withRenderRetries(() =>
      runCapture(quartoCommand, [
      "render",
      basename(temporaryInput),
      "--output",
      `${name}.html`,
      "--output-dir",
      "tests/_output",
      "--no-clean",
      ...metadataArgs,
      ])
    ).stderr;
  } finally {
    if (existsSync(temporaryInput)) {
      unlinkSync(temporaryInput);
    }
  }
};

const renderTemplate = (source) => {
  const output = `${source}-smoke.html`;
  withRenderRetries(() =>
    runCapture(quartoCommand, [
      "render",
      `${source}.qmd`,
      "--output",
      output,
      "--output-dir",
      "tests/_output",
      "--no-clean",
    ])
  );
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

    // A malformed path (a stray `%`) makes `decodeURIComponent` throw, and that
    // exception would leave the request hanging and take the run with it. Bad input
    // from a probe is a 400, not a crash.
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestUrl.pathname);
    } catch (error) {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
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
    const stream = createReadStream(file);
    // The file can vanish between the `existsSync` above and the open -- a second
    // run resetting `tests/_output` is the realistic way -- and a stream with no
    // `error` listener raises an unhandled 'error' event, which kills the run.
    stream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
    stream.pipe(response);
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
      // A frame that is not JSON -- a protocol ping, or a truncated message -- must
      // not throw out of this listener: an exception here is uncaught, which takes
      // the whole run down with a stack that names nothing useful.
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (error) {
        return;
      }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
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
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
    // A socket error while the connection is in use must fail the commands that are
    // waiting on it. Without a listener here they had nothing to settle them except
    // the per-command watchdog, so a browser that died mid-run turned into one
    // `cdpTimeout` wait (300s by default) per pending command instead of an immediate,
    // attributable failure. Node's WebSocket is an EventTarget, so an unhandled
    // `error` event does not throw -- it just goes unnoticed, which is worse.
    webSocket.addEventListener("error", () => {
      const error = new Error("Chrome DevTools connection errored.");
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
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
      // The watchdog is deliberately not `unref`ed: if a command really is stuck
      // it is the only thing that will still report the failure, and the timer is
      // cleared the moment the command settles.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(
          new Error(
            `Chrome DevTools command ${method} did not answer within ` +
              `${cdpTimeout} ms (set BEAMERSLIDES_CDP_TIMEOUT_MS to change this).`
          )
        );
      }, cdpTimeout);
      this.pending.set(id, {
        resolve: resolveCommand,
        reject: rejectCommand,
        timer,
      });
      this.webSocket.send(JSON.stringify(message));
    });
  }

  close() {
    if (this.webSocket.readyState >= WebSocket.CLOSING) {
      return Promise.resolve();
    }

    return new Promise((resolveClose) => {
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        // Without this the 1s fallback timer outlived the connection and kept the
        // event loop alive for up to a second after the last slide was measured.
        clearTimeout(timer);
        resolveClose();
      };
      this.webSocket.addEventListener("close", finish, { once: true });
      this.webSocket.addEventListener("error", finish, { once: true });
      this.webSocket.close();
      timer = setTimeout(finish, 1000);
    });
  }
}

const readChromeStderr = (path) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

// Diagnostics must never replace the real failure, so every probe is total.
const safeListDirectory = (path) => {
  try {
    return readdirSync(path).slice(0, 20);
  } catch {
    return null;
  }
};

const preserveChromeStartupDiagnostics = (details) => {
  try {
    mkdirSync(artifactsDir, { recursive: true });
    const suffix = details.attempt > 1 ? `-attempt-${details.attempt}` : "";
    if (details.stderrPath && existsSync(details.stderrPath)) {
      copyFileSync(
        details.stderrPath,
        join(artifactsDir, `chrome-stderr${suffix}.log`)
      );
    }
    writeFileSync(
      join(artifactsDir, `chrome-startup${suffix}.json`),
      `${JSON.stringify(details, null, 2)}\n`
    );
  } catch (error) {
    console.warn(`Warning: could not preserve Chrome diagnostics: ${error.message}`);
  }
};

// Headless Chrome is driven straight through CDP, so the flags also cover the
// shared-runner hazards that can stall a launch for the whole timeout: tiny
// /dev/shm, background networking and component updates, and a desktop keyring
// that is not there. Startup logging goes to the captured stderr so a stalled
// launch is diagnosable from the uploaded artifacts.
const chromeFlags = (profileDir) => [
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
  `--user-data-dir=${profileDir}`,
  "--window-size=1280,720",
  "--force-device-scale-factor=1",
  "--disable-background-networking",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-hang-monitor",
  "--disable-sync",
  "--metrics-recording-only",
  "--mute-audio",
  "--password-store=basic",
  "--use-mock-keychain",
  "--enable-logging=stderr",
];

const launchChromeAttempt = async ({
  attempt,
  chromePath,
  profileDir,
  stderrPath,
}) => {
  const startupStartedAt = Date.now();
  const stderrFd = openSync(stderrPath, "w");
  let processHandle;
  try {
    processHandle = spawn(chromePath, chromeFlags(profileDir), {
      stdio: ["ignore", "ignore", stderrFd],
      // Own process group, so the whole Chrome tree can be signalled at once.
      detached: true,
    });
    if (typeof processHandle.pid === "number") {
      childProcessGroups.add(processHandle.pid);
    }
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
    const stderr = readChromeStderr(stderrPath);
    // Chromium sends logs to stderr with --enable-logging=stderr, but some
    // builds write them to chrome_debug.log inside the profile instead.
    const debugLogPath = join(profileDir, "chrome_debug.log");
    const debugLogTail = existsSync(debugLogPath)
      ? readChromeStderr(debugLogPath)
          .split("\n")
          .filter((line) => line.trim())
          .slice(-20)
          .join("\n")
      : "";
    const details = {
      summary,
      attempt,
      chromePath,
      elapsedMilliseconds: Date.now() - startupStartedAt,
      timeoutMilliseconds: chromeStartupTimeout,
      exitCode: observedExitCode,
      signalCode: observedSignalCode,
      spawnError: spawnError?.message || null,
      activePortFileContents: lastActivePortContents || null,
      lastConnectionError: lastConnectionError || null,
      // A profile that Chrome never populated points at the launch itself
      // rather than at the DevTools endpoint.
      profileEntries: safeListDirectory(profileDir),
      debugLogTail: debugLogTail || null,
      stderrPath,
    };
    preserveChromeStartupDiagnostics(details);
    return new Error(
      [
        summary,
        `Chrome executable: ${chromePath}`,
        `Startup wait: ${details.elapsedMilliseconds} ms`,
        `Launch attempt: ${attempt}/${chromeLaunchAttempts}`,
        lastConnectionError && `Last connection error: ${lastConnectionError}`,
        "Chrome stderr:",
        stderr.trim() || "(no stderr output)",
        debugLogTail && `chrome_debug.log (last lines):\n${debugLogTail}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  };

  const activePortFile = join(profileDir, "DevToolsActivePort");
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
          return {
            connection,
            processHandle,
            stderr: () => readChromeStderr(stderrPath),
          };
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

// A shared runner can occasionally stall a single Chrome start (load spikes,
// stale first-run state). Each attempt gets a fresh profile and its own stderr
// log, and the previous process is stopped before the next one starts.
const launchChrome = async () => {
  const chromePath = findChrome();
  let lastError;
  for (let attempt = 1; attempt <= chromeLaunchAttempts; attempt += 1) {
    const attemptDir = join(chromeTemporaryDir, `attempt-${attempt}`);
    const profileDir = join(attemptDir, "profile");
    const stderrPath = join(attemptDir, "chrome-stderr.log");
    mkdirSync(profileDir, { recursive: true });
    try {
      const launched = await launchChromeAttempt({
        attempt,
        chromePath,
        profileDir,
        stderrPath,
      });
      if (attempt > 1) {
        console.log(`Chrome started on launch attempt ${attempt}.`);
      }
      return launched;
    } catch (error) {
      lastError = error;
      if (attempt < chromeLaunchAttempts) {
        console.warn(
          `Warning: Chrome launch attempt ${attempt}/${chromeLaunchAttempts} failed; ` +
            "retrying with a fresh profile."
        );
        // Let the runner reclaim the stalled process before starting again.
        await delay(1_000);
      }
    }
  }
  throw lastError;
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
    viewport = { width: 1280, height: 720 },
    options = {}
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
    if (options.preloadScript) {
      await connection.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: options.preloadScript },
        sessionId
      );
    }
    await connection.send("Page.navigate", { url }, sessionId);
    await page.waitForReady();
    return page;
  }

  async evaluate(expression) {
    // A probe that dereferences an element the page has not created yet throws a
    // null-property TypeError. That is a race, not a finding: the page is laid
    // out a moment later and the identical probe succeeds. Only those specific
    // messages are retried, so a probe that genuinely observes a missing element
    // still fails -- through its own assertion, on its own text.
    const transientNullProperty =
      /Cannot read properties of (?:null|undefined) \(reading '[^']+'\)/;
    for (let attempt = 1; attempt <= evaluateAttempts; attempt += 1) {
      const response = await this.connection.send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        this.sessionId
      );
      if (!response.exceptionDetails) {
        return response.result?.value;
      }
      const message =
        response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "Browser evaluation failed";
      if (
        attempt === evaluateAttempts ||
        !transientNullProperty.test(message)
      ) {
        throw new Error(
          attempt > 1 ? `${message} (after ${attempt} attempts)` : message
        );
      }
      console.warn(
        `[harness] ${this.url}: probe hit a not-yet-present element ` +
          `(attempt ${attempt}/${evaluateAttempts}); retrying`
      );
      await delay(250 * attempt);
    }
  }

  async waitForReady() {
    // Reveal occasionally never publishes itself: the document finishes and the
    // fonts settle, but `window.Reveal` stays absent and the slide is unusable.
    // The same page loads correctly on the next attempt, so a reload is the fix.
    // Retrying here only rescues a page that never became ready -- a page that
    // loads and then breaks an assertion still fails on its own merits.
    for (let attempt = 1; attempt <= pageReadyAttempts; attempt += 1) {
      try {
        await this.waitForReadyOnce();
        return;
      } catch (error) {
        if (attempt === pageReadyAttempts) {
          throw error;
        }
        console.warn(
          `[harness] ${this.url} was not ready (attempt ${attempt}/${pageReadyAttempts}); ` +
            "reloading"
        );
        await this.reload();
      }
    }
  }

  async reload() {
    await this.connection.send(
      "Page.navigate",
      { url: this.url },
      this.sessionId
    );
  }

  async waitForReadyOnce() {
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
    // Page.printToPDF intermittently comes back with a near-empty document --
    // the same page produces ~100x the bytes on the next call. Retrying only
    // rescues output that failed the sanity checks below; anything else is
    // written out unchanged.
    let bytes = null;
    for (let attempt = 1; attempt <= pdfAttempts; attempt += 1) {
      const { data } = await this.connection.send(
        "Page.printToPDF",
        { printBackground: true, preferCSSPageSize: true },
        this.sessionId
      );
      const candidate = Buffer.from(data, "base64");
      const isPdf = candidate.subarray(0, 4).equals(Buffer.from("%PDF"));
      if (isPdf && candidate.length > 20_000) {
        bytes = candidate;
        break;
      }
      if (attempt === pdfAttempts) {
        assert(isPdf, "PDF signature");
        assert(
          candidate.length > 20_000,
          `PDF output is unexpectedly small (${candidate.length} bytes)`
        );
      }
      console.warn(
        `[harness] ${name}: printToPDF returned ${candidate.length} bytes ` +
          `(attempt ${attempt}/${pdfAttempts}); retrying`
      );
      await delay(300 * attempt);
    }
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

  return Array.from(document.querySelectorAll("section.beamer-leaf-slide")).map((slide) => {
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
    // A \section page renders its title through the frametitle template: a band
    // pinned directly under the headline, spanning \textwidth. It is not
    // vertically centred, so that is what print layout must preserve.
    const sectionBand = slide.classList.contains("beamer-section-slide")
      ? slide.querySelector(":scope > h1")
      : null;
    const sectionBandRect = sectionBand?.getBoundingClientRect();
    const sectionBandTop = headlineRect?.bottom ?? slideRect.top;
    const frameHeading =
      !sectionBand &&
      document.querySelector(
        ".slides section.beamer-frame-slide > h2:first-of-type"
      );
    const sectionExpectedWidth = frameHeading
      ? frameHeading.getBoundingClientRect().width
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
      sectionBandPinned:
        !sectionBandRect ||
        (Math.abs(sectionBandRect.top - sectionBandTop) < 1 &&
          (sectionExpectedWidth === null ||
            Math.abs(sectionBandRect.width - sectionExpectedWidth) < 1)),
      specialSlideCentered:
        !isSpecialSlide ||
        Boolean(sectionBand) ||
        (getComputedStyle(slide).display === "flex" &&
          specialContentCenter !== null &&
          Math.abs(specialContentCenter - availableCenter) < 12)
    };
  });
})()`;

// Leaf sections, derived from Reveal's own DOM shape rather than from the theme's
// class: a section that holds no nested sections is a slide the theme is expected
// to decorate. Counting this independently is what makes the canary in
// `assertPrintLayout` able to fail.
//
// The filter mirrors `leafSlides()` in `beamer.js`, deliberately. If that rule ever
// changes, this one has to change with it -- otherwise the canary starts reporting
// a mismatch between two definitions of "leaf slide" instead of a missing class.
const leafSectionCountSource = `(() => {
  return Array.from(document.querySelectorAll(".reveal .slides section")).filter(
    (slide) => {
      const hasNested = Array.from(slide.children).some(
        (child) => child.tagName === "SECTION"
      );
      const hasContent = Array.from(slide.children).some(
        (child) => !child.matches(".beamer-headline, .beamer-footline")
      );
      return !hasNested && (slide.id !== "" || hasContent);
    }
  ).length;
})()`;

const assertPrintLayout = async (page) => {
  const printLayout = await page.evaluate(printLayoutMeasurementSource);
  // Coverage canary. Both assertions below are "this filter found nothing", which
  // an empty array satisfies -- so a deck whose slides never received
  // `beamer-leaf-slide` would pass every print-layout check by measuring nothing.
  //
  // Reveal's own `getTotalSlides()` is NOT the number to compare against: the theme
  // marks reference pages `data-visibility="uncounted"`, and Reveal leaves
  // uncounted slides out of its model (measured on the Madrid fixture: 10 leaf
  // sections, 9 reported, the difference being `#references`). The leaf sections
  // are counted from the DOM instead.
  const leafSections = await page.evaluate(leafSectionCountSource);
  assert(
    printLayout.length > 0,
    `the print-layout probe measured no slides at all: ${JSON.stringify(printLayout)}`
  );
  assert.equal(
    printLayout.length,
    leafSections,
    `the print-layout probe measured ${printLayout.length} slides but the deck has ` +
      `${leafSections} leaf sections; a slide is missing its beamer-leaf-slide class`
  );
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
        !slide.specialSlideCentered ||
        !slide.sectionBandPinned
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


export {
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
};
