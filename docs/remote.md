# Floade Remote

The floating dot has a Remote action below Add folder. It opens the local device ID, password-based outgoing connection, recent devices and Windows-protected remembered credentials. Settings also opens the same remote settings panel. An independent native Flutter engine handles incoming connections, media and the remote toolbar; it starts hidden with Floade and retains the advanced native tools.

The device code is generated separately on each device. Never copy FloadeRemote.toml, host key material, or encrypted remote.json between devices. Only the hardware codec cache may be reused from RustDesk on the same Windows installation. Floade stores its remote preferences separately from folders.json and Work Map data.

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

GPU/display preferences apply to new sessions, including previously visited peers. Direct connectivity remains dependent on NAT/firewall/server conditions and falls back to relay. Requested FPS is a preference, not a guaranteed delivered rate.

## Mobile hotspot P2P (0.1.26)

Choose **Mobile network P2P** in the connection page, then reconnect. This saves `forceRelay=false`, `tcpPunch=false`, `udpPunch=true`, and `webrtc=true`, preserving picture, GPU and authentication preferences. It avoids the TCP punch route that connected successfully but repeatedly reset with Windows error 10054 on the tested mobile hotspot. **Automatic direct connection** re-enables TCP punching as well as UDP/WebRTC. Neither button starts a connection or changes an established session.

The connection page displays the actual sampled P2P/relay route and per-display FPS while an outgoing window is active. A selected preference alone is not proof of a direct connection. The native engine retains relay fallback if direct routes cannot connect; the observed mobile hotspot session used direct WebRTC without relay. Public-server availability and other carrier NAT/firewall policies can differ.

## Native engine and installation

Runtime files live in resources/remote. The frontend and helper server can continue receiving connections after the Floade panel closes. The default runtime operates within the signed-in user's desktop. Windows login-screen/UAC access requires installing the engine's native system service from Advanced tools, with Windows administrator privileges; this is separate from installing the per-user Floade app. An existing RustDesk service is preserved.

Before updating, close native session windows through remote.shutdown, then stop only processes whose exact executable path is the bundled resources/remote/FloadeRemote.exe. Do not stop the user's unrelated RustDesk processes. Back up Floade configuration and the engine profile first. Preserve folders.json, remote.json, native identity/credentials and the standalone Work Map profile.

## Building

Build the engine from the pinned revision in vendor/remote/source.json using its scripts/floade-build-ui.ps1 (Rust 1.75, Flutter 3.24.5 plus the committed upstream dropdown patch, bridge codegen 1.80.1, pinned vcpkg and hwcodec/vram features). It needs Visual Studio C++ tools, matching generated bridge files and the SHA-256-pinned RustDesk Flutter engine with its matching AOT generator. Install native dependencies as documented in the engine repository. When Windows developer mode is unavailable, create local directory junctions for Flutter plugin paths rather than changing global Windows settings.

Copy the resulting branded-windows-x64 folder to vendor/remote/windows-x64, then npm ci, npm run check, npm test, npm run test:preview and npm run dist:win -- --publish never. The runtime must contain its integrity manifest. Publish the exact engine source revision and runtime archive alongside the app installer, latest.yml and blockmap. See THIRD-PARTY-NOTICES.md and LICENSE for source and redistribution information.

TCP, UDP and WebRTC direct-connection options are available in manual settings and remote.settings.update (tcpPunch, udpPunch, webrtc). Display/transport changes take effect on new connections. If an established direct connection resets, choose forceRelay or disable the failing punch route; an already established session is not silently migrated. Performance probes are not input-to-display measurements.

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
