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
// Keep QA windows off the user's desktop so typing cannot enter test fixtures.
const hideQAWindow = (_event, window) => {
  window.show = () => {}
  window.showInactive = () => {}
  window.focus = () => {}
  window.webContents.setBackgroundThrottling(false)
}
app.on('browser-window-created', hideQAWindow)
const voiceRequests = []
let voiceOptions
let fakeVoiceSession
globalThis.previewVoiceFactory = options => {
  voiceOptions = options
  return {
    start: (owner, request) => {
      fakeVoiceSession = { owner, ...request }
      voiceRequests.push(fakeVoiceSession)
      return { success: true }
    },
    stop: (owner, id) => {
      if (!fakeVoiceSession || (owner !== undefined && owner !== fakeVoiceSession.owner)
        || (id !== undefined && id !== fakeVoiceSession.id)) return
      options.emit(fakeVoiceSession.owner, { ...fakeVoiceSession, type: 'stopped' })
      fakeVoiceSession = undefined
    }
  }
}

// Instrument a temporary copy of the real main process. No test hooks are
// shipped in the app, and no user's profile, folder or control pipe is used.
let source = await fs.readFile(path.join(root, 'src', 'main.mjs'), 'utf8')
source = source.replace(/from '(\.\/[^']+)'/g, (_match, relative) =>
  `from '${pathToFileURL(path.join(root, 'src', relative)).href}'`)
