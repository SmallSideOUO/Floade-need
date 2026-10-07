import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCommunication, CHANNEL_MARKER, encodeMessage, decodeMessage } from '../src/communication.mjs'
import { createLocalApi } from '../src/local-api.mjs'
import { parseApiArguments } from '../src/local-api-client.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-communication-'))
  const services = []
  const issues = [{ number: 9, title: 'Unrelated issue', body: 'User document', html_url: 'https://github.com/fixture/data/issues/9' }]
  const comments = new Map()
  const calls = []
  let nextIssue = 10
  let nextComment = 1000
  let offline = false
  let ambiguous = false
  let staleLists = false
  const repository = { full_name: 'fixture/data', private: true, has_issues: true, permissions: { push: true } }
  let clock = Date.now()
  async function command(program, args) {
    assert.equal(program, 'gh')
    assert.equal(args[0], 'api')
    const endpoint = args[args.indexOf('github.com') + 1]
    const method = args[args.indexOf('--method') + 1]
    const input = args.includes('--input') ? JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')) : null
    calls.push({ endpoint, method, input })
    if (offline) throw new Error('Network unavailable')
    let result
    const number = Number(endpoint.match(/issues\/(\d+)/)?.[1])
    if (endpoint === 'repos/fixture/data') result = repository
    else if (endpoint.includes('/comments')) {
      const list = comments.get(number) || []
      if (method === 'POST') {
        result = { id: nextComment++, body: input.body, created_at: new Date(clock).toISOString(), updated_at: new Date(clock).toISOString(), user: { login: 'fixture' } }
        list.push(result)
        comments.set(number, list)
        if (ambiguous) { ambiguous = false; throw new Error('Response lost after GitHub accepted the message') }
      } else result = list
    } else if (method === 'POST') {
      result = { number: nextIssue++, ...input, html_url: `https://github.com/fixture/data/issues/${nextIssue - 1}` }
      issues.push(result)
      comments.set(result.number, [])
    } else result = staleLists ? [] : issues
    return { stdout: JSON.stringify(args.includes('--slurp') ? [result.slice(0, 100), result.slice(100)] : result) }
  }
  function start(name) {
    const service = createCommunication({ userDataPath: path.join(root, name), command, deviceName: name, autoStart: false, now: () => clock })
    services.push(service)
    return service
  }
  t.after(() => { services.forEach(service => service.dispose()); fs.rmSync(root, { recursive: true, force: true }) })
  return { root, command, start, issues, comments, calls, repository,
    set offline(value) { offline = value }, set ambiguous(value) { ambiguous = value }, set staleLists(value) { staleLists = value }, advance(ms = 11000) { clock += ms } }
}

test('configuration validates privacy and Issues without touching Git; discovers only Floade rooms', async t => {
  const f = fixture(t)
  const service = f.start('desktop')
  assert.equal(service.snapshot().repo, null)
  f.repository.private = false
  await assert.rejects(service.dispatch('communication.configure', { repo: 'fixture/data' }), { apiCode: 'REPOSITORY_NOT_PRIVATE' })
  assert.equal(service.snapshot().repo, null)
  f.repository.private = true
  f.repository.has_issues = false
  await assert.rejects(service.dispatch('communication.configure', { repo: 'fixture/data' }), { apiCode: 'ISSUES_DISABLED' })
  f.repository.has_issues = true
  f.repository.permissions.push = false
  await assert.rejects(service.dispatch('communication.configure', { repo: 'fixture/data' }), { apiCode: 'REPOSITORY_NOT_WRITABLE' })
  f.repository.permissions.push = true
  const result = await service.dispatch('communication.configure', { repo: 'fixture/data', deviceName: 'My desktop' })
  assert.equal(result.channels.length, 1)
  assert.equal(result.channels[0].name, '共用')
  assert.equal(result.identity.deviceName, 'My desktop')
  assert.ok(f.issues[1].body.startsWith(CHANNEL_MARKER))
  await service.dispatch('communication.configure', { repo: 'fixture/data' })
  assert.equal(f.issues.length, 2)
  const room = await service.dispatch('communication.create-channel', { name: 'Project' })
  assert.deepEqual(await service.dispatch('communication.create-channel', { name: 'Project' }), room)
  assert.equal(f.issues.length, 3)
})

