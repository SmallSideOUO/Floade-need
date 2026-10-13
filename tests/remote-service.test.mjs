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
