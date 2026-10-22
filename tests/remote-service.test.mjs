import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRemoteService } from '../src/remote-service.mjs'
import { createLocalApi } from '../src/local-api.mjs'

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-remote-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.writeFileSync(path.join(directory, 'remote.json'), JSON.stringify({ settings: { connectionMode: 'manual' }, devices: [] }))
  const calls = []
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: () => Buffer.from('protected-fixture'), decryptString: () => 'fixture-secret' },
    engineCall: async (method, params) => { calls.push({ method, params }); return method === 'status' ? { deviceId: '123456789', directOnly: true } : { windowId: 2, applied: true } } })
  t.after(() => service.dispose())
  return { directory, calls, service }
}

test('preview changes only the existing window and rejects invalid actions before dispatch', async t => {
  const { directory, calls, service } = fixture(t)
  const before = fs.readFileSync(path.join(directory, 'remote.json'))
  for (const params of [{ windowId: 0 }, { windowId: '2' }, { windowId: 2, action: 'disconnect' }]) {
    await assert.rejects(service.dispatch('remote.preview', params), { apiCode: 'INVALID_PARAMS' })
  }
  assert.equal(calls.length, 0)
  for (const action of ['open', 'collapse', 'restore', 'status']) {
    await service.dispatch('remote.preview', { windowId: 2, action })
    assert.deepEqual(calls.at(-1), { method: 'miniPreview', params: { windowId: 2, action } })
  }
  assert.deepEqual(fs.readFileSync(path.join(directory, 'remote.json')), before)
  assert.equal(calls.some(call => ['connect', 'disconnect', 'apply'].includes(call.method)), false)
})
test('remote API validates before mutation and manual settings persist through restart', async t => {
  const { directory, calls, service } = fixture(t)
  const api = createLocalApi({ remote: service.dispatch })
  assert.ok((await api({ method: 'api.describe' })).result.methods['remote.connect'])
  for (const settings of [{ fps: 300 }, { gpu: 'Y' }, { unknown: true }, { approval: 'click' }]) {
    assert.equal((await api({ method: 'remote.settings.update', params: { settings } })).error.code, 'INVALID_PARAMS')
  }
  assert.equal(calls.length, 0)
  assert.equal((await api({ method: 'remote.settings.update', params: { settings: { fps: 45, quality: 75, gpu: false } } })).ok, true)
  const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory })
  assert.equal((await restarted.dispatch('remote.settings.get')).settings.fps, 45)
  assert.equal((await restarted.dispatch('remote.settings.get')).settings.gpu, false)
})
test('remembered credentials are protected, redacted, reused and forgotten', async t => {
  const { directory, calls, service } = fixture(t)
  await service.dispatch('remote.connect', { deviceId: '123456789', password: 'fixture-secret', remember: true, alias: 'Home' })
  assert.equal(fs.readFileSync(path.join(directory, 'remote.json'), 'utf8').includes('fixture-secret'), false)
  const publicState = await service.dispatch('remote.settings.get')
  assert.equal(publicState.devices[0].hasPassword, true)
  assert.equal(JSON.stringify(publicState).includes('protected-fixture'), false)
  await service.dispatch('remote.connect', { deviceId: '123456789' })
  assert.equal(calls.at(-1).params.password, 'fixture-secret')
  await service.dispatch('remote.devices.forget', { deviceId: '123456789' })
  assert.deepEqual((await service.dispatch('remote.settings.get')).devices, [])
})

test('a running controller reloads saved devices and preserves them across settings writes and restart', async t => {
  const { directory, service } = fixture(t)
  const writer = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory })
  await writer.dispatch('remote.devices.save', { deviceId: '987654321', alias: 'Home' })
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].alias, 'Home')
  await service.dispatch('remote.settings.update', { settings: { quality: 80 } })
  const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory })
  assert.equal((await restarted.dispatch('remote.settings.get')).devices[0].deviceId, '987654321')
  assert.equal((await restarted.dispatch('remote.settings.get')).settings.quality, 80)
})

test('saving a device while engine settings are pending does not lose the device', async t => {
  const { directory } = fixture(t)
  let releaseApply
  const pendingApply = new Promise(resolve => { releaseApply = resolve })
  let startedApply
  const started = new Promise(resolve => { startedApply = resolve })
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async method => { if (method === 'apply') { startedApply(); await pendingApply } return { directOnly: true } } })
  const updating = service.dispatch('remote.settings.update', { settings: { quality: 80 } })
  await started
  const writer = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory })
  await writer.dispatch('remote.devices.save', { deviceId: '987654321', alias: 'Home' })
  releaseApply()
  await updating
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].alias, 'Home')
})

