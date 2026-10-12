# Floade Remote

The floating dot has a Remote action below Add folder. It opens the local device ID, password-based outgoing connection, recent devices and Windows-protected remembered credentials. Settings also opens the same remote settings panel. An independent native Flutter engine handles incoming connections, media and the remote toolbar; it starts hidden with Floade and retains the advanced native tools.

The device code is generated separately on each device. Never copy FloadeRemote.toml, host key material, or encrypted remote.json between devices. Only the hardware codec cache may be reused from RustDesk on the same Windows installation. Floade stores its remote preferences separately from folders.json and Work Map data.

## Local API

Call api.describe for the authoritative list. remote.settings.get redacts remembered credentials. remote.password.temporary is the explicit operation that reveals the temporary password. Authentication, password checks and local approval remain enforced by RustDesk.

Examples (PowerShell helper installed beside Floade.exe):

```powershell
& .\floade-api.ps1 -Method remote.status
& .\floade-api.ps1 -Method remote.settings.get
& .\floade-api.ps1 -Method remote.settings.update -ParamsJson '{"settings":{"fps":60,"quality":70,"gpu":true,"forceRelay":false}}'
& .\floade-api.ps1 -Method remote.connect -ParamsJson '{"deviceId":"123456789"}'
```

For passwords, construct ParamsJson in memory from a secure prompt; do not put secrets literally into shell history. Node clients use requestLocalApi({method, params}) over the existing local named pipe. The native frontend uses an ephemeral IPv4 loopback listener with a per-launch 256-bit capability stored only in the current user's profile. It rejects browser-origin requests and does not expose a LAN listener.

GPU/display preferences apply to new sessions, including previously visited peers. Direct connectivity remains dependent on NAT/firewall/server conditions and falls back to relay. Requested FPS is a preference, not a guaranteed delivered rate.

## Native engine and installation

Runtime files live in resources/remote. The frontend and helper server can continue receiving connections after the Floade panel closes. The default runtime operates within the signed-in user's desktop. Windows login-screen/UAC access requires installing the engine's native system service from Advanced tools, with Windows administrator privileges; this is separate from installing the per-user Floade app. An existing RustDesk service is preserved.

Before updating, close native session windows through remote.shutdown, then stop only processes whose exact executable path is the bundled resources/remote/FloadeRemote.exe. Do not stop the user's unrelated RustDesk processes. Back up Floade configuration and the engine profile first. Preserve folders.json, remote.json, native identity/credentials and the standalone Work Map profile.

## Building

Build the engine from the pinned revision in vendor/remote/source.json using its scripts/floade-build-ui.ps1 (Rust 1.75, Flutter 3.24.5 plus the committed upstream dropdown patch, bridge codegen 1.80.1, pinned vcpkg and hwcodec/vram features). It needs Visual Studio C++ tools, matching generated bridge files and the matching Flutter engine shipped with that SDK. Install native dependencies as documented in the engine repository. When Windows developer mode is unavailable, create local directory junctions for Flutter plugin paths rather than changing global Windows settings.

Copy the resulting branded-windows-x64 folder to vendor/remote/windows-x64, then npm ci, npm run check, npm test, npm run test:preview and npm run dist:win -- --publish never. The runtime must contain its integrity manifest. Publish the exact engine source revision and runtime archive alongside the app installer, latest.yml and blockmap. See THIRD-PARTY-NOTICES.md and LICENSE for source and redistribution information.
