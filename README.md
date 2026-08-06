# Floade

[English](README.md) | [繁體中文](README.zh-TW.md)

Floade is a tiny system-tray app that links local folders to private GitHub repositories and pushes every local change in one click.

It has no main window. Start it with `floade`, then use the tray menu to add folders, link repositories, push changes, or quit.

## Why I built Floade

I wanted a fast way to keep my own data in a private repository instead of creating and maintaining another cloud database. My files stay in a normal local folder, while GitHub provides the remote storage layer I already use.

For my personal workflow, this gives me:

- A quick path from a local file to a private GitHub repository
- Git history for reviewing or restoring previous versions
- Multi-device access through the normal Git clone, pull, and push workflow
- GitHub-hosted availability without running my own server 24/7
- Plain files that remain usable without Floade

Floade itself has no hosted backend and does not receive a copy of the linked folder. It only automates local Git and GitHub CLI operations. Multi-device synchronization currently uses Git; automatic background pull and conflict resolution are not implemented yet.

## Features

- Runs quietly in the system tray
- Adds existing local folders through the native folder picker
- Opens one or more local Markdown files in editable desktop windows
- Supports always-on-top controls in both the Markdown picker and document windows
- Provides a global shortcut recorder with chords of up to three keys
- Applies one configurable opacity level to every Floade window
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

Select **Preview** (`預覽`) from a folder submenu to choose one or more `.md` files. For a linked folder with a clean Git working tree, Floade first checks the linked repository for updates; an empty folder is cloned automatically. Every selected file opens in its own editable window and is saved back to the original local file automatically. Use the pin button to keep either the picker or a Markdown window on top.

Select **Settings** (`設定`) from the main tray menu to record a system-wide shortcut that opens the Floade menu. A shortcut may contain up to three simultaneous keys. The same page controls the opacity of all Floade windows from 40% to 100%.

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
