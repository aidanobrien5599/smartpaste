chrome.storage.local
  .get(["snippets", "supplementary", "apiKey"])
  .then(({ snippets = {}, supplementary = {}, apiKey }) => {
    const resumeOnly = Object.keys(snippets).filter((k) => k.startsWith("s")).length;
    document.getElementById("snippets").textContent = resumeOnly || "none";
    document.getElementById("supplementary").textContent =
      Object.keys(supplementary).length || "none";
    document.getElementById("key").textContent = apiKey ? "stored" : "missing";
  });

document.getElementById("open-options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
