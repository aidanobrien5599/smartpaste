import { snippetsFromResume, SUPPLEMENTARY } from "./lib/snippets.js";

const $ = (id) => document.getElementById(id);

function say(node, text, warn = false) {
  node.textContent = text;
  node.className = "status" + (warn ? " warn" : "");
}

/** Resume snippets plus the supplementary answers, as one option set. */
function combine(resumeSnippets, supplementary) {
  const merged = { ...resumeSnippets };
  Object.values(supplementary)
    .filter(Boolean)
    .forEach((value, i) => {
      merged[`x${String(i + 1).padStart(3, "0")}`] = value;
    });
  return merged;
}

async function persistSnippets() {
  const { resumeText = "", supplementary = {} } = await chrome.storage.local.get([
    "resumeText",
    "supplementary",
  ]);
  const resumeSnippets = resumeText ? snippetsFromResume(resumeText) : {};
  const snippets = combine(resumeSnippets, supplementary);
  await chrome.storage.local.set({ snippets });
  return { resumeSnippets, snippets };
}

function renderSnippets(snippets) {
  const list = $("snippet-list");
  list.innerHTML = "";
  Object.entries(snippets).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.textContent = `${key}  ${value}`;
    list.appendChild(row);
  });
  list.hidden = !Object.keys(snippets).length;
}

function renderSupplementary(values) {
  const host = $("supplementary");
  host.innerHTML = "";
  for (const [name, example] of SUPPLEMENTARY) {
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = name.replace(/_/g, " ");
    label.htmlFor = `sup-${name}`;
    const input = document.createElement("input");
    input.type = "text";
    input.id = `sup-${name}`;
    input.dataset.name = name;
    input.placeholder = example;
    input.value = values[name] || "";
    host.append(label, input);
  }
}

$("save-key").addEventListener("click", async () => {
  const apiKey = $("key").value.trim();
  if (!apiKey) return say($("key-status"), "Enter a key first.", true);
  await chrome.storage.local.set({ apiKey });
  say($("key-status"), "Saved.");
});

$("save-resume").addEventListener("click", async () => {
  const resumeText = $("resume").value;
  if (resumeText.trim().length < 80) {
    return say($("resume-status"), "That does not look like a resume.", true);
  }
  await chrome.storage.local.set({ resumeText });
  const { resumeSnippets, snippets } = await persistSnippets();
  renderSnippets(snippets);
  say(
    $("resume-status"),
    `${Object.keys(resumeSnippets).length} snippets from your resume, ` +
      `${Object.keys(snippets).length} options in total.`
  );
});

$("save-supplementary").addEventListener("click", async () => {
  const supplementary = {};
  document.querySelectorAll("#supplementary input").forEach((input) => {
    if (input.value.trim()) supplementary[input.dataset.name] = input.value.trim();
  });
  await chrome.storage.local.set({ supplementary });
  const { snippets } = await persistSnippets();
  renderSnippets(snippets);
  const blank = SUPPLEMENTARY.length - Object.keys(supplementary).length;
  say(
    $("supplementary-status"),
    blank
      ? `Saved. ${blank} still blank — those fields will fall through to a normal ⌘V.`
      : "Saved. All of them answered.",
    Boolean(blank)
  );
});

(async function load() {
  const { apiKey = "", resumeText = "", supplementary = {}, snippets = {} } =
    await chrome.storage.local.get(["apiKey", "resumeText", "supplementary", "snippets"]);
  $("key").value = apiKey;
  $("resume").value = resumeText;
  renderSupplementary(supplementary);
  renderSnippets(snippets);
  if (apiKey) say($("key-status"), "Key stored.");
})();
