import { createEngineSupervisor } from './remote-engine-supervisor.mjs'
import { createAutoConnector } from './remote-auto-connect.mjs'
import { recoverRemoteProfile, remoteProfileSources, readRemoteCredential } from './remote-profile.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRemoteWindowsService } from './remote-windows-service.mjs'

export const remoteMethods = {
  'remote.status': { description: 'Read this device ID, native engine and connection status.', params: {} },
  'remote.metrics': { description: 'Read native FPS, decode queue and shared-channel delay samples. Delay is not input-to-display latency.', params: {} },
  'remote.start': { description: 'Start the bundled remote engine.', params: {} },
  'remote.access.get': { description: 'Read incoming full-access device allowlist. IDs are self-reported; password authentication remains required.', params: {} },
  'remote.access.grant': { description: 'Allow a device full remote access to THIS host; enable the allowlist and deny other IDs. Requires password. Applies to new incoming sessions.', params: { deviceId: 'numeric code', alias: 'optional device name' } },
  'remote.access.revoke': { description: 'Remove a full-access device. An enabled empty allowlist denies all incoming sessions.', params: { deviceId: 'numeric code' } },
  'remote.access.disable': { description: 'Disable the full-access allowlist and restore the previous native access mode and ID filter.', params: {} },
  'remote.service.status': { description: 'Read actual Windows LocalSystem service and packaged binary readiness for UAC/login access.', params: {} },
  'remote.service.install': { description: 'Install/update the native system service in protected Program Files. Windows UAC consent is required. Close sessions first.', params: {} },
  'remote.settings.get': { description: 'Read remote preferences and saved devices; passwords are redacted.', params: {} },
  'remote.settings.update': { description: 'Update validated remote preferences. Direct P2P only; relay is disabled. Display changes apply to new sessions.', params: { settings: 'object: fps, quality, codec, gpu, hardwareCodec, acceptConnections, keyboard, clipboard, fileTransfer, connectionMode (auto/manual), tcpPunch, udpPunch, webrtc, relativeMouseShortcut, server, serverKey, approval, verification' } },
  'remote.password.set': { description: 'Set this device permanent password, or empty string to clear it.', params: { password: 'write-only string, at least 8 characters' } },
  'remote.password.temporary': { description: 'Explicitly reveal this device temporary password.', params: {} },
  'remote.connect': { description: 'Open a branded native remote window. Reuses saved credentials; permissions are set by the receiving host.', params: { deviceId: 'numeric device code', password: 'optional write-only credential', remember: 'optional boolean', favorite: 'optional boolean', alias: 'optional name', mode: 'desktop or files' } },
  'remote.transfer.open': { description: 'Open/reuse an authenticated direct-only background tunnel to a saved device file shelf. Uses its existing protected credential.', params: { deviceId: 'saved numeric device code' } },
  'remote.credentials.check': { description: 'Check saved-password readability and retain its DPAPI-wrapped origin key when available. Does not connect or return passwords or keys.', params: { deviceId: 'optional saved numeric device code' } },
  'remote.connection.cancel': { description: 'Stop automatic connection attempts and close its session.', params: {} },
  'remote.disconnect': { description: 'Close one native session window.', params: { windowId: 'integer from remote.status' } },
  'remote.preview': { description: 'Switch an existing Windows desktop session to a view-only, always-on-top preview without reconnecting.', params: { windowId: 'integer from remote.status', action: 'open (default), restore, collapse or status' } },
  'remote.devices.forget': { description: 'Remove a saved device and its protected credential.', params: { deviceId: 'numeric device code' } },
  'remote.devices.save': { description: 'Add/update a favorite without connecting. Credentials use Windows protected storage and are never returned.', params: { deviceId: 'numeric device code', alias: 'optional name', password: 'optional write-only permanent password; omitted or empty preserves saved password', remember: 'optional boolean; false removes saved password', favorite: 'optional boolean; defaults to true' } },
  'remote.advanced.open': { description: 'Open advanced native settings and tools.', params: {} },
  'remote.shutdown': { description: 'Close native session windows and stop the managed UI engine for installation.', params: {} }
}
const defaults = { fps: 60, quality: 70, codec: 'h264', gpu: true, hardwareCodec: true,
  acceptConnections: true, keyboard: true, clipboard: true, fileTransfer: true,
  connectionMode: 'auto', forceRelay: false, tcpPunch: true, udpPunch: true, webrtc: true, relativeMouseShortcut: 'Ctrl+Alt',
  server: '', relayServer: '', serverKey: '', approval: 'password', verification: 'use-both-passwords' }
