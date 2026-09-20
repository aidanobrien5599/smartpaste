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
  const FIELD_SELECTOR =
    'input:not([type]), input[type="text"], input[type="email"], ' +
    'input[type="tel"], input[type="url"], input[type="search"], textarea';
  const MIN_FIELDS = 2;
  const answers = new WeakMap(); // field element -> resolved answer
  const cycle = new WeakMap(); // field element -> index into alternatives
  let scanning = false;
  let lastSignature = "";

  /* ---------------------------------------------------------------- labels */

  function labelFor(field) {
    const byFor =
      field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    const candidates = [
      byFor,
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
      .replace(/\s*(?:\*+|\(required\)|\(optional\)|required|optional)\s*$/i, "")
      .replace(/[:*]\s*$/, "")
      .trim()
      .slice(0, 200);
  }

  function visible(field) {
    if (field.disabled || field.readOnly) return false;
    const rect = field.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function collectFields() {
    return [...document.querySelectorAll(FIELD_SELECTOR)]
      .filter(visible)
      .map((element) => ({ element, label: labelFor(element) }))
      .filter((f) => f.label.length >= 2);
  }

  /* ----------------------------------------------------------------- fetch */

  async function scan() {
    if (scanning) return;
    const fields = collectFields();
    if (fields.length < MIN_FIELDS) return;
    const signature = fields.map((f) => f.label).join("|");
    if (signature === lastSignature) return;

    scanning = true;
    lastSignature = signature;
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "answer-fields",
        labels: fields.map((f) => f.label),
      });
      if (!reply || !reply.ok) {
        if (reply && reply.error) note(reply.error, true);
        return;
      }
      reply.results.forEach((result, i) => {
        if (result.status !== "none") {
          answers.set(fields[i].element, result);
          mark(fields[i].element, result);
        }
      });
      const ready = reply.results.filter((r) => r.status !== "none").length;
      if (ready) note(`${ready} field${ready === 1 ? "" : "s"} ready — press ⌘V`);
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
  function setValue(field, value) {
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function onKeyDown(event) {
    const isPaste = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
    if (!isPaste || event.altKey) return;

    const field = event.target;
    const answer = answers.get(field);
    // No confident answer: leave the keystroke alone and paste normally.
    if (!answer || !answer.value) return;

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

  document.addEventListener("keydown", onKeyDown, true);

  let debounce;
  new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(scan, 600);
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
