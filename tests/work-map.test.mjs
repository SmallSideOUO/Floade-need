import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { openWorkMap } from '../src/work-map.mjs'
const { profilePath, migrateLegacy } = createRequire(import.meta.url)('../experiments/shared-map/profile.cjs')

test('Work Map launches a separate process in development and installed builds', async () => {
  for (const isPackaged of [false, true]) {
    let call, detached = false
    await openWorkMap({ appPath: 'C:/Floade', executable: 'Floade.exe', isPackaged, spawnProcess: (...args) => {
      call = args
      const child = new EventEmitter()
      child.unref = () => { detached = true }
      queueMicrotask(() => child.emit('spawn'))
      return child
    } })
    assert.deepEqual(call, ['Floade.exe', [...(isPackaged ? [] : ['C:/Floade']), '--work-map'], { detached: true, stdio: 'ignore', windowsHide: false }])
    assert.equal(detached, true)
  }
  await assert.rejects(openWorkMap({ isPackaged: true, spawnProcess: () => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('error', new Error('Launch failed')))
    return child
  } }), /Launch failed/)
})

test('legacy migration preserves encrypted map and audit bytes and never replaces an existing map', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-map-profile-'))
  try {
    const source = path.join(temporary, 'legacy'), destination = profilePath(temporary)
    fs.mkdirSync(path.join(source, 'ai-history'), { recursive: true })
    fs.mkdirSync(path.join(source, 'profile'))
    const cipher = Buffer.from([0, 255, 5, 84, 19])
    fs.writeFileSync(path.join(source, 'map.private'), cipher)
    fs.writeFileSync(path.join(source, 'map.private.bak'), cipher)
    fs.writeFileSync(path.join(source, 'ai-history', 'record.private'), cipher)
    fs.writeFileSync(path.join(source, 'profile', 'Local State'), 'synthetic encryption key configuration')
    fs.writeFileSync(path.join(source, 'api-runtime.json'), 'stale endpoint must not migrate')
    migrateLegacy(source, destination)
    for (const file of ['map.private', 'map.private.bak', 'ai-history/record.private']) assert.deepEqual(fs.readFileSync(path.join(destination, file)), cipher)
    assert.deepEqual(fs.readFileSync(path.join(source, 'map.private')), cipher)
    assert.equal(fs.existsSync(path.join(destination, 'api-runtime.json')), false)
    assert.equal(fs.readFileSync(path.join(destination, 'profile', 'Local State'), 'utf8'), 'synthetic encryption key configuration')
    fs.writeFileSync(path.join(destination, 'map.private'), 'newer map')
    migrateLegacy(source, destination)
    assert.equal(fs.readFileSync(path.join(destination, 'map.private'), 'utf8'), 'newer map')
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})
