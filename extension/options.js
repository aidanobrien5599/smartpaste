import { DOCUMENTS, GROUPS, ORDINALS, REPEATABLE } from "./lib/schema.js";
import { humanSize, MAX_BYTES, toBase64 } from "./lib/documents.js";

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
      input.placeholder = placeholder || "";
      input.value = profile[key] || "";
      wrap.append(tag, input);
      grid.appendChild(wrap);
    }
    section.appendChild(grid);
    host.append(heading, section);
  }
}

/* ------------------------------------------------------------- repeatables */

function entryNode(section, entry, index) {
  const node = document.createElement("div");
  node.className = "entry";
  node.dataset.section = section.key;

  const heading = document.createElement("h3");
  heading.textContent =
    `${ORDINALS[index] || `${index + 1}th most recent`} ${section.singular}`;
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
    input.placeholder = placeholder || "";
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
    hint.textContent =
      `Newest first. Each entry is labelled by position, so a form asking for ` +
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
  return profile;
}

async function save() {
  const profile = collect();
  const extraText = $("extra").value;
  await chrome.storage.local.set({ profile, extraText });
  state.profile = profile;
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
  renderRepeatables();
  renderDocuments();
  $("extra").value = extraText;
  if (apiKey) say($("key-status"), "Key stored.");
})();
