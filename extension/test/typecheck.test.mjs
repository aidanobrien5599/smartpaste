// tsc is the only thing that reads the types; this makes it part of npm test.
// It also holds the escape hatch to account: an `any` must say why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// typescript@7's package.json "exports" does not expose "./bin/tsc" as a
// resolvable subpath (it throws ERR_PACKAGE_PATH_NOT_EXPORTED), even though
// "./package.json" is exported and the "bin" field points at the same file.
// Resolve the package root that way, then join to its bin script.
const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin", "tsc");
const tsFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);

test("tsc --noEmit is clean", () => {
  const run = spawnSync(process.execPath, [tsc, "-p", root], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("every `any` says why on the same line", () => {
  const bare = [];
  for (const file of tsFiles(join(root, "extension", "src"))) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/(?::|\bas|<)\s*any\b/.test(line) && !line.includes("//")) bare.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, []);
});

test("lib runs as TypeScript under plain node", async () => {
  const { buildOptions } = await import("../src/lib/profile.ts");
  assert.equal(typeof buildOptions, "function");
});
