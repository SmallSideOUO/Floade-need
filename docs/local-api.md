# Floade local API

Use this API to link a folder already added through the tray menu to an existing private GitHub repository. Floade saves the link and refreshes the tray. The user continues to use Preview, Push, and Delete as usual. Linking does not create repositories, commit files, or push them.

## Windows installer

The installer places `floade-api.ps1` and this guide (`AI-API.md`) beside `Floade.exe`. No Node.js, API key, port, or server configuration is needed. The client starts Floade if necessary and uses its local named pipe. GitHub access uses the existing GitHub CLI sign-in.

```powershell
$floadeApi = Join-Path $env:LOCALAPPDATA 'Programs\Floade\floade-api.ps1'
& $floadeApi -Method api.describe
& $floadeApi -Method folders.list
& $floadeApi -Method repositories.list
& $floadeApi -Method folders.link -Path 'C:\Users\you\Documents\Notes' -Repo 'you/notes'
```

For a custom installation, use the script beside that installation's `Floade.exe`. If PowerShell execution policy blocks the script, invoke it with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script> -Method ...`.

## npm / source checkout

```powershell
floade api api.describe
floade api folders.list
floade api repositories.list --owner your-organization --limit 1000
floade api folders.link --path 'C:\Users\you\Documents\Notes' --repo 'you/notes'
# From a source checkout: node bin/floade.mjs api <method> <flags>
```

Clients print one JSON response; success exits with code 0, failure with code 1.

## Agent workflow

1. Call `folders.list` to find the exact registered folder path and current link.
2. Call `repositories.list` to find writable private repositories owned by the signed-in account. Supply `owner` for an organization or another owner. The default limit is 100; maximum 1000. `possiblyTruncated=true` means the list may be incomplete. A known exact repository can be passed directly to `folders.link` without listing it first.
3. Choose the repository specified by the user. Ask when the target is ambiguous.
4. Call `folders.link` with the absolute path and `owner/repo`.
5. Inspect `ok`, then confirm the saved link with `folders.list`.

The same link can be requested again safely (`changed=false`). To intentionally replace a different existing link, use `-Replace` in PowerShell or `--replace` in the CLI. An unlinked folder's Push stays disabled until it has a link and changes to push. The Link menu and repository picker have been removed.

Example success:

```json
{"ok":true,"result":{"folder":{"path":"C:\\Users\\you\\Documents\\Notes","repo":"you/notes"},"changed":true}}
```

Example failure:

```json
{"ok":false,"error":{"code":"ALREADY_LINKED","message":"This folder has another link. Set replace=true to change it.","currentRepo":"you/old-notes"}}
```

Other errors include `FOLDER_NOT_FOUND`, `FOLDER_UNAVAILABLE`, `FOLDER_BUSY`, `GITHUB_CLI_MISSING`, `GITHUB_AUTH_REQUIRED`, `GITHUB_REQUEST_FAILED`, `REPOSITORY_NOT_PRIVATE`, `REPOSITORY_NOT_WRITABLE`, `REPOSITORY_MISMATCH`, and `INVALID_PARAMS`. A GitHub login requires the account owner's browser authorization: `gh auth login --hostname github.com --web`. No credentials are returned by the Floade API.

## Direct transport

Send a single UTF-8 JSON object followed by a newline. Read the JSON response through the terminating newline. Windows pipe: `\\.\pipe\floade-local-data-control`; Unix socket: `<os.tmpdir()>/floade-local-data-control.sock`. API version: 1. Maximum request size: 64 KiB. Allow up to 80 seconds for GitHub requests. Legacy `ping` and `stop` commands still return plain `ok`.

```json
{"method":"folders.link","params":{"path":"C:\\Users\\you\\Documents\\Notes","repo":"you/notes","replace":false}}
```

This is a local tool interface for agents with access to this computer. It does not embed an AI model or automatically call an AI when a folder is added.
