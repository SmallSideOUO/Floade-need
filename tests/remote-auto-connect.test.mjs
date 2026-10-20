import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoConnector, rankConnectionProfiles } from '../src/remote-auto-connect.mjs'

function fixture(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const calls = [], remembered = []
  let observed = { state: 'connecting' }
  let nextWindow = 0
  let available = true
  const connector = createAutoConnector({
    settings: () => ({ fps: 60, gpu: true }),
    remember: async (...args) => remembered.push(args),
    call: async (method, params) => {
      calls.push({ method, params })
      if (!available) throw Object.assign(Error('Offline'), { apiCode: 'REMOTE_NOT_RUNNING' })
      if (method === 'connect') return { windowId: ++nextWindow }
      if (method === 'sessionStatus') return observed
      return {}
    }, ...options
  })
  t.after(() => connector.cancel())
  return { connector, calls, remembered, online: value => { available = value }, observe: value => { observed = value },
    tick: async (count = 1) => { for (let i = 0; i < count; i++) { t.mock.timers.tick(1500); await new Promise(setImmediate) } } }
}

test('persistent failures change route only after recovery grace; stable video is remembered', async t => {
  const f = fixture(t)
  await f.connector.connect({ deviceId: '123456789', password: 'private-password', mode: 'desktop', preferred: 'tcp' })
  assert.equal(f.connector.snapshot().profile, 'tcp')
  f.observe({ state: 'network-error' })
  await f.tick(11)
  assert.equal(f.connector.snapshot().attempt, 2)
  f.observe({ state: 'connected', direct: true, video: false })
  await f.tick(3)
  assert.equal(f.remembered.length, 1) // Failed-route evidence, no video success yet.
  f.observe({ state: 'connected', direct: true, video: true })
  await f.tick(10)
  assert.equal(f.remembered.length, 1)
  await f.tick()
  assert.equal(f.connector.snapshot().state, 'connected')
  assert.equal(f.remembered.at(-1)[1], f.connector.snapshot().profile)
  assert.equal(f.remembered.at(-1)[2][f.connector.snapshot().profile].successes, 1)
  f.observe({ state: 'network-error' })
  await f.tick(11)
  assert.equal(f.connector.snapshot().state, 'connecting')
  assert.equal(f.connector.snapshot().attempt, 2)
  assert.equal(f.calls.filter(c => c.method === 'disconnect').length, 2)
  assert.ok(f.calls.filter(c => c.method === 'connect').every(c => c.params.password === 'private-password' && c.params.settings.fps === 60 && c.params.settings.forceRelay === false))
  assert.equal(JSON.stringify(f.connector.snapshot()).includes('private-password'), false)
})

test('seven direct combinations wait before another sweep and cancellation stops retries', async t => {
  const f = fixture(t)
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  await assert.rejects(f.connector.connect({ deviceId: '987654321' }), { apiCode: 'REMOTE_BUSY' })
  f.observe({ state: 'network-error' })
  await f.tick(77)
  assert.equal(f.connector.snapshot().state, 'waiting')
  const attempts = f.calls.filter(c => c.method === 'connect')
  assert.equal(attempts.length, 7)
  assert.equal(new Set(attempts.map(c => ['tcpPunch', 'udpPunch', 'webrtc'].map(k => +c.params.settings[k]).join(''))).size, 7)
  await f.tick(9)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 7)
  await f.tick()
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 8)
  f.connector.cancel()
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.connector.cancel()
  await f.tick(40)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 9)
})

test('best-route calculation weighs reliability, stable time, FPS, delay and recent failures', () => {
  const now = 1000000
  const good = { successes: 5, failures: 0, stableMs: 60000, connectMs: 1000 }
  const history = { tcp: { ...good, fpsRatio: 0.3, delayMs: 600 }, webrtc: { ...good, fpsRatio: 0.95, delayMs: 40 } }
  assert.equal(rankConnectionProfiles(history, 'tcp', now)[0].id, 'webrtc')
  history.webrtc.lastFailure = now
  assert.equal(rankConnectionProfiles(history, 'tcp', now)[0].id, 'tcp')
  assert.equal(rankConnectionProfiles({}, 'tcp', now)[0].id, 'tcp')
  assert.equal(rankConnectionProfiles({}, undefined, now)[0].id, 'udp-webrtc')
})

