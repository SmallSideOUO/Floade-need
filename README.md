# Floade

[English](README.md) | [繁體中文](README.zh-TW.md)

Floade is a tiny system-tray app that links local folders to private GitHub repositories and pushes every local change in one click.

It has no main window. Start it with `floade`, then use the tray menu to add folders, link repositories, push changes, or quit.

## Features

- Runs quietly in the system tray
- Adds existing local folders through the native folder picker
- Uses the current GitHub CLI login to list private repositories
- Initializes Git, commits all current changes with `chore: sync data`, and pushes to `main`
- Shows processing, success, and failure notifications
- Keeps linked folder paths locally; GitHub credentials remain managed by GitHub CLI
- Supports `floade`, `floade stop`, and `floade restart`

## Security warning

Floade **does not encrypt your files**. It stages and commits every file in a linked folder, except files already excluded by that folder's `.gitignore`.

Before pushing sensitive data:

- Link only a private repository you control.
- Review the folder contents and its `.gitignore`.
- Remember that deleted secrets may remain in Git history.

## Requirements

- Node.js 22 or newer
- Git
- [GitHub CLI](https://cli.github.com/) authenticated with `gh auth login`

The current release has been tested on Windows. The runtime uses Electron's cross-platform tray APIs, but macOS and Linux packaging and QA are still pending.

## Install from GitHub

```powershell
npm install --global github:SmallSideOUO/Floade-need
floade
```

If another package already provides a global `floade` command, uninstall or rename that package first.

## Usage

Right-click the Floade tray icon:

1. Select **Add folder** (`新增資料夾`) and choose an existing local folder.
2. Hover the folder path and select **Link**.
3. Choose a private repository from the current GitHub CLI account.
4. Select **Push**.

`Push` runs the equivalent of:

```text
gh auth setup-git
git init
git remote add/set-url origin
git add -A
git commit -m "chore: sync data"
git branch -M main
git push -u origin main
```

Floade does not force-push. A repository with conflicting remote history produces a failure notification instead of overwriting the remote.

## Commands

```powershell
floade          # start in the background
floade stop     # stop the background process
floade restart  # restart the background process
```

## Development

```powershell
git clone https://github.com/SmallSideOUO/Floade-need.git
cd Floade-need
npm install
npm run check
npm start
```

## License

[MIT](LICENSE)
