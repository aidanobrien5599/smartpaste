import { DOCUMENTS, GROUPS, ORDINALS, REPEATABLE } from "./lib/schema.js";
import { humanSize, MAX_BYTES, toBase64 } from "./lib/documents.js";
import { normalizePlaces } from "./lib/places.js";
import { normalizeAnswers } from "./lib/answers.js";
import { textFromStoredPdf } from "./lib/extract.js";

let state = { profile: {}, documents: {} };

const $ = (id) => document.getElementById(id);

function say(node, text, warn = false) {
  node.textContent = text;
  node.className = "status" + (warn ? " warn" : "");
}

function renderGroups(profile) {
  const host = $("groups");
  for (const group of GROUPS) {
    const heading = document.createElement("h2");
    heading.textContent = group.title;
    const section = document.createElement("section");
    const grid = document.createElement("div");
    grid.className = "grid" + (group.long ? " one" : "");

    for (const [key, label, placeholder] of group.fields) {
      const wrap = document.createElement("div");
      const tag = document.createElement("label");
      tag.className = "field";
      tag.textContent = label;
      tag.htmlFor = `f-${key}`;
      const input = group.long
        ? document.createElement("textarea")
        : document.createElement("input");
      if (group.long) input.className = "short";
      else input.type = "text";
      input.id = `f-${key}`;
      input.dataset.key = key;
      input.placeholder = placeholder ? `not set · e.g. ${placeholder}` : "not set";
      input.value = profile[key] || "";
      wrap.append(tag, input);
      grid.appendChild(wrap);
    }
    section.appendChild(grid);
    host.append(heading, section);
  }
}

/* ------------------------------------------------------------------ places */

/**
 * Where you would work: "open to anywhere", plus places in order of
 * preference. Kept in state.profile.work_locations as { ranked, anywhere }.
 */
function renderPlaces() {
  const host = $("places");
  host.innerHTML = "";
  const prefs = state.profile.work_locations || (state.profile.work_locations = { ranked: [], anywhere: false });
  if (!Array.isArray(prefs.ranked)) prefs.ranked = [];

  const anywhere = document.createElement("label");
  anywhere.className = "anywhere";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = Boolean(prefs.anywhere);
  box.addEventListener("change", () => { prefs.anywhere = box.checked; });
  anywhere.append(box, "Open to any location");
  host.appendChild(anywhere);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Most preferred first. A form asking which office or city you want gets " +
    "your highest-ranked place it offers; \"open to relocating to X?\" is Yes " +
    "for a place on your list, or anywhere if the box above is ticked.";
  host.appendChild(hint);

  const move = (from, to) => {
    const [item] = prefs.ranked.splice(from, 1);
    prefs.ranked.splice(to, 0, item);
    renderPlaces();
  };
  prefs.ranked.forEach((place, i) => {
    const row = document.createElement("div");
    row.className = "place";
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `${i + 1}.`;
    const input = document.createElement("input");
    input.type = "text";
    input.value = place;
    input.placeholder = "not set · e.g. New York, NY";
    input.addEventListener("input", () => { prefs.ranked[i] = input.value; });
    const button = (text, title, disabled, onClick) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.title = title;
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };
    row.append(
      rank, input,
      button("\u2191", "Prefer this more", i === 0, () => move(i, i - 1)),
      button("\u2193", "Prefer this less", i === prefs.ranked.length - 1, () => move(i, i + 1)),
      button("\u00d7", "Remove", false, () => { prefs.ranked.splice(i, 1); renderPlaces(); }),
    );
    host.appendChild(row);
  });

  const add = document.createElement("button");
  add.className = "add";
  add.textContent = "+ Add a place";
  add.addEventListener("click", () => {
    prefs.ranked.push("");
    renderPlaces();
    host.querySelectorAll(".place input")[prefs.ranked.length - 1]?.focus();
  });
  host.appendChild(add);
}

/* ----------------------------------------------------------------- answers */

/**
 * Your own answers to open-ended questions: the question as forms tend to
 * word it, and what you would say. Matched to a form's field by meaning,
 * with {company} and {role} filled in from the page.
 */
function renderAnswers() {
  const host = $("answers");
  host.innerHTML = "";
  if (!Array.isArray(state.profile.custom_answers)) state.profile.custom_answers = [];
  const list = state.profile.custom_answers;

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent =
    "Write the question the way forms ask it, and your answer. It is used " +
    "wherever a form asks the same thing in other words. {company} and {role} " +
    "become the company and job on the page; if they can't be worked out, the " +
    "answer waits for you (\u2318V) instead of being typed in.";
  host.appendChild(hint);

  list.forEach((entry, i) => {
    const node = document.createElement("div");
    node.className = "entry";
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "\u00d7";
    remove.title = "Remove this answer";
    remove.addEventListener("click", () => { list.splice(i, 1); renderAnswers(); });

    const field = (labelText, tag, key, placeholder) => {
      const wrap = document.createElement("div");
      const label = document.createElement("label");
      label.className = "field";
      label.textContent = labelText;
      const input = document.createElement(tag);
      if (tag === "input") input.type = "text";
      else input.className = "short";
      input.placeholder = placeholder;
      input.value = entry[key] || "";
      input.addEventListener("input", () => { entry[key] = input.value; });
      wrap.append(label, input);
      return wrap;
    };
    const grid = document.createElement("div");
    grid.className = "grid one";
    grid.append(
      field("Question", "input", "question", "not set · e.g. Why do you want to work at {company}?"),
      field("Your answer", "textarea", "answer",
        "not set · e.g. I want to work on {role} problems at {company} because…"),
    );
    node.append(remove, grid);
    host.appendChild(node);
  });

  const add = document.createElement("button");
  add.className = "add";
  add.textContent = "+ Add a question";
  add.addEventListener("click", () => {
    list.push({ question: "", answer: "" });
    renderAnswers();
    host.querySelectorAll(".entry input")[list.length - 1]?.focus();
  });
  host.appendChild(add);
}

