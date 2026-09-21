// Autofill stopwatch: time any autofill tool (smartpaste, Simplify, ...) on
// the page in front of you, the same way for each.
//
// 1. Open the application page, open DevTools (Cmd-Opt-J), paste this, Enter.
// 2. Click the tool's autofill button.
// 3. When the form stops changing for 4s it prints the time from your click
//    to the last change, how many fields changed, and a timeline -- the gaps
//    in the timeline are the pauses.
// Re-run on a fresh load of the page for the other tool.
(() => {
  const QUIET_MS = 4000;
  const read = () => {
    const state = new Map();
    const add = (node, key, value) => state.set(node, `${key}=${value}`);
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.type === "file") add(el, "files", el.files.length);
      else if (el.type === "checkbox" || el.type === "radio") add(el, "checked", el.checked);
      else if (el.type !== "hidden" && el.type !== "password") add(el, "value", el.value);
    }
    // Widgets that are not form controls: listbox buttons, toggles,
    // Workday picker selections, React Select values.
    for (const el of document.querySelectorAll(
      'button[aria-haspopup="listbox"], button[aria-pressed], [role="radio"], ' +
      '[data-automation-id="selectedItemList"], [class*="single-value"]')) {
      add(el, "state", `${el.textContent.trim()}|${el.getAttribute("aria-pressed")}|${el.getAttribute("aria-checked")}`);
    }
    return state;
  };
  const labelOf = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const entry = el.closest('[data-automation-id^="formField"], [class*="fieldEntry"], .application-question, fieldset, label');
    return (byFor?.textContent || el.getAttribute("aria-label") ||
      entry?.querySelector("label, legend")?.textContent || el.name || el.id || el.tagName)
      .replace(/\s+/g, " ").trim().slice(0, 60);
  };

  const before = read();
  const changed = new Map(); // node -> ms of its last change
  const timeline = [];
  let clickAt = null;
  let lastChange = null;
  const now = () => performance.now();

  addEventListener("pointerdown", () => { if (clickAt === null) clickAt = now(); }, true);
  console.log("stopwatch armed: click the autofill button");

  const timer = setInterval(() => {
    const t = now();
    for (const [node, value] of read()) {
      const old = changed.has(node) ? changed.get(node).value : before.get(node);
      if (value === old) continue;
      if (clickAt === null) clickAt = t; // a tool that fills without a click
      if (!changed.has(node)) timeline.push({ at_ms: Math.round(t - clickAt), field: labelOf(node) });
      changed.set(node, { value, t });
      lastChange = t;
    }
    if (lastChange !== null && t - lastChange > QUIET_MS) {
      clearInterval(timer);
      console.log(`stopwatch: ${changed.size} fields changed; last change ${Math.round(lastChange - clickAt)}ms after the click`);
      console.table(timeline);
      window.__stopwatch = { fields: changed.size, lastChangeMs: Math.round(lastChange - clickAt), timeline };
    }
  }, 50);
})();
