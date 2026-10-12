import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// This child process tests a controlled retry budget, independently of the
// browser suite's user-configurable budget.
process.env.BEAMERSLIDES_PAGE_READY_ATTEMPTS = "3";
const { artifactsDir, BrowserPage, runCapture, withRenderRetries } = await import("./harness.mjs");

let calls = 0;
assert.throws(() => withRenderRetries(() => {
  calls += 1;
  return runCapture(process.execPath, ["-e", "console.error('validation failed'); process.exit(2)"]);
}), error => error.status === 2 && error.signal === null && !error.timedOut && /validation failed/.test(error.stderr));
assert.equal(calls, 1, "ordinary validation failures must not retry");

assert.throws(() => runCapture("/beamerslides-missing-executable", []),
  error => error.code === "ENOENT" && error.status === null && !error.timedOut);
assert.throws(() => runCapture(process.execPath, ["-e", "setTimeout(()=>{},5000)"], { timeout: 80 }),
  error => error.timedOut && error.code === "ETIMEDOUT");

const crash = message => Object.assign(new Error(message), {
  signal: "SIGSEGV", status: null, stderr: message, timedOut: false, command: "controlled-test",
});
calls = 0;
const recordsBefore = new Set(existsSync(artifactsDir) ? readdirSync(artifactsDir) : []);
assert.equal(withRenderRetries(() => {
  calls += 1;
  if (calls === 1) throw crash("first native crash");
  return "recovered";
}), "recovered");
assert.equal(calls, 2);
const records = readdirSync(artifactsDir).filter(name =>
  name.startsWith("render-retry-") && !recordsBefore.has(name));
assert.equal(records.length, 1, "recovered retries retain evidence");
assert.equal(JSON.parse(readFileSync(join(artifactsDir, records[0]), "utf8"))[0].message,
  "first native crash");

calls = 0;
assert.throws(() => withRenderRetries(() => {
  calls += 1;
  throw crash(`crash ${calls}`);
}), error => error instanceof AggregateError && error.errors.length === 3 &&
  error.cause.message === "crash 1" && error.errors[2].message === "crash 3");
assert.equal(calls, 3, "crash retries are bounded");

calls = 0;
assert.throws(() => withRenderRetries(() => {
  calls += 1;
  if (calls === 1) throw crash("initial crash");
  throw Object.assign(new Error("later validation error"), { status: 2 });
}), error => error instanceof AggregateError && error.errors.length === 2 &&
  error.cause.message === "initial crash" && error.errors[1].status === 2);
assert.equal(calls, 2, "a permanent error stops after a crash");

let evaluations = 0;
const connection = {
  events: [],
  send: async () => {
    evaluations += 1;
    return { exceptionDetails: { exception: {
      description: "Cannot read properties of null (reading 'clientHeight')",
    } } };
  },
};
const page = new BrowserPage(connection, "target", "session", "test://failure", {});
await assert.rejects(() => page.evaluate("document.querySelector('#missing').clientHeight"), /Cannot read properties/);
assert.equal(evaluations, 1, "runtime exceptions are not readiness evidence");
let reloads = 0;
page.reload = async () => { reloads += 1; };
page.waitForReadyOnce = async () => { throw new Error("runtime failure"); };
await assert.rejects(() => page.waitForReady(), /runtime failure/);
assert.equal(reloads, 0, "runtime failures must not reload");
let readinessChecks = 0;
const readyRecordsBefore = new Set(readdirSync(artifactsDir));
page.waitForReadyOnce = async () => {
  if (++readinessChecks === 1) throw Object.assign(new Error("not yet ready"), { code: "PAGE_READY_TIMEOUT" });
};
await page.waitForReady();
assert.equal(reloads, 1, "only an explicit readiness timeout may reload");
const readyRecords = readdirSync(artifactsDir).filter(name =>
  name.startsWith("page-ready-retry-") && !readyRecordsBefore.has(name));
assert.equal(readyRecords.length, 1, "recovered readiness retries retain evidence");
assert.equal(JSON.parse(readFileSync(join(artifactsDir, readyRecords[0]), "utf8")).failures[0].message,
  "not yet ready");
readinessChecks = 0;
page.waitForReadyOnce = async () => {
  readinessChecks += 1;
  throw Object.assign(new Error(`readiness timeout ${readinessChecks}`), { code: "PAGE_READY_TIMEOUT" });
};
await assert.rejects(() => page.waitForReady(), error => error instanceof AggregateError &&
  error.errors.length === 3 && error.cause.message === "readiness timeout 1");
assert.equal(readinessChecks, 3, "readiness retries are bounded and retain the first failure");
readinessChecks = 0;
page.waitForReadyOnce = async () => {
  if (++readinessChecks === 1) throw Object.assign(new Error("first page timeout"), { code: "PAGE_READY_TIMEOUT" });
  throw new Error("runtime failed after reload");
};
await assert.rejects(() => page.waitForReady(), error => error instanceof AggregateError &&
  error.errors.length === 2 && error.cause.message === "first page timeout" &&
  error.errors[1].message === "runtime failed after reload");
page.waitForReadyOnce = async () => {
  throw Object.assign(new Error("timeout before failed navigation"), { code: "PAGE_READY_TIMEOUT" });
};
page.reload = async () => { throw new Error("navigation failed"); };
await assert.rejects(() => page.waitForReady(), error => error instanceof AggregateError &&
  error.errors.length === 2 && error.cause.message === "timeout before failed navigation" &&
  error.errors[1].message === "navigation failed");

const commands = [];
await assert.rejects(() => BrowserPage.create({
  events: [],
  send: async method => {
    commands.push(method);
    if (method === "Target.createTarget") return { targetId: "incomplete" };
    if (method === "Target.attachToTarget") throw new Error("attach failed");
    return {};
  },
}, "test://incomplete"), /attach failed/);
assert.equal(commands.at(-1), "Target.closeTarget", "failed creation closes the target");
console.log("Harness failure classification and evidence checks passed.");
