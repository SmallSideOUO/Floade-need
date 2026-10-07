# Floade

[English](README.md) | [繁體中文](README.zh-TW.md)

Floade is a tiny system-tray app that links local folders to private GitHub repositories and pushes every local change in one click.

Launch it from the Windows Start menu or run `floade`. A small black floating ball with a breathing white light opens the Floade panel on hover. The tray menu contains only Settings and Show/Hide floating ball. AI tools link repositories through the local API.

## Why I built Floade

I wanted a fast way to keep my own data in a private repository instead of creating and maintaining another cloud database. My files stay in a normal local folder, while GitHub provides the remote storage layer I already use.

For my personal workflow, this gives me:

- A quick path from a local file to a private GitHub repository
- Git history for reviewing or restoring previous versions
- Multi-device access through the normal Git clone, pull, and push workflow
- GitHub-hosted availability without running my own server 24/7
- Plain files that remain usable without Floade

I also personally needed a faster way to translate text already visible on my screen. Instead of copying text and replacing the current clipboard contents, I can press a shortcut, drag over the text, and let Floade run local OCR before showing the translation.

Floade itself has no hosted backend and does not receive a copy of the linked folder. It automates local Git and GitHub CLI operations. Folder synchronization uses Git; continuous background pull and conflict resolution are not implemented yet.

## Features

- Provides a draggable transparent floating ball with a breathing white center; position and visibility are remembered locally
- Opens a compact hover panel with Add folder, translation tools, and folder cards for Preview, Push, and Delete; the panel stays open when the pointer moves into it and closes after leaving
- Expands folder cards to show their Markdown files, including files in subfolders; click a file to open it directly
- Creates Markdown documents from folder cards; document rows provide Rename and Delete, with deletion moving the file to the Recycle Bin after confirmation
- Shows recently opened documents at the top of the panel; renaming and deletion update that list
- Resizes the floating panel using its edges or bottom-right grip and remembers the chosen size
- Searches Markdown files across added folders; the global shortcut focuses search, Enter opens the selected document, and Esc closes the panel
- Adds existing local folders through the native folder picker
- Opens one or more local Markdown files in editable desktop windows
- Pastes screenshots with Ctrl+V, saves PNGs beside the Markdown in `images/`, and inserts relative image links
- Renders live Markdown with Edit, Split and Preview modes, including images, tables, task lists and fenced code blocks
- Supports always-on-top controls in both the Markdown picker and document windows
- Provides a global shortcut recorder with chords of up to three keys
- Translates a dragged screen region with bundled local OCR and Google Translate
- Lets translation windows change languages, swap both texts and their languages, and edit either text box
- Offers 55 common translation languages, grouped into frequent and other languages; selection frequency and recent use rank the frequent group, with history kept locally
- Shows additional translations below the primary result: expand Japanese, Spanish, or other languages together; expanded results update from the last edited text and can each be copied
- Opens a pinnable **Text translation** window from the floating panel; type in either box for automatic translation in both directions; **Translate** or `Ctrl+Enter` translates immediately
- Provides microphone and read-aloud buttons in both text boxes; speech input translates automatically, and clicking the active button again stops voice
- Provides English and Traditional Chinese interfaces with system-language detection and a manual override
- Applies one configurable opacity level to every Floade window
- Provides a local API for AI tools to list folders, find writable private GitHub repositories, and link folders; the Windows installer includes a client that needs no Node.js or API key
- Initializes Git, commits all current changes with `chore: sync data`, and pushes to `main`
- Uses the signed-in GitHub account's name and private reply address for commits when a linked folder has no Git author configured
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

Speech recognition and read-aloud use local Windows speech engines. Audio stays on your computer; recognized text is sent to Google Translate. Select the text box's language before using its microphone and allow desktop apps to access your microphone in Windows settings. Available languages depend on installed Windows speech packages; missing packages display a message. A listening session lasts up to five minutes. Closing the window stops voice.

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

Hover over the floating ball, or click it to focus the panel:

1. Select **Add folder** (`新增資料夾`) at the top of the panel and choose an existing local folder.
2. Ask your local AI assistant to link the folder to your private GitHub repository using the [Floade local API](docs/local-api.md). Existing links are preserved. First-time GitHub access uses `gh auth login --hostname github.com --web`.
3. Select **Push** on its folder card.

The tray's right-click menu offers only **Settings** and **Show/Hide floating ball**. Drag the ball to reposition it. Click a folder's name or arrow to expand its Markdown files, then click a file to open it directly. Click the folder again to collapse it. Search also finds files across folders. Use **Quit** at the bottom of the panel or `floade stop` to exit.

The panel's top section lists recently opened documents. Select **+ File** (`＋文件`) on a folder card to create and open a new Markdown document. Hover over a document row to reveal its **Rename** and **Delete** buttons. Names receive a `.md` extension automatically, and existing files are never overwritten. Delete asks for confirmation and moves the document to the Recycle Bin. An open document is saved before renaming or deleting; a conflicting draft blocks the operation until you resolve it. Drag a panel edge or its bottom-right grip to resize it; the size is remembered across restarts.

Select **Preview** (`預覽`) on a folder card to choose one or more `.md` files. For a linked folder with a clean Git working tree, Floade first checks the linked repository for updates; an empty folder is cloned automatically. Every selected file opens in its own editable window and is saved back to the original local file automatically. Use the pin button to keep either the picker or a Markdown window on top.

Open Markdown windows reload external file changes automatically. If the editor also has unsaved changes, Floade keeps the draft and blocks saving until you copy your edits and confirm **Reload from disk**.

Select **Edit**, **Split** or **Preview** at the top of a document window. The selected mode is remembered. The rendered view updates as you type, and relative images resolve from the Markdown file's directory. Rendering uses [Marked](https://marked.js.org/) and sanitizes its HTML with [DOMPurify](https://github.com/cure53/DOMPurify).

Take a screenshot, then press **Ctrl+V** in the document. Floade saves a uniquely named PNG in an `images` directory beside that Markdown file and inserts an image reference at the cursor. The Markdown autosaves and the image appears in the rendered view. Images remain alongside the document when it is renamed. Keep the images with the Markdown when moving or sharing files; pushing the folder includes them unless your Git ignore rules exclude them.

Select **Settings** (`設定`) from the main tray menu to record system-wide shortcuts for opening the floating panel and OCR screen translation. A shortcut may contain up to three simultaneous keys. The default translation shortcut is `Alt+Shift+T`. Press it, drag a rectangle around the text, and Floade opens the translated result without reading or replacing the clipboard. Chinese is translated to English; other detected languages are translated to Traditional Chinese. The same page controls the interface language and the opacity of all Floade windows from 40% to 100%. Floade follows the operating-system language by default and falls back to English for unsupported languages.

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

On Windows, the installed app starts in the background at sign-in by default. Use **Settings → Start with Windows** to turn this on or off; the setting persists across launches. The automatic push uses the same safe Git flow as manual **Push** and only attempts folders with local changes. If Floade is closed or the computer is off at 20:00, it tries once after the next launch that day. Failed pushes show an error and can be retried manually.

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
