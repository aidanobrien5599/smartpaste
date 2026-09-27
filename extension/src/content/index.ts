// @ts-nocheck
/**
 * Cmd-V, made to know what box it is in.
 *
 * Reading labels from the DOM is the whole reason this belongs in a browser:
 * the CLI had to guess which lines of copied page text were fields, and that
 * was its weakest stage. Here the page simply says so.
 *
 * The keystroke has to decide synchronously whether to intercept, and a Jev
 * call takes about half a second, so every field on the page is answered in
 * one batched call up front. By the time you press Cmd-V the answer is already
 * sitting in a cache. If there is no confident answer, the keystroke is left
 * alone and you get an ordinary paste.
 */

import { state, answers, asked, cycle, staleMenus, dateWrappers } from "./state.ts";
import { deepAll, sleep, fire, frames, press, scroller, click } from "./dom/query.ts";
import { clean, normalize, optionText } from "./dom/text.ts";
import { COMBO_SELECTOR, SELECT_SHELL, isCombobox, nodeVisible } from "./dom/controls.ts";
import {
  FILE_SELECTOR, FIELD_ENTRY, LISTBOX_BUTTON, PROMPT_INPUT, DATE_PART, EMPTY_BUTTON,
  ANY_CONTROL, NOT_A_SUGGESTION, UD_SELECT, UD_TREE_NODE,
} from "./discover/selectors.ts";
import { labelFor, ownerLabel, questionFor, listboxLabel } from "./discover/labels.ts";
import { entryNumbers, titledSection, ENTRY_SECTIONS, splitsInternships, CARD } from "./discover/sections.ts";
import { pageChrome, looksLikeApplication } from "./discover/gate.ts";
import { fileHintTiers, documentFor } from "./discover/files.ts";
import { toggleAnswered } from "./discover/collect/choices.ts";
import { groupCheckboxes } from "./discover/collect/checkboxes.ts";
import { collectFields } from "./discover/collect/fields.ts";
import { hint, flash } from "./ui/marks.ts";
import { pillRoot, FRAME_TAG, ourPill, note } from "./ui/note.ts";
import { answer, chooseAmong, localMatch } from "./answer/ask.ts";
import { forget, detached, rebind } from "./answer/known.ts";

import { selectChoices, setSelect } from "./widgets/select.ts";
import { setToggle, setChecks } from "./widgets/toggle.ts";
import { looksLikeAutocomplete } from "./widgets/autocomplete.ts";
import { currentValue } from "./widgets/combobox.ts";
import { surveyListbox, applyListbox } from "./widgets/listbox.ts";
import { surveyPrompt, applyPrompt, promptChosen, setPrompt, setMultiPrompt } from "./widgets/prompt.ts";
import { dateParts, formatForField, setDate } from "./widgets/date.ts";
import { setValue } from "./widgets/set-value.ts";

