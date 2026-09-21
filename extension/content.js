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

(() => {
  const FILE_SELECTOR = 'input[type="file"]';
  // React Select renders a text input with role=combobox plus a second, empty
  // input for form submission. Only the first is a field; the second is noise.
  const COMBO_SELECTOR = 'input[role="combobox"], input.select__input';
  const SELECT_SHELL = '[class*="select__control"], [class*="select-shell"]';
  const JUNK_LABELS = /^(?:select\.{0,3}|choose\.{0,3}|please select|search|--)$/i;
  // Yes/No rendered as buttons over a hidden checkbox, as Ashby does it.
  const TOGGLE_SELECTOR =
    'button[aria-pressed], button[role="radio"], [role="radio"], [data-option]';
  const FIELD_ENTRY =
    '[class*="fieldEntry"], [class*="field-entry"], [class*="formField"], ' +
    '[data-automation-id^="formField"], .application-question, fieldset';
  // Workday builds its forms from widgets rather than form controls: a
  // dropdown is a <button> that opens a listbox, a searchable picker is a text
  // input that only takes a value by choosing from its results, and a date is
  // split into month / day / year boxes.
  const LISTBOX_BUTTON = 'button[aria-haspopup="listbox"]';
  const PROMPT_INPUT =
    'input[data-uxi-widget-type="selectinput"], ' +
    '[data-automation-id="multiSelectContainer"] input[type="text"]';
  const DATE_WRAPPER = '[data-automation-id="dateInputWrapper"]';
  // Workday marks date boxes either way: dateSectionMonth-input, or just an
  // aria-label of Month / Day / Year (its My Experience step).
  const DATE_PART = '[data-automation-id^="dateSection"], input[aria-label="Month"], ' +
    'input[aria-label="Day"], input[aria-label="Year"]';
  const dateWrappers = new WeakSet();
  const EMPTY_BUTTON = /^(?:select one|select|choose one|choose|--)?$/i;
  const OPTION = '[role="option"], [data-automation-id*="promptOption"]';
  // A Workday result row: a radio circle plus a promptOption label. The row
  // takes the click; the label inside it does not.
  const PROMPT_LEAF = '[data-automation-id="promptLeafNode"]';
  // Where a question keeps its text when the input has no label of its own.
  // Lever wraps inputs in a <label> that also holds status text ("No location
  // found. Try entering…"), and its custom questions have no label at all.
  const QUESTION_BOX = '.application-question, [role="radiogroup"], fieldset';
  const QUESTION_TEXT = '.application-label, legend, [class*="question-label"]';
  const FIELD_SELECTOR =
    'input:not([type]), input[type="text"], input[type="email"], ' +
    'input[type="tel"], input[type="url"], input[type="search"], ' +
    'input[type="date"], textarea, select';
  const MIN_FIELDS = 2;
  const answers = new WeakMap(); // field element -> resolved answer
  const asked = new WeakSet(); // fields sent to Jev, answered or not
  const cycle = new WeakMap(); // field element -> index into alternatives
  let known = []; // [{element, result}] for the autofill button
  let scanning = false;
  let lastSignature = "";

  /* ---------------------------------------------------------------- labels */

  function questionText(field) {
    const box = field.closest(QUESTION_BOX);
    return box ? box.querySelector(QUESTION_TEXT) : null;
  }

  function labelFor(field) {
    const byFor =
      field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    const candidates = [
      byFor,
      questionText(field),
      field.closest("label"),
      field.getAttribute("aria-label"),
      field.getAttribute("aria-labelledby") &&
        document.getElementById(field.getAttribute("aria-labelledby")),
      field.labels && field.labels[0],
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const text = clean(
        typeof candidate === "string" ? candidate : candidate.textContent
      );
      if (text) return text;
    }
    // Greenhouse and friends often put the label in a preceding sibling. Stop
    // at the first form control: anything before it is that control's label,
    // not ours, and walking past it silently steals the neighbour's name.
    let node = field.previousElementSibling;
    for (let hops = 0; node && hops < 3; hops++, node = node.previousElementSibling) {
      if (node.matches("input, textarea, select, button")) break;
      if (node.matches("label[for]") && node.getAttribute("for") !== field.id) break;
      const text = clean(node.textContent);
      if (text) return text;
    }
    return clean(field.placeholder) || clean(field.name) || "";
  }

  function clean(text) {
    if (!text) return "";
    return text
      .replace(/\s+/g, " ")
      // "*", and Lever's heavy asterisk "✱"
      .replace(/\s*(?:[*\u2731\u2217]+|\(required\)|\(optional\)|required|optional)\s*$/i, "")
      .replace(/[:*]\s*$/, "")
      .trim()
      .slice(0, 200);
  }

  function isCombobox(field) {
    return field.matches(COMBO_SELECTOR);
  }

  function visible(field) {
    if (field.disabled || field.readOnly) return false;
    // The hidden twin inside a React Select is not a field of its own; it
    // otherwise gets picked up and labelled from the "Select..." placeholder.
    if (field.closest(SELECT_SHELL) && !isCombobox(field)) return false;
    const rect = field.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** A dropdown carries its own answer set, so send it along with the label. */
  function selectOptions(element) {
    if (element.tagName !== "SELECT") return null;
    // Each wording once, for the same reason as askChoice().
    return [...new Set([...element.options]
      .map((o) => o.textContent.trim())
      .filter((t) => t && !/^(?:select|choose|please select|--)/i.test(t)))]
      .slice(0, 60);
  }

  function nodeVisible(node) {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Choice fields built from buttons rather than form controls.
   *
   * Ashby renders yes/no as two <button aria-pressed> over a hidden checkbox.
   * The checkbox is invisible so it is skipped, and the buttons are not form
   * controls, so without this the question is simply never seen.
   */
  function collectToggleGroups() {
    const groups = new Map();
    for (const button of document.querySelectorAll(TOGGLE_SELECTOR)) {
      if (!nodeVisible(button)) continue;
      const wrap = button.closest(FIELD_ENTRY);
      if (!wrap) continue;
      if (!groups.has(wrap)) groups.set(wrap, []);
      groups.get(wrap).push(button);
    }
    const fields = [];
    for (const [wrap, buttons] of groups) {
      // One label and a handful of buttons means one question; more than that
      // and we have walked up into a container holding several fields.
      if (buttons.length < 2 || buttons.length > 8) continue;
      if (wrap.querySelectorAll("label, legend").length !== 1) continue;
      const label = clean(wrap.querySelector("label, legend").textContent);
      const options = buttons.map((b) => b.textContent.trim()).filter(Boolean);
      if (label.length < 2 || options.length !== buttons.length) continue;
      fields.push({ element: wrap, label, options, buttons, combobox: false });
    }
    return fields;
  }

  function toggleAnswered(field) {
    return field.buttons.some(
      (b) =>
        b.checked ||
        b.getAttribute("aria-pressed") === "true" ||
        b.getAttribute("aria-checked") === "true"
    );
  }

  /**
   * Native radio buttons, grouped by name. Lever asks its sponsorship question
   * this way, and a radio is neither a text field nor a toggle button, so the
   * question was simply never collected.
   */
  function collectRadioGroups() {
    const groups = new Map();
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      if (!radio.name || radio.disabled) continue;
      if (!groups.has(radio.name)) groups.set(radio.name, []);
      groups.get(radio.name).push(radio);
    }
    const fields = [];
    for (const radios of groups.values()) {
      if (radios.length < 2 || radios.length > 12) continue;
      const first = radios[0];
      const label = clean(
        questionText(first)?.textContent ||
          first.closest("fieldset")?.querySelector("legend")?.textContent ||
          ""
      );
      const options = radios.map((r) =>
        clean(
          r.closest("label")?.textContent ||
            (r.id && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent) ||
            r.value || ""
        )
      );
      if (label.length < 2 || options.some((o) => !o)) continue;
      const element = first.closest(QUESTION_BOX) || first.parentElement;
      if (!nodeVisible(element)) continue;
      fields.push({ element, label, options, buttons: radios, combobox: false });
    }
    return fields;
  }

  /**
   * Which entry of a repeated section a field sits in. Workday asks "Job
   * Title" once per "Work Experience 1", "Work Experience 2"...; without the
   * panel's heading every one of them reads as the same question.
   */
  function sectionPrefix(element) {
    const group = element.closest('[role="group"][aria-labelledby]');
    const heading = group && document.getElementById(group.getAttribute("aria-labelledby"));
    const text = heading ? clean(heading.textContent) : "";
    return /\d/.test(text) && text.length < 60 ? `${text}: ` : "";
  }

  /** A listbox button's question. Its aria-label also holds its current value. */
  function listboxLabel(button) {
    const byFor =
      button.id && document.querySelector(`label[for="${CSS.escape(button.id)}"]`);
    const entry = button.closest(FIELD_ENTRY);
    const inEntry = entry && entry.querySelectorAll("label, legend").length === 1
      ? entry.querySelector("label, legend") : null;
    const text = clean((byFor || inEntry)?.textContent || "");
    if (text) return text;
    return clean(
      (button.getAttribute("aria-label") || "")
        .replace(button.textContent.trim(), "")
        .replace(/\b(?:select one|required)\b/gi, "")
    );
  }

  /** A date split into boxes is one question, labelled by its form field. */
  function dateLabel(wrapper) {
    const part = wrapper.querySelector(DATE_PART);
    const byFor = part && part.id && document.querySelector(`label[for="${CSS.escape(part.id)}"]`);
    const entry = wrapper.closest(FIELD_ENTRY);
    return clean((byFor || entry?.querySelector("label, legend"))?.textContent || "");
  }

  function collectWidgets() {
    const fields = [];
    for (const button of document.querySelectorAll(LISTBOX_BUTTON)) {
      if (!nodeVisible(button) || button.disabled || button.closest(".smartpaste-button")) continue;
      fields.push({ element: button, label: listboxLabel(button), options: null, combobox: false, widget: "listbox" });
    }
    const wrappers = new Set();
    for (const part of document.querySelectorAll(DATE_PART)) {
      const wrapper = part.closest(DATE_WRAPPER) || part.closest('[data-automation-id^="formField"]') || part.parentElement;
      if (wrapper && nodeVisible(wrapper)) wrappers.add(wrapper);
    }
    for (const wrapper of wrappers) {
      dateWrappers.add(wrapper);
      fields.push({ element: wrapper, label: dateLabel(wrapper), options: null, combobox: false, widget: "date" });
    }
    return fields;
  }

  /**
   * "Check all that apply": native checkboxes sharing a name, under one
   * question (Lever's language and office questions). Several may be right,
   * so the answer is a list of options, not one.
   */
  function collectCheckboxGroups() {
    const groups = new Map();
    for (const box of document.querySelectorAll('input[type="checkbox"]')) {
      if (!box.name || box.disabled) continue;
      if (!groups.has(box.name)) groups.set(box.name, []);
      groups.get(box.name).push(box);
    }
    const fields = [];
    for (const boxes of groups.values()) {
      if (boxes.length < 2 || boxes.length > 60) continue;
      const first = boxes[0];
      const label = clean(
        questionText(first)?.textContent ||
          first.closest("fieldset")?.querySelector("legend")?.textContent || ""
      );
      const options = boxes.map((b) =>
        clean(
          b.closest("label")?.textContent ||
            (b.id && document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.textContent) ||
            b.value || ""
        )
      );
      if (label.length < 2 || options.some((o) => !o)) continue;
      const element = first.closest(QUESTION_BOX) || first.parentElement;
      if (!nodeVisible(element)) continue;
      fields.push({ element, label, options, buttons: boxes, combobox: false, multi: true });
    }
    return fields;
  }

  // A lone checkbox is a yes/no question -- "I currently work here" -- unless
  // it is a consent. Those are the applicant's to tick, never ours.
  const CONSENT = /agree|consent|terms|privacy|acknowledg|certif|attest|marketing|newsletter|subscribe|remember me|sms|text messages?|contact me/i;

  function collectSingleCheckboxes() {
    const byName = new Map();
    for (const box of document.querySelectorAll('input[type="checkbox"]')) {
      const key = box.name || box.id || box;
      byName.set(key, (byName.get(key) || 0) + 1);
    }
    const fields = [];
    for (const box of document.querySelectorAll('input[type="checkbox"]')) {
      if (box.disabled || byName.get(box.name || box.id || box) !== 1) continue;
      const label = labelFor(box);
      if (label.length < 3 || CONSENT.test(label)) continue;
      const shown = box.closest("label, [data-automation-id^='formField']") || box;
      if (!nodeVisible(shown) && !nodeVisible(box)) continue;
      fields.push({ element: box, label, options: ["Yes", "No"], buttons: [box], combobox: false, single: true });
    }
    return fields;
  }

  /** A write-in ("Other: ___") inside a choice question is not that question. */
  function insideChoiceQuestion(element) {
    const box = element.closest(QUESTION_BOX);
    return Boolean(box) && box.querySelectorAll('input[type="checkbox"], input[type="radio"]').length >= 2;
  }

  function collectFields() {
    return [...document.querySelectorAll(FIELD_SELECTOR)]
      .filter((element) => visible(element) && !element.matches(DATE_PART) && !insideChoiceQuestion(element))
      .map((element) => ({
        element,
        label: labelFor(element),
        options: selectOptions(element),
        combobox: isCombobox(element),
        widget: element.matches(PROMPT_INPUT) ? "prompt" : null,
      }))
      .concat(collectWidgets())
      .filter((f) => f.label.length >= 2 && !JUNK_LABELS.test(f.label))
      .concat(collectToggleGroups())
      .concat(collectRadioGroups())
      .concat(collectCheckboxGroups())
      .concat(collectSingleCheckboxes())
      .map((f) => ({ ...f, label: sectionPrefix(f.element) + f.label }));
  }

  /* ----------------------------------------------------------------- fetch */

  /* ------------------------------------------------------ is this a job app? */

  // The script runs on every site, like any autofill tool -- but it only talks
  // to Jev on a page that is plainly a job application. Login, checkout and
  // newsletter forms have fields too, and their labels have no business
  // leaving the machine. This check is local: no network, no model.
  const APPLICATION_TERMS = [
    ["name", /\b(?:first|last|full|legal|preferred|given|family)\s*name\b|^name$/i],
    ["email", /\be-?mail\b/i],
    ["phone", /\b(?:phone|mobile|telephone|cell)\b/i],
    ["resume", /\b(?:resume|r\u00e9sum\u00e9|cv|curriculum vitae|cover letter)\b/i],
    ["links", /\b(?:linkedin|github|portfolio|personal website)\b/i],
    ["authorization", /\b(?:authori[sz]ed to work|work authori[sz]ation|sponsorship|visa|right to work|legally (?:eligible|authori[sz]ed))\b/i],
    ["eeo", /\b(?:veteran|disability|gender|race|ethnicity|hispanic|latino|pronouns)\b/i],
    ["education", /\b(?:graduat\w*|degree|school|university|college|gpa|major|discipline)\b/i],
    ["logistics", /\b(?:salary|compensation|start date|notice period|relocat\w*|how did you hear|referr\w*|years of experience)\b/i],
    ["employment", /\b(?:current (?:company|employer|title)|employer|job title|most recent)\b/i],
  ];
  const IDENTITY = new Set(["name", "email", "phone"]);
  const APPLY_PAGE = /\b(?:apply|application|careers?|jobs?|position|opening|recruit\w*|talent)\b/i;

  function looksLikeApplication(fields) {
    // A resume upload settles it.
    const uploads = [...document.querySelectorAll(FILE_SELECTOR)].filter(nodeVisible);
    if (uploads.some((input) => documentFor(fileHintTiers(input).join(" ")) === "resume")) return true;
    const kinds = new Set();
    for (const { label } of fields) {
      for (const [kind, pattern] of APPLICATION_TERMS) if (pattern.test(label)) kinds.add(kind);
    }
    // Name, email and phone alone are a contact form, not an application.
    const beyondIdentity = [...kinds].filter((k) => !IDENTITY.has(k)).length;
    if (!beyondIdentity) return false;
    const onApplyPage = APPLY_PAGE.test(location.href) || APPLY_PAGE.test(document.title);
    return kinds.size >= (onApplyPage ? 3 : 4);
  }

  function forget() {
    known = [];
    lastSignature = "";
    document.querySelector(".smartpaste-button")?.remove();
  }

  let filling = false;
  let lastSummary = "";

  const detached = (entry) =>
    !entry.element.isConnected || (entry.buttons || []).some((b) => !b.isConnected);

  /**
   * Swap in the page's current elements for any the page has thrown away.
   * React discards and rebuilds a form when hydration fails (Figma, with
   * Grammarly installed); holding the old nodes, a fill spent ~6s per
   * dropdown on elements no longer on the page. Answers are keyed by label,
   * so rebinding needs no new Jev call.
   */
  function rebind() {
    if (!known.some(detached)) return false;
    const byLabel = new Map(known.map((k) => [k.label, k.result]));
    known = collectFields()
      .filter((f) => byLabel.has(f.label))
      .map((f) => ({ ...f, result: byLabel.get(f.label) }));
    for (const k of known) answers.set(k.element, k.result);
    return true;
  }

  async function scan() {
    // A fill opens menus and types into search boxes; scanning that churn
    // would re-ask Jev about a half-open page.
    if (scanning || filling) return;
    const fields = collectFields();
    // Workday's My Experience starts as empty sections with Add buttons: few
    // or no fields, but a whole resume's worth of entries to add.
    const entries = fields.length < MIN_FIELDS || !looksLikeApplication(fields) ? await entriesToAdd() : 0;
    if ((fields.length < MIN_FIELDS || !looksLikeApplication(fields)) && !entries) {
      if (known.length) forget();
      return;
    }
    const signature = fields.map((f) => f.label).join("|") + (entries ? `|+${entries}` : "");
    if (signature === lastSignature) {
      // Same questions, maybe new elements: keep hold of the live ones.
      if (rebind()) fields.forEach((f) => asked.add(f.element));
      return;
    }

    scanning = true;
    lastSignature = signature;
    try {
      const answered = fields.length ? await answer(fields) : [];
      if (!answered) return;
      known = answered;
      showButton(known.length);
    } catch (error) {
      // An extension reload orphans this script; staying quiet is correct.
    } finally {
      scanning = false;
    }
  }

  /** Ask for answers to `fields`; returns those with one, or null on error. */
  async function answer(fields) {
    const reply = await chrome.runtime.sendMessage({
      type: "answer-fields",
      fields: fields.map((f) => ({ label: f.label, options: f.options, multi: Boolean(f.multi) })),
      // Which employer "have you worked for us?" means.
      // ...and which company and role {company} / {role} mean.
      page: { url: location.href, title: document.title,
        heading: document.querySelector("h1, h2")?.textContent.replace(/\s+/g, " ").trim().slice(0, 120) || "" },
    });
    if (!reply || !reply.ok) {
      if (reply && reply.error) note(reply.error, true);
      return null;
    }
    fields.forEach((f) => asked.add(f.element));
    reply.results.forEach((result, i) => {
      if (result.status !== "none") {
        answers.set(fields[i].element, result);
        mark(fields[i].element, result);
      }
    });
    return fields
      .map((f, i) => ({ ...f, result: reply.results[i] }))
      .filter((f) => f.result && f.result.status !== "none");
  }

  /* --------------------------------------------------------------- pasting */

  /**
   * React tracks its own value on the DOM node, so assigning `.value` leaves
   * the component's state stale and the field reverts on blur. Going through
   * the native setter and dispatching an input event is what React listens for.
   */
  /** Click the button in a toggle group that expresses `want`. */
  async function setToggle(entry, want, decided) {
    const index = await (decided ?? chooseAmong(entry.label, want, entry.options));
    if (index < 0 || !entry.buttons[index]) return false;
    entry.buttons[index].click();
    await sleep(150);
    return toggleAnswered(entry);
  }

  /** Tick every box in `wants` that is not ticked already. */
  async function setChecks(entry, wants) {
    let ticked = 0;
    for (const want of wants) {
      const i = entry.options.findIndex((o) => normalize(o) === normalize(want));
      const box = entry.buttons[i];
      if (!box) continue;
      if (!box.checked) box.click();
      if (box.checked) ticked++;
    }
    await sleep(50);
    return ticked > 0;
  }

  /**
   * Type the way a keyboard does, one character at a time with a real keyCode.
   *
   * Some autocompletes ignore a synthetic "input" event and key off keydown's
   * keyCode, which a constructed KeyboardEvent leaves at 0. Lever's location
   * field showed no suggestions for nativeSet + input, and did for this.
   */
  async function typeLikeAPerson(field, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const key = (type, ch) => {
      const event = new KeyboardEvent(type, { key: ch, bubbles: true, cancelable: true });
      const code = ch.toUpperCase().charCodeAt(0);
      Object.defineProperty(event, "keyCode", { get: () => code });
      Object.defineProperty(event, "which", { get: () => code });
      field.dispatchEvent(event);
    };
    field.focus();
    setter.call(field, "");
    for (const ch of text) {
      key("keydown", ch);
      key("keypress", ch);
      setter.call(field, field.value + ch);
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      key("keyup", ch);
      await sleep(8);
    }
  }

  // A name hint is only for autocompletes that do not say so (Lever's
  // "Current location"). "Address", "City", "Postal code" are plain boxes on
  // Workday -- guessing otherwise waited 3s on each for suggestions.
  const AUTOCOMPLETE_HINT = /location|hometown/i;
  const SUGGESTION_BOX =
    '[role="listbox"], [class*="dropdown-results"], [class*="suggest"], ' +
    '[class*="autocomplete"], [class*="typeahead"], [class*="pac-container"]';
  const NOT_A_SUGGESTION = /^(?:no .* found|no items|loading|searching)/i;

  function looksLikeAutocomplete(field) {
    if (field.getAttribute("aria-autocomplete") || field.getAttribute("list")) return true;
    // "Email Address" is not a place, and waiting on it for suggestions that
    // never come cost three seconds a form.
    if (field.type === "email" || /e-?mail/i.test(labelFor(field))) return false;
    // Label and name only: ids and classes carry section names
    // ("addressSection_postalCode") that say nothing about the widget.
    const hints = [field.name, labelFor(field)].join(" ");
    return AUTOCOMPLETE_HINT.test(hints);
  }

  /** Suggestions that appeared just below the field, in reading order. */
  function suggestionsNear(field) {
    const box = field.getBoundingClientRect();
    const items = [];
    for (const list of document.querySelectorAll(SUGGESTION_BOX)) {
      const rect = list.getBoundingClientRect();
      if (!rect.height || rect.top < box.top - 4 || rect.top > box.bottom + 400) continue;
      const leaves = [...list.querySelectorAll('[role="option"], li, div')].filter(
        (n) => !n.querySelector("li, div, [role='option']") && n.textContent.trim()
      );
      for (const leaf of leaves.length ? leaves : [list]) {
        const text = leaf.textContent.trim();
        if (!NOT_A_SUGGESTION.test(text)) items.push({ node: leaf, text });
      }
    }
    return items;
  }

  /**
   * A plain-text autocomplete: typed text alone is not an answer. Lever keeps
   * the real value in a hidden selectedLocation that is only set by clicking
   * a suggestion, so a field that merely looks filled is submitted empty.
   */
  async function setAutocomplete(field, value) {
    await typeLikeAPerson(field, value);
    let items = [];
    for (let i = 0; i < 12 && !items.length; i++) {
      await sleep(100);
      items = suggestionsNear(field);
    }
    if (!items.length) return Boolean(field.value);
    const want = normalize(value);
    const pick =
      items.find((i) => normalize(i.text) === want) ||
      items.find((i) => normalize(i.text).startsWith(want)) ||
      items[0];
    fire(pick.node, "mousedown");
    fire(pick.node, "mouseup");
    fire(pick.node, "click");
    await sleep(200);
    return true;
  }

  /**
   * A native <select>. Usually the background already chose among its own
   * options, so the value matches exactly. When it does not -- a profile GPA
   * of "3.9/4.00" against options "4.0 / 3.9 / 3.8" -- ask which option
   * expresses it rather than giving up.
   */
  function selectChoices(field) {
    return [...field.options].filter(
      (o) => o.value !== "" && !/^(?:select|choose|please select|--)/i.test(o.textContent.trim())
    );
  }

  async function setSelect(field, value, decided) {
    const options = selectChoices(field);
    const texts = options.map((o) => o.textContent.trim());
    const index = await (decided ?? chooseAmong(labelFor(field), value, texts));
    if (index < 0) return false;
    field.value = options[index].value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setValue(field, value) {
    if (field.matches(LISTBOX_BUTTON)) return setListbox(field, value); // async
    if (dateWrappers.has(field)) return setDate(field, value); // async
    if (field.matches(PROMPT_INPUT)) {
      return /\bskills?\b/i.test(labelFor(field)) ? setMultiPrompt(field, value) : setPrompt(field, value); // async
    }
    if (field.tagName === "INPUT" && !isCombobox(field) && looksLikeAutocomplete(field)) {
      return setAutocomplete(field, value); // async
    }
    if (isCombobox(field)) return setCombobox(field, value); // async
    if (field.tagName === "SELECT") return setSelect(field, value); // async
    value = formatForField(field, value);
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /* ------------------------------------------------------------- comboboxes */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fire = (node, type) =>
    node.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
  const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

  function nativeSet(field, value) {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Read a combobox's menu, scoped by aria-controls.
   *
   * Scoping matters: a bare [role=option] query sweeps up every open menu on
   * the page, and a phone widget's 244 countries will happily swamp a Yes/No.
   * Options can also load asynchronously -- a school list arrives well after
   * the menu opens -- so this polls rather than sleeping once.
   */
  /**
   * A combobox's menu: by aria-controls, or else React Select's sibling
   * menu. Figma's location box has no aria-controls at all, so looking only
   * there never saw its menu and sat out every timeout.
   */
  function menuFor(field) {
    const id = field.getAttribute("aria-controls");
    return (id && document.getElementById(id)) ||
      selectRoot(field)?.querySelector('[class*="select__menu"]') || null;
  }

  /** The whole React Select: control, menu and notices all live under it. */
  function selectRoot(field) {
    return field.closest('[class*="select-shell"], [class*="select__container"]') ||
      field.closest(SELECT_SHELL)?.parentElement || null;
  }

  // Opening a menu shows it at once, even if its options are still loading
  // (a school list). Nothing at all after this long means it will not open
  // until typed into.
  const OPENS_WITHIN = 300;

  async function menuOptions(field, timeout = 2500, { opening = false } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const menu = menuFor(field);
      const nodes = menu ? [...menu.querySelectorAll('[role="option"]')] : [];
      if (nodes.length) return nodes;
      // An open menu saying "No options" is an answer, not a slow load.
      const notice = menuNotice(field);
      if (notice && !/loading|searching/i.test(notice)) return [];
      // Opened and still empty with no "Loading" notice: it lists nothing
      // until typed into (Greenhouse's location box shows a bare empty list).
      if (opening && Date.now() - started > OPENS_WITHIN) return [];
      await sleep(25);
    }
    return [];
  }

  function menuNotice(field) {
    // Under the whole select: on Greenhouse the menu is not a sibling of the
    // control, so looking beside it missed "No options" and sat out 1.5s.
    const root = selectRoot(field);
    const notice = root && root.querySelector('[class*="menu-notice"]');
    return notice && nodeVisible(notice) ? notice.textContent.trim() : "";
  }

  /** "Start typing..." -- a menu with nothing in it until you type. */
  const TYPE_FIRST = /start typing|type to search|begin typing|search for/i;
  function needsTyping(field) {
    const shown = field.closest(SELECT_SHELL)?.querySelector('[class*="placeholder"]')?.textContent || "";
    return TYPE_FIRST.test(`${field.placeholder || ""} ${shown}`);
  }

  function isReactSelect(field) {
    return (
      field.classList.contains("select__input") ||
      Boolean(field.closest(SELECT_SHELL))
    );
  }

  function currentValue(field) {
    const shown = field
      .closest(SELECT_SHELL)
      ?.querySelector('[class*="single-value"], [class*="multi-value__label"]');
    return shown ? shown.textContent.trim() : "";
  }

  // A Choice takes 255 options; a long menu still fits with room to spare.
  const MAX_MENU = 150;
  // Below this the whole menu is on screen and typing can only do harm.
  const LONG_MENU = 40;

  /** The most distinctive word in a value, for narrowing a long menu. */
  function narrowingToken(want) {
    const words = want.match(/[A-Za-z]{4,}/g) || [];
    const skip = /^(the|and|for|university|college|school|degree|bachelor|master)$/i;
    return (
      words.find((w) => !skip.test(w)) || words[0] || want.slice(0, 12)
    );
  }

  /**
   * Pick `want` out of a combobox.
   *
   * Do not type the value in. A menu's wording is its own: an expected
   * graduation of "May 2027" has to become "Spring 2027", and typing the
   * literal value filters that menu to nothing, destroying the very list the
   * decision needs. So the menu is opened and read whole, an exact match wins
   * if there is one, and otherwise Jev chooses among what is actually there.
   *
   * Typing is only a fallback, and only for a menu long enough to be paged --
   * a school list opens on "Aalborg University" and will never show Wisconsin
   * on its own. Then one distinctive word narrows it, never the whole value.
   */
  async function setCombobox(field, want) {
    field.focus();
    fire(field, "mousedown");
    fire(field, "mouseup");
    fire(field, "click");

    // A type-first menu is empty when opened: waiting on it only costs time.
    let nodes = needsTyping(field) ? [] : await menuOptions(field, 1500, { opening: true });
    let texts = nodes.map((n) => n.textContent.trim());
    const exact = () => texts.findIndex((t) => normalize(t) === normalize(want));

    // An autocomplete has nothing to show until you type -- that is what a
    // "Start typing..." placeholder means. Opening it yields an empty menu,
    // so here typing is the only way to get any options at all.
    if (!nodes.length) {
      for (const probe of [want, narrowingToken(want)]) {
        nativeSet(field, probe);
        nodes = await menuOptions(field, 3000);
        if (nodes.length) break;
      }
      texts = nodes.map((n) => n.textContent.trim());
    }

    if (exact() < 0 && texts.length >= LONG_MENU) {
      nativeSet(field, narrowingToken(want));
      const narrowed = await menuOptions(field, 3000);
      if (narrowed.length) {
        nodes = narrowed;
        texts = nodes.map((n) => n.textContent.trim());
      } else {
        // The narrowing matched nothing; restore the full menu.
        nativeSet(field, "");
        nodes = await menuOptions(field);
        texts = nodes.map((n) => n.textContent.trim());
      }
    }
    if (!nodes.length) {
      // A plain autocomplete keeps what you typed, so leaving it is a real
      // answer. A React Select discards it on blur, so leaving it would only
      // look filled -- clear it and report the field as still needing you.
      if (isReactSelect(field)) {
        nativeSet(field, "");
        field.blur();
        return false;
      }
      nativeSet(field, want);
      return Boolean(field.value);
    }

    let index = exact();
    if (index < 0 && texts.length === 1) index = 0;
    if (index < 0) index = await askChoice(labelFor(field), want, texts.slice(0, MAX_MENU));
    if (index < 0 || !nodes[index]) {
      field.blur();
      return false;
    }

    // Jev takes a few hundred ms, and a menu can re-render its options in
    // the meantime (Figma's location results render twice). A click on the
    // replaced node reaches nothing, so click the option showing now.
    let target = nodes[index];
    if (!target.isConnected) {
      const want = texts[index];
      target = (await menuOptions(field, 1500)).find((n) => n.textContent.trim() === want);
      if (!target) { field.blur(); return false; }
    }
    fire(target, "mousedown");
    fire(target, "mouseup");
    fire(target, "click");
    for (let i = 0; i < 16 && !currentValue(field); i++) await sleep(25);
    return Boolean(currentValue(field));
  }

  /* ------------------------------------------------------- workday widgets */

  const frames = (n) => new Promise((resolve) => {
    const step = () => (--n > 0 ? requestAnimationFrame(step) : resolve());
    requestAnimationFrame(step);
  });

  const optionText = (node) =>
    (node.getAttribute("data-automation-label") || node.textContent).trim();

  function press(field, key, keyCode) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
      Object.defineProperty(event, "keyCode", { get: () => keyCode });
      Object.defineProperty(event, "which", { get: () => keyCode });
      field.dispatchEvent(event);
    }
  }

  /**
   * Options showing in whatever menu just opened for `anchor`. The menu is
   * portalled to the end of <body>, so it is found by position, not nesting:
   * the visible options nearest the thing that opened it.
   */
  function optionsNear(anchor) {
    // Workday marks the open popup data-automation-activepopup="true" and
    // its field aria-expanded="true". Read only that popup: a menu that just
    // closed stays on screen for a moment as it animates out, and reading
    // by position picked up its options -- State's list when opening Phone
    // Device Type, so "Mobile" was never there to be chosen.
    if (anchor.hasAttribute("aria-expanded")) {
      const popups = [...document.querySelectorAll('[data-automation-activepopup="true"]')].filter(nodeVisible);
      if (popups.length) {
        if (anchor.getAttribute("aria-expanded") !== "true") return [];
        return leafOptions(popups[popups.length - 1]);
      }
    }
    const box = anchor.getBoundingClientRect();
    return leafOptions(document).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > box.top - 500 && rect.top < box.bottom + 700;
    });
  }

  /** Visible options under `root`, innermost only (see optionsNear). */
  function leafOptions(root) {
    return [...root.querySelectorAll(OPTION)].filter((node) => {
      // Options nest on Workday (li[role=option] > div[promptOption]). Keep
      // the innermost, which carries the label; optionTarget() climbs back
      // to the row for the click. Dropping both levels -- as this once did --
      // found no options at all, and every Workday menu timed out.
      if (node.querySelector(OPTION)) return false;
      if (!node.getBoundingClientRect().height) return false;
      return !NOT_A_SUGGESTION.test(optionText(node));
    });
  }

  async function waitForOptions(anchor, timeout = 2500) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const nodes = optionsNear(anchor);
      if (nodes.length) return nodes;
      await sleep(40);
    }
    return [];
  }

  function scroller(node) {
    for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
    }
    return null;
  }

  /**
   * Every option in a menu, including the ones not rendered yet. Workday only
   * draws the rows in view, so a 250-country list shows a dozen until you
   * scroll -- reading it means scrolling it. Stops early on `stopAt`.
   */
  async function readMenu(anchor, stopAt) {
    let nodes = optionsNear(anchor);
    const texts = [];
    // Where each option was seen, so clicking it later is one jump, not a
    // second scroll through the whole list.
    texts.at = new Map();
    let pane = null;
    const add = (list) => list.forEach((n) => {
      const t = optionText(n);
      if (texts.includes(t)) return;
      texts.push(t);
      texts.at.set(t, pane ? pane.scrollTop : 0);
    });
    add(nodes);
    pane = nodes.length && scroller(nodes[0]);
    if (!pane) return texts;
    pane.scrollTop = 0;
    for (let step = 0; step < 80; step++) {
      if (stopAt && texts.some((t) => normalize(t) === normalize(stopAt))) break;
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) break;
      pane.scrollTop += Math.max(40, pane.clientHeight * 0.9);
      pane.dispatchEvent(new Event("scroll"));
      await frames(2); // a virtualized list draws the new rows on the next frame
      add(optionsNear(anchor));
    }
    return texts;
  }

  /** The node for option `text`, scrolling it into existence if need be. */
  async function findOption(anchor, text, seenAt) {
    const here = () => optionsNear(anchor).find((n) => optionText(n) === text);
    if (here()) return here();
    const first = optionsNear(anchor)[0];
    const pane = first && scroller(first);
    if (!pane) return null;
    if (seenAt !== undefined) {
      pane.scrollTop = seenAt;
      pane.dispatchEvent(new Event("scroll"));
      for (let i = 0; i < 5; i++) { await sleep(40); if (here()) return here(); }
    }
    pane.scrollTop = 0;
    for (let step = 0; step < 80; step++) {
      pane.dispatchEvent(new Event("scroll"));
      await sleep(50);
      if (here()) return here();
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) break;
      pane.scrollTop += Math.max(40, pane.clientHeight * 0.8);
    }
    return null;
  }

  /**
   * Which of `texts` is `want`: exact first, then Jev. A long list is cut to
   * the options sharing a word with the answer, since "United States" has to
   * find "United States of America" in 250 countries and a Choice takes 255.
   */
  /**
   * An option that is plainly the answer, with no model needed: the same
   * text, or the only option that starts with the answer as whole words
   * ("Other" -> "Other Source", but not "Job Board Other"; "Yes" -> "Yes,
   * I am authorized"). Simplify's Workday rules use the same two tiers.
   */
  function localMatch(texts, want) {
    const exact = texts.findIndex((t) => normalize(t) === normalize(want));
    if (exact >= 0) return exact;
    const head = want.trim().toLowerCase();
    if (head.length < 2) return -1;
    const starts = texts
      .map((t, i) => [t.trim().toLowerCase(), i])
      .filter(([t]) => t.startsWith(head) && /^[^a-z0-9]/.test(t.slice(head.length)));
    return starts.length === 1 ? starts[0][1] : -1;
  }

  async function chooseAmong(label, want, texts) {
    const local = localMatch(texts, want);
    if (local >= 0) return local;
    let pool = texts.map((t, i) => i);
    if (pool.length > MAX_MENU) {
      const words = (want.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
      const shared = pool.filter((i) => words.some((w) => texts[i].toLowerCase().includes(w)));
      pool = (shared.length ? shared : pool).slice(0, MAX_MENU);
    }
    const picked = await askChoice(label, want, pool.map((i) => texts[i]));
    return picked >= 0 ? pool[picked] : -1;
  }

  /**
   * Ask Jev which of `texts` expresses `want`, giving each wording once.
   *
   * Menus repeat themselves: Greenhouse's location search lists "Madison,
   * Wisconsin, United States" twice (two places share the name). Asked about
   * both copies, Jev splits its probability between them (0.36 live), neither
   * clears the bar, and the field is left empty. Either copy is the answer,
   * so ask about the wording and click its first occurrence.
   */
  async function askChoice(label, want, texts) {
    const unique = [...new Set(texts)];
    const reply = await chrome.runtime.sendMessage({ type: "choose-option", label, want, options: unique });
    if (!reply || !reply.ok || reply.index < 0) return -1;
    return texts.indexOf(unique[reply.index]);
  }

  /** A whole click, pointer events included: Workday's pickers act on pointerdown. */
  function click(node) {
    const pointer = (type) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, view: window, pointerType: "mouse", isPrimary: true, button: 0,
    }));
    pointer("pointerdown");
    fire(node, "mousedown");
    pointer("pointerup");
    fire(node, "mouseup");
    fire(node, "click");
  }

  const ACTIVE_POPUP =
    '[data-automation-activepopup="true"], [data-automation-id="activeListContainer"]';

  /** Close a menu. Workday's popups can ignore Escape; a click outside shuts them. */
  function closeMenu(field) {
    press(document.activeElement || field, "Escape", 27);
    field.blur();
    if ([...document.querySelectorAll(ACTIVE_POPUP)].some(nodeVisible)) {
      const outside = document.querySelector("#mainContent, main");
      if (outside) click(outside);
    }
  }

  /** The element that actually takes an option's click. */
  const optionTarget = (node) => node.closest(PROMPT_LEAF) || node.closest('[role="option"]') || node;

  function optionPicked(node) {
    const target = optionTarget(node);
    return target.getAttribute("data-automation-checked") === "Checked" ||
      target.getAttribute("aria-selected") === "true" ||
      target.getAttribute("aria-checked") === "true";
    // Not a ticked radio inside it: a bare radio ticks itself when clicked,
    // whether or not the widget took the choice.
  }

  /**
   * Click an option where it listens: the row, not the label inside it. If
   * the row did not take it, its own radio / checkbox is the last resort --
   * never a second click on the row, which would untick a multiselect.
   */
  async function pickOption(node) {
    const target = optionTarget(node);
    target.scrollIntoView({ block: "nearest" });
    click(target);
    for (let i = 0; i < 6; i++) {
      await sleep(40);
      if (!target.isConnected || optionPicked(node)) return;
    }
    const box = target.querySelector('input[type="radio"], input[type="checkbox"]');
    if (box && !box.checked) { click(box); await sleep(200); }
  }

  /**
   * Read a dropdown's options, then close it. Filling a page reads every menu
   * first and asks Jev about all of them at once, instead of holding each
   * menu open through its own round trip.
   */
  /** Close whatever popup is open and let it go before opening another. */
  async function settlePopups(field) {
    const open = () => [...document.querySelectorAll('[data-automation-activepopup="true"]')].some(nodeVisible);
    if (!open()) return;
    closeMenu(field);
    for (let i = 0; i < 20 && open(); i++) await sleep(25);
  }

  /**
   * Open a dropdown button. A plain click first, as Simplify's Workday rules
   * do: some of Workday's buttons (Phone Device Type) open on mousedown and
   * toggle again on click, so a full pointer-and-mouse sequence opened the
   * menu and shut it at once -- nothing to read, nothing picked. Only if a
   * plain click opens nothing is the full sequence tried.
   */
  async function openListbox(button) {
    await settlePopups(button);
    button.focus();
    fire(button, "click");
    if ((await waitForOptions(button, 600)).length) return true;
    await settlePopups(button);
    click(button);
    return (await waitForOptions(button)).length > 0;
  }

  async function surveyListbox(button, want) {
    const opened = await openListbox(button);
    const texts = opened ? await readMenu(button, want) : [];
    // The answer is right there: click it now rather than close, decide and
    // reopen. Only menus that need Jev pay for a second visit.
    const exact = localMatch(texts, want);
    if (exact >= 0) {
      const node = await findOption(button, texts[exact], texts.at?.get(texts[exact]));
      if (node) {
        await pickOption(node);
        if (!EMPTY_BUTTON.test(button.textContent.trim())) { texts.done = true; return texts; }
      }
    }
    closeMenu(button);
    await sleep(40);
    return texts;
  }

  async function applyListbox(button, texts, index) {
    if (index < 0) return false;
    if (!(await openListbox(button))) { closeMenu(button); return false; }
    const node = await findOption(button, texts[index], texts.at?.get(texts[index]));
    if (!node) { closeMenu(button); return false; }
    await pickOption(node);
    return !EMPTY_BUTTON.test(button.textContent.trim());
  }

  /** Search a prompt for `want` and read the results, then close it. */
  /** Put a search into a prompt at once; it only searches on Enter anyway. */
  function searchPrompt(input, text) {
    input.focus();
    nativeSet(input, text);
    press(input, "Enter", 13);
  }

  async function surveyPrompt(input, want) {
    searchPrompt(input, want);
    const found = (await waitForOptions(input, 2500)).length > 0;
    const texts = found ? await readMenu(input, want) : [];
    const exact = localMatch(texts, want);
    if (exact >= 0) {
      const node = await findOption(input, texts[exact], texts.at?.get(texts[exact]));
      if (node) {
        await pickOption(node);
        if (promptChosen(input) || optionPicked(node)) { closeMenu(input); texts.done = true; return texts; }
      }
    }
    closeMenu(input);
    nativeSet(input, "");
    await sleep(40);
    return texts;
  }

  async function applyPrompt(input, want, texts, index) {
    if (index >= 0) {
      searchPrompt(input, want);
      if ((await waitForOptions(input, 2500)).length) {
        const node = await findOption(input, texts[index], texts.at?.get(texts[index]));
        if (node) {
          await pickOption(node);
          if (promptChosen(input) || optionPicked(node)) { closeMenu(input); return true; }
          // Clicked and nothing took: retrying is what froze the page.
          if (sameMenu(input, texts)) { closeMenu(input); nativeSet(input, ""); return false; }
        }
      }
      closeMenu(input);
    }
    // No hit by searching, or a category: the slow, step-by-step path.
    return setPrompt(input, want);
  }

  /** A Workday dropdown: a button that opens a listbox. */
  async function setListbox(button, want) {
    if (normalize(button.textContent) === normalize(want)) return true;
    if (!(await openListbox(button))) { closeMenu(button); return false; }
    const texts = await readMenu(button, want);
    const index = await chooseAmong(listboxLabel(button), want, texts);
    const node = index >= 0 && (await findOption(button, texts[index]));
    if (!node) { closeMenu(button); return false; }
    node.scrollIntoView({ block: "nearest" });
    click(node);
    await sleep(250);
    return !EMPTY_BUTTON.test(button.textContent.trim());
  }

  /**
   * Whether a prompt holds a choice. Its list is never empty -- an empty one
   * says "0 items selected" -- so count selected items, or read that count.
   */
  function promptChosen(input) {
    const box = input.closest('[data-automation-id="multiSelectContainer"]') || input.parentElement;
    if (box.querySelector('[data-automation-id="selectedItem"]')) return true;
    const count = (input.closest(FIELD_ENTRY) || box).textContent.match(/(\d+)\s+items?\s+selected/i);
    return count ? Number(count[1]) > 0 : false;
  }

  /**
   * A Workday search prompt ("How did you hear about us?", School). Typed
   * text is not an answer; it only searches, on Enter. Pick from the results,
   * and when nothing matches, open the prompt empty and walk its categories
   * ("Job Board" > "LinkedIn Jobs") instead.
   */
  // How long one picker may hold the page, and how many Jev questions it
  // may ask. Without a cap a click that never takes meant 3 searches x 3
  // levels of re-asking with the menu open -- the page froze for ~20s.
  const PROMPT_BUDGET = 6000;
  const PROMPT_ASKS = 2;

  /** Whether the menu still shows exactly `texts`: a click changed nothing. */
  function sameMenu(anchor, texts) {
    const now = optionsNear(anchor).map(optionText);
    return now.length > 0 && now.every((t) => texts.includes(t));
  }

  async function setPrompt(input, want) {
    if (promptChosen(input)) return true;
    const label = labelFor(input);
    const deadline = Date.now() + PROMPT_BUDGET;
    let asks = 0;
    const done = (ok) => { closeMenu(input); if (!ok) nativeSet(input, ""); return ok; };
    for (const probe of [want, narrowingToken(want), ""]) {
      if (Date.now() > deadline || asks >= PROMPT_ASKS) break;
      if (probe) searchPrompt(input, probe);
      else { nativeSet(input, ""); click(input); }
      for (let depth = 0; depth < 3 && Date.now() < deadline; depth++) {
        if (!(await waitForOptions(input, 2500)).length) break;
        const texts = await readMenu(input, want);
        const exact = texts.findIndex((t) => normalize(t) === normalize(want));
        if (exact < 0 && asks >= PROMPT_ASKS) return done(false);
        if (exact < 0) asks++;
        const index = exact >= 0 ? exact : await chooseAmong(label, want, texts);
        if (index < 0) return done(false); // Jev saw the options: none fits
        const node = await findOption(input, texts[index], texts.at?.get(texts[index]));
        if (!node) break;
        await pickOption(node);
        if (promptChosen(input) || optionPicked(node)) return done(true);
        // A category opens its children in place; anything else means the
        // click did not take, and asking again would only click again.
        if (sameMenu(input, texts)) return done(false);
      }
      closeMenu(input);
      await sleep(100);
    }
    return done(false);
  }

  /** "Languages: Python, Java\nFrameworks: React" -> ["Python", "Java", "React"]. */
  function listItems(text, max = 10) {
    const items = [];
    for (const line of String(text).split(/\n+/)) {
      for (const piece of line.replace(/^[^:,]{1,30}:\s*/, "").split(/\s*[,;•|]\s*/)) {
        const item = piece.replace(/\s*\([^)]*\)/g, "").trim();
        if (item && item.length <= 40 && !items.some((i) => i.toLowerCase() === item.toLowerCase())) items.push(item);
      }
    }
    return items.slice(0, max);
  }

  /**
   * Workday's Skills box is a search prompt that holds many picks: add each
   * skill on its own -- search, then take the result that is that skill.
   * A skill with no plain match is skipped rather than guessed.
   */
  async function setMultiPrompt(input, value) {
    let added = 0;
    for (const item of listItems(value)) {
      searchPrompt(input, item);
      if (!(await waitForOptions(input, 1500)).length) { closeMenu(input); continue; }
      const texts = await readMenu(input, item);
      const index = localMatch(texts, item);
      const node = index >= 0 && (await findOption(input, texts[index], texts.at?.get(texts[index])));
      if (node) { await pickOption(node); added++; }
      closeMenu(input);
      nativeSet(input, "");
      await sleep(80);
    }
    return added > 0;
  }

  const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  /**
   * "May 2027", "05/2027", "2027-05", "2027", and with a day: "09/21/2026",
   * "2026-09-21", "Sep 21, 2026" -> {year, month, day}.
   */
  function dateParts(value) {
    const text = String(value || "");
    const year = text.match(/\b(19|20)\d{2}\b/);
    if (!year) return null;
    const full = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-]((?:19|20)\d{2})\b/) || // MM/DD/YYYY
      text.match(/\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/); // YYYY-MM-DD
    if (full) {
      const [month, day] = full[3].length === 4 ? [full[1], full[2]] : [full[2], full[3]];
      if (Number(month) <= 12 && Number(day) <= 31) return { year: year[0], month: Number(month), day: Number(day) };
    }
    const named = text.match(/\b([A-Za-z]{3})[a-z]*\.?\b/g)?.map((w) => MONTH_NAMES.indexOf(w.slice(0, 3).toLowerCase())).find((i) => i >= 0);
    const numeric = text.match(/\b(\d{1,2})[/.-](?:19|20)\d{2}\b/) || text.match(/\b(?:19|20)\d{2}[/.-](\d{1,2})\b/);
    const month = named !== undefined && named >= 0 ? named + 1 : numeric ? Number(numeric[1]) : null;
    const day = named !== undefined && named >= 0 ? text.match(/\b[A-Za-z]{3}[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?/)?.[1] : null;
    return {
      year: year[0],
      month: month && month <= 12 ? month : null,
      day: day && Number(day) <= 31 ? Number(day) : null,
    };
  }

  const pad = (n) => String(n).padStart(2, "0");

  /**
   * A date in the shape the field asks for. A box that says MM/DD/YYYY (in
   * its placeholder or label) gets exactly that, a native date input gets
   * YYYY-MM-DD, and anything else keeps the profile's own wording.
   */
  function formatForField(field, value) {
    if (field.tagName !== "INPUT") return value;
    const hint = `${field.placeholder || ""} ${field.getAttribute("aria-label") || ""} ${labelFor(field)}`;
    const shape = field.type === "date" ? "YYYY-MM-DD"
      : (hint.match(/\b(MM\/DD\/YYYY|DD\/MM\/YYYY|MM\/YYYY|YYYY-MM-DD|MM-DD-YYYY)\b/i) || [])[1]?.toUpperCase();
    if (!shape) return value;
    const parts = dateParts(value);
    if (!parts || !parts.month) return value;
    const [y, m, d] = [parts.year, pad(parts.month), pad(parts.day || 1)];
    return { "MM/DD/YYYY": `${m}/${d}/${y}`, "DD/MM/YYYY": `${d}/${m}/${y}`, "MM/YYYY": `${m}/${y}`,
      "YYYY-MM-DD": `${y}-${m}-${d}`, "MM-DD-YYYY": `${m}-${d}-${y}` }[shape];
  }

  /** A Workday date: separate month / day / year boxes. */
  async function setDate(wrapper, value) {
    const parts = dateParts(value);
    if (!parts) return false;
    const box = (name) => wrapper.querySelector(`[data-automation-id="dateSection${name}-input"], input[aria-label="${name}"]`);
    const month = box("Month");
    const day = box("Day");
    const year = box("Year");
    if (month && !parts.month) return false; // "Present", or a year alone
    if (month) { await typeLikeAPerson(month, String(parts.month).padStart(2, "0")); month.blur(); }
    if (day) { await typeLikeAPerson(day, pad(parts.day || 1)); day.blur(); }
    if (year) { await typeLikeAPerson(year, parts.year); year.blur(); }
    return Boolean(year ? year.value : month?.value);
  }

  function isFilled(entry) {
    const { element } = entry;
    if (entry.buttons) return toggleAnswered(entry);
    if (element.matches(LISTBOX_BUTTON)) return !EMPTY_BUTTON.test(element.textContent.trim());
    if (dateWrappers.has(element)) return [...element.querySelectorAll(DATE_PART)].some((p) => p.value);
    if (element.matches(PROMPT_INPUT)) return Boolean(promptChosen(element));
    if (isCombobox(element)) return Boolean(currentValue(element));
    return Boolean(element.value && element.value.trim());
  }

  /* ----------------------------------------------------------- attachments */

  const DOC_KEYWORDS = [
    ["resume", ["resume", "cv", "curriculum"]],
    ["transcript", ["transcript", "academic record"]],
    ["cover_letter", ["cover letter", "coverletter"]],
  ];

  /**
   * What names a file input, strongest evidence first.
   *
   * The element's own label, id and name are reliable -- Greenhouse labels its
   * resume upload "Attach" and hides the clue in the id. Surrounding text is a
   * last resort and must stay that way: Ashby puts an unlabelled "Autofill
   * from resume" dropzone above the real Resume field, and its container text
   * says "resume" too. Ranking keeps the document on the right input.
   */
  function fileHintTiers(input) {
    const explicit = input.id
      ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent || ""
      : "";
    return [
      // Only evidence the element states about itself. labelFor()'s sibling
      // walk is deliberately excluded: an unlabelled dropzone sits next to the
      // words "Autofill from resume", and letting that count outranks the real
      // Resume field -- which hands the file to the site's own parser, which
      // re-renders the form and wipes everything already filled.
      [explicit, input.id || "", input.name || "",
       input.getAttribute("aria-label") || "",
       // Workday: <div data-automation-id="resumeUpload"> around a bare input
       input.closest('[data-automation-id*="resume" i], [aria-labelledby*="resume" i]')
         ?.getAttribute("data-automation-id") || ""].join(" "),
      [labelFor(input),
       (input.closest(FIELD_ENTRY) || input.closest("[class*='field'], fieldset"))
         ?.textContent?.slice(0, 140) || ""].join(" "),
    ];
  }

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

  const AUTOFILL_DROPZONE = /autofill|auto-fill|parse (?:your )?resume/i;

  function documentFor(label) {
    const low = (label || "").toLowerCase();
    if (AUTOFILL_DROPZONE.test(low)) return null;
    for (const [key, words] of DOC_KEYWORDS) {
      if (words.some((word) => low.includes(word))) return key;
    }
    return null;
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
    const inputs = [...document.querySelectorAll(FILE_SELECTOR)].filter(
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

  // Workday's My Experience step starts with empty sections: each job,
  // school or website exists only once you click its section's Add button.
  // Nothing to fill until then, so the whole step used to be skipped.
  const LINK_KEYS = ["linkedin", "github", "portfolio", "other_link"];
  const ENTRY_SECTIONS = [
    { test: /experience|employment|work.?history|where.*worked/i, count: (p) => (p.experience || []).length },
    { test: /education|school/i, count: (p) => (p.education || []).length },
    { test: /website/i, count: (p) => LINK_KEYS.filter((k) => String(p[k] || "").trim()).length },
  ];
  const MAX_ENTRIES = 4;

  /** Sections with an Add button, and how many panels each should hold. */
  async function entryPlan() {
    const sections = [...document.querySelectorAll('[role="group"][aria-labelledby$="-section"]')].filter(nodeVisible);
    if (!sections.length) return [];
    let profile = {};
    try { ({ profile = {} } = await chrome.storage.local.get("profile")); } catch { return []; }
    const plan = [];
    for (const section of sections) {
      const id = section.getAttribute("aria-labelledby");
      const kind = ENTRY_SECTIONS.find((k) => k.test.test(`${id} ${document.getElementById(id)?.textContent || ""}`));
      if (!kind) continue;
      // Panels are "Work-Experience-1-panel", "Work-Experience-2-panel"...
      const prefix = id.replace(/section$/, "");
      const panels = () => document.querySelectorAll(
        `[role="group"][aria-labelledby^="${CSS.escape(prefix)}"][aria-labelledby$="-panel"]`).length;
      const want = Math.min(kind.count(profile), MAX_ENTRIES);
      if (panels() < want) plan.push({ section, panels, want });
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
    for (const { section, panels, want } of await entryPlan()) {
      for (let guard = 0; panels() < want && guard < MAX_ENTRIES; guard++) {
        const add = [...section.querySelectorAll("button")].find((b) =>
          b.getAttribute("data-automation-id") === "add-button" ||
          /^add\b/i.test(b.getAttribute("aria-label") || b.textContent.trim()));
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
    if (!known.length && !document.querySelector(FILE_SELECTOR) &&
        !document.querySelector('[role="group"][aria-labelledby$="-section"]')) return;
    if (filling) return;
    filling = true;
    try {
      const started = performance.now();
      // New entries first: their fields need answers before anything fills.
      if (await addEntries()) {
        await sleep(300);
        const fields = collectFields();
        const answered = await answer(fields);
        if (answered) {
          known = answered;
          lastSignature = fields.map((f) => f.label).join("|");
        }
      }
      const attached = await attachDocuments();
      await fillFields(started, attached);
      // Newly revealed questions first -- they are the user's to see now --
      // then keep watch for a resume re-parse, over those fields too.
      await fillRevealed();
      if (attached) await refillIfReparsed();
    } finally {
      filling = false;
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
    const seen = new Set(lastSignature.split("|"));
    for (let round = 0; round < 3; round++) {
      await sleep(250); // let the page reveal what the last answers unlock
      const fields = collectFields();
      const fresh = fields.filter((f) => !seen.has(f.label));
      lastSignature = fields.map((f) => f.label).join("|");
      if (!fresh.length) return;
      fresh.forEach((f) => seen.add(f.label));
      const answered = await answer(fresh);
      if (!answered || !answered.length) continue;
      known = known.concat(answered);
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
    const filledNow = known.filter((k) => k.result.status === "auto" && isFilled(k));
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

  async function fillFields(started, attached, prefix = "", only = null) {
    rebind();
    let filled = 0;
    let skipped = 0;
    const count = (ok) => (ok ? filled++ : skipped++);
    const todo = known.filter((entry) => {
      if (only && !only.has(entry.label)) return false;
      const due = entry.result.status === "auto" && !isFilled(entry);
      if (!due) skipped++;
      return due;
    });

    // Nothing waits on anything slower than itself. Instant fields go in
    // one pass, as on Ashby; a Workday search picker waits on its server,
    // and in field order it used to hold up every text box below it.
    const timeline = [];
    // The page may rebuild the form mid-fill too: re-find by label, and never
    // wait on a detached element (every one of its timeouts runs out).
    const live = (entry) => {
      if (!detached(entry)) return entry;
      rebind();
      const fresh = known.find((k) => k.label === entry.label);
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
      if (timeline[before]) timeline[before].read = read;
    }
    // Where the time went, for when a page feels slow.
    if (timeline.length) {
      console.info(`smartpaste: filled in ${Math.round(performance.now() - started)}ms`);
      console.table(timeline);
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
    lastSummary = only && lastSummary ? `${lastSummary} · ${summary}` : summary;
    note(lastSummary, false, why.length || only ? 12000 : 4000);
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

  /* ------------------------------------------------------------------- ink */

  function mark(field, answer) {
    field.dataset.smartpaste = answer.status;
    field.title =
      `smartpaste: ⌘V inserts "${answer.value}" ` +
      `(${answer.confidence.toFixed(2)})`;
  }

  function hint(field, text) {
    const badge = document.createElement("div");
    badge.className = "smartpaste-flash smartpaste-muted";
    badge.textContent = text;
    const rect = field.getBoundingClientRect();
    badge.style.top = `${window.scrollY + rect.top - 22}px`;
    badge.style.left = `${window.scrollX + rect.left}px`;
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 1600);
  }

  function flash(field, probability, position) {
    const badge = document.createElement("div");
    badge.className = "smartpaste-flash";
    badge.textContent = position
      ? `${probability.toFixed(2)} · ⌘V again ${position}`
      : probability.toFixed(2);
    const rect = field.getBoundingClientRect();
    badge.style.top = `${window.scrollY + rect.top - 22}px`;
    badge.style.left = `${window.scrollX + rect.left}px`;
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 1400);
  }

  function note(text, isError = false, ms = 4000) {
    const existing = document.querySelector(".smartpaste-note");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "smartpaste-note" + (isError ? " smartpaste-error" : "");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /* ----------------------------------------------------------------- start */

  /* ---------------------------------------------------------------- button */

  async function countAttachable() {
    const inputs = [...document.querySelectorAll(FILE_SELECTOR)].filter(
      (el) => !el.disabled && !el.files.length
    );
    if (!inputs.length) return 0;
    const { documents = {} } = await chrome.storage.local.get("documents");
    return planAttachments(inputs, documents).size;
  }

  async function showButton(count) {
    document.querySelector(".smartpaste-button")?.remove();
    const files = await countAttachable();
    const entries = await entriesToAdd();
    // Nothing answered, nothing to attach, nothing to add: no button at all.
    if (!count && !files && !entries) return;
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
    document.body.appendChild(button);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "fill-page") fillPage();
  });

  // After the page's load event: long enough for a server-rendered React app
  // to take the page over ("hydrate").
  const SETTLE_MS = 300;

  function start() {
    document.addEventListener("keydown", onKeyDown, true);
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
    Object.assign(window.__smartpasteTest, { dateParts, formatForField, localMatch, looksLikeApplication, looksLikeAutocomplete, collectFields, normalize, setPrompt });
  }

  // The manifest runs this at document_idle, but an injected or early copy can
  // land before <html> exists, and observe() throws on a null root.
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
