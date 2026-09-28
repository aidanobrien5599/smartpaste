/**
 * Builds the extension: extension/src/ -> extension/dist/.
 *
 *   node extension/build.mjs            once
 *   node extension/build.mjs --watch    on every save
 *
 * The manifest stays in extension/ and names dist/ files, so "Load unpacked
 * -> extension/" keeps the same folder, and with it the same extension id
 * and the same stored profile. Chrome never reloads an unpacked extension
 * by itself: build, then press Reload on chrome://extensions.
 */
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SRC = join(here, "src");
export const DIST = join(here, "dist");

// A content script cannot import, so it is one IIFE. The service worker is
// declared "type": "module"; options.html loads its script as a module.
const entries = (src) => [
  { in: join(src, "content", "index.ts"), out: "content", format: "iife" },
  { in: join(src, "background.js"), out: "background", format: "esm" },
  { in: join(src, "options.js"), out: "options", format: "esm" },
  { in: join(src, "popup.js"), out: "popup", format: "iife" },
];
// Every bundle reads the repo's tsconfig by path, not by searching upward
// from its source: the mutation check bundles a copy of src/ under /tmp,
// where no tsconfig would be found and the mutant would build differently
// (sloppy, not "use strict") from what ships. Strict is intended: the source
// is ES modules, which are strict anyway.
const TSCONFIG = join(here, "..", "tsconfig.json");
const common = { bundle: true, target: "chrome120", logLevel: "warning", legalComments: "none", tsconfig: TSCONFIG };
const options = (entry, dist, extra = {}) => ({
  ...common, entryPoints: [entry.in], outfile: join(dist, `${entry.out}.js`), format: entry.format, ...extra,
});

export async function build({ src = SRC, dist = DIST } = {}) {
  await Promise.all(entries(src).map((entry) => esbuild.build(options(entry, dist))));
}

/** The content script alone, as text: what the tests and the mutation check inject. */
export async function bundleContent(src = SRC) {
  const result = await esbuild.build({
    ...common, entryPoints: [join(src, "content", "index.ts")], format: "iife", write: false,
  });
  return result.outputFiles[0].text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--watch")) {
    for (const entry of entries(SRC)) {
      const context = await esbuild.context(options(entry, DIST, { sourcemap: "inline" }));
      await context.watch();
    }
    console.log("watching extension/src/ -- press Reload on chrome://extensions after a change");
  } else {
    await build();
  }
}
