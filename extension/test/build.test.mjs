// The build: what Chrome loads is dist/, made from src/ by build.mjs.
// These pin the parts of that a mistake would break silently -- a service
// worker that cannot start, a PDF reader that cannot find pdf.js, a folder
// Chrome refuses to load, tests that run yesterday's bundle.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build, bundleContent, DIST } from "../build.mjs";
import { contentSource } from "./browser.mjs";

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(DIST, name), "utf8");
before(() => build());

test("the content script is one classic script, with no module syntax left", () => {
  const code = read("content.js");
  assert.doesNotThrow(() => new vm.Script(code));
  assert.doesNotMatch(code, /^\s*(?:import|export)\s/m);
});

test("the service worker imports nothing at run time", () => {
  const code = read("background.js");
  assert.doesNotMatch(code, /^\s*import\s/m);
  assert.doesNotMatch(code, /\bimport\s*\(/);
});

test("the options page loads pdf.js by extension URL, not a relative path", () => {
  const code = read("options.js");
  assert.match(code, /import\(chrome\.runtime\.getURL\("vendor\/pdf\.mjs"\)\)/);
  assert.doesNotMatch(code, /["']\.{1,2}\/vendor\//);
});

test("every file the manifest and its pages name exists", () => {
  const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
  const named = [
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...(c.css || [])]),
    manifest.background.service_worker,
    manifest.options_page,
    manifest.action.default_popup,
    ...manifest.web_accessible_resources.flatMap((w) => w.resources),
  ];
  for (const page of [manifest.options_page, manifest.action.default_popup]) {
    const html = readFileSync(join(EXT, page), "utf8");
    named.push(...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]));
  }
  for (const file of named) assert.ok(existsSync(join(EXT, file)), `${file} is named but missing`);
  assert.ok(manifest.content_scripts[0].js.includes("dist/content.js"));
  assert.equal(manifest.background.service_worker, "dist/background.js");
});

test("extension/ stays loadable unpacked: no node_modules, no names starting with _", () => {
  const bad = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_") || entry.name === "node_modules") bad.push(join(dir, entry.name));
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(EXT);
  assert.deepEqual(bad, []);
});

test("tests inject the current source, not whatever dist/ holds", { skip: process.env.SMARTPASTE_CONTENT && "mutant run" }, async () => {
  assert.equal(await contentSource(), await bundleContent());
});