/* ------------------------------------------------------------- repeatables */

function entryNode(section, entry, index) {
  const node = document.createElement("div");
  node.className = "entry";
  node.dataset.section = section.key;

  const heading = document.createElement("h3");
  heading.textContent = section.named
    ? `${entry[section.summary] || `${section.singular[0].toUpperCase()}${section.singular.slice(1)} ${index + 1}`}`
    : `${ORDINALS[index] || `${index + 1}th most recent`} ${section.singular}`;
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "\u00d7";
  remove.title = `Remove this ${section.singular}`;
  remove.addEventListener("click", () => {
    state.profile[section.key].splice(index, 1);
    renderRepeatables();
  });

  const grid = document.createElement("div");
  grid.className = "grid";
  for (const [key, label, placeholder, long] of section.fields) {
    const wrap = document.createElement("div");
    if (long) wrap.style.gridColumn = "1 / -1";
    const tag = document.createElement("label");
    tag.className = "field";
    tag.textContent = label;
    const input = long ? document.createElement("textarea") : document.createElement("input");
    if (long) input.className = "short";
    else input.type = "text";
    input.placeholder = placeholder ? `not set · e.g. ${placeholder}` : "not set";
    input.value = entry[key] || "";
    input.addEventListener("input", () => {
      state.profile[section.key][index][key] = input.value;
    });
    wrap.append(tag, input);
    grid.appendChild(wrap);
  }
  node.append(remove, heading, grid);
  return node;
}

function renderRepeatables() {
  const host = document.getElementById("repeatables");
  host.innerHTML = "";
  for (const section of REPEATABLE) {
    if (!Array.isArray(state.profile[section.key])) state.profile[section.key] = [];
    const entries = state.profile[section.key];

    const heading = document.createElement("h2");
    heading.textContent = section.title;
    const box = document.createElement("section");
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = section.named
      ? `One entry per ${section.singular}. A form asking for your "SAT score" ` +
        `gets the score from the entry whose ${section.summary} is SAT.`
      : `Newest first. Each entry is labelled by position, so a form asking for ` +
        `"${section.summary} 2" gets the right one.`;
    box.appendChild(hint);
    entries.forEach((entry, i) => box.appendChild(entryNode(section, entry, i)));

    const add = document.createElement("button");
    add.className = "add";
    add.textContent = `+ Add ${section.singular}`;
    add.addEventListener("click", () => {
      entries.push({});
      renderRepeatables();
    });
    box.appendChild(add);
    host.append(heading, box);
  }
}

/* ---------------------------------------------------------------- documents */

function renderDocuments() {
  const host = document.getElementById("documents");
  host.innerHTML = "";
  for (const [key, label] of DOCUMENTS) {
    const stored = state.documents[key];
    const row = document.createElement("div");
    row.className = "doc";

    const title = document.createElement("span");
    title.textContent = label;
    title.style.minWidth = "110px";

    const name = document.createElement("span");
    name.className = "name" + (stored ? " set" : "");
    name.textContent = stored
      ? `${stored.name} · ${humanSize(stored.size)}`
      : "none stored";

    const pick = document.createElement("label");
    pick.className = "pick";
    pick.textContent = stored ? "Replace" : "Choose file";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".pdf,.doc,.docx";
    file.addEventListener("change", async () => {
      const chosen = file.files[0];
      if (!chosen) return;
      if (chosen.size > MAX_BYTES) {
        say($("save-status"), `${chosen.name} is over ${humanSize(MAX_BYTES)}.`, true);
        return;
      }
      state.documents[key] = {
        name: chosen.name,
        type: chosen.type || "application/pdf",
        size: chosen.size,
        data: toBase64(await chosen.arrayBuffer()),
      };
      await chrome.storage.local.set({ documents: state.documents });
      renderDocuments();
      say($("save-status"), `Stored ${chosen.name}.`);
    });
    pick.appendChild(file);
    row.append(title, name, pick);

    if (stored && key === "resume") {
      const draft = document.createElement("button");
      draft.textContent = "Fill profile from this";
      draft.title = "Read this PDF and draft your profile. You review it before saving.";
      draft.addEventListener("click", () => draftFromResume(stored, draft));
      row.appendChild(draft);
    }

    if (stored) {
      const clear = document.createElement("button");
      clear.textContent = "Remove";
      clear.addEventListener("click", async () => {
        delete state.documents[key];
        await chrome.storage.local.set({ documents: state.documents });
        renderDocuments();
      });
      row.appendChild(clear);
    }
    host.appendChild(row);
  }
}

