import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCipheriv, randomBytes } from 'node:crypto'
import { remoteProfileSources, migrateRemoteCredentials } from '../src/remote-profile.mjs'
import { createRemoteService } from '../src/remote-service.mjs'

test('normal startup recovers a virtualized favorite and protected password, then retires the shadow', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-profile-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'Roaming', 'floade-local-data')
  const shadow = path.join(root, 'Packages', 'OpenAI.Codex_example', 'LocalCache', 'Roaming', 'floade-local-data')
  fs.mkdirSync(shadow, { recursive: true })
  const source = path.join(shadow, 'remote.json')
  const bytes = JSON.stringify({ settings: { connectionMode: 'manual', quality: 75 }, devices: [
    { deviceId: '123456789', alias: 'Home', favorite: true, credential: 'protected', connectionProfile: 'udp-webrtc' }
  ] })
  fs.writeFileSync(source, bytes)
  const sources = remoteProfileSources(directory, { platform: 'win32', localAppData: root })
  assert.deepEqual(sources, [source])
  const calls = []
  const options = { dataDirectory: directory, runtimeDirectory: root, legacyProfileSources: sources,
    safeStorage: { isEncryptionAvailable: () => true, decryptString: () => 'fixture-password' },
    engineCall: async (method, params) => { calls.push({ method, params }); return { directOnly: true, windowId: 1 } } }
  const service = createRemoteService(options)
  t.after(() => service.dispose())
  assert.equal(fs.readFileSync(path.join(directory, 'remote.json'), 'utf8'), bytes)
  assert.equal(fs.existsSync(source), false)
  const backups = fs.readdirSync(shadow)
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(shadow, backups[0]), 'utf8'), bytes)
  assert.equal((await service.dispatch('remote.settings.get')).devices[0].hasPassword, true)
  await service.dispatch('remote.connect', { deviceId: '123456789' })
  assert.equal(calls.find(call => call.method === 'connect').params.password, 'fixture-password')
  await service.dispatch('remote.devices.forget', { deviceId: '123456789' })
  // Even a stale shadow must not resurrect an explicitly removed favorite.
  fs.writeFileSync(source, bytes)
  const restarted = createRemoteService(options)
  t.after(() => restarted.dispose())
  assert.deepEqual((await restarted.dispatch('remote.settings.get')).devices, [])
  assert.equal(fs.readFileSync(source, 'utf8'), bytes)
})

test('missing and invalid shadow profiles do not replace user state or break startup', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-profile-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bad = path.join(root, 'bad.json')
  fs.writeFileSync(bad, '{incomplete')
  const service = createRemoteService({ dataDirectory: root, runtimeDirectory: root, legacyProfileSources: [bad, path.join(root, 'missing')] })
  t.after(() => service.dispose())
  assert.deepEqual((await service.dispatch('remote.settings.get')).devices, [])
  assert.equal(fs.existsSync(path.join(root, 'remote.json')), false)
  assert.deepEqual(remoteProfileSources(root, { platform: 'linux' }), [])
})

test('credentials encrypted with a different Chromium profile key are reprotected without copying Local State', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-rekey-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const key = randomBytes(32), nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([Buffer.from('v10'), nonce, cipher.update('old-profile-password'), cipher.final(), cipher.getAuthTag()])
  const localState = JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('DPAPIwrapped-key').toString('base64') } })
  fs.writeFileSync(path.join(root, 'Local State'), localState)
  const stored = { devices: [{ deviceId: '123456789', credential: encrypted.toString('base64') }] }
  const safeStorage = { isEncryptionAvailable: () => true, decryptString: () => { throw Error('different key') },
    encryptString: plaintext => { assert.equal(plaintext, 'old-profile-password'); return Buffer.from('current-protected-password') } }
  const migrated = migrateRemoteCredentials(stored, path.join(root, 'remote.json'), safeStorage, wrapped => {
    assert.equal(wrapped.toString(), 'wrapped-key'); return Buffer.from(key)
  })
  assert.equal(migrated.devices[0].credential, Buffer.from('current-protected-password').toString('base64'))
  assert.equal(stored.devices[0].credential, encrypted.toString('base64'))
  assert.equal(fs.readFileSync(path.join(root, 'Local State'), 'utf8'), localState)
  encrypted[20] ^= 1
  assert.throws(() => migrateRemoteCredentials({ devices: [{ credential: encrypted.toString('base64') }] }, path.join(root, 'remote.json'), safeStorage, () => Buffer.from(key)))
})

test('failed password recovery preserves the source and blocks empty-profile writes without crashing startup', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-recovery-failed-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'legacy.json')
  const bytes = JSON.stringify({ devices: [{ deviceId: '123456789', credential: 'unreadable' }] })
  fs.writeFileSync(source, bytes)
  const service = createRemoteService({ dataDirectory: root, runtimeDirectory: root, legacyProfileSources: [source] })
  t.after(() => service.dispose())
  for (const method of ['remote.settings.get', 'remote.settings.update', 'remote.devices.save', 'remote.devices.forget', 'remote.connect']) {
    await assert.rejects(service.dispatch(method), { apiCode: 'REMOTE_PROFILE_RECOVERY_FAILED' })
  }
  assert.equal((await service.dispatch('remote.status')).running, false)
  assert.equal(fs.existsSync(path.join(root, 'remote.json')), false)
  assert.equal(fs.readFileSync(source, 'utf8'), bytes)
})