assert.ok(source.includes('  app.whenReady().then(() => {'))
source = source.replace('floade-local-data-control', `floade-preview-qa-${process.pid}`)
source = source.replace('    loadFolders()', '    folders = []')
source = source.replace('    screenTranslator = createScreenTranslator({', '    screenTranslator = createScreenTranslator({ voiceFactory: globalThis.previewVoiceFactory,')
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
  await runTranslation('window.floadeI18n.setLocale("en")')
  assert.deepEqual(await runTranslation('[...document.querySelector("#target-language").querySelectorAll("optgroup")].map(group => group.label)'), ['Frequently used', 'Other languages'])
  assert.equal(await runTranslation('document.querySelector("#target-language").options.length'), 55)
  assert.equal(await runTranslation('new Set([...document.querySelector("#target-language").options].map(option => option.value)).size'), 55)
  await runTranslation('document.querySelector("#target-language").value = "ar"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  assert.equal(await runTranslation('document.querySelector("#target-language").value'), 'ar')
  assert.equal(await runTranslation('document.querySelector("#target-language optgroup").firstElementChild.value'), 'ar')
  assert.equal(await runTranslation('document.querySelector("#source-language").value'), 'en')
  await runTranslation('document.querySelector("#target-language").value = "zh-TW"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  assert.equal(await runTranslation('Boolean(document.querySelector("#target-language option[value=hi]") && document.querySelector("#target-language option[value=tl]"))'), true)
  results.push('55 unique languages are grouped; selecting a new language promotes it without changing either selection')

  await runTranslation('document.querySelector("#pin").click()')
  await until(() => Promise.resolve(translationWindow.isAlwaysOnTop()))
  assert.equal(await runTranslation('document.querySelector("#pin").getAttribute("aria-pressed")'), 'true')
  await runTranslation('document.querySelector("#pin").click()')
  await until(() => Promise.resolve(!translationWindow.isAlwaysOnTop()))
  results.push('pin toggles real native always-on-top')

  assert.equal(await runTranslation('Boolean(document.querySelector("#swap"))'), true)
  const requests = []
  let pendingReply
  let responseMode = 'success'
  globalThis.fetch = async (_url, options) => {
    requests.push(Object.fromEntries(options.body))
    if (responseMode === 'failure') return { ok: false, status: 503 }
    if (responseMode === 'delayed') await new Promise(resolve => { pendingReply = resolve })
    const result = options.body.get('tl') === 'en' ? 'Hello' : options.body.get('tl') === 'ja' ? 'こんにちは' : '你好'
    return { ok: true, json: async () => [[[result, options.body.get('q')]], null, options.body.get('sl') === 'auto' ? 'en' : options.body.get('sl')] }
  }
  const inputSide = (id, value) => runTranslation(`document.querySelector('#${id}').value = ${JSON.stringify(value)}; document.querySelector('#${id}').dispatchEvent(new Event('input'))`)
  const translationInput = value => inputSide('source', value)
  const lowerInput = value => inputSide('translation', value)
  const idle = () => runTranslation('!document.querySelector("#translate").disabled')
  await translationInput('Hello')
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  assert.deepEqual(requests[0], { client: 'gtx', sl: 'en', tl: 'zh-TW', dt: 't', q: 'Hello' })
  await wait(650)
  assert.equal(requests.length, 1, 'programmatic result does not retrigger translation')
  await lowerInput('你好朋友')
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  assert.deepEqual(requests.at(-1), { client: 'gtx', sl: 'zh-TW', tl: 'en', dt: 't', q: '你好朋友' })
  assert.equal(await runTranslation('document.querySelector("#translation").value'), '你好朋友')
  const countAfterReverse = requests.length
  await wait(650)
  assert.equal(requests.length, countAfterReverse, 'reverse result does not loop')
  results.push('typing in either box automatically translates in the correct direction without loops')

  await translationInput('H')
  await wait(100)
  await translationInput('He')
  await wait(100)
  await translationInput('Hello again')
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  assert.equal(requests.length, countAfterReverse + 1, 'typing is debounced into one request')
  assert.equal(requests.at(-1).q, 'Hello again')
  await runTranslation('document.querySelector("#target-language").value = "ja"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  await until(() => runTranslation('document.querySelector("#translation").value === "こんにちは"'))
  assert.equal(requests.at(-1).tl, 'ja')
  await lowerInput('こんにちは友達')
  await runTranslation('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))')
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  assert.equal(requests.at(-1).sl, 'ja')
  assert.equal(requests.at(-1).tl, 'en')
  results.push('rapid typing is debounced; language changes and Ctrl+Enter respect the last edited box')

  const countBeforeComposition = requests.length
  await runTranslation('document.querySelector("#translation").dispatchEvent(new CompositionEvent("compositionstart"))')
  await lowerInput('に')
  await wait(650)
  assert.equal(requests.length, countBeforeComposition)
  await runTranslation('document.querySelector("#translation").value = "日本語"; document.querySelector("#translation").dispatchEvent(new CompositionEvent("compositionend"))')
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  assert.equal(requests.at(-1).q, '日本語')
  results.push('IME composition waits for completed text before translating')

  responseMode = 'delayed'
  pendingReply = undefined
  await translationInput('Old request')
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => Promise.resolve(Boolean(pendingReply)))
  assert.equal(await runTranslation('document.querySelector("#translation").readOnly'), false)
  await lowerInput('新的下方草稿')
  await wait(650)
  responseMode = 'success'
  pendingReply()
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  assert.equal(await runTranslation('document.querySelector("#translation").value'), '新的下方草稿')
  assert.equal(requests.at(-1).q, '新的下方草稿')
  assert.equal(requests.at(-1).tl, 'en')
  results.push('editing the other box during a request preserves the new draft and queues its reverse translation')

  responseMode = 'failure'
  await lowerInput('保留我的草稿')
  await until(() => runTranslation('document.querySelector("#status").classList.contains("error")'))
  assert.equal(await runTranslation('document.querySelector("#translation").value'), '保留我的草稿')
  responseMode = 'success'
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  await runTranslation('document.querySelector("#source-language").value = "auto"; document.querySelector("#source-language").dispatchEvent(new Event("change"))')
  await until(idle)
  assert.equal(requests.at(-1).tl, 'en', 'reverse translation never sends auto as the target')
  await translationInput('Detected English')
  await runTranslation('document.querySelector("#source-language").value = "auto"; document.querySelector("#source-language").dispatchEvent(new Event("change"))')
  await until(() => runTranslation('document.querySelector("#translation").value === "こんにちは"'))
  assert.equal(requests.at(-1).sl, 'auto')
  await lowerInput('逆方向')
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  assert.equal(requests.at(-1).tl, 'en')
  const countBeforeClear = requests.length
  await lowerInput('')
  await wait(650)
  assert.equal(await runTranslation('document.querySelector("#source").value'), '')
  assert.equal(requests.length, countBeforeClear)
  results.push('errors preserve editable text and allow retry; automatic language detection supports reverse; empty text clears output')

  await translationInput('Hello')
  await until(() => runTranslation('document.querySelector("#translation").value === "こんにちは"'))
  await runTranslation('window.floadeI18n.setLocale("zh-TW")')
  assert.equal(await runTranslation('document.querySelector("#source").placeholder'), '輸入或貼上要翻譯的文字…')
  assert.equal(await runTranslation('document.querySelector("#translation").placeholder'), '在這裡輸入，自動翻譯成上方語言…')
  assert.deepEqual(await runTranslation('[...document.querySelector("#target-language").querySelectorAll("optgroup")].map(group => group.label)'), ['常用語言', '其他語言'])
  assert.notEqual(await runTranslation('document.querySelector("#target-language option[value=ar]").textContent'), 'language.ar')
  if (process.env.FLOADE_TRANSLATION_SCREENSHOT) {
    translationWindow.show()
    translationWindow.focus()
    await runTranslation('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await wait(150)
    const screenshot = await translationWindow.webContents.capturePage()
    await fs.writeFile(process.env.FLOADE_TRANSLATION_SCREENSHOT, screenshot.toPNG())
  }
  results.push('both input directions have localized hints')
  const pairBeforeSwap = await runTranslation('[document.querySelector("#source").value, document.querySelector("#translation").value]')
  const countBeforeSwap = requests.length
  await runTranslation('document.querySelector("#swap").click()')
  assert.deepEqual(await runTranslation('[document.querySelector("#source").value, document.querySelector("#translation").value]'), [...pairBeforeSwap].reverse())
  assert.deepEqual(await runTranslation('[document.querySelector("#source-language").value, document.querySelector("#target-language").value]'), ['ja', 'en'])
  await wait(650)
  assert.equal(requests.length, countBeforeSwap, 'swapping preserves both texts without regenerating them')
  await runTranslation('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))')
  await until(idle)
  assert.equal(requests.at(-1).q, pairBeforeSwap[0])
  assert.equal(requests.at(-1).sl, 'en')
  assert.equal(requests.at(-1).tl, 'ja')
  await runTranslation('document.querySelector("#swap").click()')
  assert.deepEqual(await runTranslation('[document.querySelector("#source").value, document.querySelector("#translation").value]'), pairBeforeSwap)
  results.push('swap exchanges texts and languages together, resolves auto detection and preserves the last edited direction')

  responseMode = 'delayed'
  pendingReply = undefined
  await translationInput('Pending swap')
  await runTranslation('document.querySelector("#translate").click()')
  await until(() => Promise.resolve(Boolean(pendingReply)))
  await runTranslation('document.querySelector("#swap").click()')
  const countDuringSwap = requests.length
  responseMode = 'success'
  pendingReply()
  await until(idle)
  assert.deepEqual(await runTranslation('[document.querySelector("#source").value, document.querySelector("#translation").value]'), ['', 'Pending swap'])
  assert.equal(requests.length, countDuringSwap)
  await lowerInput('Hello')
  await until(() => runTranslation('document.querySelector("#source").value === "こんにちは"'))
  await runTranslation('document.querySelector("#swap").click()')
  results.push('swapping during a request ignores its stale reply and subsequent typing still translates correctly')
  await runTranslation('document.querySelector("#source-mic").click()')
  await until(() => Promise.resolve(voiceRequests.length > 0))
  let voiceRequest = voiceRequests.at(-1)
  assert.equal(voiceRequest.mode, 'listen')
  assert.equal(voiceRequest.language, 'en')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'ready', language: 'en-US' })
  await until(() => runTranslation('document.activeElement.id === "source"'))
  await runTranslation('document.querySelector("#source").setSelectionRange(0, document.querySelector("#source").value.length)')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'text', text: 'Spoken English' })
  await until(() => runTranslation('document.querySelector("#source").value === "Spoken English" && document.querySelector("#translation").value === "こんにちは"'))
  await runTranslation('document.querySelector("#source-mic").click()')
  await until(() => Promise.resolve(!fakeVoiceSession))
  assert.equal(await runTranslation('document.querySelector("#source-mic").getAttribute("aria-pressed")'), 'false')
  results.push('microphone inserts text at selection and automatically translates through real voice IPC; click again stops')

  await runTranslation('document.querySelector("#target-language").value = "zh-TW"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  await runTranslation('document.querySelector("#translation-mic").click()')
  await until(() => Promise.resolve(fakeVoiceSession?.side === 'translation'))
  voiceRequest = voiceRequests.at(-1)
  assert.equal(voiceRequest.language, 'zh-TW')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'ready', language: 'zh-TW' })
  await until(() => runTranslation('document.activeElement.id === "translation"'))
  await runTranslation('document.querySelector("#translation").setSelectionRange(0, document.querySelector("#translation").value.length)')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'text', text: '語音輸入' })
  await until(() => runTranslation('document.querySelector("#translation").value === "語音輸入" && document.querySelector("#source").value === "Hello"'))
  await runTranslation('document.querySelector("#translation-speak").click()')
  await until(() => Promise.resolve(fakeVoiceSession?.mode === 'speak'))
  voiceRequest = voiceRequests.at(-1)
  assert.equal(voiceRequest.language, 'zh-TW')
  assert.equal(voiceRequest.text, '語音輸入')
  assert.equal(await runTranslation('document.querySelector("#translation-mic").getAttribute("aria-pressed")'), 'false')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'ready', language: 'zh-TW' })
  await until(() => runTranslation('document.querySelector("#voice-status").textContent === "正在朗讀…"'))
  await lowerInput('修改後停止朗讀')
  await until(() => Promise.resolve(!fakeVoiceSession))
  await until(() => runTranslation('document.querySelector("#source").value === "Hello"'))
  results.push('lower microphone translates in reverse; reading uses matching language and stops on text edits')

  await runTranslation('document.querySelector("#source-speak").click()')
  await until(() => Promise.resolve(fakeVoiceSession?.side === 'source'))
  voiceRequest = voiceRequests.at(-1)
  assert.equal(voiceRequest.text, 'Hello')
  assert.equal(voiceRequest.language, 'en')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'error', message: 'Missing speech language' })
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'stopped' })
  await until(() => runTranslation('document.querySelector("#voice-status").classList.contains("error")'))
  assert.equal(await runTranslation('document.querySelector("#source-speak").getAttribute("aria-pressed")'), 'false')
  const textBeforeLateVoice = await runTranslation('document.querySelector("#source").value')
  voiceOptions.emit(voiceRequest.owner, { ...voiceRequest, type: 'text', text: 'stale voice' })
  assert.equal(await runTranslation('document.querySelector("#source").value'), textBeforeLateVoice)
  await runTranslation('document.querySelector("#source-mic").click()')
  await until(() => Promise.resolve(fakeVoiceSession?.mode === 'listen'))
  await runTranslation('document.querySelector("#swap").click()')
  await until(() => Promise.resolve(!fakeVoiceSession))
  results.push('swapping stops active voice before changing its language and text')
  await runTranslation('document.querySelector("#source-mic").click()')
  await until(() => Promise.resolve(fakeVoiceSession?.mode === 'listen'))
  results.push('both read-aloud buttons route text correctly; errors reset controls and stopped recognition cannot write late text')
  const historyBeforeClose = await runTranslation('localStorage.getItem("floade.translation.languageUsage.v1")')
  await runTranslation('document.querySelector("#close").click()')
  await until(() => Promise.resolve(translationWindow.isDestroyed()))
  assert.equal(fakeVoiceSession, undefined, 'closing translation window stops its microphone')
  translateItem.click()
  await until(() => Promise.resolve(BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('translation-result.html'))))
  const reopened = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('translation-result.html'))
  await until(() => reopened.webContents.executeJavaScript('Boolean(window.floadeLanguages && document.querySelector("#target-language").options.length === 55)'))
  assert.equal(await reopened.webContents.executeJavaScript('localStorage.getItem("floade.translation.languageUsage.v1")'), historyBeforeClose)
  results.push('language usage persists when the translation window is closed and reopened')
  results.push('translation window closes and can be reopened from tray')
  console.log(JSON.stringify({ ok: true, checks: results }, null, 2))
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: true, checks: results }, null, 2))
} catch (error) {
  console.error(error)
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: false, checks: results, error: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  app.removeListener('browser-window-created', hideQAWindow)
  globalThis.fetch = originalFetch
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(temporary, { recursive: true, force: true }).catch(error => {
    // Chromium may hold profile files until app.exit on Windows.
    if (!['EBUSY', 'EPERM'].includes(error.code)) throw error
  })
  app.exit(process.exitCode || 0)
}
