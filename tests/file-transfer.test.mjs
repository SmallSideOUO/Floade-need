import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createFileTransfer } from '../src/file-transfer.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) { for (let i = 0; i < 150; i++) { if (await check()) return; await pause(30) } throw Error('Transfer did not reach the expected state') }
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-transfer-test-'))
  const source = createFileTransfer({ dataDirectory: path.join(directory, 'source'), port: 0 })
  const { origin } = await source.start()
  const makeReceiver = () => createFileTransfer({ dataDirectory: path.join(directory, 'receiver'), port: 0, peerOrigin: async () => origin, ...options })
  const receiver = makeReceiver()
  const receivers = [receiver]
  await receiver.start()
  t.after(async () => { await Promise.all([source.dispose(), ...receivers.map(item => item.dispose())]); await fs.rm(directory, { recursive: true, force: true }) })
  const destination = path.join(directory, 'destination'); await fs.mkdir(destination)
  return { directory, source, receiver, destination, makeReceiver, origin, receivers }
}

test('file shelf registers paths only, receives Unicode multi-file folders and never overwrites existing data', async t => {
  const f = await fixture(t)
  const folder = path.join(f.directory, '素材'); await fs.mkdir(folder)
  await fs.writeFile(path.join(folder, '影片.bin'), randomBytes(2400000))
  await fs.mkdir(path.join(folder, '空資料夾'))
  const other = path.join(f.directory, '說明.md'); await fs.writeFile(other, '# 工作進度\n')
  const added = await f.source.dispatch('transfers.offer', { paths: [folder, other] })
  await f.receiver.dispatch('transfers.refresh', { deviceId: '123456789' })
  assert.equal(f.receiver.list().jobs.length, 0)
  assert.deepEqual(await fs.readdir(path.join(f.directory, 'receiver/file-transfer/partial')), [])
  await fs.writeFile(path.join(f.destination, '說明.md'), 'keep me')
  await f.receiver.dispatch('transfers.receive', { deviceId: '123456789', offerIds: added.offers.map(o => o.id), destination: f.destination })
  assert.deepEqual(await fs.readFile(path.join(f.destination, '素材/影片.bin')), await fs.readFile(path.join(folder, '影片.bin')))
  assert.equal((await fs.stat(path.join(f.destination, '素材/空資料夾'))).isDirectory(), true)
  assert.equal(await fs.readFile(path.join(f.destination, '說明.md'), 'utf8'), 'keep me')
  assert.equal(await fs.readFile(path.join(f.destination, '說明 (2).md'), 'utf8'), '# 工作進度\n')
  assert.equal(f.receiver.list().jobs.every(j => j.status === 'delivered'), true)
})

test('paused jobs survive restart and resume from verified blocks, repairing a damaged partial tail', async t => {
  let receiver, stopped = false
  const f = await fixture(t, { changed: () => {
    const job = receiver?.list().jobs[0]
    if (job?.bytes >= 1048576 && !stopped) { stopped = true; void receiver.dispatch('transfers.pause', { jobId: job.id }) }
  } })
  receiver = f.receiver
  const input = path.join(f.directory, 'large.bin'); const contents = randomBytes(3500000); await fs.writeFile(input, contents)
  const { offers } = await f.source.dispatch('transfers.offer', { paths: [input] })
  await receiver.dispatch('transfers.refresh', { deviceId: '123456789' })
  const drag = await receiver.drag('123456789', [offers[0].id])
  assert.equal(receiver.list().jobs[0].bytes, 0)
  const reading = fetch(`${drag.url}/file/0?offset=0&count=65536`, { headers: { 'x-floade-transfer': '1' } })
  await until(() => receiver.list().jobs[0].status === 'paused')
  assert.equal((await reading).status, 409)
  const job = receiver.list().jobs[0]
  assert.equal(job.bytes, 1048576)
  await receiver.dispose()
  const partial = path.join(f.directory, 'receiver/file-transfer/partial', `${job.id}.part`)
  const file = await fs.open(partial, 'a'); await file.write(Buffer.from('interrupted tail')); await file.close()
  receiver = f.makeReceiver(); f.receivers.push(receiver); await receiver.start()
  await receiver.dispatch('transfers.resume', { jobId: job.id })
  await until(() => receiver.list().jobs[0].status === 'ready')
  assert.deepEqual(await fs.readFile(partial), contents)
  await receiver.dispatch('transfers.receive', { deviceId: '123456789', offerIds: [offers[0].id], destination: f.destination })
  assert.deepEqual(await fs.readFile(path.join(f.destination, 'large.bin')), contents)
})

test('source changes, browser requests, symlinks and malformed destination paths are rejected', async t => {
  const f = await fixture(t)
  const input = path.join(f.directory, 'mutable.txt'); await fs.writeFile(input, 'old')
  const { offers } = await f.source.dispatch('transfers.offer', { paths: [input] })
  await f.receiver.dispatch('transfers.refresh', { deviceId: '123456789' })
  await fs.writeFile(input, 'new contents')
  await assert.rejects(f.receiver.dispatch('transfers.receive', { deviceId: '123456789', offerIds: [offers[0].id], destination: f.destination }), /source file changed/i)
  assert.equal((await fetch(`${f.origin}/v1/catalog`)).status, 403)
  assert.equal((await fetch(`${f.origin}/v1/catalog`, { headers: { origin: 'https://example.com', 'x-floade-transfer': '1' } })).status, 403)
  await assert.rejects(f.source.dispatch('transfers.offer', { paths: ['relative.txt'] }), /absolute/)
  await assert.rejects(f.receiver.dispatch('transfers.receive', { deviceId: '123456789', offerIds: [offers[0].id], destination: '../outside' }), /existing destination/)
})

test('Windows virtual IStream bridge materializes multiple files only when read after preparing drag metadata', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t)
  const first = path.join(f.directory, '拖曳一.bin'), second = path.join(f.directory, 'two.txt')
  await fs.writeFile(first, randomBytes(1500000)); await fs.writeFile(second, 'drag and drop')
  const { offers } = await f.source.dispatch('transfers.offer', { paths: [first, second] })
  await f.receiver.dispatch('transfers.refresh', { deviceId: '123456789' })
  const drag = await f.receiver.drag('123456789', offers.map(o => o.id))
  assert.equal(f.receiver.list().jobs.every(j => j.bytes === 0 && j.status === 'queued'), true)
  const { createFileDrag } = await import('../src/file-drag.mjs')
  const bridge = await createFileDrag({ appPath: process.cwd(), dataDirectory: path.join(f.directory, 'bridge'), transfer: f.receiver })
  await promisify(execFile)(bridge.executable, [drag.url, '--probe', f.destination], { windowsHide: true, timeout: 30000 })
  for (const input of [first, second]) assert.equal(createHash('sha256').update(await fs.readFile(path.join(f.destination, path.basename(input)))).digest('hex'), createHash('sha256').update(await fs.readFile(input)).digest('hex'))
  assert.equal(f.receiver.list().jobs.every(j => j.status === 'delivered'), true)
})
