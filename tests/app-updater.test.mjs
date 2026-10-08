import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createAppUpdater } from '../src/app-updater.mjs'

function fixture(options = {}) {
  const updater = new EventEmitter()
  updater.calls = 0
  updater.checkForUpdates = async () => { updater.calls++; updater.emit('update-not-available'); return {} }
  updater.quitAndInstall = (...args) => { updater.installed = args }
  let notifications = 0
  const service = createAppUpdater({ updater, currentVersion: '0.1.18', ready: () => notifications++, ...options })
  return { updater, service, notifications: () => notifications }
}

test('stable updates never downgrade or install on normal quit; only a verified download enables install', async () => {
  const { updater, service, notifications } = fixture()
  assert.equal(updater.allowPrerelease, false)
  assert.equal(updater.allowDowngrade, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.autoDownload, true)
  assert.equal(updater.disableWebInstaller, true)
  assert.equal(service.install(), false)
  await service.check()
  assert.equal(service.state().status, 'current')
  updater.emit('update-available', { version: '0.1.19' })
  updater.emit('download-progress', { percent: 62.4 })
  assert.equal(service.state().percent, 62.4)
  assert.equal(service.install(), false)
  updater.emit('update-downloaded', { version: '0.1.19' })
  updater.emit('update-downloaded', { version: '0.1.19' })
  assert.equal(notifications(), 1)
  assert.equal(service.state().status, 'ready')
  await service.check()
  assert.equal(updater.calls, 1)
  assert.equal(service.install(), true)
  assert.deepEqual(updater.installed, [true, true])
  assert.equal(service.install(), false)
  service.dispose()
})

test('overlapping checks share a download, failure is retryable, and disposal ignores late results', async () => {
  const { updater, service, notifications } = fixture()
  let release
  const downloadPromise = new Promise(resolve => { release = resolve })
  updater.checkForUpdates = async () => { updater.calls++; updater.emit('update-available', { version: '0.1.19' }); return { downloadPromise } }
  const first = service.check()
  const second = service.check()
  await Promise.resolve()
  assert.equal(updater.calls, 1)
  updater.emit('error', new Error('network unavailable'))
  service.dispose()
  release()
  await Promise.all([first, second])
  assert.equal(service.state().status, 'error')
  assert.equal(updater.listenerCount('update-downloaded'), 0)
  assert.equal(notifications(), 0)
  assert.equal(service.install(), false)
  const retry = fixture()
  retry.updater.checkForUpdates = () => { throw new Error('bad checksum') }
  assert.equal((await retry.service.check()).status, 'error')
  assert.equal(retry.service.install(), false)
  retry.updater.checkForUpdates = async () => { retry.updater.emit('update-not-available'); return {} }
  assert.equal((await retry.service.check()).status, 'current')
  retry.service.dispose()
})

test('scheduled checks respect the preference, manual checks work, and source mode cannot install', async () => {
  let enabled = false
  const { updater, service } = fixture({ enabled: () => enabled, initialDelay: 5, interval: 20 })
  service.start(); service.start()
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(updater.calls, 0)
  await service.check()
  assert.equal(updater.calls, 1)
  enabled = true
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.ok(updater.calls > 1)
  service.dispose()
  const before = updater.calls
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(updater.calls, before)
  const source = createAppUpdater({ currentVersion: '0.1.18' })
  assert.equal((await source.check()).status, 'unsupported')
  assert.equal(source.install(), false)
  source.start(); source.dispose()
})
