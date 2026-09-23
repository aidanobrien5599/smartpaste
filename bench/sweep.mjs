// Sweep the REAL extension -- real Jev, my real profile -- across many live
// application pages, and score what it filled.
//
//   node bench/sweep.mjs <urls.txt> [--parallel 3] [--only <regex>] [--label name]
//
// urls.txt: one URL per line; "#" starts a comment. Each URL runs in its own
// throwaway Chrome for Testing profile, a copy of bench/.sweep-template
// (my extension storage; see below), so runs never share cookies or state.
//
// It NEVER submits anything: every page gets a guard, installed before the
// page's own scripts, that cancels form submission and requestSubmit(), and
// the only thing clicked is smartpaste's own Autofill pill. Pages that want a
// login or a captcha are recorded as "gated" and skipped.
//
// Template: copy my real extension storage once (and again after editing the
// profile):
//   mkdir -p "bench/.sweep-template/Default/Local Extension Settings"
//   cp -R ~/Library/Application\ Support/Google/Chrome/Default/Local\ Extension\ Settings/ghncgfialljljkgmhngflhbbcelbnlll \
//     "bench/.sweep-template/Default/Local Extension Settings/"
//
// Writes bench/sweeps/<timestamp>-<label>/<n>-<host>.json per page plus
// summary.json, and prints a table.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const EXT = join(here, "..", "extension");
const TEMPLATE = join(here, ".sweep-template");
const pw = join(homedir(), "Library/Caches/ms-playwright");
const build = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const binary = join(pw, build, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const list = process.argv[2];
if (!list || !existsSync(list) || !existsSync(binary) || !existsSync(TEMPLATE)) {
  console.error("usage: node bench/sweep.mjs <urls.txt> [--parallel N] [--only regex] [--label name]\n" +
    "(needs Playwright's Chromium and bench/.sweep-template -- see the header)");
  process.exit(1);
}
const parallel = Number(arg("--parallel", 3));
const only = arg("--only") ? new RegExp(arg("--only"), "i") : null;
const label = arg("--label", "sweep");
const urls = readFileSync(list, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
  .filter((u) => !only || only.test(u));
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const outDir = join(here, "sweeps", `${stamp}-${label}`);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed before any page script, in every frame.
const GUARD = `(() => {
  const block = (why) => console.warn("SWEEP-GUARD blocked " + why);
  HTMLFormElement.prototype.submit = function () { block("form.submit()"); };
  HTMLFormElement.prototype.requestSubmit = function () { block("form.requestSubmit()"); };
  addEventListener("submit", (e) => { e.preventDefault(); e.stopImmediatePropagation(); block("a submit event"); }, true);
})();`;

// What the page shows, per visible control: its label, its value, whether
// it is required. Radios and checkboxes are one line per group.
const READOUT = `(() => {
  const clean = (t) => (t || "").replace(/[\\u200b]/g, "").replace(/\\s+/g, " ").trim();
  const deepAll = (sel, root = document, out = []) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out); return out; };
  const labelOf = (el) => { const root = el.getRootNode(); const host = root.host;
    return clean((el.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => root.getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || "").join(" ") ||
      (el.id && root.querySelector?.('label[for="' + CSS.escape(el.id) + '"]')?.textContent) || el.closest("label")?.textContent ||
      el.getAttribute("aria-label") || host?.getAttribute("label") || el.placeholder || el.name || "").slice(0, 100); };
  const required = (el) => el.required || el.getAttribute("aria-required") === "true" ||
    /\\*\\s*$/.test(labelOf(el)) || Boolean(el.closest("[class*=required i]"));
  const out = []; const groups = new Map();
  for (const el of deepAll("input, textarea, select")) {
    if (el.type === "hidden" || el.type === "submit" || el.type === "button") continue;
    const r = el.getBoundingClientRect();
    const hiddenChoice = (el.type === "radio" || el.type === "checkbox");
    if (!hiddenChoice && (!r.width || !r.height)) continue;
    if (el.closest(".smartpaste-button, .smartpaste-note")) continue;
    if (hiddenChoice && el.name) {
      const g = groups.get(el.type + el.name) || { el, kind: el.type, picked: [], n: 0 };
      g.n++; if (el.checked) g.picked.push(labelOf(el)); groups.set(el.type + el.name, g); continue;
    }
    // A React Select (Greenhouse) keeps its input empty and shows the choice
    // in a sibling: read what the control shows, not the typing box.
    const shell = el.closest('[class*="select__control"], [class*="select-shell"], [class*="Select-control"]');
    const shown = shell ? clean(shell.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value__label"], [class*="multiValue"]')?.textContent) : "";
    const value = shown ? shown : el.type === "file" ? (el.files?.length ? el.files[0].name : "")
      : el.type === "checkbox" || el.type === "radio" ? (el.checked ? "[ticked]" : "")
      : el.tagName === "SELECT" ? (el.value ? clean(el.selectedOptions[0]?.textContent) : "") : el.value;
    out.push({ kind: el.type === "file" ? "file" : el.tagName === "SELECT" ? "select" : el.getAttribute("role") === "combobox" ? "combobox" : el.type || el.tagName.toLowerCase(),
      label: labelOf(el), value: clean(value).slice(0, 100), required: required(el),
      marked: el.getAttribute("data-smartpaste") || null });
  }
  for (const g of groups.values()) {
    const box = g.el.closest("fieldset, [role=radiogroup], [role=group]");
    const q = clean(box?.querySelector("legend, label")?.textContent || box?.getAttribute("aria-label") || g.el.name).slice(0, 100);
    out.push({ kind: g.kind + "-group", label: q, value: g.picked.join(" | ").slice(0, 100), required: g.el.required, options: g.n });
  }
  // Toggle / pill buttons (Ashby, Oracle): a group is answered when one is pressed.
  for (const group of document.querySelectorAll('[role="radiogroup"]')) {
    const buttons = group.querySelectorAll('button[role="radio"], [role="radio"]:not(input)');
    if (!buttons.length) continue;
    const picked = [...buttons].filter((b) => b.getAttribute("aria-checked") === "true").map((b) => clean(b.textContent));
    out.push({ kind: "pills", label: clean(group.getAttribute("aria-label") || ""), value: picked.join(" | "), required: false, options: buttons.length });
  }
  return out;
})()`;

let template = null;
function freshProfile() {
  const dir = mkdtempSync(join(tmpdir(), "smartpaste-sweep-"));
  cpSync(TEMPLATE, dir, { recursive: true });
  return dir;
}

async function runOne(url, n) {
  const profile = freshProfile();
  const result = { n, url, host: (() => { try { return new URL(url).hostname; } catch { return "?"; } })(), status: "error" };
  const started = Date.now();
  const chrome = spawn(binary, [
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--window-size=1280,1400", `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`, "about:blank",
  ], { stdio: "ignore" });
  const cleanup = () => { try { chrome.kill(); } catch {} setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500); };
  try {
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await sleep(100); }
    }
    if (!port) throw new Error("Chrome did not start");
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
    let nextId = 0;
    const pending = new Map();
    const logs = [];
    socket.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.method === "Runtime.consoleAPICalled") {
        const text = m.params.args.map((a) => a.value ?? a.preview?.properties?.map((p) => `${p.name}=${p.value}`).join(" ") ?? a.description ?? "").join(" ");
        if (/smartpaste|SWEEP-GUARD/i.test(text)) logs.push(`[${m.params.type}] ${text}`.slice(0, 2000));
      }
      if (m.method === "Page.javascriptDialogOpening") {
        logs.push(`DIALOG (${m.params.type}): ${String(m.params.message).slice(0, 200)}`);
        socket.send(JSON.stringify({ id: ++nextId, method: "Page.handleJavaScriptDialog", params: { accept: false } }));
      }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => {
      const r = await Promise.race([send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
        sleep(15000).then(() => ({ exceptionDetails: { exception: { description: "evaluate timed out" } } }))]);
      return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result?.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: GUARD });
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await send("Page.navigate", { url });
    await sleep(7000);

    const where = await evaluate(`JSON.stringify({ href: location.href, title: document.title,
      captcha: Boolean(document.querySelector('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], #challenge-form')),
      inputs: document.querySelectorAll("input, textarea, select").length })`);
    const page = typeof where === "string" ? JSON.parse(where) : { href: url, title: "", captcha: false, inputs: 0 };
    Object.assign(result, { finalUrl: page.href, title: page.title });
    // Ashby and Lever load an invisible reCAPTCHA on every form; a captcha
    // only gates the page when it stands in for the form (DataDome).
    if (page.captcha && page.inputs < 3) { result.status = "gated"; result.why = "captcha"; return result; }
    if (/log-?in|sign-?in|\/auth|\/account/i.test(page.href) || /sign in|log in/i.test(page.title)) {
      result.status = "gated"; result.why = "login"; return result;
    }

    let pill = null;
    for (let i = 0; i < 40 && !pill; i++) {
      pill = await evaluate("document.querySelector('.smartpaste-button')?.textContent || null");
      if (pill && typeof pill === "object") pill = null;
      if (!pill) await sleep(500);
    }
    result.pill = pill;
    const before = await evaluate(READOUT);
    if (!pill) {
      result.status = "no-pill";
      result.controls = Array.isArray(before) ? before : [];
      result.logs = logs;
      return result;
    }
    const clickAt = Date.now();
    await evaluate("document.querySelector('.smartpaste-button').click()");
    let last = "";
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      const note = await evaluate("document.querySelector('.smartpaste-note')?.textContent || ''");
      if (typeof note !== "string") continue;
      if (/filled \d+/.test(note) && note === last && i > 6) break;
      if (!note && /filled \d+/.test(last) && i > 6) break;
      if (note) last = note;
    }
    await sleep(2500);
    result.note = last;
    result.fillSeconds = Math.round((Date.now() - clickAt) / 100) / 10;
    const after = await evaluate(READOUT);
    result.controls = Array.isArray(after) ? after : [];
    result.logs = logs;
    result.status = "filled";
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    return result;
  } finally {
    result.seconds = Math.round((Date.now() - started) / 1000);
    cleanup();
  }
}

