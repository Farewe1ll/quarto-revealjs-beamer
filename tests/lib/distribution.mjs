import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quartoCommand, rootDir, runCapture, withRenderRetries } from "./harness.mjs";

// Package the pending delivery, including uncommitted sources but no ignored outputs.
// Git's NUL-separated inventory keeps whitespace in resource names intact.
export const withDistribution = async (check) => {
  const scratch = mkdtempSync(join(tmpdir(), "beamerslides-distribution-"));
  try {
    const inventory = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      cwd: rootDir, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(inventory.status, 0, inventory.stderr);
    const files = inventory.stdout.split("\0").filter(Boolean).filter(file => existsSync(join(rootDir, file)));
    assert(files.every(file => !file.includes("\n")), "zip file inventory cannot contain newlines");
    const archive = join(scratch, "release.zip");
    const packed = spawnSync("zip", ["-q", archive, "-@"], {
      cwd: rootDir, input: files.join("\n") + "\n", encoding: "utf8", timeout: 30_000,
    });
    assert.equal(packed.status, 0, packed.stderr || String(packed.error));
    const template = join(scratch, "template");
    const added = join(scratch, "added");
    const isolated = join(scratch, "isolated");
    for (const directory of [template, added, isolated]) mkdirSync(directory);
    runCapture(quartoCommand, ["use", "template", archive, "--no-prompt"], { cwd: template });
    const roots = readdirSync(template).filter(name => !name.startsWith("."));
    assert.deepEqual(roots.sort(), ["_extensions", "assets", "examples", "references.bib", "template-cambridgeus.qmd", "template.qmd"].sort(),
      "template copies only presentation files");
    for (const name of ["template", "template-cambridgeus"]) {
      withRenderRetries(() => runCapture(quartoCommand, ["render", `${name}.qmd`, "--quiet"], { cwd: template }));
    }
    runCapture(quartoCommand, ["add", archive, "--no-prompt"], { cwd: added });
    assert.deepEqual(readdirSync(added).filter(name => !name.startsWith(".")), ["_extensions"],
      "quarto add installs the extension without copying a template");
    assert(existsSync(join(added, "_extensions/beamerslides/_extension.yml")));
    copyFileSync(join(rootDir, "assets/normal-density.svg"), join(added, "plot.svg"));
    const deck = (variant, embed) => `---
title: "Installed extension"
beamer-variant: ${variant}
format:
  beamerslides-revealjs:
    embed-resources: ${embed}
    self-contained-math: ${embed}
---

## Installed mathematics {#installed-math}

$x^2$ is rendered using the installed extension.

![Bundled example](plot.svg){width=35%}
`;
    for (const [name, variant, embed] of [["madrid", "madrid", false], ["cambridgeus", "cambridgeus", false], ["embedded", "madrid", true]]) {
      writeFileSync(join(added, `${name}.qmd`), deck(variant, embed));
      withRenderRetries(() => runCapture(quartoCommand, ["render", `${name}.qmd`, "--quiet"], { cwd: added }));
    }
    copyFileSync(join(added, "embedded.html"), join(isolated, "slides.html"));
    assert.deepEqual(readdirSync(isolated), ["slides.html"]);
    await check({ scratch, template, added, isolated });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
