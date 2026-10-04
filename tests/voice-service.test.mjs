import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createVoiceService } from '../src/voice-service.mjs'

function fixture(platform = 'win32') {
  const children = []
  const events = []
  const service = createVoiceService({
    workerPath: 'C:/Program Files/Floade/voice-worker.ps1', platform,
    translateUi: (key, vars) => `${key}${vars?.language ? ':' + vars.language : ''}`,
    emit: (owner, data) => events.push({ owner, ...data }),
    spawnProcess: (command, args, options) => {
      const child = new EventEmitter()
      Object.assign(child, { command, args, options, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false })
      child.kill = () => { child.killed = true }
      children.push(child)
      return child
    }
  })
  return { service, children, events }
}

const listen = { id: 1, side: 'source', mode: 'listen', language: 'en' }

test('speech frames survive split chunks and user text stays out of shell arguments', () => {
  const { service, children, events } = fixture()
  try {
    const text = 'Quotation " ; $(echo unsafe)\n第二行'
    assert.equal(service.start(10, { ...listen, mode: 'speak', text }).success, true)
    assert.equal(children[0].options.windowsHide, true)
    assert.ok(!children[0].args.some(arg => arg.includes(text)))
    assert.equal(JSON.parse(children[0].stdin.read().toString()).text, text)
    children[0].stdout.write('{"type":"rea')
    children[0].stdout.write('dy","language":"en-US"}\n{"type":"text","text":"Hello"}\n')
    assert.deepEqual(events.map(event => event.type), ['ready', 'text'])
    assert.equal(events[1].owner, 10)
    assert.equal(events[1].id, 1)
  } finally { service.stop() }
})

test('owner and session checks prevent unrelated stops; replacing voice terminates the old worker', () => {
  const { service, children, events } = fixture()
  try {
    service.start(10, listen)
    service.stop(11, 1)
    service.stop(10, 99)
    assert.equal(children[0].killed, false)
    service.start(11, { ...listen, id: 2, side: 'translation' })
    assert.equal(children[0].killed, true)
    children[0].stdout.write('{"type":"text","text":"stale"}\n')
    children[0].emit('close', 1)
    assert.deepEqual(events.map(event => event.type), ['stopped'])
    assert.equal(children[1].killed, false)
    service.stop(11)
    assert.equal(children[1].killed, true)
  } finally { service.stop() }
})

test('missing voice, worker errors and closing reset sessions without duplicate errors', () => {
  const { service, children, events } = fixture()
  try {
    service.start(10, listen)
    children[0].stdout.write('{"type":"error","code":"recognizerMissing","language":"ja"}\n')
    children[0].emit('close', 1)
    assert.equal(events[0].message, 'voice.recognizerMissing:ja')
    assert.deepEqual(events.map(event => event.type), ['error', 'stopped'])
    service.start(10, { ...listen, id: 2 })
    children[1].emit('error', new Error('spawn failed'))
    assert.equal(children[1].killed, true)
    assert.equal(events.at(-2).message, 'spawn failed')
    assert.equal(events.at(-1).type, 'stopped')
  } finally { service.stop() }
})

test('unsupported platforms and malformed requests never launch audio workers', () => {
  const unsupported = fixture('linux')
  assert.equal(unsupported.service.start(10, listen).success, false)
  assert.equal(unsupported.children.length, 0)
  const { service, children } = fixture()
  assert.equal(service.start(10, { ...listen, language: 'en;$(bad)' }).success, false)
  assert.equal(service.start(10, { ...listen, mode: 'speak', text: '' }).success, false)
  assert.equal(service.start(10, { ...listen, id: 'bad' }).success, false)
  assert.equal(children.length, 0)
})
