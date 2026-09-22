// Dogfood the REAL extension -- real Jev, my real profile -- on a live page.
//
//   node bench/dogfood-real.mjs <url>
//
// dogfood-live.mjs plays Jev with a stub, so it only tests the DOM half.
// This loads extension/ unpacked into Chrome for Testing (branded Chrome
// ignores --load-extension) on a kept profile, bench/.real-profile, whose
// extension storage is a copy of my real Chrome's:
//
//   cp -R ~/Library/Application\ Support/Google/Chrome/Default/Local\ Extension\ Settings/<id> \
//     bench/.real-profile/Default/Local\ Extension\ Settings/
//
// The id is the same in both, since an unpacked extension's id is a hash of
// its path. Sign in to the site once in the window; the profile keeps it.
// --settings '{"acknowledge":true}' merges into the extension's settings in
// that profile first (it never touches real Chrome's).
//
// Clicks Autofill, then prints smartpaste's own timeline and every field's
// value as the page shows it.
import { readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const EXT = join(here, "..", "extension");
const profile = join(here, ".real-profile");
const pw = join(homedir(), "Library/Caches/ms-playwright");
const build = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const binary = join(pw, build, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const url = process.argv[2];
const flag = process.argv.indexOf("--settings");
const settings = flag > 0 ? JSON.parse(process.argv[flag + 1]) : null;
// Chrome's id for an unpacked extension: its path's sha256, hex digits as a-p.
const extensionId = [...createHash("sha256").update(EXT).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
if (!url || !existsSync(binary)) {
  console.error("usage: node bench/dogfood-real.mjs <url>   (needs Playwright's Chromium)");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(join(profile, "DevToolsActivePort"), { force: true });
const chrome = spawn(binary, [
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
  "--no-default-browser-check", "--window-size=1280,1400",
  `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "about:blank",
], { stdio: "ignore" });
let port;
for (let i = 0; i < 150 && !port; i++) {
  try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await sleep(100); }
}

if (settings) {
  await sleep(1500);
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extensionId}/options.html`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  await sleep(1000);
  const done = new Promise((r) => (ws.onmessage = ({ data }) => r(JSON.parse(data))));
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { awaitPromise: true, returnByValue: true, expression:
    `chrome.storage.local.get("settings").then(({ settings = {} }) => chrome.storage.local.set({ settings: { ...settings, ...${JSON.stringify(settings)} } }))` +
    `.then(() => chrome.storage.local.get("settings")).then((x) => JSON.stringify(x.settings))` } }));
  console.log(`SETTINGS: ${(await done).result?.result?.value}`);
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`);
}
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (socket.onopen = r));
let nextId = 0;
const pending = new Map();
const logs = [];
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === "Runtime.consoleAPICalled") {
    const text = m.params.args.map((a) => a.value ?? a.preview?.properties?.map((p) => `${p.name}=${p.value}`).join(" ") ?? a.description ?? "").join(" ");
    if (/smartpaste|jev|SPTRACE/i.test(text)) logs.push(`[${m.params.type}] ${text}`);
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); socket.send(JSON.stringify({ id, method, params })); });
// A page that is busy (or showing a dialog) can hold an evaluate forever.
const evaluate = async (expression) => {
  const r = await Promise.race([
    send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
    sleep(15000).then(() => ({ exceptionDetails: { exception: { description: "evaluate timed out" } } })),
  ]);
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Page.navigate", { url });
await sleep(6000);
if (/log-?in|sign-?in/i.test(await evaluate("location.href + document.title"))) {
  console.log("Sign in in the Chromium window; waiting up to 5 minutes...");
  for (let i = 0; i < 300 && /log-?in|sign-?in/i.test(await evaluate("location.href + document.title")); i++) await sleep(1000);
  if (!(await evaluate("location.href")).startsWith(url)) await send("Page.navigate", { url });
  await sleep(8000);
}

let pill = null;
for (let i = 0; i < 60 && !pill; i++) {
  pill = await evaluate("document.querySelector('.smartpaste-button')?.textContent || null");
  if (!pill) await sleep(500);
}
console.log(`PILL: ${pill}`);
if (pill) {
  await evaluate("document.querySelector('.smartpaste-button').click()");
  let last = "";
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const note = await evaluate("document.querySelector('.smartpaste-note')?.textContent || ''");
    if (note && note !== last && typeof note === "string") console.log(`  note: ${note}`);
    if (/filled \d+/.test(note) && note === last && i > 8) break;
    // The note fades after a few seconds; once a fill has reported, that is the end.
    if (!note && /filled \d+/.test(last) && i > 8) break;
    if (note) last = note;
  }
  console.log(`NOTE: ${last}`);
}
await sleep(3000);
console.log("SMARTPASTE LOG:");
for (const line of logs) console.log(`  ${line.slice(0, 3000)}`);

// Every labelled field's value as the page shows it: typed text, chosen
// menu items / tags, ticked boxes.
const fields = await evaluate(`(() => {
  const out = [];
  const items = [...document.querySelectorAll('[id^="formily-item-"], .gh-apply-form__field, [class*="field-entry"], [class*="formField"], fieldset, [data-testid^="career-form/inputs/"]:not([data-testid*="/inputs/phone"] *)')]
    .filter((i) => !i.querySelector('[id^="formily-item-"]'));
  for (const item of items) {
    const label = (item.querySelector('[role="radiogroup"]') ? item.querySelector('p') : item.querySelector('label, legend, [class*="item-label"], p'))?.textContent.replace(/[\\u200b]/g, "").trim().replace(/\\s+/g, " ").slice(0, 60) || "";
    const typed = [...item.querySelectorAll('input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea')].map((x) => x.value).filter(Boolean);
    const selects = [...item.querySelectorAll('select')].map((s) => s.selectedOptions[0]?.textContent.trim()).filter((t) => t && !/^select/i.test(t));
    const shown = [...item.querySelectorAll('[class*="selector__selectItem"], [class*="selector__tag"] [class*="tag__content"]')].map((x) => x.textContent.trim());
    const ticked = [...item.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked')]
      .map((x) => (x.closest('label')?.textContent || 'ticked').replace(/[\\u200b]/g, '').trim().slice(0, 50));
    const values = [...typed, ...selects, ...shown, ...ticked].join(" | ");
    if (label) out.push(\`\${values ? "  =" : "  ✗"} \${label}\${values ? " => " + values : ""}\`);
  }
  return out;
})()`);
console.log("FIELDS:");
for (const line of fields || []) console.log(line);

chrome.kill();
process.exit(0);