test('two independent devices exchange messages, replies and targeted identities; unread is local', async t => {
  const f = fixture(t)
  const desktop = f.start('desktop')
  const laptop = f.start('laptop')
  await desktop.dispatch('communication.configure', { repo: 'fixture/data' })
  await laptop.dispatch('communication.configure', { repo: 'fixture/data' })
  const channel = desktop.snapshot().channels[0].id
  const first = await desktop.dispatch('communication.send', { channel, text: '**請測試**', agent: 'Codex/session1', target: 'laptop', id: 'test-message-0001' })
  assert.equal(first.status, 'sent')
  assert.equal(desktop.snapshot().unread, 0)
  f.advance()
  const received = await laptop.dispatch('communication.read', { channel })
  assert.equal(received.messages[0].text, '**請測試**')
  assert.equal(received.messages[0].target, 'laptop')
  assert.equal(laptop.snapshot().unread, 1)
  await laptop.markRead(channel, received.cursor)
  assert.equal(laptop.snapshot().unread, 0)
  const reply = await laptop.dispatch('communication.send', { channel, text: '測試完成', replyTo: first.message.id, agent: 'Codex/session2', id: 'test-message-0002' })
  assert.equal(reply.message.replyTo, first.message.id)
  f.advance()
  const newer = await desktop.dispatch('communication.read', { channel, after: received.cursor })
  assert.equal(newer.messages.length, 1)
  assert.equal(newer.messages[0].deviceName, 'laptop')
  assert.equal(desktop.snapshot().unread, 1)
  assert.notEqual(desktop.snapshot().identity.deviceId, laptop.snapshot().identity.deviceId)
})

test('a confirmed channel survives GitHub list lag and restart without appearing as an empty setup', async t => {
  const f = fixture(t)
  let service = f.start('desktop')
  f.staleLists = true
  const configured = await service.dispatch('communication.configure', { repo: 'fixture/data' })
  assert.equal(configured.channels.length, 1)
  assert.equal(configured.selectedChannel, 10)
  service.dispose()
  service = f.start('desktop')
  await service.sync(true)
  assert.equal(service.snapshot().channels.length, 1)
  assert.equal(f.issues.length, 2)
  f.staleLists = false
  await service.sync(true)
  assert.equal(service.snapshot().channels.length, 1)
  assert.equal(service.snapshot().channels[0].id, 10)
})

test('offline sends survive restart, reconcile an ambiguous POST, and reject id reuse', async t => {
  const f = fixture(t)
  let service = f.start('desktop')
  await service.dispatch('communication.configure', { repo: 'fixture/data' })
  const channel = service.snapshot().channels[0].id
  const params = { channel, text: 'Durable message', agent: 'Codex', id: 'durable-message-001' }
  f.offline = true
  assert.equal((await service.dispatch('communication.send', params)).status, 'pending')
  assert.equal(service.snapshot().pendingCount, 1)
  await assert.rejects(service.dispatch('communication.configure', { repo: 'fixture/other' }), { apiCode: 'PENDING_MESSAGES' })
  service.dispose()
  service = f.start('desktop')
  assert.equal(service.snapshot().pendingCount, 1)
  f.offline = false
  f.ambiguous = true
  await service.sync(true)
  assert.equal(service.snapshot().pendingCount, 1)
  assert.equal(f.comments.get(channel).length, 1)
  // Recovery still finds the accepted message even after a long disconnection.
  f.advance(3600000)
  await service.sync(true)
  assert.equal(service.snapshot().pendingCount, 0)
  assert.equal(f.comments.get(channel).length, 1)
  assert.equal((await service.dispatch('communication.send', params)).status, 'sent')
  await assert.rejects(service.dispatch('communication.send', { ...params, text: 'Other content' }), { apiCode: 'MESSAGE_ID_REUSED' })
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.endpoint.endsWith('/comments')).length, 1)
  assert.equal(fs.readdirSync(path.join(f.root, 'desktop')).some(name => name.startsWith('communication-request-')), false)
})

