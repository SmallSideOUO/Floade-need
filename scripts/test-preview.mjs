import { app, BrowserWindow, clipboard } from 'electron'
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
const originalFetch = globalThis.fetch

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
  '  globalThis.previewQA = { openMarkdownPreview, previewWindows, previewFiles, hasPushableChanges, buildTrayMenu }\n  app.whenReady().then(() => {')
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

  const clipboardBefore = clipboard.readText()
  const menu = previewQA.buildTrayMenu()
  const translateItem = menu.items.find(item => ['Text translation', '文字翻譯'].includes(item.label))
  assert.ok(translateItem, 'tray offers text translation')
  translateItem.click()
  await until(() => Promise.resolve(BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('translation-result.html'))))
  const translationWindow = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('translation-result.html'))
  const runTranslation = code => translationWindow.webContents.executeJavaScript(code)
  await until(() => runTranslation('Boolean(window.floadeTranslation && document.activeElement.id === "source")'))
  translateItem.click()
  assert.equal(BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('translation-result.html')).length, 1)
  assert.equal(await runTranslation('document.querySelector("#confidence").hidden'), true)
  assert.equal(await runTranslation('document.querySelector("#translate").disabled'), true)
  assert.equal(clipboard.readText(), clipboardBefore)
  results.push('tray opens one focused blank text window without reading or replacing clipboard')

  await runTranslation('document.querySelector("#pin").click()')
  await until(() => Promise.resolve(translationWindow.isAlwaysOnTop()))
  assert.equal(await runTranslation('document.querySelector("#pin").getAttribute("aria-pressed")'), 'true')
  await runTranslation('document.querySelector("#pin").click()')
  await until(() => Promise.resolve(!translationWindow.isAlwaysOnTop()))
  translationWindow.minimize()
  translateItem.click()
  assert.equal(translationWindow.isMinimized(), false)
  results.push('pin toggles real native always-on-top; tray restores minimized window')

  const requests = []
  let pendingReply
  let responseMode = 'success'
  globalThis.fetch = async (_url, options) => {
    requests.push(Object.fromEntries(options.body))
    if (responseMode === 'failure') return { ok: false, status: 503 }
    if (responseMode === 'delayed') await new Promise(resolve => { pendingReply = resolve })
    return { ok: true, json: async () => [[['你好', options.body.get('q')]], null, 'en'] }
  }
  const translationInput = value => runTranslation(`document.querySelector('#source').value = ${JSON.stringify(value)}; document.querySelector('#source').dispatchEvent(new Event('input'))`)
  await translationInput('Hello')
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  assert.deepEqual(requests[0], { client: 'gtx', sl: 'auto', tl: 'zh-TW', dt: 't', q: 'Hello' })
  assert.equal(await runTranslation('document.querySelector("#source-language").value'), 'auto')
  await runTranslation('document.querySelector("#target-language").value = "ja"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  await until(() => runTranslation('!document.querySelector("#translate").disabled'))
  assert.equal(requests.at(-1).tl, 'ja')
  await translationInput('Second message')
  await runTranslation('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))')
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  assert.equal(requests.at(-1).q, 'Second message')
  await runTranslation('document.querySelector("#swap").click()')
  await until(() => runTranslation('!document.querySelector("#translate").disabled'))
  assert.equal(requests.at(-1).q, '你好')
  assert.equal(requests.at(-1).sl, 'ja')
  assert.equal(requests.at(-1).tl, 'en')
  results.push('button, Ctrl+Enter, language change and swap use real preload and translation IPC')

  responseMode = 'delayed'
  await translationInput('Old request')
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => Promise.resolve(Boolean(pendingReply)))
  await translationInput('New draft')
  pendingReply()
  await until(() => runTranslation('!document.querySelector("#translate").disabled'))
  assert.equal(await runTranslation('document.querySelector("#translation").value'), '')
  responseMode = 'failure'
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => runTranslation('document.querySelector("#status").classList.contains("error")'))
  assert.equal(await runTranslation('document.querySelector("#source").value'), 'New draft')
  responseMode = 'success'
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  await runTranslation('window.floadeI18n.setLocale("zh-TW")')
  assert.equal(await runTranslation('document.querySelector("#translate").textContent'), '翻譯')
  assert.equal(await runTranslation('document.querySelector("#source").placeholder'), '輸入或貼上要翻譯的文字…')
  if (process.env.FLOADE_TRANSLATION_SCREENSHOT) {
    const screenshot = await translationWindow.webContents.capturePage()
    await fs.writeFile(process.env.FLOADE_TRANSLATION_SCREENSHOT, screenshot.toPNG())
  }
  results.push('stale replies are ignored; errors preserve input and allow retry; Chinese labels work')
  await runTranslation('document.querySelector("#close").click()')
  await until(() => Promise.resolve(translationWindow.isDestroyed()))
  translateItem.click()
  await until(() => Promise.resolve(BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('translation-result.html'))))
  results.push('translation window closes and can be reopened from tray')
  console.log(JSON.stringify({ ok: true, checks: results }, null, 2))
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: true, checks: results }, null, 2))
} catch (error) {
  console.error(error)
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: false, checks: results, error: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(temporary, { recursive: true, force: true }).catch(error => {
    // Chromium may hold profile files until app.exit on Windows.
    if (!['EBUSY', 'EPERM'].includes(error.code)) throw error
  })
  app.exit(process.exitCode || 0)
}
