// Run ANOTHER autofill extension (Simplify, Huntr) over the same forms, and
// score it with bench/readout.mjs -- the same reading bench/sweep.mjs gives
// our own runs. A comparison where each side is measured by its own code,
// or by eye, is not one.
//
//   node bench/rival.mjs --list                       which rivals are installed
//   node bench/rival.mjs simplify --probe <url>       what it injects (for finding its button)
//   node bench/rival.mjs simplify <urls.txt>          fill and score each page
//
// WHY A SEPARATE PROFILE, AND WHAT IS IN IT
// The rival's session is in its cookies, and Chrome encrypts those with a key
// tied to the application, so Chrome for Testing cannot read a profile written
// by Google Chrome. This therefore launches Google Chrome itself, against a
// minimal profile built in bench/.rival-profile from:
//   - the rival extension's own folder and its own extension storage
//   - ONLY that rival's cookies, copied row by row (no other site's session)
//   - Preferences / Secure Preferences / Local State, which is how Chrome
//     knows the extension is installed
// No history, no passwords, no other cookies. It stays on this machine.
//
// NOTHING IS EVER SUBMITTED: every page gets the same guard sweep.mjs uses,
// installed before the page's own scripts, which cancels form submission and
// requestSubmit(). The only thing clicked is the rival's own fill control.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { READOUT } from "./readout.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SOURCE = join(homedir(), "Library/Application Support/Google/Chrome");
const PROFILE = join(here, ".rival-profile");

// id -> how to recognise it, and the cookie host that holds its session.
const RIVALS = {
  simplify: { id: "pbanhockgagggenencehbnadejlgchfc", cookies: "simplify" },
  huntr: { id: "mihdfbecejheednfigjpdacgeilhlmnf", cookies: "huntr" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function installed() {
  const dir = join(SOURCE, "Default", "Extensions");
  return Object.entries(RIVALS).filter(([, r]) => existsSync(join(dir, r.id)));
}

/** A profile holding one rival, its own storage, and only its own cookies. */
function buildProfile(rival) {
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(join(PROFILE, "Default"), { recursive: true });
  for (const file of ["Local State"]) cpSync(join(SOURCE, file), join(PROFILE, file));
  // Every other extension is stripped out of the copy -- smartpaste included.
  // Left in, Chrome loads it from its path on disk and fills the page too,
  // and the run measures both tools at once.
  for (const file of ["Preferences", "Secure Preferences"]) {
    const prefs = JSON.parse(readFileSync(join(SOURCE, "Default", file), "utf8"));
    const settings = prefs.extensions?.settings;
    if (settings) {
      for (const id of Object.keys(settings)) if (id !== rival.id) delete settings[id];
    }
    if (prefs.extensions?.pinned_extensions) prefs.extensions.pinned_extensions = [];
    writeFileSync(join(PROFILE, "Default", file), JSON.stringify(prefs));
  }
  for (const dir of ["Extensions", "Local Extension Settings"]) {
    const from = join(SOURCE, "Default", dir, rival.id);
    if (existsSync(from)) cpSync(from, join(PROFILE, "Default", dir, rival.id), { recursive: true });
  }
  copyCookies(rival.cookies);
}

/** Only this rival's cookies, by host, into a fresh store Chrome will read. */
function copyCookies(host) {
  const from = join(SOURCE, "Default", "Cookies");
  const to = join(PROFILE, "Default", "Cookies");
  const scratch = join(tmpdir(), `cookies-${Date.now()}.sqlite`);
  cpSync(from, scratch);
  const sql = [
    `ATTACH DATABASE '${to}' AS out;`,
    "CREATE TABLE out.meta AS SELECT * FROM meta;",
    "CREATE TABLE out.cookies AS SELECT * FROM cookies WHERE 0;",
    `INSERT INTO out.cookies SELECT * FROM cookies WHERE host_key LIKE '%${host}%';`,
    "SELECT 'copied ' || (SELECT count(*) FROM out.cookies) || ' cookies';",
  ].join("\n");
  const said = execFileSync("sqlite3", [scratch], { input: sql }).toString().trim();
  rmSync(scratch, { force: true });
  return said;
}

const GUARD = `(() => {
  const block = (why) => console.warn("RIVAL-GUARD blocked " + why);
  HTMLFormElement.prototype.submit = function () { block("form.submit()"); };
  HTMLFormElement.prototype.requestSubmit = function () { block("form.requestSubmit()"); };
  addEventListener("submit", (e) => { e.preventDefault(); e.stopImmediatePropagation(); block("a submit event"); }, true);
})();`;

// What the rival drew on the page: its own root elements, and anything that
// looks like a fill control inside them (its UI lives in a shadow root).
const PROBE = `(() => {
  const out = { roots: [], buttons: [], shadowHosts: [], frames: [], extensionNodes: [] };
  for (const el of document.querySelectorAll("*")) {
    const src = el.getAttribute?.("src") || el.getAttribute?.("data-src") || "";
    if (/^chrome-extension:/.test(src)) out.extensionNodes.push({ tag: el.tagName, src: src.slice(0, 90) });
    if (el.shadowRoot && !out.shadowHosts.includes(el.tagName)) {
      out.shadowHosts.push(el.tagName + (el.id ? "#" + el.id : ""));
      for (const b of el.shadowRoot.querySelectorAll("button, [role=button], a, div[class*=button i]")) {
        const text = (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 50);
        if (text) out.buttons.push({ host: el.tagName, text, cls: String(b.className).slice(0, 40) });
      }
    }
  }
  for (const f of document.querySelectorAll("iframe")) out.frames.push(String(f.src).slice(0, 90));
  for (const el of document.body.children) {
    const id = (el.id || "") + " " + (el.className || "");
    if (/simplify|huntr|copilot|extension/i.test(String(id)) || el.shadowRoot) {
      out.roots.push({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60), shadow: Boolean(el.shadowRoot) });
    }
    if (el.shadowRoot) {
      out.shadowHosts.push(el.tagName + "#" + el.id);
      for (const b of el.shadowRoot.querySelectorAll("button, [role=button], a")) {
        const text = (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 50);
        if (text) out.buttons.push({ host: el.tagName + "#" + el.id, text, cls: String(b.className).slice(0, 40) });
      }
    }
  }
  for (const b of document.querySelectorAll("button, [role=button]")) {
    const text = (b.textContent || "").replace(/\\s+/g, " ").trim();
    if (/autofill|simplify|fill|apply with/i.test(text)) out.buttons.push({ host: "page", text: text.slice(0, 50), cls: String(b.className).slice(0, 40) });
  }
  return JSON.stringify(out, null, 1);
})()`;

async function connect(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (socket.onopen = r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  socket.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === "Runtime.consoleAPICalled") {
      logs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); socket.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      sleep(20000).then(() => ({ exceptionDetails: { exception: { description: "evaluate timed out" } } })),
    ]);
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result?.value;
  };
  return { send, evaluate, logs };
}

