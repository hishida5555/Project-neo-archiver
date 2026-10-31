// ツールバーの拡張アイコンクリックでアーカイバ画面を新規タブで開く。
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('extension/index.html') });
});
