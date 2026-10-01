import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { syncFolderToRepository } from '../src/push-folder.mjs'

const exec = promisify(execFile)
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-push-'))
  const local = path.join(root, 'local')
  const remote = path.join(root, 'remote.git')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'no-global'), GIT_CONFIG_NOSYSTEM: '1' }
  const git = (args, cwd = root) => exec('git', args, { cwd, env, windowsHide: true })
  await fs.mkdir(local)
  await git(['init', '--bare', remote])
  const calls = []
  const command = async (program, args, cwd) => {
    calls.push([program, ...args])
    if (program === 'gh') {
      if (args[0] === 'auth') return { stdout: '' }
      return { stdout: JSON.stringify({ id: 123, login: 'fixture', name: 'Fixture User' }) }
    }
    // Keep the exact app workflow, redirect only its remote to local test data.
    if (args[0] === 'remote' && (args[1] === 'add' || args[1] === 'set-url')) args = [...args.slice(0, -1), remote]
    return git(args, cwd)
  }
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const push = () => syncFolderToRepository(local, 'fixture/test', command)
  return { root, local, remote, git, command, calls, push }
}

test('app push initializes identity and remote, pushes additions, edits and deletions', async t => {
  const { local, remote, git, push, calls } = await fixture(t)
  await fs.writeFile(path.join(local, 'sample.md'), 'first\n')
  await push()
  assert.equal((await git(['show', 'main:sample.md'], remote)).stdout, 'first\n')
  assert.equal((await git(['log', '-1', '--format=%ae'], local)).stdout.trim(), '123+fixture@users.noreply.github.com')
  await fs.writeFile(path.join(local, 'sample.md'), 'second\n')
  await push()
  assert.equal((await git(['show', 'main:sample.md'], remote)).stdout, 'second\n')
  await fs.unlink(path.join(local, 'sample.md'))
  await push()
  assert.equal((await git(['ls-tree', '--name-only', 'main'], remote)).stdout, '')
  assert.ok(calls.some(call => call.join(' ') === 'gh auth setup-git'))
})

test('failed transport keeps a pending commit and retry does not duplicate it', async t => {
  const { local, command, git, push } = await fixture(t)
  await fs.writeFile(path.join(local, 'sample.md'), 'retry\n')
  const failPush = (program, args, cwd) => {
    if (program === 'git' && args[0] === 'push') throw new Error('fixture transport unavailable')
    return command(program, args, cwd)
  }
  await assert.rejects(syncFolderToRepository(local, 'fixture/test', failPush), /transport unavailable/)
  assert.equal((await git(['status', '--porcelain'], local)).stdout, '')
  const head = (await git(['rev-parse', 'HEAD'], local)).stdout
  await push()
  assert.equal((await git(['rev-parse', 'HEAD'], local)).stdout, head)
  assert.equal((await git(['rev-parse', 'origin/main'], local)).stdout, head)
})

test('diverged remote is rejected without force push or dropping either history', async t => {
  const { root, local, remote, git, push } = await fixture(t)
  await fs.writeFile(path.join(local, 'sample.md'), 'base\n')
  await push()
  const other = path.join(root, 'other')
  await git(['clone', '--branch', 'main', remote, other])
  await git(['config', 'user.name', 'Other'], other)
  await git(['config', 'user.email', 'other@example.test'], other)
  await fs.writeFile(path.join(other, 'remote.md'), 'remote edit\n')
  await git(['add', '-A'], other)
  await git(['commit', '-m', 'remote edit'], other)
  await git(['push', 'origin', 'main'], other)
  const remoteHead = (await git(['rev-parse', 'main'], remote)).stdout
  await fs.writeFile(path.join(local, 'sample.md'), 'local edit\n')
  await assert.rejects(push(), /rejected|fetch first|non-fast-forward/)
  assert.equal((await git(['rev-parse', 'main'], remote)).stdout, remoteHead)
  assert.equal((await git(['show', 'HEAD:sample.md'], local)).stdout, 'local edit\n')
})