async function launch(rival) {
  // Built once and kept. Rebuilt every run, the rival meets its own
  // first-use notice ("Before you autofill ...") on every page, and its
  // first click lands on that instead of filling -- which would have gone
  // down as the rival failing. Pass --rebuild to start it clean.
  if (!existsSync(PROFILE) || process.argv.includes("--rebuild")) buildProfile(rival);
  const port = 9444;
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, "--no-first-run",
    "--no-default-browser-check", "--window-size=1280,1400", "--restore-last-session=false", "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(200); }
  }
  return { chrome, port };
}

const [which, ...rest] = process.argv.slice(2);
if (which === "--list" || !which) {
  const found = installed();
  console.log(found.length ? `installed rivals: ${found.map(([name]) => name).join(", ")}` : "no known rival extension is installed");
  console.log("usage: node bench/rival.mjs <rival> --probe <url> | node bench/rival.mjs <rival> <urls.txt>");
  process.exit(0);
}
const rival = RIVALS[which];
if (!rival) { console.error(`unknown rival "${which}" -- known: ${Object.keys(RIVALS).join(", ")}`); process.exit(1); }
if (!existsSync(CHROME)) { console.error("Google Chrome itself is needed here: its cookies cannot be read by Chrome for Testing."); process.exit(1); }

const { chrome, port } = await launch(rival);
const { send, evaluate, logs } = await connect(port);
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: GUARD });

if (rest[0] === "--buttons") {
  await send("Page.navigate", { url: rest[1] });
  await sleep(Number(process.env.WAIT || 20000));
  const seen = await evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (!el.shadowRoot) continue;
      for (const b of el.shadowRoot.querySelectorAll("button, [role=button]")) {
        const text = (b.textContent || "").replace(/\\s+/g, " ").trim();
        const box = b.getBoundingClientRect();
        if (text) out.push({ text: text.slice(0, 60), visible: box.width > 0 && box.height > 0, aria: b.getAttribute("aria-label") });
      }
    }
    return JSON.stringify(out, null, 1);
  })()`);
  console.log(typeof seen === "string" ? seen : JSON.stringify(seen));
  chrome.kill();
  process.exit(0);
}

if (rest[0] === "--shadow") {
  await send("Page.navigate", { url: rest[1] });
  await sleep(Number(process.env.WAIT || 20000));
  const dump = await evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (!el.shadowRoot) continue;
      out.push(el.shadowRoot.innerHTML.replace(/<svg[\\s\\S]*?<\\/svg>/g, "<svg/>").replace(/\\s+/g, " ").slice(0, 4000));
    }
    return out.join("\\n\\n----\\n\\n");
  })()`);
  console.log(typeof dump === "string" ? dump : JSON.stringify(dump));
  chrome.kill();
  process.exit(0);
}

if (rest[0] === "--probe") {
  await send("Page.navigate", { url: rest[1] });
  await sleep(Number(process.env.WAIT || 15000));
  console.log("PROBE:", await evaluate(PROBE));
  console.log("CONSOLE:", logs.slice(0, 10));
  chrome.kill();
  process.exit(0);
}

