const $ = (id) => document.getElementById(id);
const secs = (ms) => (ms === null || ms === undefined ? "?" : `${(ms / 1000).toFixed(2)}s`);

async function render() {
  const { runs = [], tool = "", enabled = true } = await chrome.storage.local.get(["runs", "tool", "enabled"]);
  $("enabled").checked = enabled;
  $("tool").value = tool;
  $("runs").innerHTML = "";
  for (const r of runs.slice(0, 30)) {
    const tr = document.createElement("tr");
    const load = r.trigger === "step change" ? "step" :
      r.cache ? `${r.trigger}, ${r.cache.fromCache}/${r.cache.scripts} cached` : r.trigger;
    for (const text of [r.tool, secs(r.fillMs), secs(r.formShownMs), r.fields, load]) {
      const td = document.createElement("td"); td.textContent = text; tr.appendChild(td);
    }
    tr.title = `${r.title}\n${r.url}\nfill timed from ${r.startedBy}`;
    $("runs").appendChild(tr);
  }
  if (!runs.length) $("runs").innerHTML = '<tr><td colspan="5" class="muted">No runs yet.</td></tr>';
}

$("enabled").addEventListener("change", (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$("tool").addEventListener("input", (e) => chrome.storage.local.set({ tool: e.target.value.trim() }));
$("clear").addEventListener("click", async () => { await chrome.storage.local.set({ runs: [] }); render(); });
$("copy").addEventListener("click", async () => {
  const { runs = [] } = await chrome.storage.local.get("runs");
  await navigator.clipboard.writeText(JSON.stringify(runs, null, 2));
  $("status").textContent = `copied ${runs.length} runs`;
});
chrome.storage.onChanged.addListener(render);
render();
