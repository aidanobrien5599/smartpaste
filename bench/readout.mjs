// The one reading of a filled form, shared so every tool is scored the same
// way: bench/sweep.mjs uses it on smartpaste's own runs, and bench/score-page
// prints it for pasting into a page another tool (Simplify, ...) has filled.
// A comparison where each side is measured by its own code is not one.
// What the page shows, per visible control: the text THIS FILE can find for
// it, its value, whether it is required. Radios and checkboxes are one line
// per group.
//
// `pageLabel` is not the question the extension asks. The content script runs
// in an isolated world, so its labelFor() is unreachable from here, and this
// is a cruder rule (aria-labelledby, label[for], a wrapping label, aria-label,
// placeholder, name). Where they differ the extension is usually right: a
// brief written from this column sent an agent after three bugs that did not
// exist -- Lever's "Type your response", Ashby's UUIDs and Lever's
// "cards[...][field0]" are all read correctly by the extension. Use it to spot
// which FIELD is blank, never to conclude what the extension asked about it.
export const READOUT = `(() => {
  const readDoc = (document) => {
  const clean = (t) => (t || "").replace(/[\\u200b]/g, "").replace(/\\s+/g, " ").trim();
  const deepAll = (sel, root = document, out = []) => { out.push(...root.querySelectorAll(sel)); for (const el of root.querySelectorAll("*")) if (el.shadowRoot) deepAll(sel, el.shadowRoot, out); return out; };
  const labelOf = (el) => { const root = el.getRootNode(); const host = root.host;
    return clean((el.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => root.getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || "").join(" ") ||
      (el.id && root.querySelector?.('label[for="' + CSS.escape(el.id) + '"]')?.textContent) || el.closest("label")?.textContent ||
      el.getAttribute("aria-label") || host?.getAttribute("label") || el.placeholder || el.name || "").slice(0, 200); };
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
      pageLabel: labelOf(el), value: clean(value).slice(0, 100), required: required(el),
      marked: el.getAttribute("data-smartpaste") || null,
      // The confidence is in the title the mark leaves ("... (0.62)"), which
      // is the only place a run says how sure it was -- what a change to the
      // auto-fill bar would newly let through.
      confidence: Number((String(el.getAttribute("title") || "").match(/\\(([01]\\.\\d+)\\)\\s*$/) || [])[1]) || null });
  }
  for (const g of groups.values()) {
    const box = g.el.closest("fieldset, [role=radiogroup], [role=group]");
    const q = clean(box?.querySelector("legend, label")?.textContent || box?.getAttribute("aria-label") || g.el.name).slice(0, 100);
    out.push({ kind: g.kind + "-group", pageLabel: q, value: g.picked.join(" | ").slice(0, 100), required: g.el.required, options: g.n });
  }
  // Toggle / pill buttons (Ashby, Oracle): a group is answered when one is pressed.
  for (const group of document.querySelectorAll('[role="radiogroup"]')) {
    const buttons = group.querySelectorAll('button[role="radio"], [role="radio"]:not(input)');
    if (!buttons.length) continue;
    const picked = [...buttons].filter((b) => b.getAttribute("aria-checked") === "true").map((b) => clean(b.textContent));
    out.push({ kind: "pills", pageLabel: clean(group.getAttribute("aria-label") || ""), value: picked.join(" | "), required: false, options: buttons.length });
  }
  return out;
  };
  // Every same-origin document: the page, and iCIMS's form in its iframe.
  const docs = [document];
  for (let i = 0; i < window.frames.length; i++) { try { if (window.frames[i].document) docs.push(window.frames[i].document); } catch {} }
  return docs.flatMap(readDoc);
})()`;
