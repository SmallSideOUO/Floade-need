# Floade Remote

## Saved devices after Windows startup (0.1.33)

Windows can redirect AppData writes into an MSIX parent's private profile when Floade is launched from that parent. Normal startup then sees a different profile. If `remote.json` is missing, Floade recovers the newest valid saved-device profile from the same Windows user's Codex package cache. When Chromium profile keys differ, Windows DPAPI unlocks the old key in memory and the current protected storage re-encrypts each password. Plaintext passwords and keys are never saved or logged. Floade flushes and atomically creates the restored file, and retains the original shadow as a timestamped backup. An existing profile, including an intentionally empty device list, is never replaced. The current Local State, native engine identity and host keys are not replaced.

## Direct P2P only (0.1.30)

Floade no longer connects through RustDesk relay servers or WebRTC TURN. TCP, UDP and WebRTC direct connections remain available; a failed direct connection reports an error instead of relaying. This applies to outgoing desktop/file sessions and incoming sessions handled by the updated engine. Public ID-server discovery and NAT signaling are still used and may require account login. Direct-only transport does not guarantee low network delay or a connection through every NAT/firewall.

The connection page removes force-relay and relay-server controls. The API rejects `forceRelay=true` and nonempty `relayServer`, and ignores those preferences in older saved state. Update the Windows service along with the bundled engine; the controller refuses to connect using an older running engine without the direct-only capability. Existing identity, passwords and favorites are preserved.

The floating dot has a Remote action below Add folder. It opens the local device ID, password-based outgoing connection, recent devices and Windows-protected remembered credentials. Settings also opens the same remote settings panel. An independent native Flutter engine handles incoming connections, media and the remote toolbar; it starts hidden with Floade and retains the advanced native tools.

The device code is generated separately on each device. Never copy FloadeRemote.toml, host key material, or encrypted remote.json between devices. Only the hardware codec cache may be reused from RustDesk on the same Windows installation. Floade stores its remote preferences separately from folders.json and Work Map data.

In 0.1.29, the controller rereads saved remote preferences/devices before requests and merges writes against the current file. A running controller no longer hides a device restored on disk or replaces it with its stale in-memory list during a later settings write. Writes flush their temporary file before atomic replacement. This preserves favorites across ordinary restarts; credentials remain protected by the same Windows account.

## Local API

Call api.describe for the authoritative list. remote.settings.get redacts remembered credentials. remote.password.temporary is the explicit operation that reveals the temporary password. Authentication, password checks and local approval remain enforced by RustDesk.

## Favorite devices (0.1.27)

The connection page puts **Favorite devices** first. Choose **Add device**, enter a code, name and the receiving computer's permanent password, then **Save device**. Saving works without launching the engine or connecting; it does not verify the password. Desktop and file buttons reuse the Windows-protected credential. Edit can rename a device or replace its password; blank keeps the existing password, and unchecking Remember removes the Floade credential. Remove deletes the saved device and asks the running native engine to forget its cached password. Stored credentials belong to this Windows user and cannot be moved to another computer/account.

Previously remembered devices become favorites automatically. Up to 50 favorites persist independently of the last 50 non-favorite connections, including across app restarts. Favorites may also be saved without passwords; authentication then appears in the native window. Temporary passwords may expire, so permanent passwords are needed for unattended access. Changing the receiving computer's password requires editing the saved password here.

`remote.devices.save` takes `deviceId`, optional `alias`, write-only `password`, `remember` (default true) and `favorite` (default true). An omitted or empty password preserves the credential; `remember=false` removes it. It never changes incoming permissions. `remote.settings.get` returns `favorite` and `hasPassword` without returning encrypted or plaintext credentials. `remote.connect` uses an existing credential when no password is supplied.

For full unattended access, configure the **receiving/home computer** once: set a permanent password, grant the controlling device code under **Full-access devices**, and install the Windows system service for administrator applications and the login screen. Then save the home computer on the controlling device. The connection page links to setup for **this computer**; saving a favorite cannot elevate a different computer or bypass its permissions. Windows UAC consent is required once for service installation. The native engine and password authentication are unchanged.

Examples (PowerShell helper installed beside Floade.exe):

```powershell
& .\floade-api.ps1 -Method remote.status
& .\floade-api.ps1 -Method remote.settings.get
& .\floade-api.ps1 -Method remote.settings.update -ParamsJson '{"settings":{"fps":60,"quality":70,"gpu":true,"forceRelay":false}}'
& .\floade-api.ps1 -Method remote.connect -ParamsJson '{"deviceId":"123456789"}'
```

