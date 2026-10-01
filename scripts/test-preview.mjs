import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-preview-qa-'))
await fs.mkdir(path.join(temporary, 'profile'))
app.setPath('userData', path.join(temporary, 'profile'))
app.setAppPath(root)
app.setName('floade-preview-qa')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []

// Instrument a temporary copy of the real main process. No test hooks are
// shipped in the app, and no user's profile, folder or control pipe is used.
let source = await fs.readFile(path.join(root, 'src', 'main.mjs'), 'utf8')
source = source.replace(/from '(\.\/[^']+)'/g, (_match, relative) =>
  `from '${pathToFileURL(path.join(root, 'src', relative)).href}'`)
assert.ok(source.includes('  app.whenReady().then(() => {'))
source = source.replace('floade-local-data-control', `floade-preview-qa-${process.pid}`)
source = source.replace('    loadFolders()', '    folders = []')
source = source.replace("    if (process.platform === 'win32' && app.isPackaged)", '    if (false)')
source = source.replace('  app.whenReady().then(() => {',
  '  globalThis.previewQA = { openMarkdownPreview, previewWindows, previewFiles, hasPushableChanges }\n  app.whenReady().then(() => {')
const instrumented = path.join(temporary, 'main.mjs')
await fs.writeFile(instrumented, source)

try {
  await import(pathToFileURL(instrumented).href)
  await app.whenReady()
  await wait(100)
  const file = path.join(temporary, 'sample.md')
  await fs.writeFile(file, 'original\n')
  await previewQA.openMarkdownPreview(temporary, 'sample.md')
  const window = [...previewQA.previewWindows.values()][0]
  window.webContents.on('preload-error', (_event, _preload, error) => console.error('Preload:', error))
  window.webContents.on('console-message', event => console.error('Renderer:', event.message))
  const run = code => window.webContents.executeJavaScript(code)
  async function until(check) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await check()) return
      await wait(50)
    }
    throw new Error('Timed out waiting for preview')
  }
  const text = () => run('document.querySelector("#editor").value')
  const input = value => run(`document.querySelector('#editor').value = ${JSON.stringify(value)}; document.querySelector('#editor').dispatchEvent(new Event('input'))`)
  await until(async () => await text() === 'original\n')
  await run('document.querySelector("#editor").setSelectionRange(2, 4)')
  await fs.writeFile(file, 'external addition\n')
  await until(async () => await text() === 'external addition\n')
  assert.deepEqual(await run('[document.querySelector("#editor").selectionStart, document.querySelector("#editor").selectionEnd]'), [2, 4])
  results.push('external write updates open renderer and preserves selection')

  await input('saved by editor\n')
  await until(async () => await fs.readFile(file, 'utf8') === 'saved by editor\n')
  results.push('normal autosave through real preload and main IPC')

  const replacement = path.join(temporary, 'replacement.md')
  await fs.writeFile(replacement, 'atomic replacement\n')
  await fs.rename(replacement, file)
  await until(async () => await text() === 'atomic replacement\n')
  results.push('atomic file replacement updates renderer')

  await input('unsaved local draft\n')
  await fs.writeFile(file, 'concurrent external edit\n')
  await until(() => run('!document.querySelector("#reload").hidden'))
  await wait(550)
  assert.equal(await text(), 'unsaved local draft\n')
  assert.equal(await fs.readFile(file, 'utf8'), 'concurrent external edit\n')
  if (process.env.FLOADE_QA_SCREENSHOT) {
    const screenshot = await window.webContents.capturePage()
    await fs.writeFile(process.env.FLOADE_QA_SCREENSHOT, screenshot.toPNG())
  }
  await run('document.querySelector("#close").click()')
  await wait(100)
  assert.equal(window.isDestroyed(), false)
  window.close()
  await wait(100)
  assert.equal(window.isDestroyed(), false)
  assert.equal(await fs.readFile(file, 'utf8'), 'concurrent external edit\n')
  results.push('concurrent edits preserve both disk and draft, including native close')

  await run('window.confirm = () => false; document.querySelector("#reload").click()')
  await wait(100)
  assert.equal(await text(), 'unsaved local draft\n')
  await run('window.confirm = () => true; document.querySelector("#reload").click()')
  await until(async () => await text() === 'concurrent external edit\n')
  await run('window.floadeI18n.setLocale("zh-TW")')
  assert.equal(await run('document.querySelector("#status").textContent'), '已從檔案更新')
  results.push('reload requires discard confirmation and supports Traditional Chinese')

  await fs.unlink(file)
  await wait(1100)
  assert.equal(await text(), 'concurrent external edit\n')
  await fs.writeFile(file, 'recreated\n')
  await until(async () => await text() === 'recreated\n')
  results.push('temporary deletion does not erase the editor; recreation reloads')
  window.close()
  await until(() => Promise.resolve(previewQA.previewFiles.size === 0))
  results.push('closing window disposes document polling')
  console.log(JSON.stringify({ ok: true, checks: results }, null, 2))
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: true, checks: results }, null, 2))
} catch (error) {
  console.error(error)
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: false, checks: results, error: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(temporary, { recursive: true, force: true }).catch(error => {
    // Chromium may hold profile files until app.exit on Windows.
    if (!['EBUSY', 'EPERM'].includes(error.code)) throw error
  })
  app.exit(process.exitCode || 0)
}
