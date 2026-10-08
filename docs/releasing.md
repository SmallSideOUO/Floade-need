# Windows stable releases

App updates use the public `SmallSideOUO/Floade-need` GitHub Releases channel. No GitHub token is included in the app. Only non-prerelease versions newer than the installed version are eligible. The download is verified against the SHA-512 in the generated `latest.yml` by electron-updater. Current installers are unsigned, as before; when a code-signing certificate is configured, electron-builder includes its publisher information for updater signature verification.

For each release:

1. Bump the package version with `npm version <version> --no-git-tag-version`.
2. Run `npm run check`, `npm test` and `npm run test:preview`.
3. Build with `node node_modules/electron-builder/cli.js --win nsis --x64 --publish never`.
4. Verify `dist/latest.yml` points to the new installer and contains its SHA-512 and size. Verify `dist/win-unpacked/resources/app-update.yml` targets this repository. Install and check the actual installed runtime using `floade-api.ps1 -Method app.status` and `-Method folders.list`.
   Run `node node_modules/electron/cli.js scripts/test-app-update.cjs` for real NSIS download/checksum verification with an isolated local feed, including rejection of a corrupt installer. Set `FLOADE_QA_APP_PATH` to the installed `resources/app.asar` when running `test:preview` to exercise its actual main process and renderer files with an isolated profile.
5. Commit and push the source, then tag the tested commit `v<version>` and push that tag.
6. Create a draft GitHub Release for that tag and upload **all three** files: `Floade-Setup-<version>.exe`, its `.exe.blockmap`, and `latest.yml`. Publish the draft as the latest stable release only after all files are present. Never replace an existing version's executable; ship a higher version instead.
7. Check `app.status` after a manual or scheduled update check, and verify the remote assets match the built files.
   Run `node node_modules/electron/cli.js scripts/test-app-update.cjs --github` after publishing to verify the real GitHub feed and full installer download, with an isolated simulated old version. The QA harness never launches an installer.

The updater waits 30 seconds after startup, then checks every six hours while automatic app updates are enabled. Turning off automatic app updates does not block a manual check. It downloads in the background but installs only when the user chooses **Restart and update**. The main process closes each document through the existing synchronous save/conflict checks and refuses to restart while folder operations are active. A normal quit or OS shutdown never installs a pending download.

The update EXE contains the application, not any local folders, credentials or settings. Upgrades preserve the local user profile and linked folder paths. Release 0.1.18 is the first updater-capable release; older installed versions need one manual upgrade.
