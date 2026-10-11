# 共用地圖（實驗）

獨立 Electron 視窗，用來共用會持續改變的思考脈絡。尚未接到 Floade 主體，不在正式安裝包內，沒有傳送給 GPT 的功能。

在 need 專案根目錄執行 `npm ci`，然後 `npm run experiment:map`。Windows 也可以雙擊本資料夾的 `開啟共用地圖.vbs`，或執行 `Open Map.ps1`。

左側「由大到小」依上層目的與下層細項顯示；點選項目可移到該物件。物件的「上層目的／議題」可自由修改或留白。實線箭頭表示上層到下層，虛線表示跨分支關聯。層級不代表因果、執行順序或預先固定的計畫。上方脈絡列保留目前手上工作的來由，查看其他分支不會改變目前工作。

右鍵空白處新增；中鍵按住移動畫布；左鍵拖物件；滾輪縮放；F 看全圖。選取物件後可修改形狀、背景與文字色、大小、不透明度；右下角可拖曳調整大小。編輯面板可連線、設為目前工作或刪除。

AI 與畫面隱私各自控制，彼此不連動：

- 每個物件可設定完整、遮蔽文字或遮蔽整個物件。
- 全域 AI「全部開放」覆蓋個別 AI 限制；切回「依物件設定」會恢復限制。
- 全域畫面可依個別設定、全部顯示或遮蔽全部文字（整個物件的隱藏設定仍保留）；暫時顯示只影響當前選取物件。
- AI 只能依 `data/ai-map.json` 取得目前允許的內容。遮蔽物件會連同相關線與父層引用被排除。畫面遮蔽也涵蓋脈絡樹、上層選項與工作脈絡列。

`data/map.private` 使用 Electron safeStorage 加密；`data/ai-map.json` 是允許 AI 讀取的明文輸出。這是應用程式與 AI 的讀取約定，不是阻止所有本機工具存取資料的安全邊界。私人資料、輸出和測試 profile 都被 Git 忽略；提交的 seed 只有通用示範內容。

本機需要一次性整理時，可在 `data/organization.json` 放入 `{ "revision": "unique-id", "nodes": [{ "id": "node-id", "parentId": "parent-id", "title": "optional-title" }] }`。程式只更新當時 AI 可完整讀取的節點，不更動座標、外觀、隱私或跨分支連線；同一 revision 只套用一次。這個檔案也不提交。

`npm run test:map` 驗證層級循環、整理時資料保留與 AI 隱私組合。`tests/ui-check.js` 是 Playwright CLI 的獨立測試 profile 操作腳本：先以 `electron experiments/shared-map/main.cjs --map-profile=<絕對測試目錄> --remote-debugging-port=9246` 啟動測試視窗，再 attach 到該 CDP 埠，並 `run-code --filename=<此腳本絕對路徑>`。不要對使用者的私人 profile 執行測試。

3D 目前暫緩：先讓目的、選擇與驗證的關係清楚；日後可以用同一張圖的另一種視圖探索 3D，無須把第三維當成固定資料層級。
