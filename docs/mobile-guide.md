# Floade 手機文件

開啟 [Floade 手機文件](https://smallsideouo.github.io/Floade-need/mobile/)。Android Chrome 可從選單選擇「安裝應用程式」或「加入主畫面」。電腦 Floade 設定中也有「開啟手機版」；它只會在網址片段預填 repo，沒有包含權杖。

首次連線輸入 `owner/repository`、分支（桌面版目前使用 `main`）及 GitHub fine-grained personal access token。建立 token 時只選需要的儲存庫，將 **Contents** 設為 **Read and write**，設定到期時間。不要提供帳號密碼。API 憑證直接傳給 GitHub；公開網站只有程式碼，不包含私人文件或任何共用 token。

「記住此裝置」會將 token 保存在此網站的 IndexedDB 中；取消後只保留本次執行的授權。設定中的「登出此裝置」會確認後清除權杖、快取與本機草稿。使用受信任的個人裝置；若 token 遺失或裝置不再使用，在 GitHub 撤銷 token。

## 瀏覽與編輯

- 可展開資料夾、搜尋名稱與路徑，最近文件顯示在最上方。
- 預設渲染 Markdown；點「編輯」修改，再按「儲存」提交到 GitHub。
- 草稿即時存入本機。離線可開啟以前看過的文件及編輯；重新連線後，開啟文件並按「儲存」，不會擅自送出舊草稿。
- 支援儲存庫內的 PNG/JPEG/GIF/WebP 圖片；圖片經已授權的 GitHub API 載入。外部圖片不自動載入、原始 HTML 不執行。
- 文字文件與圖片目前各支援 1 MB 以內；完整目錄超過 GitHub Trees API 限制時會提示，不顯示不完整清單。
- 網路儲存成功時才顯示「已同步」，本機草稿不等於已送達。瀏覽器清除網站資料也會移除離線草稿，重要內容請完成同步。

## 同步與衝突

手機儲存時使用開啟版本的 SHA；另一端已修改時保留手機草稿，顯示最新版本。比較並編輯後，按「以此草稿合併儲存」，或確認放棄草稿後採用最新版本。不會自動改用新 SHA 覆蓋其他裝置內容。所有已提交版本仍在 GitHub 歷史中。

Floade 0.1.17 起，桌面版預設每 60 秒檢查已連結資料夾，僅自動接收能 fast-forward 的 `main` 更新。本機有未提交修改、尚未 Push 的分岔歷史、資料夾操作中或文件視窗開啟時暫停；關閉文件並處理本機修改後下次檢查會接收。資料夾的「更新」可立即檢查，設定可關閉自動接收。

電腦上尚未 Push 的文件不會出現在手機。自動 Pull 不會替你自動 Push，也不會 stash、reset、強制推送或自動處理分岔歷史；本機有修改時先用原本的 Push 工作流程。若兩端歷史分岔，先保留本機資料並處理 Git 合併，再繼續同步。

## 開發與發布

`npm run build:mobile` 從 `mobile/` 產生 `docs/mobile/`（含本機 Marked/DOMPurify、應用程式圖示與 service worker），GitHub Pages 以 `main` 的 `/docs` 發布。GitHub API 回應不進入 service worker 的 HTTP 快取；離線文件/圖片及草稿只在使用者瀏覽器的 IndexedDB。

手機互動驗證腳本：`scripts/test-mobile-browser.js`，以 playwright-cli 的 `run-code --filename` 在測試伺服器 `http://127.0.0.1:8765/mobile/` 執行。它使用 fixture API，涵蓋手機版面、儲存、離線重開、衝突與儲存中的後續輸入。
