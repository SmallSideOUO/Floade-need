import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { ensureCommitIdentity } from '../src/git-identity.mjs'

const execFileAsync = promisify(execFile)

test('a new linked repository can commit without a preconfigured Git author', async () => {
  const folderPath = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-identity-'))
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(folderPath, 'missing-global-config'),
    GIT_CONFIG_NOSYSTEM: '1'
  }
  const command = (program, args, cwd) => {
    if (program === 'gh') {
      return Promise.resolve({ stdout: JSON.stringify({ id: 123, login: 'example-user', name: 'Example User' }) })
    }
    return execFileAsync(program, args, { cwd, env, windowsHide: true })
  }

  try {
    await command('git', ['init'], folderPath)
    await fs.writeFile(path.join(folderPath, 'sample.txt'), 'hello\n')
    await command('git', ['add', '-A'], folderPath)
    await ensureCommitIdentity(folderPath, command)
    await command('git', ['commit', '-m', 'test commit'], folderPath)
    const { stdout } = await command('git', ['log', '-1', '--format=%an <%ae>'], folderPath)
    assert.equal(stdout.trim(), 'Example User <123+example-user@users.noreply.github.com>')
  } finally {
    await fs.rm(folderPath, { recursive: true, force: true })
  }
})
