import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { documentName, managedDocumentPath, createLauncherFile, renameLauncherFile } from '../src/launcher-files.mjs'

test('document creation and rename preserve content and never overwrite an existing file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-files-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  assert.equal(createLauncherFile(root, '新筆記'), '新筆記.md')
  fs.writeFileSync(path.join(root, '新筆記.md'), 'draft')
  assert.throws(() => createLauncherFile(root, '新筆記'), { code: 'EEXIST' })
  createLauncherFile(root, 'existing')
  assert.throws(() => renameLauncherFile(root, '新筆記.md', 'existing'), { code: 'EEXIST' })
  assert.equal(fs.readFileSync(path.join(root, '新筆記.md'), 'utf8'), 'draft')
  assert.equal(renameLauncherFile(root, '新筆記.md', 'renamed.md'), 'renamed.md')
  assert.equal(fs.readFileSync(path.join(root, 'renamed.md'), 'utf8'), 'draft')
  assert.equal(fs.existsSync(path.join(root, '新筆記.md')), false)
  if (process.platform === 'win32') {
    assert.equal(renameLauncherFile(root, 'renamed.md', 'Renamed.md'), 'Renamed.md')
    assert.ok(fs.readdirSync(root).includes('Renamed.md'))
  }
})

test('invalid filenames, traversal, Git metadata and external directory links are rejected', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-paths-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const folder = path.join(root, 'registered')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(folder); fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'private.md'), 'unchanged')
  for (const name of ['', '..', 'a/b', 'a\\b', 'CON', 'x.', 'nul.md', 'a:b', 'a\nb']) assert.throws(() => documentName(name))
  for (const relative of ['../outside/private.md', '.git/config.md', 'private.md:stream.md', '/private.md', 'a.txt']) assert.throws(() => managedDocumentPath(folder, relative))
  fs.symlinkSync(outside, path.join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => managedDocumentPath(folder, 'link/private.md'))
  assert.throws(() => renameLauncherFile(folder, 'link/private.md', 'renamed'))
  assert.equal(fs.readFileSync(path.join(outside, 'private.md'), 'utf8'), 'unchanged')
})