function fail(code, message) { throw Object.assign(new Error(message), { apiCode: code }) }
export function validateRemoteSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('INVALID_PARAMS', 'settings must be an object.')
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(defaults, key)) fail('INVALID_PARAMS', `Unknown remote setting: ${key}`)
    if (typeof value !== typeof defaults[key]) fail('INVALID_PARAMS', `Invalid type for ${key}`)
    if (key === 'connectionMode' && !['auto', 'manual'].includes(value)) fail('INVALID_PARAMS', 'connectionMode must be auto or manual.')
    if (key === 'fps' && (!Number.isInteger(value) || value < 10 || value > 120)) fail('INVALID_PARAMS', 'fps must be 10–120.')
    if (key === 'quality' && (!Number.isInteger(value) || value < 10 || value > 100)) fail('INVALID_PARAMS', 'quality must be 10–100.')
    if (key === 'codec' && !['auto', 'h264', 'h265', 'vp8', 'vp9', 'av1'].includes(value)) fail('INVALID_PARAMS', 'Unsupported codec.')
    if (key === 'approval' && value !== 'password') fail('INVALID_PARAMS', 'Floade remote connections require password authentication.')
    if (key === 'verification' && !['use-both-passwords', 'use-permanent-password', 'use-temporary-password'].includes(value)) fail('INVALID_PARAMS', 'Unsupported password mode.')
    if (key === 'relativeMouseShortcut') {
      const keys = value.split('+')
      const primary = keys.filter(key => !['Ctrl', 'Alt', 'Shift'].includes(key))
      if (new Set(keys).size !== keys.length || keys.some(key => !/^(Ctrl|Alt|Shift|[A-Z0-9]|F([1-9]|1[0-2]))$/.test(key)) ||
          primary.length > 1 || (primary.length === 0 && !(keys.includes('Ctrl') && keys.includes('Alt'))) ||
          (primary.length === 1 && keys.length === 1 && !primary[0].startsWith('F'))) fail('INVALID_PARAMS', 'Use Ctrl+Alt, a modifier with a letter or digit, or F1–F12 for the relative mouse shortcut.')
    }
    if (typeof value === 'string' && (value.length > 512 || /[\r\n\0]/.test(value))) fail('INVALID_PARAMS', `Invalid value for ${key}`)
  }
  return patch
}
const deviceCode = value => {
  if (typeof value !== 'string' || !/^\d{6,16}$/.test(value)) fail('INVALID_PARAMS', 'deviceId must be a numeric device code.')
  return value
}

