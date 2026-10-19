import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineSupervisor } from '../src/remote-engine-supervisor.mjs'

const flush = () => new Promise(setImmediate)
const unavailable = () => Object.assign(Error('Offline'), { apiCode: 'REMOTE_START_FAILED' })

test('concurrent startup requests share bounded retries and become ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let starts = 0
  const engine = createEngineSupervisor({ probe: async () => {}, start: async () => { if (++starts < 3) throw unavailable(); return { running: true } } })
  t.after(() => engine.stop())
  const first = engine.ensure()
  assert.equal(engine.ensure(), first)
  await flush()
  t.mock.timers.tick(1000); await flush()
  t.mock.timers.tick(2000); await flush()
  assert.deepEqual(await first, { running: true })
  assert.equal(starts, 3)
  assert.equal(engine.snapshot().state, 'ready')
})

test('background health checks restore a stopped engine and explicit shutdown stops recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let starts = 0
  let healthy = true
  const engine = createEngineSupervisor({ start: async () => { starts++; healthy = true; return {} }, probe: async () => { if (!healthy) throw unavailable() } })
  t.after(() => engine.stop())
  await engine.ensure()
  healthy = false
  t.mock.timers.tick(5000); await flush()
  assert.equal(starts, 2)
  assert.equal(engine.snapshot().state, 'ready')
  engine.stop()
  healthy = false
  t.mock.timers.tick(120000); await flush()
  assert.equal(starts, 2)
  assert.equal(engine.snapshot().state, 'stopped')
})

test('persistent startup failure waits before a new round and can be cancelled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let starts = 0
  const engine = createEngineSupervisor({ start: async () => { starts++; throw unavailable() }, probe: async () => { throw unavailable() } })
  t.after(() => engine.stop())
  const result = assert.rejects(engine.ensure(), { apiCode: 'REMOTE_START_FAILED' })
  await flush()
  t.mock.timers.tick(1000); await flush()
  t.mock.timers.tick(2000); await flush()
  await result
  assert.equal(engine.snapshot().state, 'waiting')
  t.mock.timers.tick(29999); await flush()
  assert.equal(starts, 3)
  engine.stop()
  t.mock.timers.tick(120000); await flush()
  assert.equal(starts, 3)
})