(() => {
  const MIN_FIELDS = 2;

  // Opt-in (Settings -> "Tick acknowledgements for me"): the "I have read the
  // privacy notice" and "I confirm this is accurate" boxes most forms end
  // with. Vercel asks both as a radio group with one option, so they are not
  // questions at all -- there is nothing to choose, only something to tick.
  // Decided here, never by Jev, and only on wording that is an acknowledgement:
  // marketing, texts, talent pools and do-not-sell stay the applicant's even
  // with the setting on, whatever else the label says.
  const ACKNOWLEDGEMENT = /acknowledg|have read|read and understood?|reviewed and confirm|confirm(?:ed)? that|accurate and complete|true and (?:correct|complete)|certify|attest|i accept|privacy (?:notice|policy|statement)|terms (?:and|&) conditions/i;
  const NEVER_ACKNOWLEDGE = /marketing|newsletter|subscribe|promotion|special offers|\bsms\b|text messages?|contact me|do not sell|share my personal|remember me|talent (?:community|network|pool)|future (?:roles|opportunities|openings)|job alerts/i;

  function acknowledgements() {
    const found = [];
    const consider = (box, ...texts) => {
      if (box.disabled || box.checked || pageChrome(box)) return;
      const text = texts.filter(Boolean).join(" ");
      if (!ACKNOWLEDGEMENT.test(text) || NEVER_ACKNOWLEDGE.test(text)) return;
      const shown = box.closest("label") || box;
      if (nodeVisible(shown) || nodeVisible(box)) found.push(box);
    };
    const radios = new Map();
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      if (radio.name) radios.set(radio.name, [...(radios.get(radio.name) || []), radio]);
    }
    for (const group of radios.values()) {
      if (group.length === 1) consider(group[0], clean(group[0].closest("label")?.textContent), questionFor(group));
    }
    for (const [box, ...rest] of groupCheckboxes()) {
      if (!rest.length) consider(box, labelFor(box), ownerLabel(box));
    }
    return found;
  }

  /** Tick every acknowledgement, if the setting is on. Returns how many. */
  async function acknowledge() {
    let settings = {};
    try { ({ settings = {} } = await chrome.storage.local.get("settings")); } catch { return 0; }
    if (!settings.acknowledge) return 0;
    let ticked = 0;
    for (const box of acknowledgements()) {
      click(box);
      if (!box.checked) box.click();
      if (box.checked) ticked++;
    }
    return ticked;
  }

  /* ----------------------------------------------------------------- fetch */

  async function scan() {
    // A fill opens menus and types into search boxes; scanning that churn
    // would re-ask Jev about a half-open page.
    if (state.scanning || state.filling) return;
    const fields = collectFields();
    // Workday's My Experience starts as empty sections with Add buttons: few
    // or no fields, but a whole resume's worth of entries to add.
    const entries = fields.length < MIN_FIELDS || !looksLikeApplication(fields) ? await entriesToAdd() : 0;
    if ((fields.length < MIN_FIELDS || !looksLikeApplication(fields)) && !entries) {
      if (state.known.length) forget();
      return;
    }
    const signature = fields.map((f) => f.label).join("|") + (entries ? `|+${entries}` : "");
    if (signature === state.lastSignature) {
      // Same questions, maybe new elements: keep hold of the live ones.
      if (rebind()) fields.forEach((f) => asked.add(f.element));
      return;
    }

    state.scanning = true;
    state.lastSignature = signature;
    try {
      const answered = fields.length ? await answer(fields) : [];
      if (!answered) return;
      state.known = answered;
      showButton(state.known.length);
    } catch (error) {
      // An extension reload orphans this script; staying quiet is correct.
    } finally {
      state.scanning = false;
    }
  }

  /* --------------------------------------------------------------- pasting */

  function isFilled(entry) {
    const { element } = entry;
    if (entry.buttons) return toggleAnswered(entry);
    if (element.matches(LISTBOX_BUTTON)) return !EMPTY_BUTTON.test(element.textContent.trim());
    // Live, an empty date box holds its mask -- "MM", "YYYY" ("current value
    // is MM/YYYY") -- and counting that as filled skipped every From / To.
    if (dateWrappers.has(element)) return [...element.querySelectorAll(DATE_PART)].some((p) => /\d/.test(p.value));
    if (element.matches(PROMPT_INPUT)) return Boolean(promptChosen(element));
    if (isCombobox(element)) return Boolean(currentValue(element));
    return Boolean(element.value && element.value.trim());
  }

  /* ----------------------------------------------------------- attachments */

  /** Assign each stored document to the one input that names it best. */
  function planAttachments(inputs, documents) {
    const plan = new Map();
    for (const tier of [0, 1]) {
      for (const input of inputs) {
        if (plan.has(input)) continue;
        const key = documentFor(fileHintTiers(input)[tier]);
        if (!key || !documents[key]) continue;
        if ([...plan.values()].includes(key)) continue; // already placed
        plan.set(input, key);
      }
    }
    return plan;
  }

  function decode(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /**
   * A file input's `files` is read-only, but it accepts a FileList taken from
   * a DataTransfer -- which is how a drag-and-drop would have delivered it.
   */
  async function attachDocuments() {
    const inputs = deepAll(FILE_SELECTOR).filter(
      (el) => !el.disabled && !el.files.length
    );
    if (!inputs.length) return 0;
    const { documents = {} } = await chrome.storage.local.get("documents");
    const plan = planAttachments(inputs, documents);
    let attached = 0;
    for (const [input, key] of plan) {
      const stored = documents[key];
      if (!stored) continue;
      try {
        const file = new File([decode(stored.data)], stored.name, {
          type: stored.type || "application/pdf",
        });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        attached++;
      } catch (error) {
        // Some hosts wrap uploads in a custom widget that rejects this.
      }
    }
    return attached;
  }

  /** Fill everything the model was confident about, leaving the rest alone. */
  /**
   * Documents go first. Attaching a resume makes some sites (Lever, Ashby's
   * dropzone) parse it and re-render the form, which throws away anything
   * already typed and replaces the elements we were holding. So attach, give
   * the parser a moment, then re-find the fields by label and fill those.
   */

  /* ------------------------------------------------------ repeated entries */

  /** Entries already on the page for a section: panels, marked boxes, or ids. */
  function countEntries(kind, prefix, root) {
    const cards = root && !prefix ? root.querySelectorAll(CARD).length : 0;
    if (cards) return cards;
    // One entry can carry both a panel label and ids; count one or the other.
    const panels = prefix ? document.querySelectorAll(
      `[role="group"][aria-labelledby^="${CSS.escape(prefix)}"][aria-labelledby$="-panel"]`).length : 0;
    return panels || Math.max(0, ...kind.stems.map((stem) => entryNumbers(stem).length));
  }

  const addButtonIn = (root) => [...root.querySelectorAll("button")].find((b) =>
    b.getAttribute("data-automation-id") === "add-button" ||
    /^add\b/i.test(b.getAttribute("aria-label") || b.textContent.trim()));
  const MAX_ENTRIES = 4;

  /** Sections with an Add button, and how many panels each should hold. */
  async function entryPlan() {
    // A section is a labelled group ("Work-Experience-section") or, failing
    // that, wherever a button says "Add Work Experience" / "Add Another …".
    const found = [];
    for (const group of document.querySelectorAll('[role="group"][aria-labelledby$="-section"]')) {
      if (!nodeVisible(group)) continue;
      const id = group.getAttribute("aria-labelledby");
      found.push({ root: group, name: `${id} ${document.getElementById(id)?.textContent || ""}`, prefix: id.replace(/section$/, "") });
    }
    for (const button of document.querySelectorAll("button")) {
      const name = button.getAttribute("aria-label") || button.textContent.trim();
      if (!/^add\b/i.test(name) || !nodeVisible(button) || found.some((f) => f.root.contains(button))) continue;
      if (/^add(?: another)?$/i.test(name.trim())) {
        // A bare "Add" says nothing about its section, but a title beside
        // it can: ByteDance's "Work Experience  [Add]".
        const section = titledSection(button);
        if (section && !found.some((f) => f.root === section.root)) found.push({ ...section, prefix: "", button });
        continue;
      }
      found.push({ root: button.parentElement, name, prefix: "", button });
    }
    if (!found.length) return [];
    let profile = {};
    try { ({ profile = {} } = await chrome.storage.local.get("profile")); } catch { return []; }
    state.profileCache = profile;
    const split = splitsInternships();
    const plan = [];
    const taken = new Set();
    for (const { root, name, prefix, button } of found) {
      const kind = ENTRY_SECTIONS.find((k) => k.test.test(name));
      if (!kind || taken.has(kind)) continue;
      taken.add(kind);
      const panels = () => countEntries(kind, prefix, root);
      const want = Math.min(kind.entries(profile, split).length, MAX_ENTRIES);
      if (panels() < want) plan.push({ section: root, add: button, panels, want });
    }
    return plan;
  }

  /** How many entries a fill would add: counted on the button. */
  async function entriesToAdd() {
    return (await entryPlan()).reduce((sum, p) => sum + p.want - p.panels(), 0);
  }

  /** Click Add until each section holds one panel per profile entry. */
  async function addEntries() {
    let added = 0;
    for (const { section, add: first, panels, want } of await entryPlan()) {
      for (let guard = 0; panels() < want && guard < MAX_ENTRIES; guard++) {
        // The button may be relabelled "Add Another" after the first click.
        const add = (first && first.isConnected && first) || addButtonIn(section);
        if (!add) break;
        const before = panels();
        fire(add, "click");
        for (let i = 0; i < 40 && panels() === before; i++) await sleep(50);
        if (panels() === before) break;
        added++;
      }
    }
    return added;
  }

  async function fillPage() {
    // The fill command reaches every frame; one with no form (a reCAPTCHA or
    // proxy iframe) has nothing to do and nothing to report.
    if (!state.known.length && !document.querySelector(FILE_SELECTOR) &&
        !document.querySelector('[role="group"][aria-labelledby$="-section"]')) return;
    if (state.filling) return;
    state.filling = true;
    try {
      const started = performance.now();
      // New entries first: their fields need answers before anything fills.
      if (await addEntries()) {
        await sleep(300);
        const fields = collectFields();
        const answered = await answer(fields);
        if (answered) {
          state.known = answered;
          state.lastSignature = fields.map((f) => f.label).join("|");
        }
      }
      const attached = await attachDocuments();
      await fillFields(started, attached);
      const acknowledged = await acknowledge();
      if (acknowledged) {
        state.lastSummary += `, ${acknowledged} acknowledged`;
        note(state.lastSummary);
      }
      // Newly revealed questions first -- they are the user's to see now --
      // then keep watch for a resume re-parse, over those fields too.
      await fillRevealed();
      if (attached) await refillIfReparsed();
    } finally {
      state.filling = false;
      setTimeout(scan, 300);
    }
  }

  /**
   * Questions that only appear once another is answered: Greenhouse asks
   * "Please identify your race" after "Are you Hispanic/Latino?" is No.
   * They were not on the page when the fill began, so after it, look again;
   * answer and fill whatever is new, a few rounds deep.
   */
  async function fillRevealed() {
    const seen = new Set(state.lastSignature.split("|"));
    for (let round = 0; round < 3; round++) {
      await sleep(250); // let the page reveal what the last answers unlock
      const fields = collectFields();
      const fresh = fields.filter((f) => !seen.has(f.label));
      state.lastSignature = fields.map((f) => f.label).join("|");
      if (!fresh.length) return;
      fresh.forEach((f) => seen.add(f.label));
      const answered = await answer(fresh);
      if (!answered || !answered.length) continue;
      state.known = state.known.concat(answered);
      await fillFields(performance.now(), 0, "then new questions: ",
        new Set(answered.map((k) => k.label)));
    }
  }

  // How long a site may take to parse an attached resume and rebuild the form.
  const REPARSE_WINDOW = 3000;

  /**
   * Some sites (Lever) parse an attached resume and re-render the form,
   * wiping what was filled. This used to be a flat 2.5s wait before filling
   * on every page with an upload -- most of a 3s Ashby fill, where nothing
   * re-renders. Now: fill at once, then watch; refill only if it happened.
   */
  async function refillIfReparsed() {
    const filledNow = state.known.filter((k) => k.result.status === "auto" && isFilled(k));
    if (!filledNow.length) return;
    const deadline = Date.now() + REPARSE_WINDOW;
    while (Date.now() < deadline) {
      await sleep(150);
      const wiped = filledNow.some((k) => !k.element.isConnected || !isFilled(k));
      if (!wiped) continue;
      await sleep(500); // let the re-render finish
      rebind();
      await fillFields(performance.now(), 0, "refilled after the page rebuilt the form: ");
      return;
    }
  }

  // "Still Student?" / "I currently work here" ticked means the entry has no
  // end. Ashby rejects an End Date beside a ticked "Still Student?", so the
  // end date of the same entry is left empty instead of filled.
  const ONGOING = /\b(?:still (?:a )?student|currently (?:work|study|attend|enrolled)|(?:i )?(?:still )?work here|present|ongoing|current(?:ly)? (?:role|position|job))\b/i;
  // The field's own label, after any section prefix: "End Date", "To (Actual
  // or Expected)", "Graduation date".
  const END_DATE = /^(?:end(?:ing)?\b|to\b|until\b|graduation date)/i;
  function dropEndDatesOfOngoing(todo) {
    // From every known box, not just those still to tick: a second pass
    // (after a resume upload rebuilds the form) finds the box already ticked.
    const ongoing = state.known.filter((e) => e.single && ONGOING.test(e.label) &&
      (e.element.checked || (e.result.status === "auto" && /^y/i.test(e.result.value))));
    for (const box of ongoing) {
      const ends = todo.filter((e) => END_DATE.test(e.label.split(": ").pop()));
      // The same entry: the nearest ancestor holding the box and an end date.
      for (let node = box.element.parentElement; node; node = node.parentElement) {
        const mine = ends.filter((e) => node.contains(e.element));
        if (!mine.length) continue;
        for (const e of mine) todo.splice(todo.indexOf(e), 1);
        break;
      }
    }
  }

  async function fillFields(started, attached, prefix = "", only = null) {
    rebind();
    let filled = 0;
    let skipped = 0;
    const count = (ok) => (ok ? filled++ : skipped++);
    const todo = state.known.filter((entry) => {
      if (only && !only.has(entry.label)) return false;
      const due = entry.result.status === "auto" && !isFilled(entry);
      if (!due) skipped++;
      return due;
    });
    dropEndDatesOfOngoing(todo);

    // Nothing waits on anything slower than itself. Instant fields go in
    // one pass, as on Ashby; a Workday search picker waits on its server,
    // and in field order it used to hold up every text box below it.
    const timeline = [];
    // The page may rebuild the form mid-fill too: re-find by label, and never
    // wait on a detached element (every one of its timeouts runs out).
    const live = (entry) => {
      if (!detached(entry)) return entry;
      rebind();
      const fresh = state.known.find((k) => k.label === entry.label);
      if (fresh) Object.assign(entry, { element: fresh.element, buttons: fresh.buttons });
      return entry;
    };
    const timed = async (entry, kind, work) => {
      const t = performance.now();
      live(entry);
      const ok = detached(entry) ? false : await work();
      timeline.push({ field: entry.label, kind, ms: Math.round(performance.now() - t), ok });
      count(ok);
      return ok;
    };
    const isSkills = (entry) => entry.widget === "prompt" && /\bskills?\b/i.test(entry.label);
    const isMenu = (entry) => (entry.widget === "listbox" || entry.widget === "prompt") && !isSkills(entry);
    const isTyped = (entry) =>
      !entry.buttons && !isMenu(entry) && entry.widget !== "date" && entry.element.tagName !== "SELECT" &&
      (isCombobox(entry.element) || looksLikeAutocomplete(entry.element));

    // 1. Choices whose options are already on the page: plain matches are
    //    clicked now, the rest go to Jev together in the background.
    const pending = [];
    for (const entry of todo) {
      if (entry.multi) {
        await timed(entry, "checkboxes", () => setChecks(entry, entry.result.value));
        continue;
      }
      if (entry.single) {
        await timed(entry, "checkbox", async () => {
          const box = entry.buttons[0];
          if (/^y/i.test(entry.result.value) && !box.checked) box.click();
          return true; // "No" is an unticked box: nothing to do
        });
        continue;
      }
      const texts = entry.buttons ? entry.options
        : entry.element.tagName === "SELECT" ? selectChoices(entry.element).map((o) => o.textContent.trim())
        : null;
      if (!texts) continue;
      const decision = chooseAmong(entry.label, entry.result.value, texts);
      if (localMatch(texts, entry.result.value) < 0) { pending.push([entry, decision]); continue; }
      await timed(entry, entry.buttons ? "toggle" : "select", () => entry.buttons
        ? setToggle(entry, entry.result.value, decision)
        : setSelect(entry.element, entry.result.value, decision));
    }
    // 2. Text and dates: no decision, no menu, no waiting.
    for (const entry of todo) {
      if (entry.buttons || entry.element.tagName === "SELECT" || isMenu(entry) || isTyped(entry) || isSkills(entry)) continue;
      if (entry.widget === "date") { await timed(entry, "date", () => setDate(entry.element, entry.result.value)); continue; }
      // Focus and blur around a plain field: Workday, among others, only
      // commits what was typed when the field loses focus.
      await timed(entry, "text", () => {
        entry.element.focus();
        const ok = setValue(entry.element, entry.result.value);
        entry.element.blur();
        return ok;
      });
    }
    // 3. Menus open one at a time. Read each; a plain match is clicked on
    //    the spot, anything else is sent to Jev while the next is read.
    const menus = [];
    for (const entry of todo) {
      if (!isMenu(entry)) continue;
      const want = entry.result.value;
      const t = performance.now();
      if (detached(live(entry))) { skipped++; continue; }
      const texts = entry.widget === "listbox"
        ? await surveyListbox(entry.element, want) : await surveyPrompt(entry.element, want);
      // What the menu showed, for the console table: a failed dropdown is
      // then diagnosable from one paste ("read 0" = it never opened).
      const read = `${texts.length}: ${texts.slice(0, 4).join(" | ")}`.slice(0, 120);
      if (texts.done) {
        timeline.push({ field: entry.label, kind: entry.widget, ms: Math.round(performance.now() - t), ok: true, read });
        filled++;
        continue;
      }
      menus.push({ entry, texts, read, decision: texts.length ? chooseAmong(entry.label, want, texts) : Promise.resolve(-1) });
    }
    // 4. Autocompletes type and wait on suggestions; they go after the rest.
    for (const entry of todo) {
      if (isTyped(entry)) await timed(entry, "typed", () => setValue(entry.element, entry.result.value));
      if (isSkills(entry)) await timed(entry, "skills", () => setMultiPrompt(entry.element, entry.result.value));
    }
    // 5. Click in Jev's decisions as they arrive.
    for (const [entry, decision] of pending) {
      await timed(entry, entry.buttons ? "toggle (jev)" : "select (jev)", () => entry.buttons
        ? setToggle(entry, entry.result.value, decision)
        : setSelect(entry.element, entry.result.value, decision));
    }
    for (const { entry, texts, decision, read } of menus) {
      const before = timeline.length;
      await timed(entry, `${entry.widget} (jev)`, async () => {
        const index = await decision;
        return entry.widget === "listbox"
          ? applyListbox(entry.element, texts, index)
          : applyPrompt(entry.element, entry.result.value, texts, index);
      });
      if (timeline[before]) {
        timeline[before].read = read;
        timeline[before].wanted = String(entry.result.value).slice(0, 40);
        if (!timeline[before].ok) menus.find((m) => m.entry === entry).failed = true;
      }
    }
    // Where the time went, for when a page feels slow.
    if (timeline.length) {
      console.info(`smartpaste: filled in ${Math.round(performance.now() - started)}ms`);
      console.table(timeline);
      reportGaps(menus);
    }
    if (window.__smartpasteTest) window.__smartpasteTest.timeline = timeline;

    const parts = [`${prefix}filled ${filled} in ${((performance.now() - started) / 1000).toFixed(1)}s`];
    if (attached) parts.push(`attached ${attached} file${attached === 1 ? "" : "s"}`);
    if (skipped) parts.push(`left ${skipped} for you`);
    // Name the slow fields right in the note, so a slow page can be
    // diagnosed from a screenshot.
    const slow = timeline.filter((t) => t.ms >= 700).sort((a, b) => b.ms - a.ms).slice(0, 3);
    const why = slow.map((t) => `${t.field.slice(0, 28)} ${(t.ms / 1000).toFixed(1)}s${t.ok ? "" : " ✗"}`);
    const summary = parts.join(", ") + (why.length ? ` · slowest: ${why.join(", ")}` : "");
    // A follow-up round adds to the fill's summary rather than replacing it.
    state.lastSummary = only && state.lastSummary ? `${state.lastSummary} · ${summary}` : summary;
    note(state.lastSummary, false, why.length || only ? 12000 : 4000);
  }

  /**
   * For diagnosing a page from one console paste: questions on it that
   * smartpaste found no field in, with a trimmed copy of their markup, and
   * for each dropdown that failed, what it wanted and every option offered.
   */
  function reportGaps(menus = []) {
    const handled = [...state.known.map((k) => k.element), ...collectFields().map((f) => f.element)];
    const gaps = [];
    for (const box of document.querySelectorAll('[data-automation-id^="formField"], .application-question, fieldset')) {
      if (!nodeVisible(box) || box.querySelector('[data-automation-id^="formField"], input[type="file"]')) continue;
      if (handled.some((el) => box.contains(el) || el.contains(box))) continue;
      const label = clean(box.querySelector("label, legend")?.textContent || "");
      if (!label) continue;
      const html = box.outerHTML.replace(/\s(?:class|style)="[^"]*"/g, "").replace(/\s+/g, " ").slice(0, 700);
      gaps.push({ question: label, markup: html });
    }
    const failed = menus.filter((m) => m.failed).map((m) => ({ field: m.entry.label, wanted: m.entry.result.value, options: m.texts.join(" | ").slice(0, 1500) }));
    if (!gaps.length && !failed.length) return;
    console.groupCollapsed(`smartpaste: ${gaps.length} question(s) not recognised, ${failed.length} dropdown(s) not matched -- paste this when reporting a problem`);
    if (gaps.length) console.table(gaps);
    if (failed.length) console.table(failed);
    console.groupEnd();
  }

  function onKeyDown(event) {
    const isPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
    if (!isPaste || event.altKey) return;

    const field = event.target;
    const answer = answers.get(field);
    // No confident answer: leave the keystroke alone and paste normally --
    // but say so. Otherwise whatever was on the clipboard lands in the box
    // and looks exactly like smartpaste put it there.
    if (!answer || !answer.value) {
      if (asked.has(field)) hint(field, "no answer in your profile — normal paste");
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // A repeat press cycles to the next most likely snippet, which is how a
    // low-confidence answer gets corrected without any menu.
    const options = answer.alternatives.length
      ? answer.alternatives
      : [{ value: answer.value, p: answer.confidence }];
    const index = field.value === options[cycle.get(field) ?? 0]?.value
      ? ((cycle.get(field) ?? 0) + 1) % options.length
      : cycle.get(field) ?? 0;
    cycle.set(field, index);

    const option = options[index];
    setValue(field, option.value);
    flash(field, option.p, options.length > 1 ? `${index + 1}/${options.length}` : "");
  }

  /* ----------------------------------------------------------------- start */

  /* ---------------------------------------------------------------- button */

  async function countAttachable() {
    const inputs = deepAll(FILE_SELECTOR).filter(
      (el) => !el.disabled && !el.files.length
    );
    if (!inputs.length) return 0;
    const { documents = {} } = await chrome.storage.local.get("documents");
    return planAttachments(inputs, documents).size;
  }

  async function showButton(count) {
    ourPill()?.remove();
    const files = await countAttachable();
    const entries = await entriesToAdd();
    // Nothing answered, nothing to attach, nothing to add: no button at all.
    if (!count && !files && !entries) return;
    const root = pillRoot();
    // Two frames with forms would stack two pills in the same corner. The
    // one that found more to do wins; the other stays quiet.
    const theirs = [...root.querySelectorAll(".smartpaste-button")]
      .find((b) => b.dataset.smartpasteFrame !== FRAME_TAG);
    if (theirs && Number(theirs.dataset.smartpasteCount || 0) >= count + files + entries) return;
    theirs?.remove();
    const button = document.createElement("button");
    button.className = "smartpaste-button";
    button.textContent =
      `Autofill ${count} field${count === 1 ? "" : "s"}` +
      (files ? ` + ${files} file${files === 1 ? "" : "s"}` : "") +
      (entries ? ` + ${entries} entr${entries === 1 ? "y" : "ies"}` : "");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      fillPage();
    });
    button.dataset.smartpasteFrame = FRAME_TAG;
    button.dataset.smartpasteCount = String(count + files + entries);
    root.body.appendChild(button);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "fill-page") fillPage();
  });

  // After the page's load event: long enough for a server-rendered React app
  // to take the page over ("hydrate").
  const SETTLE_MS = 300;

  function start() {
    document.addEventListener("keydown", onKeyDown, true);
    // A pill this frame left in the top document would outlive the frame:
    // iCIMS navigates its iframe at every step of an application.
    addEventListener("pagehide", () => ourPill()?.remove());
    try {
      chrome.storage.local.get("profile").then(({ profile = {} } = {}) => { state.profileCache = profile; }, () => {});
    } catch { /* not in the extension */ }
    // Touch nothing until the page's own app has taken over. On Greenhouse,
    // scanning at DOMContentLoaded put our marks and button into the page
    // before React hydrated it: React hit a mismatch (error #418), threw the
    // form away and rebuilt it, and a click that came that early reached no
    // handler and filled nothing.
    const begin = () => {
      let debounce;
      new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = setTimeout(scan, 600);
      }).observe(document.documentElement, { childList: true, subtree: true });
      scan();
    };
    if (document.readyState === "complete") setTimeout(begin, SETTLE_MS);
    else addEventListener("load", () => setTimeout(begin, SETTLE_MS), { once: true });
  }

  // Tests (extension/test/content.test.mjs) reach the pure helpers here.
  // The flag is only ever set by the test stub, never by a real page.
  if (window.__smartpasteTest) {
    Object.assign(window.__smartpasteTest, { dateParts, formatForField, localMatch, looksLikeApplication, looksLikeAutocomplete, collectFields, normalize, setPrompt, acknowledgements });
  }

  // The manifest runs this at document_idle, but an injected or early copy can
  // land before <html> exists, and observe() throws on a null root.
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
