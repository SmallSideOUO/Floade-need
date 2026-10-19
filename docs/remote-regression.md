# Floade 0.1.22 regression surface

## 0.1.33 virtualized saved-device recovery

- Reproduce using a normal Windows launch: the real profile has no `remote.json`, while Codex's MSIX `LocalCache/Roaming/floade-local-data/remote.json` contains the favorite. A controller reload alone cannot bridge these filesystem views.
- Recover only when the destination is absent. Validate candidate settings/device IDs, reprotect passwords when Chromium keys differ, atomically publish a flushed file without overwriting a concurrent save, and retire the original shadow into a backup. Do not overwrite the current Local State. Test authenticated decryption and rejection of tampered ciphertext.
- Test credential reuse after migration, restart after forgetting a device, invalid/missing sources, existing-profile precedence, and package discovery. Verify the installed app from a normal Windows process, then restart and check the favorite and protected password again.

## 0.1.30 direct P2P only

- `src/remote-service.mjs`: normalize legacy relay preferences, reject new relay settings, and refuse a running engine without `directOnly=true` before applying settings or connecting.
- `src/remote.html`, `src/remote.js`: remove force-relay and relay-server inputs and explain that failed direct connections stop without relaying.
- Native `src/client.rs`: refuse both relay negotiation and relay socket creation before network I/O. Native `src/server.rs`: refuse incoming relay socket creation; ID-server signaling and WebRTC answers remain available even when a peer requests relay.
- Native `libs/hbb_common/src/webrtc.rs`: for the FloadeRemote profile, refuse relay-only ICE, exclude TURN servers, and filter remote relay candidates from SDP and trickle. Other application profiles retain their existing behavior.
- Native `flutter/lib/floade/control.dart`: report the branded engine's direct-only capability so the controller cannot silently reuse an old runtime. Build metadata pins the matching native and shared-library source revisions.

Validation includes API rejection and legacy migration, refusal of an older engine, UI control removal, and native relay/TURN and candidate-filter regressions. Direct-only behavior does not establish an improvement in end-to-end input latency.

## 0.1.29 connection persistence and Windows relative input

- `src/remote-service.mjs`: reread persisted state before dispatch and before mutation, merge saved preferences with the latest devices, and flush the temporary file before replacement. Necessary because a restored on-disk favorite was invisible to a running controller with stale state; subsequent writes could overwrite it.
- `tests/remote-service.test.mjs`: regressions for a running controller observing externally saved devices and preserving a device saved while an asynchronous settings operation is pending.
- Native `relative_mouse_model.dart`: Floade Windows raw-input lifecycle; other input modes retain their prior path. `input_model.dart`: suppress absolute canvas updates while this mode is active to prevent game camera jumps.
- Native Windows runner `flutter_window.cpp` and CMake: register and compile the new raw-input plugin for remote subwindows. The plugin confines/releases the cursor and collects foreground WM_INPUT counts; the Dart helper sends accumulated deltas every 8 ms without coordinate or DPI scaling. No wire protocol, Rust library, dependencies, host permissions or service installer changes.
- Package version, source pin and remote documentation ship the matching native frontend. User Work Map edits are excluded from the release staging tree.

Validation: 52 Node tests, syntax checks, remote Electron preview flow, raw-count/focus-loss and existing shortcut Flutter tests, native Windows release build, installer/runtime hashes, installed favorite restart checks and updater metadata. Physical in-game sensitivity and actual machine reboot are separate manual checks.

The release preserves the Work Map and Push commits already on main. The integration adds feature modules instead of moving existing document, translation, sync or media behavior into a new abstraction.

## Existing Floade paths changed