test('pagination advances only through returned messages, raw GitHub comments are preserved', async t => {
  const f = fixture(t)
  const service = f.start('desktop')
  await service.dispatch('communication.configure', { repo: 'fixture/data' })
  const channel = service.snapshot().channels[0].id
  const rows = f.comments.get(channel)
  for (let index = 0; index < 205; index++) rows.push({ id: index + 2000, body: `raw ${index}`, created_at: new Date().toISOString(), user: { login: 'human' } })
  f.advance()
  const first = await service.dispatch('communication.read', { channel, limit: 100 })
  assert.equal(first.messages.length, 100)
  assert.equal(first.cursor, '2099')
  assert.equal(first.hasMore, true)
  const second = await service.dispatch('communication.read', { channel, after: first.cursor, limit: 100 })
  const third = await service.dispatch('communication.wait', { channel, after: second.cursor, timeout: 0 })
  assert.equal(third.messages.length, 5)
  assert.equal(third.cursor, '2204')
  assert.equal(third.hasMore, false)
  assert.equal(first.messages[0].agent, 'human')
  assert.equal(service.snapshot(channel).hasOlder, true)
  assert.equal(service.snapshot(channel, '2105').messages[0].cursor, '2005')
  await assert.rejects(service.dispatch('communication.read', { channel, after: 'NaN' }), { apiCode: 'INVALID_PARAMS' })
  await assert.rejects(service.dispatch('communication.wait', { channel, timeout: 50000 }), { apiCode: 'INVALID_PARAMS' })
})

test('concurrent sends serialize and private repository checks block publication after visibility changes', async t => {
  const f = fixture(t)
  const service = f.start('desktop')
  await service.dispatch('communication.configure', { repo: 'fixture/data' })
  const params = { text: 'Once', id: 'concurrent-message-001' }
  await Promise.all([service.dispatch('communication.send', params), service.dispatch('communication.send', params)])
  const channel = service.snapshot().channels[0].id
  assert.equal(f.comments.get(channel).length, 1)
  f.repository.private = false
  const blocked = await service.dispatch('communication.send', { text: 'Keep private', id: 'private-message-001' })
  assert.equal(blocked.status, 'pending')
  assert.equal(blocked.error.code, 'REPOSITORY_NOT_PRIVATE')
  assert.equal(f.comments.get(channel).length, 1)
})

test('local API discovers communication, CLI passes Unicode and corrupt cache is never overwritten', async t => {
  const f = fixture(t)
  const service = f.start('desktop')
  const api = createLocalApi({ communication: service, getFolders: () => [], command: f.command, busyFolders: new Set() })
  assert.ok((await api({ method: 'api.describe' })).result.methods['communication.wait'])
  assert.equal((await api({ method: 'communication.status' })).result.status, 'unconfigured')
  assert.equal((await api({ method: 'communication.read' })).error.code, 'COMMUNICATION_NOT_CONFIGURED')
  assert.deepEqual(parseApiArguments(['communication.send', '--channel', '10', '--text', '中文\nmessage', '--agent', 'Codex', '--replyTo', 'message-001', '--deviceName', '桌機']),
    { method: 'communication.send', params: { channel: 10, text: '中文\nmessage', agent: 'Codex', replyTo: 'message-001', deviceName: '桌機' } })
  service.dispose()
  const file = path.join(f.root, 'desktop', 'communication.json')
  fs.writeFileSync(file, '{broken')
  assert.throws(() => f.start('desktop'), { apiCode: 'COMMUNICATION_CACHE_INVALID' })
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  assert.equal(decodeMessage({ id: 1, body: '<!-- floade-message:v1 invalid -->\nUser\n\nContent' }).id, 'github-1')
  const message = { id: 'encode-message-001', deviceId: 'device', deviceName: '桌機', agent: 'Codex', text: '中文\n\n**Markdown**' }
  assert.equal(decodeMessage({ id: 2, body: encodeMessage(message) }).text, message.text)
})
