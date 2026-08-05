# Floade

[English](README.md) | [繁體中文](README.zh-TW.md)

Floade 是一個小型系統匣工具，可以把本機資料夾連結到 GitHub Private Repo，並用一次點擊 Push 所有本機變更。

Floade 沒有主視窗。執行 `floade` 後，從系統匣選單新增資料夾、連結 Repo、Push 變更或退出即可。

## 功能

- 靜默常駐於系統匣
- 透過系統資料夾選擇視窗加入現有資料夾
- 使用本機 GitHub CLI 的登入狀態列出 Private Repo
- 自動初始化 Git，以 `chore: sync data` 提交所有目前變更並 Push 至 `main`
- 顯示處理中、成功及失敗通知
- 連結的資料夾路徑只儲存在本機；GitHub 憑證仍由 GitHub CLI 管理
- 支援 `floade`、`floade stop` 及 `floade restart`

## 安全警告

Floade **不會加密你的檔案**。除了資料夾 `.gitignore` 已排除的內容之外，Floade 會 Stage 並 Commit 連結資料夾中的所有檔案。

Push 敏感資料前請注意：

- 只連結由你控制的 Private Repo。
- 先檢查資料夾內容及其 `.gitignore`。
- 即使日後刪除敏感資料，內容仍可能保留在 Git 歷史中。

## 系統需求

- Node.js 22 或更新版本
- Git
- 已透過 `gh auth login` 登入的 [GitHub CLI](https://cli.github.com/)

目前版本已在 Windows 測試。執行環境使用 Electron 的跨平台系統匣 API，但 macOS 與 Linux 的打包及 QA 尚未完成。

## 從 GitHub 安裝

```powershell
npm install --global github:SmallSideOUO/Floade-need
floade
```

如果其他套件已經提供全域 `floade` 指令，請先解除安裝或重新命名該套件。

## 使用方式

右鍵點擊 Floade 系統匣圖示：

1. 選擇「新增資料夾」，加入一個現有的本機資料夾。
2. Hover 資料夾路徑並選擇 `Link`。
3. 從目前 GitHub CLI 帳號選擇一個 Private Repo。
4. 選擇 `Push`。

`Push` 相當於執行：

```text
gh auth setup-git
git init
git remote add/set-url origin
git add -A
git commit -m "chore: sync data"
git branch -M main
git push -u origin main
```

Floade 不會執行 Force Push。如果遠端 Repo 存在衝突的 Git 歷史，Floade 會顯示失敗通知，而不是覆蓋遠端內容。

## 指令

```powershell
floade          # 在背景啟動
floade stop     # 停止背景程序
floade restart  # 重新啟動背景程序
```

## 開發

```powershell
git clone https://github.com/SmallSideOUO/Floade-need.git
cd Floade-need
npm install
npm run check
npm start
```

## 授權

[MIT](LICENSE)