| Files | Runtime effect and reason |
| --- | --- |
| `src/main.mjs` | Creates the remote controller/window, starts the Windows engine, adds the launcher/settings hooks and stops that exact engine before an update. These hooks are required to own remote lifecycle without changing document/sync handlers. |
| `src/local-api.mjs`, `src/local-api-client.mjs`, `src/floade-api.ps1` | Adds remote capability discovery/dispatch and structured parameters. The original methods and transport remain available; existing clients keep working. |
| `src/floating-launcher.html`, `src/floating-launcher.js`, `src/floating-launcher.css`, `src/i18n-renderer.js` | Adds the localized Remote button below Add folder and its action. Existing actions keep their handlers. |
| `src/settings.html`, `src/settings.js`, `src/settings-preload.cjs` | Adds an owner-scoped shortcut to the shared remote settings panel. Existing settings are retained. |
| `scripts/test-preview.mjs` | Skips native startup in isolated UI QA and checks five actions plus API discovery. It preserves the existing document, translation, launcher and quit checks. |
| `package.json`, `package-lock.json`, `.gitignore` | Version 0.1.22, runtime/notice/API packaging, syntax checks and generated-output exclusions. No new application dependency is required. |
| `LICENSE`, `LICENSE-MIT`, `THIRD-PARTY-NOTICES.md`, `README.md`, `docs/local-api.md` | Documents the integrated AGPL distribution, preserves the original MIT notice and exposes source/build/API information. |

The new remote files do not modify `folders.json` or Work Map persistence. Remembered credentials use Electron safeStorage on Windows and are redacted from read APIs. Existing RustDesk identity and processes are separate.

## Existing native engine paths changed

Relative to RustDesk 1.5.0, commit `fada664df7a294d1d1a9ca3e7cd3637069122f17`:

| Files | Runtime effect and reason |
| --- | --- |
| `src/client.rs` | Adds an opt-in presentation-budget hook after ordered decode. It can coalesce queued display callbacks; decode and recording order remain intact. Without the environment flag, the original callback path runs. |
| `src/client/io_loop.rs` | Adds per-session optional diagnostics/legacy feedback state and thin timer/probe hooks. The feature-specific logic lives in new low-latency modules. No authentication, input, wire-protocol or file-transfer format changes. |
| `src/core_main.rs` | Selects the independent profile by `FloadeRemote.exe` name, initializes a random ID once with a persisted marker to avoid the observed collision with the old MAC-derived RustDesk ID, and accepts managed startup. The original executable name keeps the upstream identity/path; the prototype test profile remains explicitly opt-in. |
| `src/flutter_ffi.rs` | Adds one validated peer-display preference operation so Floade preferences also apply to previously visited peers. Existing FFI operations and shared traits retain their signatures. |
| `flutter/lib/main.dart` | Starts the local capability bridge and hides the landing window only for managed startup. Floade owns managed updates. Launch arguments are redacted because they may contain passwords. |
| `flutter/lib/desktop/pages/desktop_home_page.dart` | Removes connection arguments from one existing debug log to prevent password disclosure through the new integration. Method/window diagnostics remain. |
| `flutter/lib/common.dart`, `flutter/lib/desktop/widgets/tabbar_widget.dart` | Adds build-flag-controlled Floade colors/title. In managed startup only, hiding the final remote window keeps the engine online until explicit Floade shutdown; ordinary upstream startup retains the exit behavior. |
| `flutter/assets/logo.png`, `flutter/assets/icon.png`, `flutter/windows/runner/resources/app_icon.ico`, `flutter/windows/runner/Runner.rc` | Ships the requested Floade logo and executable branding while preserving attribution. |
| `flutter/pubspec.lock` | Pins the dependency resolution needed by the matching Flutter 3.24.5 SDK. The SHA-256-pinned custom Windows engine and matching AOT generator are used together. |
| `flutter/lib/utils/multi_window_manager.dart` | Adds one API-specific close operation using native tab cleanup/hiding and existing inactive-window reuse; no shared state or existing signatures change. |
| `flutter/lib/desktop/pages/remote_tab_page.dart`, `file_manager_tab_page.dart`, `port_forward_tab_page.dart`, `view_camera_tab_page.dart`, `terminal_tab_page.dart` | Removes credential-bearing method arguments from diagnostics; remote/file pages additionally accept the build-flag-guarded Floade disconnect event. |

No submodule revision is changed. Generated bridge outputs are regenerated by the committed build script. Advanced native remote windows, permissions and file transfer are retained. No changes were made to the host capture/network scheduling paths without measurements.

## Validation and limits

