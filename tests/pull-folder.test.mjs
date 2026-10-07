import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pullFolderFromRepository, createAutoPull } from '../src/pull-folder.mjs'

const exec = promisify(execFile)
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-pull-'))
  const remote = path.join(root, 'remote.git'), local = path.join(root, 'local'), phone = path.join(root, 'phone')
  const git = (args, cwd = root) => exec('git', args, { cwd, windowsHide: true })
  await git(['init', '--bare', remote]); await git(['clone', remote, phone])
  await git(['config', 'user.name', 'Fixture'], phone); await git(['config', 'user.email', 'fixture@example.test'], phone)
  await git(['checkout', '-b', 'main'], phone)
  await fs.writeFile(path.join(phone, 'note.md'), 'base\n')
  await git(['add', '.'], phone); await git(['commit', '-m', 'base'], phone); await git(['push', 'origin', 'main'], phone)
  await git(['clone', '--branch', 'main', remote, local])
  await git(['config', 'user.name', 'Fixture'], local); await git(['config', 'user.email', 'fixture@example.test'], local)
  const command = async (_program, args, cwd) => args.join(' ') === 'remote get-url origin' ? { stdout: 'https://github.com/fixture/data.git\n' } : git(args, cwd)
  const advance = async () => { await fs.writeFile(path.join(phone, 'note.md'), 'phone edit\n'); await git(['add', '.'], phone); await git(['commit', '-m', 'phone'], phone); await git(['push', 'origin', 'main'], phone) }
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, local, phone, git, advance, command, pull: () => pullFolderFromRepository(local, 'fixture/data', command) }
}
test('automatic pull applies a phone commit by fast-forward and reports already-current', async t => {
  const f = await fixture(t); await f.advance()
  assert.equal((await f.pull()).status, 'updated')
  assert.equal((await fs.readFile(path.join(f.local, 'note.md'), 'utf8')).replaceAll('\r\n', '\n'), 'phone edit\n')
  assert.equal((await f.pull()).status, 'current')
})
test('local edits, divergent commits and wrong remotes remain untouched', async t => {
  const f = await fixture(t); await f.advance()
  await fs.writeFile(path.join(f.local, 'note.md'), 'desktop draft\n')
  assert.equal((await f.pull()).status, 'localChanges')
  await f.git(['add', '.'], f.local); await f.git(['commit', '-m', 'desktop'], f.local)
  const before = (await f.git(['rev-parse', 'HEAD'], f.local)).stdout
  assert.equal((await f.pull()).status, 'diverged')
  assert.equal((await f.git(['rev-parse', 'HEAD'], f.local)).stdout, before)
  assert.equal(await fs.readFile(path.join(f.local, 'note.md'), 'utf8'), 'desktop draft\n')
  assert.equal((await pullFolderFromRepository(f.local, 'other/repo', f.command)).status, 'wrongRemote')
})
test('a change made while fetching cannot be overwritten; nested repositories are rejected', async t => {
  const f = await fixture(t); await f.advance()
  const command = async (program, args, cwd) => { const result = await f.command(program, args, cwd); if (args[0] === 'fetch') await fs.writeFile(path.join(f.local, 'note.md'), 'late edit\n'); return result }
  assert.equal((await pullFolderFromRepository(f.local, 'fixture/data', command)).status, 'localChanges')
  assert.equal(await fs.readFile(path.join(f.local, 'note.md'), 'utf8'), 'late edit\n')
  const nested = path.join(f.local, 'nested'); await fs.mkdir(nested)
  assert.equal((await pullFolderFromRepository(nested, 'fixture/data', f.command)).status, 'wrongRoot')
})
test('scheduler skips open documents and overlapping operations and releases locks on failure', async () => {
  const pulling = new Set(), folder = { path: 'fixture', repo: 'fixture/data' }
  let open = true, busy = false, calls = 0
  const service = createAutoPull({ getFolders: () => [folder], enabled: () => true, busy: () => busy, hasOpenDocument: () => open, pulling, changed: () => {}, command: async () => { calls++; throw new Error('offline') } })
  assert.equal((await service.pull(folder)).status, 'openDocument'); assert.equal(calls, 0)
  open = false; busy = true; assert.equal((await service.pull(folder)).status, 'busy')
  busy = false; assert.equal((await service.pull(folder)).status, 'error'); assert.equal(pulling.size, 0)
  service.dispose(); await service.run(); assert.equal(calls, 1)
})
