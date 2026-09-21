/**
 * Autofill stopwatch, as an extension so it is running before the page is.
 *
 * A console snippet dies with every reload, and a phone stopwatch times
 * Workday's own load (seconds of scripts on a hard refresh) along with the
 * tool. This starts at navigation and splits the two:
 *
 *   form shown   -- ms from navigation (or from your click, for a step
 *                   change inside a single-page app) until the form exists
 *   fill         -- ms from the form appearing, or from your click on a
 *                   tool's button if that came later, to the last change
 *
 * "fill" is the tool's number and should barely move between a hard and a
 * soft refresh; "form shown" is the page's, and is what the cache changes.
 * Each run is kept (popup) with the tool name you set there.
 */
(() => {
  if (window.top !== window) return; // one stopwatch per tab
  const QUIET_MS = window.__stopwatchQuietMs || 4000;
  const POLL_MS = 50;
  const BLANK = /^(?:value=|checked=false|files=0|state=(?:select one|select\.{0,3}|0 items selected)?\|(?:null|false)\|(?:null|false))$/i;

  const now = () => performance.now(); // ms since this navigation began
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  function read() {
    const state = new Map();
    const add = (node, key, value) => state.set(node, `${key}=${value}`);
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.type === "file") add(el, "files", el.files.length);
      else if (el.type === "checkbox" || el.type === "radio") add(el, "checked", el.checked);
      else if (el.type !== "hidden" && el.type !== "password" && visible(el)) add(el, "value", el.value);
    }
    for (const el of document.querySelectorAll(
      'button[aria-haspopup="listbox"], button[aria-pressed], [role="radio"], ' +
      '[data-automation-id="selectedItemList"], [class*="single-value"]')) {
      add(el, "state", `${el.textContent.trim()}|${el.getAttribute("aria-pressed")}|${el.getAttribute("aria-checked")}`);
    }
    return state;
  }

  function labelOf(el) {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const entry = el.closest('[data-automation-id^="formField"], [class*="fieldEntry"], .application-question, fieldset, label');
    return (byFor?.textContent || el.getAttribute("aria-label") ||
      entry?.querySelector("label, legend")?.textContent || el.name || el.id || el.tagName)
      .replace(/\s+/g, " ").trim().slice(0, 60);
  }

  /** How much of the page's script came from cache: hard vs soft refresh. */
  function cacheShare() {
    const scripts = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script" && r.decodedBodySize > 0);
    if (!scripts.length) return null;
    const cached = scripts.filter((r) => r.transferSize === 0).length;
    const bytes = scripts.reduce((sum, r) => sum + r.transferSize, 0);
    return { scripts: scripts.length, fromCache: cached, downloadedKB: Math.round(bytes / 1024) };
  }

  let run = null;
  const clicks = [];
  addEventListener("pointerdown", (e) => { if (!e.target.closest?.(".autofill-stopwatch")) clicks.push(now()); }, true);

  function newRun(startedAt, trigger) {
    run = {
      startedAt, trigger, url: location.href,
      baseline: new Map(), changed: new Map(), timeline: [],
      formAt: null, firstChange: null, lastChange: null,
    };
  }

  function report() {
    const r = run;
    const clickBefore = [...clicks].reverse().find((c) => c <= r.firstChange && c >= (r.formAt ?? 0));
    const fillFrom = Math.max(r.formAt ?? r.firstChange, clickBefore ?? 0);
    const nav = performance.getEntriesByType("navigation")[0];
    const result = {
      at: new Date().toISOString(),
      url: r.url.slice(0, 200),
      title: document.title.slice(0, 80),
      trigger: r.trigger === "navigation" ? (nav?.type || "navigate") : "step change",
      cache: r.trigger === "navigation" ? cacheShare() : null,
      formShownMs: r.formAt === null ? null : Math.round(r.formAt - r.startedAt),
      fillMs: Math.round(r.lastChange - fillFrom),
      startedBy: clickBefore ? "your click" : "form appearing",
      firstFillMs: Math.round(r.firstChange - fillFrom),
      fields: r.changed.size,
      timeline: r.timeline.map(({ t, field }) => ({ ms: Math.round(t - fillFrom), field })),
    };
    chrome.storage.local.get({ runs: [], tool: "" }, ({ runs, tool }) => {
      result.tool = tool || "(unnamed)";
      chrome.storage.local.set({ runs: [result, ...runs].slice(0, 200) });
      badge(result);
    });
    console.log(`[stopwatch] ${result.tool}: fill ${result.fillMs}ms (from ${result.startedBy}), ` +
      `form shown ${result.formShownMs}ms after ${result.trigger}, ${result.fields} fields`);
    console.table(result.timeline);
  }

  function badge(result) {
    document.querySelector(".autofill-stopwatch")?.remove();
    const el = document.createElement("div");
    el.className = "autofill-stopwatch";
    el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#111;color:#fff;" +
      "font:12px/1.4 system-ui;padding:8px 10px;border-radius:6px;box-shadow:0 2px 8px #0005;cursor:pointer";
    const cache = result.cache ? ` · ${result.cache.fromCache}/${result.cache.scripts} scripts cached` : "";
    el.textContent = `⏱ ${result.tool}: fill ${(result.fillMs / 1000).toFixed(2)}s · ${result.fields} fields · ` +
      `form shown ${result.formShownMs === null ? "?" : (result.formShownMs / 1000).toFixed(2) + "s"} after ${result.trigger}${cache}`;
    el.title = "click to dismiss";
    el.addEventListener("click", () => el.remove());
    document.documentElement.appendChild(el);
  }

  function tick() {
    if (!run) return;
    const t = now();
    let fresh = 0;
    for (const [node, value] of read()) {
      if (!run.baseline.has(node)) {
        // A field seen for the first time: whatever it holds is where it
        // started (the page's own prefill counts as nobody's fill).
        run.baseline.set(node, value);
        if (BLANK.test(value)) fresh++;
        continue;
      }
      const old = run.changed.has(node) ? run.changed.get(node) : run.baseline.get(node);
      if (value === old) continue;
      if (run.firstChange === null) run.firstChange = t;
      if (!run.changed.has(node)) run.timeline.push({ t, field: labelOf(node) });
      run.changed.set(node, value);
      run.lastChange = t;
    }
    if (fresh >= 2 && run.formAt === null && run.firstChange === null) {
      // A single-page app's next step: the click that moved on starts it.
      if (run.trigger === "step") run.startedAt = [...clicks].reverse().find((c) => c < t) ?? t;
      run.formAt = t;
    }
    if (run.lastChange !== null && t - run.lastChange > QUIET_MS) {
      report();
      newRun(now(), "step");
      run.baseline = read();
    }
  }

  chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
    if (!enabled) return;
    newRun(0, "navigation");
    setInterval(tick, POLL_MS);
  });
})();
