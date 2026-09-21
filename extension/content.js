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
    '.application-question, fieldset';
  // Where a question keeps its text when the input has no label of its own.
  // Lever wraps inputs in a <label> that also holds status text ("No location
  // found. Try entering…"), and its custom questions have no label at all.
  const QUESTION_BOX = '.application-question, [role="radiogroup"], fieldset';
  const QUESTION_TEXT = '.application-label, legend, [class*="question-label"]';
  const FIELD_SELECTOR =
    'input:not([type]), input[type="text"], input[type="email"], ' +
    'input[type="tel"], input[type="url"], input[type="search"], textarea, select';
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
    return [...element.options]
      .map((o) => o.textContent.trim())
      .filter((t) => t && !/^(?:select|choose|please select|--)/i.test(t))
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
        clean(r.closest("label")?.textContent || r.value || "")
      );
      if (label.length < 2 || options.some((o) => !o)) continue;
      const element = first.closest(QUESTION_BOX) || first.parentElement;
      if (!nodeVisible(element)) continue;
      fields.push({ element, label, options, buttons: radios, combobox: false });
    }
    return fields;
  }

  function collectFields() {
    return [...document.querySelectorAll(FIELD_SELECTOR)]
      .filter(visible)
      .map((element) => ({
        element,
        label: labelFor(element),
        options: selectOptions(element),
        combobox: isCombobox(element),
      }))
      .filter((f) => f.label.length >= 2 && !JUNK_LABELS.test(f.label))
      .concat(collectToggleGroups())
      .concat(collectRadioGroups());
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

  async function scan() {
    if (scanning) return;
    const fields = collectFields();
    if (fields.length < MIN_FIELDS || !looksLikeApplication(fields)) {
      if (known.length) forget();
      return;
    }
    const signature = fields.map((f) => f.label).join("|");
    if (signature === lastSignature) return;

    scanning = true;
    lastSignature = signature;
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "answer-fields",
        fields: fields.map((f) => ({ label: f.label, options: f.options })),
      });
      if (!reply || !reply.ok) {
        if (reply && reply.error) note(reply.error, true);
        return;
      }
      fields.forEach((f) => asked.add(f.element));
      reply.results.forEach((result, i) => {
        if (result.status !== "none") {
          answers.set(fields[i].element, result);
          mark(fields[i].element, result);
        }
      });
      known = fields
        .map((f, i) => ({ ...f, result: reply.results[i] }))
        .filter((f) => f.result && f.result.status !== "none");
      showButton(known.length);
    } catch (error) {
      // An extension reload orphans this script; staying quiet is correct.
    } finally {
      scanning = false;
    }
  }

  /* --------------------------------------------------------------- pasting */

  /**
   * React tracks its own value on the DOM node, so assigning `.value` leaves
   * the component's state stale and the field reverts on blur. Going through
   * the native setter and dispatching an input event is what React listens for.
   */
  /** Click the button in a toggle group that expresses `want`. */
  async function setToggle(entry, want) {
    const texts = entry.options;
    let index = texts.findIndex((t) => normalize(t) === normalize(want));
    if (index < 0) {
      const reply = await chrome.runtime.sendMessage({
        type: "choose-option",
        label: entry.label,
        want,
        options: texts,
      });
      if (reply && reply.ok && reply.index >= 0) index = reply.index;
    }
    if (index < 0 || !entry.buttons[index]) return false;
    entry.buttons[index].click();
    await sleep(150);
    return toggleAnswered(entry);
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
      await sleep(25);
    }
  }

  const AUTOCOMPLETE_HINT = /location|city|address|hometown/i;
  const SUGGESTION_BOX =
    '[role="listbox"], [class*="dropdown-results"], [class*="suggest"], ' +
    '[class*="autocomplete"], [class*="typeahead"], [class*="pac-container"]';
  const NOT_A_SUGGESTION = /^(?:no .* found|loading|searching)/i;

  function looksLikeAutocomplete(field) {
    if (field.getAttribute("aria-autocomplete")) return true;
    const hints = [field.name, field.id, field.className, labelFor(field)].join(" ");
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
    for (let i = 0; i < 20 && !items.length; i++) {
      await sleep(150);
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
  async function setSelect(field, value) {
    const options = [...field.options].filter(
      (o) => o.value !== "" && !/^(?:select|choose|please select|--)/i.test(o.textContent.trim())
    );
    const texts = options.map((o) => o.textContent.trim());
    let index = texts.findIndex((t) => normalize(t) === normalize(value));
    if (index < 0) {
      const reply = await chrome.runtime.sendMessage({
        type: "choose-option", label: labelFor(field), want: value, options: texts.slice(0, 200),
      });
      if (reply && reply.ok && reply.index >= 0) index = reply.index;
    }
    if (index < 0) return false;
    field.value = options[index].value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setValue(field, value) {
    if (field.tagName === "INPUT" && !isCombobox(field) && looksLikeAutocomplete(field)) {
      return setAutocomplete(field, value); // async
    }
    if (isCombobox(field)) return setCombobox(field, value); // async
    if (field.tagName === "SELECT") return setSelect(field, value); // async
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
  async function menuOptions(field, timeout = 2500) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const id = field.getAttribute("aria-controls");
      const list = id && document.getElementById(id);
      const nodes = list ? [...list.querySelectorAll('[role="option"]')] : [];
      if (nodes.length) return nodes;
      await sleep(120);
    }
    return [];
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

    let nodes = await menuOptions(field, 1500);
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
    if (index < 0) {
      const reply = await chrome.runtime.sendMessage({
        type: "choose-option",
        label: labelFor(field),
        want,
        options: texts.slice(0, MAX_MENU),
      });
      if (reply && reply.ok && reply.index >= 0) index = reply.index;
    }
    if (index < 0 || !nodes[index]) {
      field.blur();
      return false;
    }

    fire(nodes[index], "mousedown");
    fire(nodes[index], "mouseup");
    fire(nodes[index], "click");
    await sleep(200);
    return Boolean(currentValue(field));
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
       input.getAttribute("aria-label") || ""].join(" "),
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
  async function fillPage() {
    const attached = await attachDocuments();
    if (attached) {
      await sleep(2500);
      const byLabel = new Map(known.map((k) => [k.label, k.result]));
      known = collectFields()
        .filter((f) => byLabel.has(f.label))
        .map((f) => ({ ...f, result: byLabel.get(f.label) }));
    }
    let filled = 0;
    let skipped = 0;
    for (const entry of known) {
      const { element, result } = entry;
      if (result.status !== "auto") { skipped++; continue; }
      if (entry.buttons) {
        if (toggleAnswered(entry)) { skipped++; continue; }
        if (await setToggle(entry, result.value)) filled++;
        else skipped++;
        continue;
      }
      const alreadySet = isCombobox(element)
        ? Boolean(currentValue(element))
        : Boolean(element.value && element.value.trim());
      if (alreadySet) { skipped++; continue; }
      if (await setValue(element, result.value)) filled++;
      else skipped++;
    }
    const parts = [`filled ${filled}`];
    if (attached) parts.push(`attached ${attached} file${attached === 1 ? "" : "s"}`);
    if (skipped) parts.push(`left ${skipped} for you`);
    note(parts.join(", "));
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

  function note(text, isError = false) {
    const existing = document.querySelector(".smartpaste-note");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.className = "smartpaste-note" + (isError ? " smartpaste-error" : "");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
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
    // Nothing answered and nothing to attach: no button at all.
    if (!count && !files) return;
    const button = document.createElement("button");
    button.className = "smartpaste-button";
    button.textContent =
      `Autofill ${count} field${count === 1 ? "" : "s"}` +
      (files ? ` + ${files} file${files === 1 ? "" : "s"}` : "");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      fillPage();
    });
    document.body.appendChild(button);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "fill-page") fillPage();
  });

  function start() {
    document.addEventListener("keydown", onKeyDown, true);
    let debounce;
    new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(scan, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });
    scan();
  }

  // The manifest runs this at document_idle, but an injected or early copy can
  // land before <html> exists, and observe() throws on a null root.
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
