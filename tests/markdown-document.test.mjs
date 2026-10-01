import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createMarkdownDocument } from '../src/markdown-document.mjs'

function fixture(t, onChange = () => {}, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-document-'))
  const file = path.join(directory, 'sample.md')
  fs.writeFileSync(file, 'original\n')
  const document = createMarkdownDocument(file, onChange, options)
  t.after(() => {
    document.dispose()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { file, document, directory }
}

test('external writes, atomic replacements and delete/recreate reach an open document', async t => {
  const changes = []
  const { file, document, directory } = fixture(t, content => changes.push(content), { interval: 20 })
  fs.writeFileSync(file, 'externally appended\n')
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(changes, ['externally appended\n'])
  const replacement = path.join(directory, 'replacement.md')
  fs.writeFileSync(replacement, 'replacement\n')
  fs.renameSync(replacement, file)
  document.refresh()
  assert.equal(changes.at(-1), 'replacement\n')
  fs.unlinkSync(file)
  document.refresh()
  assert.equal(changes.at(-1), 'replacement\n')
  assert.throws(() => document.save('stale\n', 'replacement\n'), /ENOENT/)
  fs.writeFileSync(file, 'recreated\n')
  document.refresh()
  assert.equal(changes.at(-1), 'recreated\n')
})

test('save checks disk before polling and preserves external changes', t => {
  const { file, document } = fixture(t)
  fs.writeFileSync(file, 'external\n')
  assert.deepEqual(document.save('draft\n', 'original\n'), {
    ok: false, conflict: true, content: 'external\n'
  })
  assert.equal(fs.readFileSync(file, 'utf8'), 'external\n')
  assert.deepEqual(document.save('external\n', 'original\n'), { ok: true })
  assert.deepEqual(document.save('new edit\n', 'external\n'), { ok: true })
})

test('own saves do not cause reloads and disposing stops updates', async t => {
  const changes = []
  const { file, document } = fixture(t, content => changes.push(content), { interval: 20 })
  assert.deepEqual(document.save('edited\n', 'original\n'), { ok: true })
  document.refresh()
  assert.deepEqual(changes, [])
  document.dispose()
  fs.writeFileSync(file, 'later\n')
  await new Promise(resolve => setTimeout(resolve, 60))
  document.refresh()
  assert.deepEqual(changes, [])
})