export function createRemoteService({ dataDirectory, runtimeDirectory, safeStorage, engineCall, launch = spawn, windowsService = createRemoteWindowsService(runtimeDirectory), legacyProfileSources = remoteProfileSources(dataDirectory) }) {
  const file = path.join(dataDirectory, 'remote.json')
  let recoveryError
  try { recoverRemoteProfile(file, legacyProfileSources, validateRemoteSettings, safeStorage) }
  catch { recoveryError = true; console.warn('Floade remote: saved profile recovery needs attention; original data is preserved.') }
  const requireRecoveredProfile = () => {
    if (recoveryError) fail('REMOTE_PROFILE_RECOVERY_FAILED', 'Saved remote devices could not be recovered. Original data is preserved; do not replace the saved passwords.')
  }
  const controlFile = path.join(process.env.APPDATA || dataDirectory, 'FloadeRemote', 'control.json')
  const canonicalControlFile = process.platform === 'win32' && process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.floade', 'remote', 'control.json') : controlFile
  const executable = path.join(runtimeDirectory, 'FloadeRemote.exe')
  let state = { settings: { ...defaults }, devices: [] }
  const reload = () => {
    if (!fs.existsSync(file)) return
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    state = { settings: { ...defaults, ...validateRemoteSettings(stored.settings || {}), forceRelay: false, relayServer: '' }, devices: Array.isArray(stored.devices) ? stored.devices : [] }
  }
  reload()
  let verified = false
  const save = update => {
    requireRecoveredProfile()
    reload()
    const next = update(state)
    fs.mkdirSync(dataDirectory, { recursive: true })
    const fd = fs.openSync(`${file}.tmp`, 'w', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(`${file}.tmp`, file)
    state = next
  }
  // Upgrade previously remembered devices into favorites without changing their credentials.
  const isFavorite = device => device.favorite ?? Boolean(device.credential)
  const publicState = () => ({ settings: { ...state.settings }, devices: state.devices.map(device => ({ deviceId: device.deviceId, alias: device.alias, lastUsed: device.lastUsed, favorite: isFavorite(device), hasPassword: Boolean(device.credential) })) })
  function validateDevice(p) {
    const id = deviceCode(p.deviceId)
    if (p.password !== undefined && (typeof p.password !== 'string' || p.password.length > 256)) fail('INVALID_PARAMS', 'Invalid password.')
    for (const key of ['remember', 'favorite']) if (p[key] !== undefined && typeof p[key] !== 'boolean') fail('INVALID_PARAMS', `${key} must be boolean.`)
    if (p.alias !== undefined && (typeof p.alias !== 'string' || p.alias.length > 80)) fail('INVALID_PARAMS', 'alias must be at most 80 characters.')
    return id
  }
  function protectedCredential(p, previous) {
    if (p.remember === false) return undefined
    if (p.password && p.remember) {
      if (!safeStorage?.isEncryptionAvailable()) fail('CREDENTIAL_UNAVAILABLE', 'Cannot remember a password without protected storage.')
      return safeStorage.encryptString(p.password).toString('base64')
    }
    return previous?.credential
  }
  function savedPassword(device) {
    const result = readRemoteCredential(device, file, safeStorage)
    if (result.credentialKey && result.credentialKey !== device.credentialKey) {
      try {
        const backup = `${file}.credential-backup`
        if (!fs.existsSync(backup)) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
        save(current => ({ ...current, devices: current.devices.map(item => item.deviceId === device.deviceId && item.credential === device.credential ? { ...item, credentialKey: result.credentialKey } : item) }))
        device.credentialKey = result.credentialKey
      } catch { console.warn('Floade remote: origin-key metadata could not be retained; the saved password was not changed.') }
    }
    return result.password
  }
  function withDevice(device) {
    const others = state.devices.filter(d => d.deviceId !== device.deviceId)
    if (isFavorite(device) && others.filter(isFavorite).length >= 50) fail('INVALID_PARAMS', 'At most 50 favorite devices may be saved.')
    const all = [device, ...others]
    return [...all.filter(isFavorite), ...all.filter(d => !isFavorite(d)).slice(0, 50)]
  }
  async function call(method, params = {}, timeout = 15000) {
    if (engineCall) return engineCall(method, params)
    let endpoint
    try { endpoint = JSON.parse(fs.readFileSync(fs.existsSync(canonicalControlFile) ? canonicalControlFile : controlFile, 'utf8')) } catch { fail('REMOTE_NOT_RUNNING', 'Remote engine is not running.') }
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535 || typeof endpoint.token !== 'string') fail('REMOTE_NOT_RUNNING', 'Invalid remote engine endpoint.')
    if (!Number.isInteger(endpoint.pid) || endpoint.pid <= 0) fail('REMOTE_NOT_RUNNING', 'Invalid remote engine process.')
    try { process.kill(endpoint.pid, 0) } catch { fail('REMOTE_NOT_RUNNING', 'Remote engine process has stopped.') }
    let response
    try {
      response = await fetch(`http://127.0.0.1:${endpoint.port}/command`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-floade-token': endpoint.token },
        body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(timeout), redirect: 'error'
      })
    } catch { fail('REMOTE_NOT_RUNNING', 'Remote engine is unavailable; start it again.') }
    const message = await response.json()
    if (!response.ok || !message.ok) fail(message.error?.code || 'REMOTE_ENGINE_FAILED', message.error?.message || 'Remote engine request failed.')
    return message.result
  }
  const automatic = createAutoConnector({ call, recover: () => start(), settings: () => state.settings, metrics: () => readMetrics().samples,
    remember: (id, profile, history, mode) => save(current => ({ ...current, devices: current.devices.map(device => device.deviceId === id
      ? { ...device, ...(history[profile].lastSuccess > (history[profile].lastFailure || 0) ? { connectionProfile: profile } : {}), connectionStats: { ...device.connectionStats, [mode]: history } } : device) })) })
  const engine = createEngineSupervisor({ start: startOnce, probe: () => call('status', {}, 1500) })
  const start = () => engine.ensure()
  async function startOnce(signal) {
    const requireDirectOnly = status => {
      if (status.directOnly !== true) fail('REMOTE_ENGINE_UPDATE_REQUIRED', 'Update the remote engine and Windows service: this Floade version requires direct P2P without relay.')
      return status
    }
    try { const status = requireDirectOnly(await call('status', {}, 1500)); if (!automatic.active) await call('apply', { settings: state.settings }); return status } catch (error) { if (engineCall || error.apiCode !== 'REMOTE_NOT_RUNNING') throw error }
    if (signal.aborted) fail('REMOTE_START_CANCELLED', 'Remote startup cancelled.')
    {
      if (!fs.existsSync(executable)) fail('REMOTE_RUNTIME_MISSING', 'Install the Floade release containing the remote engine.')
      const cache = path.join(process.env.APPDATA || dataDirectory, 'RustDesk', 'config', 'RustDesk_hwcodec.toml')
      const nativeConfig = path.join(path.dirname(controlFile), 'config')
      const localCache = path.join(nativeConfig, 'FloadeRemote_hwcodec.toml')
      if (fs.existsSync(cache) && !fs.existsSync(localCache)) { fs.mkdirSync(nativeConfig, { recursive: true }); fs.copyFileSync(cache, localCache) }
      if (!verified) {
        const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, 'floade-build.json'), 'utf8').replace(/^\uFEFF/, ''))
        if (!manifest.files || typeof manifest.files !== 'object' || !Object.hasOwn(manifest.files, 'FloadeRemote.exe') || !Object.hasOwn(manifest.files, 'librustdesk.dll')) fail('REMOTE_RUNTIME_INVALID', 'Incomplete runtime manifest.')
        for (const [name, expected] of Object.entries(manifest.files)) {
          if (typeof expected !== 'string' || !/^[a-f\d]{64}$/i.test(expected)) fail('REMOTE_RUNTIME_INVALID', 'Invalid runtime digest.')
          if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..')) fail('REMOTE_RUNTIME_INVALID', 'Invalid runtime manifest.')
          const hash = createHash('sha256').update(fs.readFileSync(path.join(runtimeDirectory, name))).digest('hex')
          if (hash.toLowerCase() !== expected.toLowerCase()) fail('REMOTE_RUNTIME_INVALID', 'Remote engine integrity check failed.')
        }
        verified = true
      }
      const system = process.platform === 'win32' && !engineCall ? await windowsService.status() : null
      if (system?.installed && !system.launchExecutable) fail('REMOTE_SERVICE_UPDATE_REQUIRED', 'Update the Windows system service to match this Floade version.')
      const launchExecutable = system?.launchExecutable || executable
      if (signal.aborted) fail('REMOTE_START_CANCELLED', 'Remote startup cancelled.')
      const child = launch(launchExecutable, ['--floade-managed'], { cwd: path.dirname(launchExecutable), detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, FLOADE_RUSTDESK_TEST_PROFILE: '0', FLOADE_RUSTDESK_LOW_LATENCY: '1', RUST_LOG: 'info,webrtc=error,webrtc_ice=error,webrtc_sctp=error,turn=error' } })
      let launchError
      let ready = false
      child.once('error', () => { launchError = true })
      child.unref()
      try {
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
          if (signal.aborted) fail('REMOTE_START_CANCELLED', 'Remote startup cancelled.')
          if (launchError) fail('REMOTE_START_FAILED', 'Could not start the remote engine.')
          await new Promise(resolve => setTimeout(resolve, 250))
          try {
            const status = requireDirectOnly(await call('status', {}, Math.min(1500, Math.max(1, deadline - Date.now()))))
            if (signal.aborted) fail('REMOTE_START_CANCELLED', 'Remote startup cancelled.')
            if (!automatic.active) await call('apply', { settings: state.settings })
            ready = true
            return status
          } catch (error) { if (error.apiCode !== 'REMOTE_NOT_RUNNING') throw error }
        }
        fail('REMOTE_START_FAILED', 'Remote engine is recovering in the background; please wait and retry.')
      } finally {
        // Only stop the process this attempt launched, never an existing native window or system service.
        if (!ready && child.exitCode === null && !child.killed) child.kill()
      }
    }
  }

  function readMetrics() {
    const logs = ['FloadeRemote_rCURRENT.log', 'flutter_ffi/FloadeRemote_rCURRENT.log', 'flutter_ffi/rustdesk_rCURRENT.log'].map(name => path.join(path.dirname(controlFile), 'log', name)).filter(name => fs.existsSync(name))
    const samples = new Map()
    for (const log of logs) {
      const fd = fs.openSync(log, 'r')
      let tail
      try { const size = fs.fstatSync(fd).size; const buffer = Buffer.alloc(Math.min(size, 512 * 1024)); fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length); tail = buffer.toString('utf8') } finally { fs.closeSync(fd) }
      for (const line of tail.split(/\r?\n/)) {
        const matched = line.match(/floade_perf (\{.*\})/)
        if (!matched) continue
        try { const sample = JSON.parse(matched[1]); if (!samples.has(String(sample.session)) || samples.get(String(sample.session)).sample_unix_ms < sample.sample_unix_ms) samples.set(String(sample.session), { ...sample, fresh: Date.now() - sample.sample_unix_ms < 15000 }) } catch {}
      }
    }
    return { available: samples.size > 0, delayMeaning: 'shared-channel probe and processing; not input-to-display latency', samples: [...samples.values()] }
  }
  async function dispatch(method, p = {}) {
    if (['remote.settings.get', 'remote.settings.update', 'remote.devices.save', 'remote.devices.forget', 'remote.connect', 'remote.credentials.check'].includes(method)) requireRecoveredProfile()
    reload()
    if (method === 'remote.service.status') return windowsService.status()
    if (method === 'remote.service.install') {
      let status
      try { status = await call('status') } catch (error) { if (error.apiCode !== 'REMOTE_NOT_RUNNING') throw error }
      if (status?.windows?.length || status?.connection?.video_conn_count > 0) fail('REMOTE_BUSY', 'Close remote sessions before installing the system service.')
      engine.stop()
      const result = await windowsService.install()
      void start().catch(() => {})
      return result
    }
    if (method === 'remote.access.get') { await start(); return call('accessGet') }
    if (['remote.access.grant', 'remote.access.revoke', 'remote.access.disable'].includes(method)) {
      const id = method === 'remote.access.disable' ? undefined : deviceCode(p.deviceId)
      if (p.alias !== undefined && (typeof p.alias !== 'string' || p.alias.length > 80)) fail('INVALID_PARAMS', 'alias must be at most 80 characters.')
      await start()
      const policy = await call('accessGet')
      const devices = policy.devices.filter(d => d.deviceId !== id)
      if (method === 'remote.access.grant') devices.push({ deviceId: id, alias: p.alias || policy.devices.find(d => d.deviceId === id)?.alias || '' })
      if (devices.length > 50) fail('INVALID_PARAMS', 'At most 50 devices may be allowed.')
      return call('accessSet', { enabled: method === 'remote.access.disable' ? false : true, devices })
    }
    if (method === 'remote.settings.get') return publicState()
    if (method === 'remote.credentials.check') {
      const id = p.deviceId === undefined ? null : deviceCode(p.deviceId)
      return { devices: state.devices.filter(device => !id || device.deviceId === id).map(device => {
        let readable = false
        if (device.credential && safeStorage?.isEncryptionAvailable()) try { savedPassword(device); readable = true } catch {}
        return { deviceId: device.deviceId, hasPassword: Boolean(device.credential), readable }
      }) }
    }
    if (method === 'remote.metrics') return readMetrics()
    if (method === 'remote.status') {
      try { return { available: true, running: true, ...await call('status', {}, 1500), engine: engine.snapshot(), automatic: automatic.snapshot() } } catch (error) {
        if (error.apiCode !== 'REMOTE_NOT_RUNNING') throw error
        return { available: fs.existsSync(executable), running: false, engine: engine.snapshot(), automatic: automatic.snapshot() }
      }
    }
    if (method === 'remote.start') return start()
    if (method === 'remote.settings.update') {
      if (p.settings?.forceRelay === true || p.settings?.relayServer) fail('INVALID_PARAMS', 'Floade only supports direct P2P connections; relay is disabled.')
      const patch = { ...validateRemoteSettings(p.settings) }
      if (!Object.hasOwn(patch, 'connectionMode') && ['tcpPunch', 'udpPunch', 'webrtc'].some(key => Object.hasOwn(patch, key))) patch.connectionMode = 'manual'
      if (automatic.active) fail('REMOTE_BUSY', 'Stop the automatic connection before changing remote settings.')
      const settings = { ...state.settings, ...patch }
      await start()
      await call('apply', { settings })
      save(current => ({ ...current, settings: { ...current.settings, ...patch } }))
      return { ...publicState(), appliesTo: 'new connections for display settings' }
    }
    if (method === 'remote.devices.forget') {
      const id = deviceCode(p.deviceId)
      // Local removal works even when the engine is offline.
      try { await call('forget', { deviceId: id }) } catch (error) { if (error.apiCode !== 'REMOTE_NOT_RUNNING') throw error }
      save(current => ({ ...current, devices: current.devices.filter(d => d.deviceId !== id) }))
      return { forgotten: true }
    }
    if (method === 'remote.devices.save') {
      const id = validateDevice(p)
      const previous = state.devices.find(d => d.deviceId === id)
      const credential = protectedCredential({ ...p, remember: p.remember ?? true }, previous)
      const device = { ...previous, deviceId: id, alias: p.alias ?? previous?.alias ?? '', favorite: p.favorite ?? true,
        ...(previous?.lastUsed ? { lastUsed: previous.lastUsed } : {}), ...(previous?.connectionProfile ? { connectionProfile: previous.connectionProfile } : {}), ...(credential ? { credential } : {}) }
      if (!credential) delete device.credential
      if (credential !== previous?.credential) delete device.credentialKey
      save(current => ({ ...current, devices: withDevice(device) }))
      if (device.credential) try { savedPassword(device) } catch {}
      return publicState()
    }
    if (method === 'remote.connect') {
      const id = validateDevice(p)
      if (p.mode !== undefined && !['desktop', 'files'].includes(p.mode)) fail('INVALID_PARAMS', 'mode must be desktop or files.')
      const previous = state.devices.find(d => d.deviceId === id)
      let password = p.password
      if (!password && previous?.credential) {
        if (!safeStorage?.isEncryptionAvailable()) fail('CREDENTIAL_UNAVAILABLE', 'Windows protected storage is unavailable.')
        try { password = savedPassword(previous) }
        catch { fail('CREDENTIAL_UNAVAILABLE', 'Saved password cannot be read on this Windows account; update the device password.') }
      }
      const credential = protectedCredential({ ...p, password }, previous)
      const device = { ...previous, deviceId: id, alias: p.alias ?? previous?.alias ?? '', favorite: p.favorite ?? (previous ? isFavorite(previous) : Boolean(p.remember)), lastUsed: new Date().toISOString(), ...(previous?.connectionProfile ? { connectionProfile: previous.connectionProfile } : {}), ...(credential ? { credential } : {}) }
      if (!credential) delete device.credential
      if (credential !== previous?.credential) delete device.credentialKey
      withDevice(device) // Validate the favorite limit before opening a session.
      if (automatic.active) fail('REMOTE_BUSY', 'Stop the current automatic connection before opening another session.')
      let result
      if (state.settings.connectionMode === 'auto') {
        const mode = p.mode || 'desktop'
        result = await automatic.connect({ deviceId: id, password, mode, preferred: previous?.connectionProfile, history: previous?.connectionStats?.[mode] })
      } else { await start(); result = await call('connect', { deviceId: id, password, mode: p.mode || 'desktop', settings: state.settings }) }
      save(current => ({ ...current, devices: withDevice(device) }))
      if (device.credential) try { savedPassword(device) } catch {}
      return { ...result, deviceId: id, remembered: Boolean(credential) }
    }
    if (method === 'remote.transfer.open') {
      requireRecoveredProfile()
      const id = deviceCode(p.deviceId)
      const saved = state.devices.find(device => device.deviceId === id)
      if (!saved?.credential || !safeStorage?.isEncryptionAvailable()) fail('CREDENTIAL_UNAVAILABLE', 'Save this device with its permanent password in Remote settings first.')
      let password
      try { password = savedPassword(saved) }
      catch { fail('CREDENTIAL_UNAVAILABLE', 'The saved password could not be read. Edit this device in Remote settings and save its permanent password again. Existing data was kept.') }
      await start()
      const status = await call('status')
      if (status.fileTransferShelf !== true) fail('REMOTE_UPDATE_REQUIRED', 'The remote engine needs the file-transfer update.')
      return call('transferTunnel', { deviceId: id, password })
    }
    if (method === 'remote.password.set') {
      if (typeof p.password !== 'string' || (p.password.length > 0 && p.password.length < 8) || p.password.length > 256) fail('INVALID_PARAMS', 'Use at least 8 characters, or empty string to clear.')
      await start()
      return call('password', { password: p.password })
    }
    if (method === 'remote.password.temporary') { await start(); return call('temporaryPassword') }
    if (method === 'remote.connection.cancel') {
      const current = automatic.snapshot()
      automatic.cancel()
      if (current?.windowId && current.state !== 'cancelled') {
        const observed = await call('sessionStatus', { windowId: current.windowId, deviceId: current.deviceId })
        if (observed.state !== 'closed') await call('disconnect', { windowId: current.windowId })
      }
      return { cancelled: true }
    }
    if (method === 'remote.preview') {
      if (!Number.isInteger(p.windowId) || p.windowId <= 0 || !['open', 'restore', 'collapse', 'status'].includes(p.action ?? 'open')) fail('INVALID_PARAMS', 'A native desktop window ID and valid preview action are required.')
      return call('miniPreview', { windowId: p.windowId, action: p.action ?? 'open' })
    }
    if (method === 'remote.disconnect') {
      if (!Number.isInteger(p.windowId) || p.windowId <= 0) fail('INVALID_PARAMS', 'windowId must be a native session window ID.')
      if (automatic.snapshot()?.windowId === p.windowId) automatic.cancel()
      return call('disconnect', { windowId: p.windowId })
    }
    if (method === 'remote.advanced.open') { await start(); return call('advanced') }
    if (method === 'remote.shutdown') { engine.stop(); automatic.cancel(); return call('shutdown') }
    fail('METHOD_NOT_FOUND', 'Unknown remote operation.')
  }
  async function prepareUpdate() {
    let status
    try { status = await call('status') } catch (error) { if (error.apiCode !== 'REMOTE_NOT_RUNNING') throw error }
    if (status?.windows?.length || status?.connection?.video_conn_count > 0) fail('REMOTE_BUSY', 'Close remote sessions before installing the update.')
    engine.stop()
    automatic.cancel()
    if (status) { await call('shutdown'); await new Promise(resolve => setTimeout(resolve, 500)) }
    if (process.platform === 'win32' && fs.existsSync(executable)) {
      const script = "$target = [Environment]::GetEnvironmentVariable('FLOADE_REMOTE_UPDATE_EXE'); Get-CimInstance Win32_Process -Filter \"Name='FloadeRemote.exe'\" | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }"
      await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 15000, env: { ...process.env, FLOADE_REMOTE_UPDATE_EXE: executable } },
        error => error ? reject(Object.assign(new Error('Could not stop the bundled remote engine for installation.'), { apiCode: 'REMOTE_UPDATE_FAILED' })) : resolve()))
    }
    return true
  }
  return { dispatch, start, prepareUpdate, dispose: () => { engine.stop(); automatic.cancel() } }
}
