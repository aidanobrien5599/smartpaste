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
import { createHash } from "node:crypto";
import { build } from "../extension/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EXT = join(here, "..", "extension");
const TEMPLATE = join(here, ".sweep-template");
const pw = join(homedir(), "Library/Caches/ms-playwright");
// Not "build": that name is the esbuild run imported above.
const chromium = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const binary = join(pw, chromium, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
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

import { READOUT } from "./readout.mjs";



// Chrome derives an unpacked extension's id from its path (sha256, hex as
// a-p), so a worktree's copy has a different id from the main checkout's --
// and the stored profile, which lives under the template's id, would not be
// found: every page came back with no pill at all. Rename it on the way in.
const extensionId = [...createHash("sha256").update(EXT).digest("hex").slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

function freshProfile() {
  const dir = mkdtempSync(join(tmpdir(), "smartpaste-sweep-"));
  cpSync(TEMPLATE, dir, { recursive: true });
  const settings = join(dir, "Default", "Local Extension Settings");
  for (const stored of existsSync(settings) ? readdirSync(settings) : []) {
    if (stored !== extensionId) cpSync(join(settings, stored), join(settings, extensionId), { recursive: true });
  }
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
    // A closed posting redirects to the board ("/careers/open-roles",
    // "jobs/search?notFound=1"). Scoring that as a miss blames the extension
    // for a job that no longer exists.
    if (/notFound=1|\/(?:open-roles|search|jobs)\/?$/i.test(page.href) && page.href !== url) {
      result.status = "dead"; result.why = `redirected to ${page.href.slice(0, 80)}`; return result;
    }

    let pill = null;
    // 45s: a page loading beside two others can take half a minute to render
    // its form, and a short wait scored Exa's Ashby form as "no button" three
    // sweeps running -- on its own it offers "Autofill 10 fields + 1 file".
    for (let i = 0; i < 90 && !pill; i++) {
      // iCIMS keeps the form in an iframe; read every same-origin frame.
      pill = await evaluate(`(() => { const find = (w) => { try { const b = w.document.querySelector(".smartpaste-button"); if (b) return b.textContent;
        for (let i = 0; i < w.frames.length; i++) { const t = find(w.frames[i]); if (t) return t; } } catch {} return null; }; return find(window); })()`);
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
    await evaluate(`(() => { const find = (w) => { try { const b = w.document.querySelector(".smartpaste-button"); if (b) return b;
      for (let i = 0; i < w.frames.length; i++) { const t = find(w.frames[i]); if (t) return t; } } catch {} return null; }; find(window)?.click(); })()`);
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
    // Wall clock here is this file's own wait loop, not the fill: every page
    // came out at 10.5s, its floor. The extension times itself and says so.
    result.watchedSeconds = Math.round((Date.now() - clickAt) / 100) / 10;
    result.fillMs = (result.logs || []).flatMap((line) => [...String(line).matchAll(/filled in (\d+)ms/g)])
      .reduce((total, m) => total + Number(m[1]), 0) || null;
    const after = await evaluate(READOUT);
    // A readout that threw is not a page with no fields: say so, loudly.
    if (!Array.isArray(after)) { result.status = "readout-failed"; result.error = String(after?.error).slice(0, 200); }
    result.controls = Array.isArray(after) ? after : [];
    result.logs = logs;
    result.fillMs = logs.flatMap((line) => [...String(line).matchAll(/filled in (\d+)ms/g)])
      .reduce((total, m) => total + Number(m[1]), 0) || null;
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
  const real = c.filter((x) => x.pageLabel && !/^(search|captcha|g-recaptcha)/i.test(x.pageLabel));
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
await build();
await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker));

// Anything that found no button, or failed outright, gets one more go on its
// own. Running several browsers at once makes a slow site (Greenhouse, Ashby)
// look broken, and a flaky zero is worse than a slow sweep: it sends someone
// after a bug that is not there.
const shaky = results.filter((r) => r.status === "no-pill" || r.status === "error" || r.status === "readout-failed");
if (shaky.length) {
  console.log(`\nretrying ${shaky.length} one at a time (parallel load makes a slow page look empty)`);
  for (const old of shaky) {
    const again = await runOne(old.url, old.n);
    Object.assign(again, score(again), { retried: true, firstStatus: old.status });
    results[results.indexOf(old)] = again;
    writeFileSync(join(outDir, `${String(again.n).padStart(2, "0")}-${again.host}.json`), JSON.stringify(again, null, 1));
    console.log(`[retry ${again.n}] ${old.status} -> ${again.status}  ${String(again.filled ?? "-")}/${String(again.nControls ?? "-")}  ${again.host}`);
  }
}
results.sort((a, b) => a.n - b.n);
writeFileSync(join(outDir, "summary.json"), JSON.stringify(results.map(({ controls, logs, ...rest }) => rest), null, 1));
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${outDir}\nfilled ${count("filled")}  no-pill ${count("no-pill")}  gated ${count("gated")}  error ${count("error")}`);
process.exit(0);