The application syntax check, 44 Node tests, the Electron preview flow, three native presentation/feedback tests and Flutter analysis passed. Installer checks verify source matches and all runtime file hashes, including dependency notices. Both installations additionally check actual API status, native online identity, preserved settings/data and no-op Push using packaged code. Connection testing uses normal password authentication; passwords are transferred encrypted and stored with Windows protection. Independent IDs are checked against the existing RustDesk ID and across native restarts.

GPU preferences and FPS targets are requests, not performance guarantees. Direct connectivity can fall back to relay. Diagnostics count presentation submissions and report shared-channel delay, not input-to-display latency. The per-user host covers the signed-in desktop; login-screen/UAC access requires native service installation with administrator privileges.

The managed engine stays online after its final remote window hides. Status reports active session windows, so inactive reusable windows do not block the updater. Direct connection remains the default and the requested profile on both tested devices. Earlier TCP/WebRTC interruptions coincided with a user who moved, suspended or disconnected the laptop; those runs do not establish a transport defect. Relay also delivered sustained H.264 frames, but its roughly 400–500 ms shared-channel delay is not an input-to-display measurement.

## 0.1.24 regression surface

- `src/remote-service.mjs`: six additive API methods for incoming full-access policy and Windows service installation/status. The installation path checks active incoming/outgoing sessions; existing connection, credential, display and updater paths are retained.
- `src/remote.html`, `src/remote.js`: manual allowlist and service controls in the existing remote settings page. Existing connection form and remembered passwords remain unchanged.
- Native `flutter/lib/floade/control.dart`: two additive capability-authenticated dispatch cases, delegated to new `floade/access.dart`. No shared Rust structs, wire protocol, login/password validation or native platform installer code changed. The original executable/feature-off path is preserved.
- New `src/remote-windows-service.mjs` calls the existing native installer and queries actual SCM state. This intentionally installs a separate protected automatic LocalSystem service for the requested administrator/UAC/login-screen capability; a per-user executable is never registered as a system service.
- Package versions/source pin and the two remote documents change to ship and document the exact implementation. No Work Map, safe-Push, private repository data, legacy RustDesk service or submodule revision changes.

Two API regressions cover grant/update/revoke/disable without authentication mutation and service status/active-session refusal. Live native checks must additionally verify effective ID policy, persistence, password-authenticated direct connection and actual service state. A pending UAC prompt or non-elevated token cannot be reported as successful system-service installation.

Service integration additionally changes `src/core_main.rs` with Floade-only identity/import hooks and adds `src/platform/windows/floade.rs` (one module declaration in `windows.rs`). Existing Floade IDs are retained in the SYSTEM profile; the Floade installer imports complete identity/key/password and preferences without the upstream timestamp gate, which rejects freshly modified portable configurations. The original RustDesk importer remains unchanged. The app launches the hash-matching protected executable after service installation and refuses a mismatched service until updated; dead capability-file PIDs are rejected before sending commands. These changes are required to keep the same device identity and password after enabling the requested system service.

## 0.1.25 regression surface

Native `flutter/lib/floade/control.dart` skips an unchanged `stop-service` option when applying Floade settings. On an installed Windows client, writing that option invokes the native service installer even when the value is unchanged, which terminates the managed UI. The three-line guard makes repeated startup/settings application preserve the running service. Explicit changes retain the existing native behavior. No shared Rust path or dependency changes. Validation includes repeated installed startup/settings application and a managed UI restart with the same service PID and device ID.


## Relative mouse shortcut (0.1.28)

The default Windows Floade shortcut Ctrl+Alt toggles relative mouse mode in both directions. The configurable chord is local to the controlling computer and scoped to eligible remote desktop keyboard capture. The upstream exit-only path remains in non-Floade builds and on other platforms. No transport, authentication, wire protocol, incoming permissions, Windows installer or service code changes.