test('relative mouse shortcut validates, reaches the engine and persists', async t => {
  const { directory, calls, service } = fixture(t)
  assert.equal((await service.dispatch('remote.settings.get')).settings.relativeMouseShortcut, 'Ctrl+Alt')
  for (const shortcut of ['', 'M', 'Ctrl', 'Ctrl+Ctrl+M', 'Ctrl+M+N', 'F13']) {
    await assert.rejects(service.dispatch('remote.settings.update', { settings: { relativeMouseShortcut: shortcut } }), { apiCode: 'INVALID_PARAMS' })
  }
  assert.equal(calls.length, 0)
  for (const shortcut of ['Ctrl+Alt+M', 'F8', 'Ctrl+Shift+1', 'Ctrl+Alt']) {
    await service.dispatch('remote.settings.update', { settings: { relativeMouseShortcut: shortcut } })
    assert.equal(calls.at(-1).params.settings.relativeMouseShortcut, shortcut)
    const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory })
    assert.equal((await restarted.dispatch('remote.settings.get')).settings.relativeMouseShortcut, shortcut)
  }
})

test('mobile P2P transport preferences persist and override a remembered peer relay preference', async t => {
  const { directory, calls, service } = fixture(t)
  await service.dispatch('remote.connect', { deviceId: '123456789', password: 'fixture-secret', remember: true })
  await assert.rejects(service.dispatch('remote.settings.update', { settings: { forceRelay: true } }), { apiCode: 'INVALID_PARAMS' })
  await assert.rejects(service.dispatch('remote.settings.update', { settings: { relayServer: 'relay.example.com' } }), { apiCode: 'INVALID_PARAMS' })
  await service.dispatch('remote.settings.update', { settings: { forceRelay: false, tcpPunch: false, udpPunch: true, webrtc: true } })
  const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'fixture-secret' },
    engineCall: async (method, params) => { calls.push({ method, params }); return { directOnly: true } } })
  await restarted.dispatch('remote.connect', { deviceId: '123456789' })
  const settings = calls.at(-1).params.settings
  assert.equal(calls.at(-1).params.password, 'fixture-secret')
  assert.equal(settings.forceRelay, false)
  assert.equal(settings.tcpPunch, false)
  assert.equal(settings.udpPunch, true)
  assert.equal(settings.webrtc, true)
  assert.equal(settings.fps, 60)
  assert.equal(settings.gpu, true)
  assert.equal(settings.hardwareCodec, true)
})

test('legacy relay preferences cannot re-enable relay after loading saved settings', async t => {
  const { directory, service, calls } = fixture(t)
  fs.writeFileSync(path.join(directory, 'remote.json'), JSON.stringify({ settings: { connectionMode: 'manual', forceRelay: true, relayServer: 'relay.example.com' }, devices: [] }))
  const saved = await service.dispatch('remote.settings.get')
  assert.equal(saved.settings.forceRelay, false)
  assert.equal(saved.settings.relayServer, '')
  await service.dispatch('remote.connect', { deviceId: '123456789' })
  assert.equal(calls.at(-1).params.settings.forceRelay, false)
  assert.equal(calls.at(-1).params.settings.relayServer, '')
})

test('connections refuse an older running engine that could still fall back to relay', async t => {
  const { directory } = fixture(t)
  const calls = []
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async method => { calls.push(method); return {} } })
  await assert.rejects(service.dispatch('remote.connect', { deviceId: '123456789' }), { apiCode: 'REMOTE_ENGINE_UPDATE_REQUIRED' })
  assert.deepEqual(calls, ['status'])
})