test('transient errors and poor performance keep the selected window; fresh performance is learned once per session', async t => {
  let samples = []
  const f = fixture(t, { metrics: () => samples })
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.observe({ state: 'connected', direct: true, video: true })
  samples = [{ fresh: true, direct: true, sample_unix_ms: Date.now(), presented_fps: { 1: 57 }, shared_path_delay_ms: 40 }]
  await f.tick(11)
  assert.equal(f.connector.snapshot().locked, true)
  assert.equal(f.remembered.at(-1)[2]['udp-webrtc'].fpsRatio, 0.95)
  f.observe({ state: 'network-error' })
  await f.tick(9)
  assert.equal(f.calls.filter(c => c.method === 'disconnect').length, 0)
  assert.equal(f.connector.snapshot().reason, 'WAITING_FOR_RECOVERY')
  f.observe({ state: 'connected', direct: true, video: true })
  samples = [{ fresh: true, direct: true, sample_unix_ms: Date.now(), presented_fps: { 1: 10 }, shared_path_delay_ms: 900 }]
  await f.tick(25)
  assert.equal(f.connector.snapshot().reason, undefined)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 1)
  assert.equal(f.remembered.at(-1)[2]['udp-webrtc'].successes, 1)
  assert.equal(f.remembered.at(-1)[2]['udp-webrtc'].failures, 0)
  assert.ok(f.remembered.at(-1)[2]['udp-webrtc'].fpsRatio < 0.95)
})

test('stale, indirect, ambiguous or unavailable metrics never replace successful connection evidence', async t => {
  let samples = [{ fresh: true, direct: true, sample_unix_ms: 0, presented_fps: { 1: 60 } }]
  const f = fixture(t, { metrics: () => samples })
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.observe({ state: 'connected', direct: true, video: true })
  await f.tick(11)
  assert.equal(f.remembered.at(-1)[2]['udp-webrtc'].fpsRatio, undefined)
  samples = [1, 2].map(session => ({ session, fresh: true, direct: true, sample_unix_ms: Date.now(), presented_fps: { 1: 60 } }))
  await f.tick(20)
  assert.equal(f.remembered.at(-1)[2]['udp-webrtc'].fpsRatio, undefined)
  samples = [{ fresh: false, direct: false, sample_unix_ms: Date.now(), presented_fps: { 1: 60 } }]
  await f.tick(20)
  assert.equal(f.remembered.at(-1)[2]['udp-webrtc'].fpsRatio, undefined)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 1)
})

test('authentication and user-closed windows stop switching, while a stalled handshake advances', async t => {
  const f = fixture(t)
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.observe({ state: 'user-action' })
  await f.tick(40)
  assert.equal(f.connector.snapshot().state, 'user-action')
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 1)
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.observe({ state: 'closed' })
  await f.tick(40)
  assert.equal(f.connector.snapshot().state, 'cancelled')
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 2)
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.observe({ state: 'connecting' })
  await f.tick(30)
  assert.equal(f.connector.snapshot().attempt, 2)
})


test('an engine restart restores the requested session and DNS failure waits without burning profiles', async t => {
  const f = fixture(t, { recover: async () => ({ autoConnectStatus: true, windows: [] }) })
  await f.connector.connect({ deviceId: '123456789', password: 'private-password', mode: 'desktop' })
  f.online(false)
  await f.tick()
  assert.equal(f.connector.snapshot().state, 'recovering-engine')
  await f.tick(9)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 1)
  f.online(true)
  await f.tick()
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 2)
  assert.equal(f.calls.filter(c => c.method === 'connect').at(-1).params.password, 'private-password')
  f.observe({ state: 'network-unavailable' })
  await f.tick()
  assert.equal(f.connector.snapshot().state, 'waiting')
  const count = f.calls.filter(c => c.method === 'connect').length
  await f.tick(19)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, count)
  f.connector.cancel()
  await f.tick(100)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, count)
})


test('a connection that resumes while waiting gets time to receive its first image', async t => {
  const f = fixture(t)
  await f.connector.connect({ deviceId: '123456789', mode: 'desktop' })
  f.observe({ state: 'network-unavailable' })
  await f.tick()
  f.observe({ state: 'connected', direct: true, video: false })
  t.mock.timers.tick(46000)
  await new Promise(setImmediate)
  assert.equal(f.calls.filter(c => c.method === 'connect').length, 1)
  f.observe({ state: 'connected', direct: true, video: true })
  await f.tick(11)
  assert.equal(f.connector.snapshot().state, 'connected')
})
