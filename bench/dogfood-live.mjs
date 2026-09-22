// Dogfood smartpaste against LIVE application pages, not fixtures.
//
//   node bench/dogfood-live.mjs [--login] <url> [url...]
//
// --login opens a visible Chrome on a profile kept in bench/.dogfood-profile
// and, when a page bounces to a sign-in, waits (up to 5 min) for you to sign
// in there. The profile is kept, so you sign in once per site.
//
// Injects the test stub (canned Jev answers, fake profile) and the real
// content.js into the page exactly as the extension would, waits for the
// Autofill pill, clicks it, then reports what was collected, what was
// filled, and what was left alone. No API key needed: the stub plays Jev,
// so this exercises the DOM half (detection, gate, fill) -- the half that
// breaks on real ATSes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromePath } from "../extension/test/browser.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EXT = join(here, "..", "extension");
const stub = readFileSync(join(EXT, "test", "fixtures", "stub.js"), "utf8");
const content = readFileSync(join(EXT, "content.js"), "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.console = [];
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
        this.console.push(`[${message.params.type}] ${text}`);
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.console.push(`[exception] ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`);
      }
      const waiter = message.id && this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const login = process.argv.includes("--login");
const urls = process.argv.slice(2).filter((a) => a !== "--login");
if (!urls.length) {
  console.error("usage: node bench/dogfood-live.mjs <url> [url...]");
  process.exit(1);
}

const profile = login ? join(here, ".dogfood-profile") : mkdtempSync(join(tmpdir(), "smartpaste-dogfood-"));
if (login) { mkdirSync(profile, { recursive: true }); rmSync(join(profile, "DevToolsActivePort"), { force: true }); }
const chrome = spawn(chromePath, [
  ...(login ? [] : ["--headless=new"]), "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--window-size=1280,3000",
  "--disable-blink-features=AutomationControlled", "about:blank",
], { stdio: "ignore" });
const portFile = join(profile, "DevToolsActivePort");
for (let i = 0; i < 150 && !exists(portFile); i++) await sleep(100);
function exists(p) { try { readFileSync(p); return true; } catch { return false; } }
const port = readFileSync(portFile, "utf8").split("\n")[0];

for (const url of urls) {
  console.log(`\n=== ${url} ===`);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  const session = new Session(socket);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await session.send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: content });
  try {
    await session.send("Page.navigate", { url });
  } catch (e) {
    console.log(`navigation failed: ${e.message}`);
    continue;
  }

  const evalp = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (!exceptionDetails && result.value) return result.value;
      await sleep(300);
    }
    return null;
  };
  const evalOnce = async (expression) => {
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) return { error: exceptionDetails.exception?.description || exceptionDetails.text };
    return result.value;
  };

  // Give the SPA time to render, then look for the pill.
  await sleep(4000);
  if (login && /log-?in|sign-?in/i.test(await evalOnce(`location.href + document.title`))) {
    console.log("Sign in in the Chrome window; waiting up to 5 minutes...");
    for (let i = 0; i < 300 && /log-?in|sign-?in/i.test(await evalOnce(`location.href + document.title`)); i++) await sleep(1000);
    if (!(await evalOnce(`location.href`)).startsWith(url)) await session.send("Page.navigate", { url });
    await sleep(6000);
  }
  const pill = await evalp(`!!document.querySelector('.smartpaste-button') && document.querySelector('.smartpaste-button').textContent`, 20000);
  if (!pill) {
    console.log("NO PILL APPEARED (gate rejected the page, or no fields found)");
    const fields = await evalOnce(`window.__smartpasteTest ? (window.__smartpasteTest.collectFields() || []).map(f => f.label || f.element?.outerHTML?.slice(0,80)) : null`);
    console.log("collectFields() saw:", JSON.stringify(fields, null, 2));
    console.log("location:", await evalOnce(`location.href`), "| title:", await evalOnce(`document.title`));
  } else {
    console.log(`PILL: ${pill}`);
    const collected = await evalOnce(`
      window.__smartpasteTest.collectFields().map(f => ({
        label: (f.label || "").slice(0, 90), kind: f.widget || f.element?.type || f.element?.tagName,
        options: f.options ? f.options.length : null,
      }))`);
    console.log("COLLECTED FIELDS:");
    for (const f of collected) console.log(`  - ${f.kind}${f.options ? ` (${f.options} options)` : ""}: ${f.label}`);

    // Click the pill and let fillPage() run to completion.
    await evalOnce(`document.querySelector('.smartpaste-button').click()`);
    let last = "";
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const state = JSON.stringify(await evalOnce(`
        [...document.querySelectorAll('input, textarea, select, button[aria-pressed], [role="radio"]')].map(el => el.value || el.getAttribute('aria-pressed') || '').join('|')`));
      if (state === last && i > 5) break;
      last = state;
    }
    const after = await evalOnce(`
      [...document.querySelectorAll('input, textarea, select, button[aria-pressed], [role="radio"]')]
        .filter(el => el.type !== 'hidden' && (/^(checkbox|radio)$/.test(el.type) ? el.checked : el.getAttribute('aria-pressed') ? el.getAttribute('aria-pressed') === 'true' : el.value))
        .map(el => ({ tag: el.tagName, type: el.type, label: el.labels?.[0]?.textContent?.trim()?.slice(0,60) || el.closest('div')?.parentElement?.querySelector('label')?.textContent?.trim()?.slice(0,60) || el.name || el.id || el.getAttribute('aria-label') || '', value: (/^(checkbox|radio)$/.test(el.type) ? 'checked ' + (el.value || '') : el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent || el.value : el.value || el.getAttribute('aria-pressed')).slice(0,60) }))`);
    console.log("FILLED AFTER CLICK:");
    const seen = new Set();
    for (const f of after) {
      const key = JSON.stringify(f);
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  = [${f.tag}${f.type ? ":" + f.type : ""}] ${f.label} => ${JSON.stringify(f.value)}`);
    }
    const jev = await evalOnce(`window.__messages.filter(m => m.type === 'answer-fields').map(m => m.fields.map(f => f.label))`);
    console.log("SENT TO JEV:", JSON.stringify(jev, null, 2));
    const note = await evalOnce(`document.querySelector('.smartpaste-note')?.textContent || null`);
    if (note) console.log(`NOTE: ${note}`);
  }
  const errors = session.console.filter((c) => /\[exception\]|\[error\]/.test(c) && !/favicon/.test(c));
  if (errors.length) {
    console.log("CONSOLE ERRORS:");
    for (const e of errors.slice(0, 10)) console.log(`  ${e.slice(0, 300)}`);
  }
  socket.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
}

chrome.kill();
await sleep(200);
if (!login) rmSync(profile, { recursive: true, force: true });