test('automatic mode uses native observations, persists a stable route and cancels through the API', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const { directory } = fixture(t)
  const calls = []
  let windows = []
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async (method, params) => {
      calls.push({ method, params })
      if (method === 'status') return { directOnly: true, autoConnectStatus: true, windows }
      if (method === 'connect') { windows = [2]; return { windowId: 2 } }
      if (method === 'sessionStatus') return { state: 'connected', direct: true, video: true }
      if (method === 'disconnect') windows = []
      return {}
    } })
  t.after(() => service.dispatch('remote.connection.cancel'))
  await service.dispatch('remote.settings.update', { settings: { connectionMode: 'auto' } })
  const result = await service.dispatch('remote.connect', { deviceId: '123456789', password: 'private-password' })
  assert.equal(result.automatic.state, 'connecting')
  await assert.rejects(service.dispatch('remote.settings.update', { settings: { quality: 80 } }), { apiCode: 'REMOTE_BUSY' })
  for (let i = 0; i < 12; i++) { t.mock.timers.tick(1500); await new Promise(setImmediate) }
  assert.equal((await service.dispatch('remote.status')).automatic.state, 'connected')
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'remote.json'), 'utf8'))
  assert.equal(stored.devices[0].connectionProfile, 'udp-webrtc')
  assert.equal(stored.devices[0].connectionStats.desktop['udp-webrtc'].successes, 1)
  const preservedSettings = stored.settings
  assert.equal(JSON.stringify(stored).includes('private-password'), false)
  await service.dispatch('remote.connection.cancel')
  const count = calls.filter(c => c.method === 'connect').length
  t.mock.timers.tick(90000)
  await new Promise(setImmediate)
  assert.equal(calls.filter(c => c.method === 'connect').length, count)
  assert.deepEqual(windows, [])
  assert.equal((await service.dispatch('remote.status')).automatic.state, 'cancelled')
  await service.dispatch('remote.devices.save', { deviceId: '123456789', alias: 'Renamed home' })
  const afterEdit = JSON.parse(fs.readFileSync(path.join(directory, 'remote.json'), 'utf8'))
  assert.deepEqual(afterEdit.settings, preservedSettings)
  assert.deepEqual(afterEdit.devices[0].connectionStats, stored.devices[0].connectionStats)
  afterEdit.devices[0].connectionStats.desktop.tcp = { successes: 6, failures: 0, stableMs: 60000, fpsRatio: 0.99, delayMs: 20 }
  afterEdit.devices[0].connectionStats.files = { webrtc: { successes: 10 } }
  fs.writeFileSync(path.join(directory, 'remote.json'), JSON.stringify(afterEdit))
  const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async (method, params) => {
      calls.push({ method, params })
      if (method === 'status') return { directOnly: true, autoConnectStatus: true, windows: [] }
      if (method === 'connect') return { windowId: 3 }
      return {}
    } })
  t.after(() => restarted.dispose())
  assert.deepEqual((await restarted.dispatch('remote.settings.get')).settings, preservedSettings)
  const resumed = await restarted.dispatch('remote.connect', { deviceId: '123456789' })
  assert.equal(resumed.automatic.profile, 'tcp') // Calculated history outranks the last stable profile.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'remote.json'), 'utf8')).devices[0].connectionStats, afterEdit.devices[0].connectionStats)
})
test('favorites save offline, migrate remembered devices, update credentials and survive recent-history eviction', async t => {
  const { directory, service, calls } = fixture(t)
  await service.dispatch('remote.devices.save', { deviceId: '987654321', alias: 'Home', password: 'fixture-secret' })
  assert.equal(calls.length, 0)
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].favorite, true)
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].lastUsed, undefined)
  await service.dispatch('remote.devices.save', { deviceId: '987654321', alias: '' })
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].alias, '')
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].hasPassword, true)
  for (let index = 0; index < 55; index++) await service.dispatch('remote.connect', { deviceId: String(100000000 + index) })
  assert.equal((await service.dispatch('remote.settings.get')).devices.length, 51)
  const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'fixture-secret' },
    engineCall: async (method, params) => { calls.push({ method, params }); return { directOnly: true } } })
  await restarted.dispatch('remote.connect', { deviceId: '987654321', mode: 'files' })
  assert.equal(calls.at(-1).params.password, 'fixture-secret')
  assert.equal(calls.at(-1).params.mode, 'files')
  assert.equal((await restarted.dispatch('remote.settings.get')).devices[0].favorite, true)
  await restarted.dispatch('remote.devices.save', { deviceId: '987654321', remember: false })
  assert.equal((await restarted.dispatch('remote.settings.get')).devices[0].hasPassword, false)
  assert.equal(JSON.stringify(await restarted.dispatch('remote.settings.get')).includes('credential'), false)
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'remote.json')))
  stored.devices[0].credential = Buffer.from('protected-fixture').toString('base64')
  delete stored.devices[0].favorite
  fs.writeFileSync(path.join(directory, 'remote.json'), JSON.stringify(stored))
  const migrated = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory })
  assert.equal((await migrated.dispatch('remote.settings.get')).devices[0].favorite, true)
})

