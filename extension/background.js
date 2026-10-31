// ツールバーの拡張アイコンクリックでアーカイバ画面を開く。
// 既に開いていればそのタブを前面に出し、多重起動（ポーリング系統の重複）を防ぐ。
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('extension/index.html');
  const [t] = await chrome.tabs.query({ url });
  if (t) chrome.tabs.update(t.id, { active: true });
  else chrome.tabs.create({ url });
});
