// 伊手 鳥獣出没マップの設定
// Apps Script を「ウェブアプリ」としてデプロイしたときの URL(…/exec)を API_URL に貼り付ける。
// 空のままだと「お試しモード」になり、投稿はこの端末のブラウザの中だけに保存される。
window.CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbxucnltYfjuhl1yotOYLeZ2_qXLeFxmM0-Uos1NmlwF11zeKCUI02m5TDkmOIXr3euy/exec",
  TITLE: "伊手 鳥獣出没マップ",
  SUBTITLE: "奥州市江刺伊手(旧伊手村)・農業集落17・筆5,330",
  REFRESH_SEC: 60          // 何秒ごとに新しい投稿を読み込むか
};
