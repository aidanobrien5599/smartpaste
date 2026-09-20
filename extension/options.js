import { GROUPS } from "./lib/schema.js";

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

function collect() {
  const profile = {};
  document.querySelectorAll("[data-key]").forEach((input) => {
    const value = input.value.trim();
    if (value) profile[input.dataset.key] = value;
  });
  return profile;
}

async function save() {
  const profile = collect();
  const extraText = $("extra").value;
  await chrome.storage.local.set({ profile, extraText });
  const extras = extraText.split(/\r?\n/).filter((l) => l.trim().length >= 8).length;
  const total = Object.keys(profile).length;
  say(
    $("save-status"),
    `Saved — ${total} labelled answer${total === 1 ? "" : "s"}` +
      (extras ? ` and ${extras} extra line${extras === 1 ? "" : "s"}.` : ".")
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
  const { apiKey = "", profile = {}, extraText = "" } =
    await chrome.storage.local.get(["apiKey", "profile", "extraText"]);
  $("key").value = apiKey;
  renderGroups(profile);
  $("extra").value = extraText;
  if (apiKey) say($("key-status"), "Key stored.");
})();
