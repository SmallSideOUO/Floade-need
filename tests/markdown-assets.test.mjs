import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { saveMarkdownImage, resolveMarkdownImage } from '../src/markdown-assets.mjs'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=', 'base64')

test('pasted PNGs are unique, relative to the document, and survive its rename', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-images-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'nested'))
  fs.writeFileSync(path.join(root, 'nested', 'note.md'), '')
  const first = saveMarkdownImage(root, 'nested/note.md', png)
  const second = saveMarkdownImage(root, 'nested/note.md', png)
  assert.notEqual(first, second)
  assert.match(first, /^images\/floade-[a-f0-9-]+\.png$/)
  const image = path.join(root, 'nested', first)
  assert.deepEqual(fs.readFileSync(image), png)
  fs.renameSync(path.join(root, 'nested', 'note.md'), path.join(root, 'nested', 'renamed.md'))
  assert.equal(resolveMarkdownImage(root, pathToFileURL(image).href), pathToFileURL(image).href)
})

test('invalid images and external links cannot write or resolve assets outside the document folder', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-image-paths-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const folder = path.join(root, 'notes')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(folder); fs.mkdirSync(outside)
  fs.writeFileSync(path.join(folder, 'note.md'), '')
  fs.writeFileSync(path.join(outside, 'secret.png'), png)
  assert.throws(() => saveMarkdownImage(folder, '../outside/other.md', png))
  assert.throws(() => saveMarkdownImage(folder, 'note.md', Buffer.from('invalid')))
  assert.equal(resolveMarkdownImage(folder, pathToFileURL(path.join(outside, 'secret.png')).href), null)
  assert.equal(resolveMarkdownImage(folder, 'https://example.com/secret.png'), null)
  fs.symlinkSync(outside, path.join(folder, 'images'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => saveMarkdownImage(folder, 'note.md', png))
  assert.equal(resolveMarkdownImage(folder, pathToFileURL(path.join(folder, 'images', 'secret.png')).href), null)
  assert.deepEqual(fs.readdirSync(outside), ['secret.png'])
})
