chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  const url = new URL(chrome.runtime.getURL("export.html"));
  url.searchParams.set("tab", String(tab.id));
  chrome.tabs.create({ url: url.href });
});
