import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createLocalApi, attachControlSocket } from '../src/local-api.mjs'
import { requestLocalApi, parseApiArguments } from '../src/local-api-client.mjs'

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-api-'))
  const folders = [{ path: directory, repo: null }]
  let repository = { nameWithOwner: 'fixture/data', isPrivate: true, viewerPermission: 'WRITE' }
  let failure
  let delay
  let saves = 0
  const calls = []
  const busyFolders = new Set()
  const api = createLocalApi({ getFolders: () => folders, busyFolders, refresh: () => {},
    command: async (program, args) => {
      calls.push([program, ...args])
      if (failure) throw failure
      if (args[0] === 'auth') return { stdout: '' }
      if (delay) await delay
      return { stdout: JSON.stringify(args[1] === 'list' ? [repository, { nameWithOwner: 'fixture/readonly', isPrivate: true, viewerPermission: 'READ' }] : repository) }
    },
    saveLink: (folder, repo) => { folder.repo = repo; saves++ }
  })
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const link = (params = {}) => api({ method: 'folders.link', params: { path: directory, repo: 'fixture/data', ...params } })
  return { directory, folders, api, link, busyFolders, calls, get saves() { return saves }, set repository(value) { repository = value }, set failure(value) { failure = value }, set delay(value) { delay = value } }
}

test('API discovers capabilities, lists registered folders and writable private repositories', async t => {
  const f = await fixture(t)
  assert.deepEqual(Object.keys((await f.api({ method: 'api.describe' })).result.methods), ['api.describe', 'app.status', 'folders.list', 'repositories.list', 'folders.link'])
  assert.deepEqual((await f.api({ method: 'app.status' })).result, {})
  assert.equal((await f.api({ method: 'communication.send', params: { text: 'retired client' } })).error.code, 'METHOD_NOT_FOUND')
  assert.equal(f.calls.length, 0, 'retired methods never contact GitHub')
  assert.deepEqual((await f.api({ method: 'folders.list' })).result.folders, [{ path: f.directory, repo: null, exists: true, busy: false }])
  assert.deepEqual((await f.api({ method: 'repositories.list' })).result.repositories, [{ repo: 'fixture/data', permission: 'WRITE' }])
  assert.equal((await f.api({ method: 'repositories.list', params: { limit: 2 } })).result.possiblyTruncated, true)
  await f.api({ method: 'repositories.list', params: { owner: 'fixture-org' } })
  assert.ok(f.calls.some(call => call[2] === 'list' && call[3] === 'fixture-org'))
})

test('link saves once, supports idempotent repeats and explicit replacement without running Git', async t => {
  const f = await fixture(t)
  assert.equal((await f.link()).result.changed, true)
  assert.equal((await f.link()).result.changed, false)
  assert.equal(f.saves, 1)
  f.folders[0].repo = 'fixture/old'
  assert.equal((await f.link()).error.code, 'ALREADY_LINKED')
  assert.equal(f.folders[0].repo, 'fixture/old')
  assert.equal((await f.link({ replace: true })).ok, true)
  assert.equal(f.saves, 2)
  assert.equal(f.busyFolders.size, 0)
  assert.ok(f.calls.every(call => call[0] === 'gh'))
})