/**
 * Draft the profile from the stored resume.
 *
 * Nothing is saved: values land in the form for you to read and correct, and
 * fields you have already filled are never overwritten. A resume line is an
 * unlabelled guess -- good enough for a first pass, not good enough to trust
 * silently, which is why this is a button in settings and not something that
 * happens on an application page.
 */
async function draftFromResume(stored, button) {
  const original = button.textContent;
  button.textContent = "Reading…";
  button.disabled = true;
  try {
    const text = await textFromStoredPdf(stored);
    button.textContent = "Asking Jev…";
    const reply = await chrome.runtime.sendMessage({ type: "profile-from-resume", text });
    if (!reply || !reply.ok) throw new Error(reply?.error || "No answer from the model.");

    let added = 0;
    let kept = 0;
    for (const [key, value] of Object.entries(reply.fields)) {
      const input = document.getElementById(`f-${key}`);
      if (!input) continue;
      if (input.value.trim()) { kept++; continue; }
      input.value = value;
      input.dataset.drafted = "1";
      added++;
    }
    for (const [section, entries] of Object.entries(reply.sections)) {
      if (!Array.isArray(state.profile[section])) state.profile[section] = [];
      if (state.profile[section].some((e) => Object.values(e).some(Boolean))) {
        kept += entries.length;
        continue;
      }
      state.profile[section] = entries;
      added += entries.length;
    }
    renderRepeatables();
    say(
      $("save-status"),
      `Drafted ${added} field${added === 1 ? "" : "s"} from ${reply.lines} resume lines` +
        (kept ? `, left ${kept} you had already filled.` : ".") +
        " Check them, then Save profile.",
      true
    );
  } catch (error) {
    say($("save-status"), error.message, true);
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

function collect() {
  const profile = { ...state.profile };
  document.querySelectorAll("[data-key]").forEach((input) => {
    const value = input.value.trim();
    if (value) profile[input.dataset.key] = value;
    else delete profile[input.dataset.key];
  });
  for (const section of REPEATABLE) {
    profile[section.key] = (profile[section.key] || []).filter((entry) =>
      Object.values(entry).some((v) => String(v || "").trim())
    );
  }
  profile.work_locations = normalizePlaces(profile.work_locations);
  profile.custom_answers = normalizeAnswers(profile.custom_answers);
  return profile;
}

async function save() {
  const profile = collect();
  const extraText = $("extra").value;
  await chrome.storage.local.set({ profile, extraText });
  state.profile = profile;
  renderPlaces(); // show the lists as saved: blanks and duplicates gone
  renderAnswers();
  const { buildOptions } = await import("./lib/profile.js");
  const count = Object.keys(buildOptions(profile, extraText)).length;
  const docs = Object.keys(state.documents).length;
  say(
    $("save-status"),
    `Saved — ${count} answer${count === 1 ? "" : "s"} available` +
      (docs ? `, ${docs} document${docs === 1 ? "" : "s"} stored.` : ".")
  );
}

$("save-key").addEventListener("click", async () => {
  const apiKey = $("key").value.trim();
  if (!apiKey) return say($("key-status"), "Enter a key first.", true);
  await chrome.storage.local.set({ apiKey });
  say($("key-status"), "Saved.");
});

$("save").addEventListener("click", save);

/**
 * Empty the profile: every labelled field, both repeated sections, and the
 * extra lines. The API key and stored documents are separate things with
 * their own Remove buttons, so they stay. Saved immediately -- a clear that
 * only lasted until reload would look like it had failed.
 */
$("clear").addEventListener("click", async () => {
  const ok = confirm(
    "Clear every profile field, all education and experience entries, and " +
      "the extra lines?\n\nYour API key and stored documents are kept. " +
      "This cannot be undone."
  );
  if (!ok) return;
  document.querySelectorAll("[data-key]").forEach((input) => {
    input.value = "";
    delete input.dataset.drafted;
  });
  $("extra").value = "";
  state.profile = {};
  renderRepeatables();
  renderPlaces();
  renderAnswers();
  await chrome.storage.local.set({ profile: {}, extraText: "" });
  say($("save-status"), "Cleared. Your API key and documents are untouched.");
});

// Ctrl/Cmd-S saves, because a form this long invites losing work.
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    save();
  }
});

(async function load() {
  const { apiKey = "", profile = {}, extraText = "", documents = {} } =
    await chrome.storage.local.get(["apiKey", "profile", "extraText", "documents"]);
  state = { profile, documents };
  $("key").value = apiKey;
  renderGroups(profile);
  renderPlaces();
  renderAnswers();
  renderRepeatables();
  renderDocuments();
  $("extra").value = extraText;
  if (apiKey) say($("key-status"), "Key stored.");
})();
