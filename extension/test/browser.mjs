// A headless Chrome for the content-script tests, driven over the DevTools
// protocol with Node's built-in WebSocket -- no Playwright, no npm install.
// Fixtures are served over http so the page has a real origin, and every
// page gets stub.js (standing in for chrome.*) and then content.js injected
// before its own scripts, as the extension would.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures");
// bench/mutation-check.mjs points this at a mutated copy, so the real
// content.js is never rewritten under anyone else editing it.
const CONTENT = process.env.SMARTPASTE_CONTENT || join(here, "..", "content.js");

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];
export const chromePath = CANDIDATES.find((p) => p && existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
    const file = join(FIXTURES, name);
    if (!file.startsWith(FIXTURES) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
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

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), "smartpaste-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--window-size=1200,2400", "about:blank",
  ], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stub = readFileSync(join(FIXTURES, "stub.js"), "utf8");
  const content = readFileSync(CONTENT, "utf8");

  /** `scripts`: extra sources to inject before the page, after the stub. */
  async function open(fixture, { scripts = [], smartpaste = true } = {}) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const session = new Session(socket);
    await session.send("Page.enable");
    // A headless tab is never focused, so blur() would fire nothing; Workday
    // (and the fixture) commit typed values on blur.
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
    for (const source of scripts) await session.send("Page.addScriptToEvaluateOnNewDocument", { source });
    if (smartpaste) await session.send("Page.addScriptToEvaluateOnNewDocument", { source: content });
    await session.send("Page.navigate", { url: `${origin}/${fixture}` });

    const page = {
      /** Evaluate an expression (or a function source) in the page, awaiting promises. */
      async eval(expression) {
        const source = typeof expression === "function" ? `(${expression})()` : expression;
        const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
          expression: source, awaitPromise: true, returnByValue: true,
        });
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        return result.value;
      },
      /** Poll until `expression` is truthy; returns its value. */
      async waitFor(expression, timeout = 10000) {
        const deadline = Date.now() + timeout;
        let value;
        while (Date.now() < deadline) {
          value = await page.eval(expression);
          if (value) return value;
          await sleep(100);
        }
        throw new Error(`timed out waiting for: ${expression}`);
      },
      async close() {
        socket.close();
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
      },
    };
    await page.waitFor("document.readyState === 'complete'");
    return page;
  }

  async function close() {
    server.close();
    chrome.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }

  return { open, close };
}