test('invalid paths, public repositories, read-only permissions and GitHub failures preserve links', async t => {
  const f = await fixture(t)
  assert.equal((await f.link({ path: 'relative' })).error.code, 'INVALID_PARAMS')
  assert.equal((await f.link({ path: path.join(f.directory, 'missing') })).error.code, 'FOLDER_NOT_FOUND')
  assert.equal((await f.link({ repo: '--malicious' })).error.code, 'INVALID_PARAMS')
  assert.equal((await f.api({ method: '__proto__' })).error.code, 'METHOD_NOT_FOUND')
  assert.equal((await f.api({ method: 'repositories.list', params: { limit: 0 } })).error.code, 'INVALID_PARAMS')
  f.repository = { nameWithOwner: 'fixture/data', isPrivate: false, viewerPermission: 'ADMIN' }
  assert.equal((await f.link()).error.code, 'REPOSITORY_NOT_PRIVATE')
  f.repository = { nameWithOwner: 'fixture/data', isPrivate: true, viewerPermission: 'READ' }
  assert.equal((await f.link()).error.code, 'REPOSITORY_NOT_WRITABLE')
  f.repository = { nameWithOwner: 'fixture/renamed', isPrivate: true, viewerPermission: 'WRITE' }
  assert.equal((await f.link()).error.code, 'REPOSITORY_MISMATCH')
  f.failure = Object.assign(new Error('missing'), { code: 'ENOENT' })
  assert.equal((await f.link()).error.code, 'GITHUB_CLI_MISSING')
  f.failure = new Error('signed out')
  assert.equal((await f.link()).error.code, 'GITHUB_AUTH_REQUIRED')
  assert.equal(f.folders[0].repo, null)
  assert.equal(f.saves, 0)
  assert.equal(f.busyFolders.size, 0)
})

test('concurrent links and removed folders cannot race into an obsolete saved link', async t => {
  const f = await fixture(t)
  let release
  f.delay = new Promise(resolve => { release = resolve })
  const pending = f.link()
  assert.equal((await f.link()).error.code, 'FOLDER_BUSY')
  assert.equal((await f.api({ method: 'folders.list' })).result.folders[0].busy, true)
  f.folders.pop()
  release()
  assert.equal((await pending).error.code, 'FOLDER_NOT_FOUND')
  assert.equal(f.saves, 0)
  assert.equal(f.busyFolders.size, 0)
})

test('socket supports split UTF-8 requests, fragmented replies, structured errors and legacy ping', async t => {
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\floade-api-test-${process.pid}` : path.join(os.tmpdir(), `floade-api-test-${process.pid}.sock`)
  const server = net.createServer(socket => attachControlSocket(socket, async request => ({ ok: true, result: request }), () => {}))
  await new Promise(resolve => server.listen(pipe, resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const send = parts => new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe)
    let output = ''
    socket.setEncoding('utf8')
    socket.on('error', reject)
    socket.on('data', chunk => { output += chunk })
    socket.on('end', () => resolve(output.trim()))
    socket.on('connect', async () => {
      for (const part of parts) { socket.write(part); await new Promise(resolve => setTimeout(resolve, 5)) }
    })
  })
  const frame = Buffer.from(`${JSON.stringify({ method: 'test', params: { path: '資料夾' } })}\n`)
  const split = frame.indexOf(Buffer.from('資')) + 1
  assert.equal(JSON.parse(await send([frame.subarray(0, split), frame.subarray(split)])).result.params.path, '資料夾')
  assert.equal(JSON.parse(await send(['{invalid}\n'])).error.code, 'INVALID_JSON')
  assert.equal(JSON.parse(await send([Buffer.alloc(65537, 65)])).error.code, 'REQUEST_TOO_LARGE')
  assert.equal(await send(['ping\n']), 'ok')
  assert.equal((await requestLocalApi({ method: 'test' }, { socketPath: pipe })).result.method, 'test')
  if (process.platform === 'win32') {
    const exec = promisify(execFile)
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('src/floade-api.ps1'), '-Method', 'folders.link', '-Path', 'C:\\中文 資料夾', '-Repo', 'fixture/data', '-PipeName', path.basename(pipe)], { windowsHide: true })
    assert.equal(JSON.parse(stdout).result.params.path, 'C:\\中文 資料夾')
  }
})

test('CLI parses folder paths as data and rejects unsupported flags', () => {
  assert.deepEqual(parseApiArguments(['folders.link', '--path', 'C:\\A B', '--repo', 'fixture/data', '--replace']), { method: 'folders.link', params: { path: 'C:\\A B', repo: 'fixture/data', replace: true } })
  assert.throws(() => parseApiArguments(['folders.link', '--path']), /Invalid API argument/)
  assert.throws(() => parseApiArguments(['folders.link', '--execute', 'anything']), /Invalid API argument/)
  assert.throws(() => parseApiArguments(['communication.send', '--channel', '1']), /Invalid API argument/)
})
