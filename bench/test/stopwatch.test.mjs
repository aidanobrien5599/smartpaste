// The stopwatch extension's content script, run in headless Chrome against
// fixtures. Run: node --test bench/test/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch, chromePath } from "../../extension/test/browser.mjs";

const skip = chromePath ? false : "no Chrome found (set CHROME)";
const source = readFileSync(new URL("../stopwatch-extension/stopwatch.js", import.meta.url), "utf8");
// chrome.storage for the script, and a short quiet period so tests are quick.
const shim = `window.__stopwatchQuietMs = 1200;
  window.__store = { tool: "test-tool", runs: [] };
  window.chrome = window.chrome || {};
  const original = chrome.storage && chrome.storage.local; // smartpaste's stub, if loaded
  chrome.storage = { local: {
    get(defaults, cb) {
      if (typeof cb !== "function") return original.get(defaults);
      const out = { ...defaults }; for (const k of Object.keys(defaults)) if (k in __store) out[k] = __store[k]; cb(out); },
    set(values) { Object.assign(__store, values); },
  } };`;
const script = `(() => { ${source} })();`;

let browser;
before(async () => { if (!skip) browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

const runs = "window.__store.runs.length";

test("a tool that fills by itself: timed from the form appearing, page prefill ignored", { skip }, async () => {
  const page = await browser.open("autofiller.html", { scripts: [shim, script], smartpaste: false });
  try {
    await page.waitFor(`${runs} >= 1`, 10000);
    const [run] = await page.eval("window.__store.runs");
    assert.equal(run.tool, "test-tool");
    assert.equal(run.startedBy, "form appearing");
    assert.equal(run.fields, 3, "the account's own prefilled email is not the tool's");
    // From navigation: the page's own load, then its 600ms to show the form.
    assert.ok(run.formShownMs >= 600 && run.formShownMs < 2500, `form shown ${run.formShownMs}ms`);
    assert.ok(Math.abs(run.fillMs - 800) < 200, `fill ${run.fillMs}ms, want ~800`);
    assert.equal(run.trigger, "navigate");
    assert.equal(await page.eval("document.querySelector('.autofill-stopwatch')?.textContent.startsWith('⏱ test-tool: fill')"), true);
  } finally { await page.close(); }
});

test("a single-page app's next step is its own run, timed from the click that moved on", { skip }, async () => {
  const page = await browser.open("autofiller.html", { scripts: [shim, script], smartpaste: false });
  try {
    await page.waitFor(`${runs} >= 1`, 10000);
    await page.eval(`(() => { const b = document.getElementById("next");
      b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); b.click(); })()`);
    await page.waitFor(`${runs} >= 2`, 10000);
    const [step2] = await page.eval("window.__store.runs");
    assert.equal(step2.trigger, "step change");
    assert.equal(step2.fields, 2);
    assert.ok(Math.abs(step2.formShownMs - 400) < 250, `step form shown ${step2.formShownMs}ms after the click, want ~400`);
    assert.ok(Math.abs(step2.fillMs - 400) < 200, `step fill ${step2.fillMs}ms, want ~400`);
  } finally { await page.close(); }
});

test("a tool you click (smartpaste): timed from the click", { skip }, async () => {
  const page = await browser.open("workday.html", { scripts: [shim, script] });
  try {
    await page.waitFor("document.querySelector('.smartpaste-button')");
    await new Promise((r) => setTimeout(r, 1500)); // a human takes a moment to click
    await page.eval(`(() => { const b = document.querySelector(".smartpaste-button");
      b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); b.click(); })()`);
    await page.waitFor(`${runs} >= 1`, 30000);
    const [run] = await page.eval("window.__store.runs");
    assert.equal(run.startedBy, "your click");
    assert.ok(run.fields >= 20, `${run.fields} fields`);
    assert.ok(run.fillMs < 5000, `fill ${run.fillMs}ms`);
    assert.ok(run.firstFillMs < 500, `first fill ${run.firstFillMs}ms after the click`);
  } finally { await page.close(); }
});
