# Floade Work Map Codex plugin

本機 stdio MCP，使用 Node.js 18+，不需要安裝額外套件。先開啟 Floade 的 Work Map，plugin 才能讀寫。只經過現有 AI API，不直接讀取私人地圖。

在 Floade-need 根目錄執行：

```powershell
codex plugin marketplace add .
codex plugin add floade-work-map@floade
```

在 Codex 的 Plugins 選擇 Floade → Floade Work Map。若目前對話尚未載入工具，重新開啟對話後使用。工具包括 `graph`、`describe`、`history`、`apply`、`screenshot`，修改沿用版本檢查與加密紀錄。

預設連接 `%USERPROFILE%/.floade/work-map/api-runtime.json`（macOS／Linux 為 `~/.floade/work-map`），避開 Codex 的 MSIX AppData 轉址；新目錄尚未建立時相容舊 AppData 連線。測試可在 MCP 程序環境設定 `FLOADE_WORK_MAP_PROFILE` 指向獨立 profile；工具參數不能更換 profile 或指定遠端主機。連接 metadata 每次重新讀取，app 重開不需重新保存 token。

`plugin.json`／`mcp.json` 是 portable 格式；`.codex-plugin/plugin.json`／`.mcp.json` 提供 Codex 相容設定。安裝時使用來源目錄，不手動改動 plugin cache。這是本機 plugin，並未發佈至公開 plugin 目錄。

驗證：`node --test plugins/floade-work-map/tests/*.test.cjs`。UI／API 規格見專案 `experiments/shared-map/README.md`。