For passwords, construct ParamsJson in memory from a secure prompt; do not put secrets literally into shell history. Node clients use requestLocalApi({method, params}) over the existing local named pipe. The native frontend uses an ephemeral IPv4 loopback listener with a per-launch 256-bit capability stored only in the current user's profile. It rejects browser-origin requests and does not expose a LAN listener.

GPU/display preferences apply to new sessions, including previously visited peers. Direct connectivity remains dependent on NAT/firewall/server conditions; an unavailable direct route fails. Requested FPS is a preference, not a guaranteed delivered rate.

## Mobile hotspot P2P (0.1.26)

**Calculate best connection** ranks the seven nonempty TCP / UDP / WebRTC combinations using per-device connection history, separately for desktop and files. The score weights smoothed success rate (up to 120), stable duration (20), delivered/requested FPS ratio (20), shared-channel delay (10) and connection time (5); a failure loses up to 60 points for five minutes. An older remembered stable profile gets priority when no measured history is available. With no history, UDP/WebRTC is the starting choice. This is a best estimate from observed routes, not a simultaneous benchmark of all possible paths. There is no relay fallback.

A desktop route is successful only after a direct authenticated session has received an image and stayed connected for 15 seconds. A working route stays fixed even if FPS or delay changes. Network errors must persist for 15 seconds before disconnecting and ranking the remaining alternatives; a handshake still has a 45-second deadline. Performance evidence is saved every 30 seconds while connected. Samples must be fresh, direct, from after the current attempt began and unambiguous; missing metrics do not fail a working route. Delay measures a shared-channel probe and processing, not input-to-display latency. History is stored alongside each saved device without replacing settings, aliases or protected credentials, and survives editing and restarting.

A failed sweep waits 15, 30, then at most 60 seconds before ranking again until cancelled. DNS/network-unavailable errors wait without consuming all profiles. Password/permission prompts pause automatic work and stay open for the user. Closing the native tab or choosing **Stop / disconnect** cancels retries. An engine process loss preserves the pending connection and credentials in memory, restarts the engine, and resumes the requested session.

**Manual: mobile network P2P** selects `connectionMode=manual`, `tcpPunch=false`, `udpPunch=true`, `webrtc=true`. Other manual combinations remain available under Remote settings. Setting transport switches through the API without an explicit `connectionMode` selects manual mode for compatibility. Use `remote.settings.update` with `connectionMode=auto` to restore automation. Settings do not change an established session. Automatic mode owns one outgoing native window at a time because transport options are global and closing a native window closes its tabs; close existing sessions before starting it. Manual mode retains the existing multi-session behavior.

`remote.status.automatic` reports the current profile, selection score, locked state, attempt and bounded recent attempt history without passwords. `remote.connection.cancel` stops automatic work and closes its active window. Automatic connections require the native `autoConnectStatus` capability. The automatic-mode button changes only `connectionMode`, preserving the user's manual transport switches and all other preferences.

The connection page displays the actual sampled route and per-display FPS while an outgoing window is active. A selected preference alone is not proof of a direct connection. The observed mobile hotspot session used direct WebRTC without relay. From 0.1.30 the native engine blocks relay fallback. Public-server availability and other carrier NAT/firewall policies can differ.

## Native engine and installation

### Relative mouse shortcut (0.1.28)

From 0.1.29, Windows Floade relative mode uses foreground raw mouse counts at an 8 ms polling interval, independent of display scaling and cursor recentering. Absolute canvas refresh/edge events are suppressed while it is active. Losing focus or moving the window exits the mode and releases the cursor; use the shortcut again after refocusing. This fix is on the controlling computer. Games that reject simulated input still depend on their own input policy.

On Windows, click inside a remote desktop image and press **Ctrl+Alt** to toggle relative mouse movement on or off. The shortcut is handled locally, fires once per press, and releases remote modifier keys when switching. It only applies to eligible desktop sessions with keyboard permission and a supported peer; it is not a system-wide shortcut.

Under **Remote settings → Relative mouse shortcut**, focus the shortcut field, press a new combination, and save. For example, use **Ctrl+Alt+M**, **Ctrl+Shift+1**, or **F8**. **Restore Ctrl+Alt** resets the field; save to apply it. The preference persists on this controlling computer and applies to its existing and future remote windows once the updated runtime is loaded. The API setting is `relativeMouseShortcut`.

Runtime files live in resources/remote. The frontend and helper server can continue receiving connections after the Floade panel closes. The default runtime operates within the signed-in user's desktop. Windows login-screen/UAC access requires installing the engine's native system service from Advanced tools, with Windows administrator privileges; this is separate from installing the per-user Floade app. An existing RustDesk service is preserved.

