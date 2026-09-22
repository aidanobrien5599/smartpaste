// Ask real Jev a page's questions exactly as the extension does.
//
// The stub in test/fixtures can say what code does with an answer, never what
// Jev would answer. This loads background.js itself under a fake `chrome`,
// feeds it a stored profile, and sends the same "answer-fields" message the
// content script sends, printing each field's result and the raw top picks.
//
//   node bench/probe-answers.mjs storage.json questions.json [--say-yes=0|1]
//
// storage.json holds { apiKey, profile, extraText, settings } as
// chrome.storage.local does; questions.json is [[label, [options...]], ...]
// (an empty options list asks the field as a text box; a third element
// true makes it a group of checkboxes). The key is never
// printed.
import { readFileSync } from "node:fs";

const [storePath, questionsPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const sayYes = process.argv.find((a) => a.startsWith("--say-yes="));
const store = JSON.parse(readFileSync(storePath, "utf8"));
if (sayYes) store.settings = { ...(store.settings || {}), say_yes: sayYes.endsWith("=1") };
const Q = JSON.parse(readFileSync(questionsPath, "utf8"));

let listener;
globalThis.chrome = {
  storage: { local: { get: async (keys) => Object.fromEntries(keys.map((k) => [k, store[k]])) } },
  runtime: { onMessage: { addListener: (f) => { listener = f; } }, onInstalled: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  contextMenus: { create() {}, onClicked: { addListener() {} } },
  tabs: { query: async () => [] },
};

// Keep the raw answers so a miss shows what Jev leaned toward.
const raw = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await realFetch(...args);
  const copy = response.clone();
  try { Object.assign(raw, (await copy.json()).answers || {}); } catch {}
  return response;
};

await import("../extension/background.js");
const fields = Q.map(([label, options, multi]) =>
  (options && options.length ? { label, options, multi: Boolean(multi) } : { label }));
const reply = await new Promise((resolve) =>
  listener({ type: "answer-fields", fields, page: { url: "", title: "" } }, {}, resolve));
if (!reply.ok) throw new Error(reply.error);

const top = (a) => a ? Object.entries(a.probabilities || {}).sort((p, q) => q[1] - p[1]).slice(0, 3)
  .map(([k, p]) => `${k}=${p.toFixed(2)}`).join(" ") + ` (conf ${Number(a.confidence).toFixed(2)})` : "-";
reply.results.forEach((r, i) => {
  console.log(`${Q[i][0].slice(0, 90)}\n  => ${r.status} ${JSON.stringify(r.value)} ${Number(r.confidence).toFixed(2)}` +
    `\n     select: ${top(raw[`f${i}`])}\n     entry:  ${top(raw[`f${i}_entry`])}`);
});
