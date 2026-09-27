// The shape of src/: what the split promised, made checkable.
//   dom <- state/ui-display <- discover <- answer <- widgets <- set-value
//     <- fill <- session/keys <- index
// An import may only point down (or across, within a layer), never in a cycle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
// Files allowed past MAX_LINES. Empty since the split finished; a file added
// here needs a reason written beside it.
const EXEMPT = new Set();
const MAX_LINES = 400;

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);
const rel = (path) => relative(SRC, path).split("\\").join("/");
const files = walk(SRC);
const content = files.filter((f) => rel(f).startsWith("content/"));

export function layer(path) {
  const m = rel(path).replace(/^content\//, "").replace(/\.ts$/, "");
  if (!rel(path).startsWith("content/")) return -1; // shared/, lib/: usable anywhere
  if (m.startsWith("dom/")) return 0;
  if (m === "state" || m === "ui/marks" || m === "ui/note") return 1;
  if (m.startsWith("discover/")) return 2;
  if (m.startsWith("answer/")) return 3;
  if (m === "widgets/set-value") return 4.5;
  if (m.startsWith("widgets/")) return 4;
  if (m.startsWith("fill/")) return 5;
  if (m === "session" || m === "ui/keys") return 6;
  if (m === "index") return 7;
  return NaN;
}

const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?["'](\.{1,2}\/[^"']+)["']/g)]
    .map((m) => resolve(dirname(file), m[1]));

test("every content module sits in a known layer", () => {
  assert.deepEqual(content.filter((f) => Number.isNaN(layer(f))).map(rel), []);
});

test("imports resolve and only point down the layers", () => {
  const bad = [];
  for (const file of content) {
    for (const target of importsOf(file)) {
      if (!existsSync(target)) bad.push(`${rel(file)} -> missing ${rel(target)}`);
      else if (layer(target) > layer(file)) bad.push(`${rel(file)} -> ${rel(target)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("no import cycles", () => {
  const graph = new Map(files.map((f) => [f, importsOf(f).filter((t) => existsSync(t))]));
  const done = new Set();
  const cycles = [];
  const visit = (node, path) => {
    if (path.includes(node)) { cycles.push([...path.slice(path.indexOf(node)), node].map(rel).join(" -> ")); return; }
    if (done.has(node)) return;
    for (const next of graph.get(node) || []) visit(next, [...path, node]);
    done.add(node);
  };
  for (const file of files) visit(file, []);
  assert.deepEqual(cycles, []);
});

test("every source file opens with a header comment", () => {
  const bare = files.filter((f) => !/^(?:\/\/ @ts-nocheck\s*)?\/\*\*/.test(readFileSync(f, "utf8").trimStart()));
  assert.deepEqual(bare.map(rel), []);
});

test(`no source file over ${MAX_LINES} lines`, () => {
  // Controller ruling R1: the cap applies only under content/ and shared/,
  // not lib/, because the spec converts lib one-to-one and lib/draft.ts is
  // already ~500 lines.
  const long = files.filter((f) => /^(?:content|shared)\//.test(rel(f)) && !EXEMPT.has(rel(f)))
    .map((f) => [rel(f), readFileSync(f, "utf8").split("\n").length])
    .filter(([, n]) => n > MAX_LINES);
  assert.deepEqual(long, []);
});