test('favorite validation, credential failures and favorite limit never launch or evict favorites', async t => {
  const { directory, service, calls } = fixture(t)
  for (const params of [{ deviceId: 'bad' }, { deviceId: '123456789', favorite: 'yes' }, { deviceId: '123456789', password: 4 }, { deviceId: '123456789', alias: 'x'.repeat(81) }]) {
    await assert.rejects(service.dispatch('remote.devices.save', params), { apiCode: 'INVALID_PARAMS' })
  }
  const insecure = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory, safeStorage: { isEncryptionAvailable: () => false } })
  await assert.rejects(insecure.dispatch('remote.devices.save', { deviceId: '123456789', password: 'fixture-secret' }), { apiCode: 'CREDENTIAL_UNAVAILABLE' })
  for (let index = 0; index < 50; index++) await service.dispatch('remote.devices.save', { deviceId: String(100000000 + index) })
  await assert.rejects(service.dispatch('remote.connect', { deviceId: '987654321', remember: true }), { apiCode: 'INVALID_PARAMS' })
  assert.equal(calls.length, 0)
  await service.dispatch('remote.devices.save', { deviceId: '100000000', password: 'fixture-secret' })
  const broken = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => { throw Error('secret must not escape') } },
    engineCall: async () => { throw Error('Must not launch') } })
  await assert.rejects(broken.dispatch('remote.connect', { deviceId: '100000000' }), error => error.apiCode === 'CREDENTIAL_UNAVAILABLE' && !error.message.includes('secret must not escape'))
  const offline = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async () => { throw Object.assign(Error('Offline'), { apiCode: 'REMOTE_NOT_RUNNING' }) } })
  await offline.dispatch('remote.devices.forget', { deviceId: '100000000' })
  assert.equal((await offline.dispatch('remote.settings.get')).devices.length, 49)
})
test('invalid connection data and unavailable protected storage never launch a session', async t => {
  const { directory, calls, service } = fixture(t)
  await assert.rejects(service.dispatch('remote.connect', { deviceId: '../123456' }), { apiCode: 'INVALID_PARAMS' })
  await assert.rejects(service.dispatch('remote.connect', { deviceId: '123456789', remember: 'yes' }), { apiCode: 'INVALID_PARAMS' })
  const insecure = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory, safeStorage: { isEncryptionAvailable: () => false }, engineCall: async () => { throw new Error('Must not call engine') } })
  await assert.rejects(insecure.dispatch('remote.connect', { deviceId: '123456789', password: 'fixture-secret', remember: true }), { apiCode: 'CREDENTIAL_UNAVAILABLE' })
  assert.equal(calls.length, 0)
  const busy = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory, engineCall: async () => ({ windows: [2] }) })
  await assert.rejects(busy.prepareUpdate(), { apiCode: 'REMOTE_BUSY' })
})

test('full-access API grants, updates, revokes and disables the incoming allowlist without touching passwords', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-access-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let policy = { enabled: false, devices: [] }
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async (method, params) => {
      if (method === 'accessGet') return structuredClone(policy)
      if (method === 'accessSet') { policy = structuredClone(params); return policy }
      if (method === 'status' || method === 'apply') return { directOnly: true }
      throw new Error('Unexpected authentication mutation')
    } })
  await assert.rejects(service.dispatch('remote.access.grant', { deviceId: 'bad' }), { apiCode: 'INVALID_PARAMS' })
  await service.dispatch('remote.access.grant', { deviceId: '1370592362', alias: 'Laptop' })
  await service.dispatch('remote.access.grant', { deviceId: '1370592362', alias: 'My laptop' })
  assert.deepEqual((await service.dispatch('remote.access.get')).devices, [{ deviceId: '1370592362', alias: 'My laptop' }])
  assert.equal(policy.enabled, true)
  await service.dispatch('remote.access.revoke', { deviceId: '1370592362' })
  assert.deepEqual(policy, { enabled: true, devices: [] })
  await service.dispatch('remote.access.disable')
  assert.equal(policy.enabled, false)
})

test('system-service API exposes actual status and refuses installation during an active remote session', async t => {
  const { directory } = fixture(t)
  let active = true
  let installs = 0
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    engineCall: async method => method === 'status' ? { windows: [], connection: { video_conn_count: active ? 1 : 0 } } : {},
    windowsService: { status: async () => ({ ready: false, installed: false }), install: async () => { installs++; return { requested: true, requiresWindowsConsent: true } } } })
  assert.equal((await service.dispatch('remote.service.status')).ready, false)
  await assert.rejects(service.dispatch('remote.service.install'), { apiCode: 'REMOTE_BUSY' })
  assert.equal(installs, 0)
  active = false
  assert.equal((await service.dispatch('remote.service.install')).requiresWindowsConsent, true)
  assert.equal(installs, 1)
})