function score(r) {
  const c = r.controls || [];
  const real = c.filter((x) => x.label && !/^(search|captcha|g-recaptcha)/i.test(x.label));
  const filled = real.filter((x) => x.value).length;
  const requiredBlank = real.filter((x) => x.required && !x.value).length;
  return { nControls: real.length, filled, blank: real.length - filled, requiredBlank };
}

const results = [];
let next = 0;
async function worker() {
  while (next < urls.length) {
    const n = next++;
    const r = await runOne(urls[n], n + 1);
    Object.assign(r, score(r));
    results.push(r);
    writeFileSync(join(outDir, `${String(n + 1).padStart(2, "0")}-${r.host}.json`), JSON.stringify(r, null, 1));
    console.log(`[${n + 1}/${urls.length}] ${r.status.padEnd(8)} ${String(r.filled ?? "-").padStart(3)}/${String(r.nControls ?? "-").padEnd(3)} req-blank ${String(r.requiredBlank ?? "-").padEnd(3)} ${r.host} ${r.why || r.error || ""}`);
  }
}
await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker));
results.sort((a, b) => a.n - b.n);
writeFileSync(join(outDir, "summary.json"), JSON.stringify(results.map(({ controls, logs, ...rest }) => rest), null, 1));
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${outDir}\nfilled ${count("filled")}  no-pill ${count("no-pill")}  gated ${count("gated")}  error ${count("error")}`);
process.exit(0);
