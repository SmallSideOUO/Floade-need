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
  const calls = []
  const service = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: () => Buffer.from('protected-fixture'), decryptString: () => 'fixture-secret' },
    engineCall: async (method, params) => { calls.push({ method, params }); return method === 'status' ? { deviceId: '123456789' } : { windowId: 2, applied: true } } })
  return { directory, calls, service }
}
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
    engineCall: async method => { if (method === 'apply') { startedApply(); await pendingApply } return {} } })
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
  await service.dispatch('remote.settings.update', { settings: { forceRelay: true } })
  await service.dispatch('remote.settings.update', { settings: { forceRelay: false, tcpPunch: false, udpPunch: true, webrtc: true } })
  const restarted = createRemoteService({ dataDirectory: directory, runtimeDirectory: directory,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'fixture-secret' },
    engineCall: async (method, params) => { calls.push({ method, params }); return {} } })
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
    engineCall: async (method, params) => { calls.push({ method, params }); return {} } })
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
      if (method === 'status' || method === 'apply') return {}
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
