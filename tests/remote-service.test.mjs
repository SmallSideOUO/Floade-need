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