Before updating, close native session windows through remote.shutdown, then stop only processes whose exact executable path is the bundled resources/remote/FloadeRemote.exe. Do not stop the user's unrelated RustDesk processes. Back up Floade configuration and the engine profile first. Preserve folders.json, remote.json, native identity/credentials and the standalone Work Map profile.

## Building

Build the engine from the pinned revision in vendor/remote/source.json using its scripts/floade-build-ui.ps1 (Rust 1.75, Flutter 3.24.5 plus the committed upstream dropdown patch, bridge codegen 1.80.1, pinned vcpkg and hwcodec/vram features). It needs Visual Studio C++ tools, matching generated bridge files and the SHA-256-pinned RustDesk Flutter engine with its matching AOT generator. Install native dependencies as documented in the engine repository. When Windows developer mode is unavailable, create local directory junctions for Flutter plugin paths rather than changing global Windows settings.

Copy the resulting branded-windows-x64 folder to vendor/remote/windows-x64, then npm ci, npm run check, npm test, npm run test:preview and npm run dist:win -- --publish never. The runtime must contain its integrity manifest. Publish the exact engine source revision and runtime archive alongside the app installer, latest.yml and blockmap. See THIRD-PARTY-NOTICES.md and LICENSE for source and redistribution information.

TCP, UDP and WebRTC direct-connection options are available in manual settings and remote.settings.update (tcpPunch, udpPunch, webrtc). Display/transport changes take effect on new connections. Automatic mode reevaluates after a persistent network failure; in manual mode, change the failing punch route and reconnect. Performance probes are not input-to-display measurements.

## Full access and Windows service (0.1.24)

The remote settings page exposes the same operations as the local API:

```powershell
& .\floade-api.ps1 -Method remote.access.grant -ParamsJson '{"deviceId":"1370592362","alias":"筆電"}'
& .\floade-api.ps1 -Method remote.access.grant -ParamsJson '{"deviceId":"1157168970","alias":"桌機"}'
& .\floade-api.ps1 -Method remote.access.get
& .\floade-api.ps1 -Method remote.service.install
& .\floade-api.ps1 -Method remote.service.status
```

Run these on each receiving computer. The full-access allowlist allows only the listed incoming IDs and uses the upstream `access-mode=full`, including keyboard, clipboard, files, audio, camera, terminal, tunnel, restart, recording, block input, privacy and printer permissions where supported. The regular per-feature checkboxes do not restrict full mode. Password authentication is retained. RustDesk's incoming ID is self-reported: this is a password-authenticated ID filter, not cryptographic device trust. Protect the password; knowing an allowed code alone never authorizes login.

`remote.access.revoke` removes an ID; an enabled empty list denies all. `remote.access.disable` restores the pre-existing native access mode and ID filter. Changes apply to new incoming sessions; disconnect an existing session to revoke its current access. Native advanced settings may change the underlying policy; `effective=false` exposes that drift rather than silently claiming enforcement.

`remote.service.install` verifies every bundled runtime digest and invokes the native installer, copying the engine into protected `Program Files\FloadeRemote` and installing its independent automatic LocalSystem service. Close remote sessions first. Windows UAC consent is required and cannot be bypassed through the API. The existing RustDesk service is not changed. Native installation may restart the remote engine; use `remote.start` afterward.

`remote.service.status.ready` requires a running automatic LocalSystem service, the expected protected executable path and matching executable/native-library/AOT hashes. Installation request success is not proof of readiness. This service supports privileged applications, secure desktop and login-screen capture/input according to native Windows capabilities; actual end-to-end secure-desktop operation must be tested separately. It does not grant the signed-in Windows account membership in Administrators or disclose Windows credentials. Update the system service after upgrading Floade if `binaryMatchesBundle=false`.


## Background engine recovery (0.1.32)

Floade keeps one app tray icon; the Windows FloadeRemote profile does not create its own tray icon. Its incoming system service and hidden managed UI continue to run. Advanced tools and actual desktop/file windows remain available through Floade.

Engine starts share one promise, make at most three launch attempts per round, and use a real 15-second readiness deadline for each launch with short health probes. A background health check every five seconds restores a lost engine; a failed round waits 30 seconds before retrying. Only a process created by a failed startup attempt is terminated. The system service and existing native sessions are never killed as startup cleanup. Explicit remote.shutdown, application quit and update preparation stop supervision.

Native Floade main windows always expose the capability control channel, including when a tray/installer opened the main window without the managed argument. Control-channel bind/publication failures retry within the existing process, endpoint files are atomically replaced, and native commands have a deadline. Remote UI status polling starts independently of engine initialization, and clears its startup message after recovery. remote.status.engine exposes starting/recovering/waiting/ready/blocked state without secrets. Installation/integrity errors still require fixing the installation; automatic recovery does not bypass Windows UAC.