| Existing file | Changed runtime path and reason |
| --- | --- |
| `src/remote-service.mjs` | Validate, persist and pass `relativeMouseShortcut` to the engine; prevents an unusable shortcut from being stored. |
| `src/remote.html`, `src/remote.js` | Add shortcut recording and restore controls to the existing remote settings form. |
| Native `src/keyboard.rs` | Thin Windows Flutter hooks for the Floade-only keyboard interceptor and focus reset; native capture otherwise bypasses Flutter keyboard handling. |
| Native `flutter/lib/floade/control.dart` | Store the configured chord in the native local options, shared by active remote windows. |
| Native `flutter/lib/models/model.dart` | Dispatch the new local toggle event from native capture to the existing input model. |
| Native `flutter/lib/models/input_model.dart` | Release modifiers and tracked modifier events when toggling to avoid stuck Ctrl/Alt; retain the original exit behavior for existing callers. |
| Native `flutter/lib/models/relative_mouse_model.dart` | Handle the configured chord in Flutter input mode, reset held state on blur, and show the active shortcut in the relative mouse notification. |

New shortcut modules keep parsing and press/release matching out of shared input code. Tests cover both modifier orders, held-key repeat, consumed releases, a custom key after its modifier prefix, extra modifiers, and switching while a game movement key is held. The Electron preview covers recording, saving, native settings dispatch and restoring Ctrl+Alt.


## Automatic direct switching (0.1.31)

- `src/remote-auto-connect.mjs`: bounded seven-profile search, native state polling, 15-second image stability check, per-device successful profile, explicit cancellation and password/permission stop.
- `src/remote-service.mjs`: default auto/manual preference, automation lifecycle/status/API, success-profile persistence and capability check. Manual connections retain their original engine call. Automatic mode refuses existing native windows because transport options are global and window disconnect clears its tabs.
- `src/remote.html`, `src/remote.js`: default automatic mode, progress and stop controls; manual route switches remain available.
- Native `flutter/lib/floade/connection_status.dart`: feature-specific per-window state; no message content or credentials retained.
- Native `models/model.dart`: thin hooks for listener start, connection events and first received image. Feature-off hooks are no-ops.
- Native `floade/control.dart` and desktop remote/file tab pages: capability-protected per-window observation query, filtered to active tabs. No wire protocol, Rust transport, identity, authentication, capture, input or service-install changes.

Regression checks cover full exhaustion, stable-route caching, later recovery, stale-session rejection, authentication stop, user close, cancellation and handshake timeout. Native analysis has existing deprecation/style notices only. An exhaustive search cannot make an offline host, unavailable ID server or a NAT with no direct route reachable.


## Background engine and recovery (0.1.32)

- `src/remote-service.mjs`: wraps startup in a single supervised operation, adds bounded probe deadlines, and cancels supervision for explicit shutdown/service installation/update. Failed launches clean up only their own child. This fixes overlapping/stalled startup and recovery after process loss.
- New `src/remote-engine-supervisor.mjs`: background health check, bounded launch rounds and delayed retry, with explicit stop.
- `src/main.mjs`: disposes the supervisor on app quit, preventing background relaunch during exit.
- `src/remote-auto-connect.mjs`: preserves pending connection intent during engine loss, reopens it after recovery, and waits before repeating route sweeps or DNS failures. User closes and authentication prompts still cancel/stop automation.
- `src/remote.js`: status polling survives initial startup failure, shows retry countdowns and clears stale startup errors after recovery.
- Native `src/tray.rs`: Windows FloadeRemote-only early return suppresses the extra icon. `src/core_main.rs`: skips launching an unnecessary tray child for that profile. Other profiles retain the original path.
- Native `flutter/lib/main.dart` and `common.dart`: the Floade frontend always starts its local control channel and remains background-managed, even when opened without the managed argument; prevents an existing unmanaged main window from blocking the controller's next launch.
- Native `floade/control.dart`: retries failed channel initialization, atomically publishes the endpoint, bounds commands/window probes, and reports PID/background capability. This avoids partial endpoint reads, permanently absent control and a hung command blocking later readiness checks.
- Native `floade/connection_status.dart`: categorizes DNS/unreachable-network failures for delayed retry rather than rapidly cycling all seven profiles.

Validation: engine startup coalescing/retry, health recovery, stop cancellation, connection recovery with credential retention, delayed sweep/DNS retries and renderer startup-error recovery. Installed checks must additionally terminate only the current managed UI process and verify automatic replacement with the same device identity, current service/runtime hashes, no native tray process and a live outgoing P2P session where the network permits it. Wire protocol, passwords, incoming access policy, capture and input paths are unchanged.
