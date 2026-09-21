// Autofill stopwatch: time any autofill tool (smartpaste, Simplify, ...) on
// the page in front of you, the same way for each.
//
// Paste into DevTools (Cmd-Opt-J, context "top") and press Enter. It keeps
// watching until the form has been still for 4s after something filled it.
//
// - A tool you click (smartpaste): arm it, then click Autofill. Timed from
//   your click.
// - A tool that fills by itself as the form appears (Simplify): arm it one
//   step EARLIER, then move forward (Workday: arm on My Information, click
//   Save and Continue, and it times My Experience). Workday changes steps
//   without reloading, so the stopwatch survives the move. Timed from the
//   moment the new form appeared.
//
// Prints both clocks, how many fields changed, and a timeline -- the gaps
// in the timeline are the pauses. Use a fresh load / fresh step per tool.
(() => {
  const QUIET_MS = 4000;
  const BLANK = /^(?:value=|checked=false|files=0|state=(?:select one|0 items selected)?\|(?:null|false)\|(?:null|false))$/i;
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

  const now = () => performance.now();
  const baseline = read(); // what each field held before any tool touched it
  const changed = new Map(); // node -> latest value
  const timeline = [];
  const clicks = [];
  let formAt = null; // when fields that were not here at arming appeared
  let firstChange = null;
  let lastChange = null;

  addEventListener("pointerdown", () => clicks.push(now()), true);
  console.log("stopwatch armed: click Autofill, or move to the step a tool fills by itself");

  const timer = setInterval(() => {
    const t = now();
    let fresh = 0;
    for (const [node, value] of read()) {
      if (!baseline.has(node)) {
        // A field that just appeared. Blank means untouched: that is its
        // baseline. Already filled means a tool got to it within 50ms.
        fresh++;
        baseline.set(node, BLANK.test(value) ? value : "");
      }
      const old = changed.has(node) ? changed.get(node) : baseline.get(node);
      if (value === old) continue;
      if (firstChange === null) firstChange = t;
      if (!changed.has(node)) timeline.push({ t, field: labelOf(node) });
      changed.set(node, value);
      lastChange = t;
    }
    if (fresh >= 2 && formAt === null && firstChange === null) formAt = t;
    if (lastChange !== null && t - lastChange > QUIET_MS) {
      clearInterval(timer);
      const clickAt = [...clicks].reverse().find((c) => c <= firstChange) ?? null;
      const start = clickAt ?? formAt ?? firstChange;
      const from = (x) => (x === null ? "n/a" : `${Math.round(lastChange - x)}ms`);
      console.log(
        `stopwatch: ${changed.size} fields changed\n` +
        `  last change after your click:      ${from(clickAt)}\n` +
        `  last change after the form showed: ${from(formAt)}`);
      console.table(timeline.map(({ t, field }) => ({ at_ms: Math.round(t - start), field })));
      window.__stopwatch = {
        fields: changed.size,
        fromClickMs: clickAt === null ? null : Math.round(lastChange - clickAt),
        fromFormMs: formAt === null ? null : Math.round(lastChange - formAt),
        timeline,
      };
    }
  }, 50);
})();
