# Floade

[English](README.md) | [繁體中文](README.zh-TW.md)

Floade is a tiny system-tray app that links local folders to private GitHub repositories and pushes every local change in one click.

It has no main window. Launch it from the Windows Start menu or run `floade`, then use the tray menu to add folders, link repositories, push changes, or quit.

## Why I built Floade

I wanted a fast way to keep my own data in a private repository instead of creating and maintaining another cloud database. My files stay in a normal local folder, while GitHub provides the remote storage layer I already use.

For my personal workflow, this gives me:

- A quick path from a local file to a private GitHub repository
- Git history for reviewing or restoring previous versions
- Multi-device access through the normal Git clone, pull, and push workflow
- GitHub-hosted availability without running my own server 24/7
- Plain files that remain usable without Floade

I also personally needed a faster way to translate text already visible on my screen. Instead of copying text and replacing the current clipboard contents, I can press a shortcut, drag over the text, and let Floade run local OCR before showing the translation.

Floade itself has no hosted backend and does not receive a copy of the linked folder. It only automates local Git and GitHub CLI operations. Multi-device synchronization currently uses Git; automatic background pull and conflict resolution are not implemented yet.

## Features

- Runs quietly in the system tray
- Adds existing local folders through the native folder picker
- Opens one or more local Markdown files in editable desktop windows
- Supports always-on-top controls in both the Markdown picker and document windows
- Provides a global shortcut recorder with chords of up to three keys
- Translates a dragged screen region with bundled local OCR and Google Translate
- Lets translation windows change or swap languages and edit both the source and translated text
- Provides English and Traditional Chinese interfaces with system-language detection and a manual override
- Applies one configurable opacity level to every Floade window
- Opens a GitHub sign-in flow from the Link window when GitHub CLI is signed out, then lists private repositories
- Initializes Git, commits all current changes with `chore: sync data`, and pushes to `main`
- Automatically pushes changed linked folders once daily at 20:00 local time while Floade is running; launching after 20:00 catches up that day's push
- Shows processing, success, and failure notifications
- Keeps linked folder paths locally; GitHub credentials remain managed by GitHub CLI
- Supports `floade`, `floade stop`, and `floade restart`

## Screenshots

| Tray workflow | Editable Markdown |
| --- | --- |
| ![Floade tray menu](docs/images/tray-menu.png) | ![Floade Markdown window](docs/images/markdown.png) |
| Settings | OCR translation |
| ![Floade settings](docs/images/settings.png) | ![Floade translation window](docs/images/translation.png) |

## Security warning

Floade **does not encrypt your files**. It stages and commits every file in a linked folder, except files already excluded by that folder's `.gitignore`.

Screen OCR runs locally. After OCR, the recognized text is sent to Google Translate to produce the translation. Do not translate sensitive text that you do not want to send to Google.

Before pushing sensitive data:

- Link only a private repository you control.
- Review the folder contents and its `.gitignore`.
- Remember that deleted secrets may remain in Git history.

## Requirements

- Windows 10 or newer for the installer
- Git
- [GitHub CLI](https://cli.github.com/) (Floade can start its browser sign-in from the Link window)
- Node.js 22 or newer only when installing from the command line

The current release has been tested on Windows. The runtime uses Electron's cross-platform tray APIs, but macOS and Linux packaging and QA are still pending.

## Install

### Windows installer

Download and run the latest `Floade-Setup-*.exe` from [GitHub Releases](https://github.com/SmallSideOUO/Floade-need/releases/latest). The current installer is not code-signed, so Windows SmartScreen may display a warning.

### The easy way

Tell Codex or Claude Code:

> Install Floade for me: https://github.com/SmallSideOUO/Floade-need

### The command-line way

```powershell
npm install --global github:SmallSideOUO/Floade-need
floade
```

If another package already provides a global `floade` command, uninstall or rename that package first.

## Usage

Right-click the Floade tray icon:

1. Select **Add folder** (`新增資料夾`) and choose an existing local folder.
2. Hover the folder path and select **Link**.
3. If prompted, select **Sign in to GitHub**, enter the displayed device code in the browser, and authorize GitHub CLI. Then choose a private repository.
4. Select **Push**.

Select **Preview** (`預覽`) from a folder submenu to choose one or more `.md` files. For a linked folder with a clean Git working tree, Floade first checks the linked repository for updates; an empty folder is cloned automatically. Every selected file opens in its own editable window and is saved back to the original local file automatically. Use the pin button to keep either the picker or a Markdown window on top.

Select **Settings** (`設定`) from the main tray menu to record system-wide shortcuts for opening the Floade menu and OCR screen translation. A shortcut may contain up to three simultaneous keys. The default translation shortcut is `Alt+Shift+T`. Press it, drag a rectangle around the text, and Floade opens the translated result without reading or replacing the clipboard. Chinese is translated to English; other detected languages are translated to Traditional Chinese. The same page controls the interface language and the opacity of all Floade windows from 40% to 100%. Floade follows the operating-system language by default and falls back to English for unsupported languages.

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

On Windows, the installed app starts at sign-in so the daily push can run. The automatic push uses the same safe Git flow as manual **Push** and only attempts folders with local changes. If Floade is closed or the computer is off at 20:00, it tries once after the next launch that day. Failed pushes show an error and can be retried manually.

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

## Community

Questions, feedback, and ideas are welcome in the [Floade Discord](https://discord.gg/nKe2QAxF9).

## License

[MIT](LICENSE)
