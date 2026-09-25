chrome.storage.local
  .get(["profile", "extraText", "apiKey"])
  .then(({ profile = {}, extraText = "", apiKey }) => {
    document.getElementById("profile").textContent =
      Object.keys(profile).length || "none";
    document.getElementById("extra").textContent =
      extraText.split(/\r?\n/).filter((l) => l.trim().length >= 8).length || "none";
    document.getElementById("key").textContent = apiKey ? "stored" : "missing";
  });

document.getElementById("fill").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "fill-page" });
  window.close();
});

document.getElementById("open-options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