// Its own control, by the words on it. Clicked in the shadow root it lives
// in; nothing else on the page is touched.
const SEEK = (words, click) => `(() => {
  for (const el of document.querySelectorAll("*")) {
    if (!el.shadowRoot) continue;
    for (const b of el.shadowRoot.querySelectorAll("button, [role=button]")) {
      const text = (b.textContent || "").replace(/\\s+/g, " ").trim();
      const box = b.getBoundingClientRect();
      if (${words}.test(text) && box.width > 0 && box.height > 0) { ${click ? "b.click();" : ""} return text.slice(0, 60); }
    }
  }
  return null;
})()`;

// Everything the rival's own UI says, for when it fills nothing: a sign-in
// wall, a usage limit or an empty profile all look identical in the numbers
// (0/24, three clicks, no error), and they are all over in one sentence of
// its own text. A whole 42-form run came back 0/N, which without this would
// have read as the rival being bad at these forms.
const PANEL = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    if (!el.shadowRoot) continue;
    const text = (el.shadowRoot.textContent || "").replace(/\\s+/g, " ").trim();
    if (text) out.push(text.slice(0, 600));
  }
  return out.join(" || ").slice(0, 1200);
})()`;

const CONTROL = { simplify: "/autofill this page/i", huntr: "/autofill/i" }[which];
const urls = readFileSync(rest[0], "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
// SWEEP_OUT and START let a long corpus run in chunks that accumulate into
// one result set: a 42-form rival run takes ~30 minutes, longer than one
// background window.
const outDir = join(here, "sweeps", process.env.SWEEP_OUT || `${stamp}-${which}`);
const START = Number(process.env.START || 0);
mkdirSync(outDir, { recursive: true });

const results = [];
for (const [i, url] of urls.entries()) {
  const result = { n: START + i + 1, url, host: new URL(url).hostname, tool: which, status: "error" };
  const started = Date.now();
  await send("Page.navigate", { url });
  // Wait for its own control to appear rather than guessing how long it
  // takes: on a cold start the panel needs longer than any fixed wait, and
  // "I did not find its button" would otherwise be recorded as a failure.
  const deadline = Date.now() + Number(process.env.SETTLE || 45000);
  let ready = null;
  while (!ready && Date.now() < deadline) {
    ready = await evaluate(SEEK(CONTROL, false));
    if (typeof ready !== "string") { ready = null; await sleep(1000); }
  }
  // Anything it asks a person to acknowledge first, acknowledged once.
  // Its panel reloads per page, and clicking the moment the button appears
  // is often too early -- the fill then does nothing. So: click, watch for
  // any value to land, and try again a couple of times, as a person would.
  const clickedAt = Date.now();
  let clicked = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(attempt ? 4000 : 1500);
    const hit = await evaluate(SEEK(CONTROL, true));
    if (typeof hit === "string") clicked = hit;
    let filledAny = false;
    for (let t = 0; t < 16 && !filledAny; t++) {
      await sleep(500);
      filledAny = (await evaluate(`[...document.querySelectorAll("input,textarea,select")].some((e) => e.value)`)) === true;
    }
    if (filledAny) break;
    // Nothing yet: acknowledge whatever it is asking first, then try again.
    await evaluate(SEEK("/^(?:got it|continue|accept|i agree|agree|ok)$/i", true));
  }
  result.control = typeof clicked === "string" ? clicked : null;
  if (!result.control) {
    result.status = "no-control";
  } else {
    // No note to watch, so wait for the page to stop changing: three reads
    // the same in a row, or twenty seconds.
    let last = "", still = 0;
    for (let t = 0; t < 40 && still < 3; t++) {
      await sleep(500);
      const now = await evaluate(`[...document.querySelectorAll("input,textarea,select")].map((e) => e.value).join("|")`);
      if (typeof now === "string") { still = now === last ? still + 1 : 0; last = now; }
    }
    result.fillMs = Date.now() - clickedAt;
    result.status = "filled";
  }
  const rows = await evaluate(READOUT);
  result.controls = Array.isArray(rows) ? rows : [];
  // What its own panel says, always -- it is the only explanation of a page
  // it filled nothing on.
  const panel = await evaluate(PANEL);
  if (typeof panel === "string") result.panel = panel;
  result.seconds = Math.round((Date.now() - started) / 1000);
  results.push(result);
  writeFileSync(join(outDir, `${String(START + i + 1).padStart(2, "0")}-${result.host}.json`), JSON.stringify(result, null, 1));
  const real = result.controls.filter((c) => c.pageLabel);
  console.log(`[${START + i + 1}/${START + urls.length}] ${result.status.padEnd(10)} ${real.filter((c) => c.value).length}/${real.length} fields  ${result.fillMs ? (result.fillMs / 1000).toFixed(1) + "s" : "-"}  ${result.host}`);
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify(results.map(({ controls, ...rest }) => rest), null, 1));
console.log(`\n${outDir}`);
chrome.kill();
process.exit(0);
