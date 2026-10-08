import { app, BrowserWindow, clipboard, screen } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import syncFs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { requestLocalApi } from '../src/local-api-client.mjs'
import { createFloatingLauncher } from '../src/floating-launcher.mjs'

const root = process.env.FLOADE_QA_APP_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'floade-preview-qa-'))
await fs.mkdir(path.join(temporary, 'profile'))
app.setPath('userData', path.join(temporary, 'profile'))
app.setAppPath(root)
app.setName('floade-preview-qa')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const results = []
const loginWrites = []
globalThis.previewLoginSettings = options => loginWrites.push(options)
const originalFetch = globalThis.fetch
globalThis.previewApiFolder = path.join(temporary, 'Notes')
await fs.mkdir(globalThis.previewApiFolder)
await fs.writeFile(path.join(globalThis.previewApiFolder, 'note.md'), 'API fixture\n')
await fs.mkdir(path.join(globalThis.previewApiFolder, 'nested'))
await fs.writeFile(path.join(globalThis.previewApiFolder, 'nested', 'guide.md'), 'Nested fixture\n')
globalThis.previewGithubCommand = async (_program, args) => ({ stdout: args[0] === 'auth' ? '' : JSON.stringify(args[1] === 'list'
  ? [{ nameWithOwner: 'demo/notes', isPrivate: true, viewerPermission: 'WRITE' }]
  : { nameWithOwner: 'demo/notes', isPrivate: true, viewerPermission: 'WRITE' }) })
// Keep QA windows off the user's desktop so typing cannot enter test fixtures.
const hideQAWindow = (_event, window) => {
  window.show = () => { window.__qaShown = true }
  window.showInactive = () => { window.__qaShown = true }
  const nativeHide = window.hide.bind(window)
  window.hide = () => { window.__qaShown = false; nativeHide() }
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
source = source.replace('    loadFolders()', '    folders = [{ path: globalThis.previewApiFolder, repo: null }]')
const realApiCommand = 'command: (program, args) => execFileAsync(program, args, { windowsHide: true, timeout: 30000, maxBuffer: 10 * 1024 * 1024 })'
assert.ok(source.includes(realApiCommand))
source = source.replace(realApiCommand, 'command: globalThis.previewGithubCommand')
source = source.replace('    screenTranslator = createScreenTranslator({', '    screenTranslator = createScreenTranslator({ voiceFactory: globalThis.previewVoiceFactory,')
source = source.replace('    floatingLauncher = createFloatingLauncher({', '    floatingLauncher = createFloatingLauncher({ cursor: () => globalThis.previewCursor || screen.getCursorScreenPoint(),')
source = source.replace('    autoPull.start()', '    // Remote pull timer disabled in QA')
source = source.replace('    runDailyPush()', '    // Daily remote pushes disabled in QA')
source = source.replace('    autoPushTimer = setInterval(runDailyPush, 60 * 1000)', '    // Daily timer disabled in QA')
source = source.replace("    if (process.platform === 'win32' && app.isPackaged)", '    if (true)')
source = source.replace('app.setLoginItemSettings(', 'globalThis.previewLoginSettings(')
source = source.replace('  app.whenReady().then(() => {',
  '  globalThis.previewQA = { loadFolders, openMarkdownPreview, previewWindows, previewFiles, hasPushableChanges, buildTrayMenu, requestQuit, readLauncherData, openFloadeMenu, getLauncher: () => floatingLauncher }\n  app.whenReady().then(() => {')
const instrumented = path.join(temporary, 'main.mjs')
await fs.writeFile(instrumented, source)

try {
  await import(pathToFileURL(instrumented).href)
  await app.whenReady()
  await wait(100)
  const apiSocket = process.platform === 'win32' ? `\\\\.\\pipe\\floade-preview-qa-${process.pid}` : path.join(os.tmpdir(), `floade-preview-qa-${process.pid}.sock`)
  const apiCall = (method, params = {}) => requestLocalApi({ method, params }, { socketPath: apiSocket })
  const folderState = () => previewQA.readLauncherData().folders.find(folder => folder.path === globalThis.previewApiFolder)
  assert.deepEqual(Object.keys((await apiCall('api.describe')).result.methods), ['api.describe', 'app.status', 'folders.list', 'repositories.list', 'folders.link'])
  assert.equal((await apiCall('communication.status')).error.code, 'METHOD_NOT_FOUND')
  assert.equal(previewQA.buildTrayMenu().items.length, 5)
  assert.ok(['Quit', '退出'].includes(previewQA.buildTrayMenu().items.at(-1).label))
  assert.ok(['Check for app updates', '檢查程式更新'].includes(previewQA.buildTrayMenu().items[2].label))
  assert.equal(previewQA.buildTrayMenu().items.some(item => /Link|連結/.test(item.label)), false)
  assert.equal(folderState().canPush, false, 'an unlinked folder cannot push')
  assert.deepEqual((await apiCall('folders.list')).result.folders, [{ path: globalThis.previewApiFolder, repo: null, exists: true, busy: false }])
  assert.equal((await apiCall('repositories.list')).result.repositories[0].repo, 'demo/notes')
  const qaConfigPath = path.join(temporary, 'profile', 'folders.json')
  const baselineConfig = JSON.stringify({ folders: [{ path: globalThis.previewApiFolder, repo: null }], settings: { language: 'system', opacity: 1 } })
  await fs.writeFile(qaConfigPath, baselineConfig)
  const originalRename = syncFs.renameSync
  syncFs.renameSync = (from, to) => {
    if (to === qaConfigPath) throw Object.assign(new Error('Configuration is busy'), { code: 'EBUSY' })
    return originalRename(from, to)
  }
  try {
    assert.equal((await apiCall('folders.link', { path: globalThis.previewApiFolder, repo: 'demo/notes' })).ok, false)
    assert.equal((await apiCall('folders.list')).result.folders[0].repo, null)
    assert.equal(await fs.readFile(qaConfigPath, 'utf8'), baselineConfig)
    assert.equal(syncFs.existsSync(`${qaConfigPath}.tmp`), false)
  } finally { syncFs.renameSync = originalRename }
  results.push('failed configuration replacement preserves the existing file and rolls back the in-memory link')
  const linked = await apiCall('folders.link', { path: globalThis.previewApiFolder, repo: 'demo/notes' })
  assert.equal(linked.ok, true)
  assert.equal(linked.result.changed, true)
  const configAfterLink = JSON.parse(await fs.readFile(path.join(temporary, 'profile', 'folders.json'), 'utf8'))
  assert.deepEqual(configAfterLink.folders, [{ path: globalThis.previewApiFolder, repo: 'demo/notes' }])
  assert.equal(folderState().canPush, true, 'link immediately enables the existing Push for pending files')
  assert.equal((await apiCall('folders.link', { path: globalThis.previewApiFolder, repo: 'demo/notes' })).result.changed, false)
  assert.equal((await apiCall('folders.list')).result.folders[0].repo, 'demo/notes')
  results.push('Link is absent from the tray; the real local API saves a verified link and immediately enables the existing Push')
  const launcher = previewQA.getLauncher()
  const runBall = code => launcher.ball.webContents.executeJavaScript(code)
  const runPanel = code => launcher.panel.webContents.executeJavaScript(code)
  await until(() => runBall('Boolean(window.floadeLauncher)'))
  await until(() => runPanel('Boolean(window.floadeLauncher)'))
  assert.equal(await runPanel('document.querySelectorAll(".quick-actions button").length'), 3)
  assert.equal(await runPanel('Boolean(document.querySelector("#communication"))'), false)
  assert.equal(await runBall('Boolean(document.querySelector("#ball-unread"))'), false)
  results.push('AI communication UI and APIs are removed; the three remaining quick actions load normally')
  assert.equal(launcher.ball.isAlwaysOnTop(), true)
  assert.equal(await runBall('getComputedStyle(document.body).backgroundColor'), 'rgba(0, 0, 0, 0)')
  assert.equal(await runBall('getComputedStyle(document.querySelector(".light")).animationName'), 'breathe')
  const originalBall = launcher.ball.getBounds()
  globalThis.previewCursor = { x: originalBall.x + 26, y: originalBall.y + 26 }
  await runBall('window.floadeLauncher.drag("start")')
  globalThis.previewCursor = { x: originalBall.x - 34, y: originalBall.y - 14 }
  await runBall('window.floadeLauncher.drag("move")')
  await runBall('window.floadeLauncher.drag("end")')
  const movedBall = launcher.ball.getBounds()
  assert.deepEqual([movedBall.x, movedBall.y], [originalBall.x - 60, originalBall.y - 40])
  assert.deepEqual(JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.launcherPosition, { x: movedBall.x, y: movedBall.y })
  assert.notEqual(launcher.panel.__qaShown, true, 'dragging does not open the panel')
  globalThis.previewCursor = { x: movedBall.x + 26, y: movedBall.y + 26 }
  await runBall('window.floadeLauncher.hover(true)')
  await until(() => Promise.resolve(launcher.panel.__qaShown === true))
  await until(() => runPanel('document.querySelectorAll(".folder").length === 1'))
  assert.equal(await runPanel('document.querySelector("[data-action=push]").disabled'), false)
  assert.equal(await runPanel('Boolean(document.querySelector("[data-action=preview]") && document.querySelector("[data-action=remove]") && document.querySelector("#add-folder") && document.querySelector("#text-translate") && document.querySelector("#screen-translate"))'), true)
  await runBall('window.floadeLauncher.hover(false)')
  await runPanel('window.floadeLauncher.hover(true)')
  await wait(450)
  assert.equal(launcher.panel.__qaShown, true)
  globalThis.previewCursor = { x: movedBall.x - 900, y: movedBall.y - 900 }
  await runPanel('window.floadeLauncher.hover(false)')
  await until(() => Promise.resolve(launcher.panel.__qaShown === false))
  results.push('transparent breathing ball stays on top; drag saves position; hover preserves the panel during pointer transfer and closes after leaving')
  previewQA.buildTrayMenu().items[1].click()
  assert.equal(launcher.isVisible(), false)
  assert.ok(['Show floating ball', '顯示小球'].includes(previewQA.buildTrayMenu().items[1].label))
  assert.equal(JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.launcherVisible, false)
  previewQA.buildTrayMenu().items[1].click()
  assert.equal(launcher.isVisible(), true)
  previewQA.openFloadeMenu()
  await until(() => runPanel('document.activeElement.id === "search"'))
  await until(() => runPanel('document.querySelector("#status").textContent === ""'))
  assert.equal(await runPanel('document.querySelector("header").nextElementSibling.id'), 'recent-section')
  assert.equal(launcher.panel.isResizable(), true)
  const initialPanelSize = launcher.panel.getBounds()
  globalThis.previewCursor = { x: initialPanelSize.x + initialPanelSize.width - 10, y: initialPanelSize.y + initialPanelSize.height - 10 }
  await runPanel('window.floadeLauncher.sizeDrag("start")')
  globalThis.previewCursor.x += 40
  globalThis.previewCursor.y += 30
  await runPanel('window.floadeLauncher.sizeDrag("move")')
  await runPanel('window.floadeLauncher.sizeDrag("end")')
  const resizedPanel = launcher.panel.getBounds()
  const resizeArea = screen.getDisplayMatching(initialPanelSize).workArea
  assert.ok(Math.abs(resizedPanel.width - Math.min(initialPanelSize.width + 40, resizeArea.x + resizeArea.width - initialPanelSize.x)) <= 2, JSON.stringify({ initialPanelSize, resizedPanel, resizeArea }))
  assert.ok(Math.abs(resizedPanel.height - Math.min(initialPanelSize.height + 30, resizeArea.y + resizeArea.height - initialPanelSize.y)) <= 2, JSON.stringify({ initialPanelSize, resizedPanel, resizeArea }))
  assert.deepEqual(JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.launcherSize, { width: resizedPanel.width, height: resizedPanel.height })
  await runPanel('window.floadeLauncher.resize(400)')
  assert.equal(launcher.panel.getBounds().height, resizedPanel.height, 'content updates cannot overwrite the manually chosen size')
  results.push('panel is resizable; grip changes both dimensions, persists the size and prevents auto sizing from undoing it')
  assert.equal(await runPanel('document.querySelector(".folder-open").getAttribute("aria-expanded")'), 'false')
  assert.equal(await runPanel('document.querySelectorAll(".folder-documents .document").length'), 0)
  await runPanel('document.querySelector(".folder-open").click()')
  await until(() => runPanel('document.querySelectorAll(".folder-documents .document").length === 2'))
  assert.equal(await runPanel('document.querySelector(".folder-open").getAttribute("aria-expanded")'), 'true')
  await launcher.refreshData()
  assert.equal(await runPanel('document.querySelector(".folder-documents").hidden'), false, 'refresh keeps the folder expanded')
  await runPanel('document.querySelector(".folder-open").click()')
  assert.equal(await runPanel('document.querySelector(".folder-documents").hidden'), true)
  await runPanel('document.querySelector(".folder-open").click()')
  if (process.env.FLOADE_LAUNCHER_SCREENSHOT) {
    await runPanel('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await fs.writeFile(process.env.FLOADE_LAUNCHER_SCREENSHOT, (await launcher.panel.webContents.capturePage()).toPNG())
    const ballImage = await launcher.ball.webContents.capturePage()
    assert.equal(ballImage.toBitmap()[3], 0, 'the ball window has transparent corners')
    await fs.writeFile(process.env.FLOADE_LAUNCHER_SCREENSHOT.replace('.png', '-ball.png'), ballImage.toPNG())
  }
  await runPanel('[...document.querySelectorAll(".folder-documents .document")].find(button => button.querySelector("strong").textContent === "guide.md").click()')
  await until(() => Promise.resolve(previewQA.previewWindows.size === 1))
  const nestedDocumentWindow = [...previewQA.previewWindows.values()][0]
  await until(() => nestedDocumentWindow.webContents.executeJavaScript('Boolean(window.floadePreview && document.querySelector("#editor").value === "Nested fixture\\n")'))
  assert.equal(JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).recentDocuments[0].relativePath, 'nested/guide.md')
  nestedDocumentWindow.destroy()
  await until(() => Promise.resolve(previewQA.previewWindows.size === 0))
  await launcher.showPanel(true)
  await until(() => runPanel('document.querySelectorAll(".folder-documents .document").length === 2'))
  await until(() => runPanel('document.querySelector("#recent-documents .document strong").textContent === "guide.md"'))
  results.push('folder cards expand and collapse; nested Markdown opens directly; expansion survives refresh and reopening; recent history is visible at the top')
  await runPanel('document.querySelector("#search").value = "note.md"; document.querySelector("#search").dispatchEvent(new Event("input"))')
  await until(() => runPanel('document.querySelectorAll("#documents .document").length === 1'))
  await runPanel('document.querySelector("#search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))')
  await until(() => Promise.resolve(previewQA.previewWindows.size === 1))
  const launcherDocumentWindow = [...previewQA.previewWindows.values()][0]
  await until(() => launcherDocumentWindow.webContents.executeJavaScript('Boolean(window.floadePreview && document.querySelector("#editor").value === "API fixture\\n")'))
  launcherDocumentWindow.destroy()
  await until(() => Promise.resolve(previewQA.previewWindows.size === 0))
  await launcher.showPanel(true)
  await until(() => runPanel('document.activeElement.id === "search"'))
  await runPanel('document.querySelector("#search").value = ""; document.querySelector("#search").dispatchEvent(new Event("input")); document.querySelector("[data-action=create-file]").click()')
  await until(() => runPanel('document.querySelector("#file-dialog").open'))
  await runPanel('document.querySelector("#file-name").value = "note"; document.querySelector("#file-form").requestSubmit()')
  await until(() => runPanel('document.querySelector("#file-error").textContent.length > 0'))
  assert.equal(await fs.readFile(path.join(globalThis.previewApiFolder, 'note.md'), 'utf8'), 'API fixture\n')
  assert.equal(await runPanel('document.querySelector("#file-dialog").open'), true)
  await runPanel('document.querySelector("#file-name").value = "draft"; document.querySelector("#file-form").requestSubmit()')
  await until(() => Promise.resolve(previewQA.previewWindows.size === 1))
  assert.equal(await fs.readFile(path.join(globalThis.previewApiFolder, 'draft.md'), 'utf8'), '')
  const draftWindow = [...previewQA.previewWindows.values()][0]
  await until(() => draftWindow.webContents.executeJavaScript('document.querySelector("#name").textContent === "draft.md"'))
  await draftWindow.webContents.executeJavaScript('document.querySelector("#editor").value = "saved draft"; document.querySelector("#editor").dispatchEvent(new Event("input"))')
  await launcher.showPanel(true)
  await until(() => runPanel('[...document.querySelectorAll("#recent-documents .document-row")].some(row => row.querySelector("strong").textContent === "draft.md")'))
  await runPanel('[...document.querySelectorAll("#recent-documents .document-row")].find(row => row.querySelector("strong").textContent === "draft.md").querySelector("[data-file-action=rename]").click(); document.querySelector("#file-name").value = "renamed"; document.querySelector("#file-form").requestSubmit()')
  await until(() => Promise.resolve(syncFs.existsSync(path.join(globalThis.previewApiFolder, 'renamed.md'))))
  assert.equal(await fs.readFile(path.join(globalThis.previewApiFolder, 'renamed.md'), 'utf8'), 'saved draft')
  assert.equal(syncFs.existsSync(path.join(globalThis.previewApiFolder, 'draft.md')), false)
  await until(() => Promise.resolve(previewQA.previewWindows.size === 1 && [...previewQA.previewWindows.values()][0] !== draftWindow))
  const renamedWindow = [...previewQA.previewWindows.values()][0]
  await until(() => renamedWindow.webContents.executeJavaScript('document.querySelector("#editor").value === "saved draft"'))
  await launcher.showPanel(true)
  await until(() => runPanel('document.querySelector("#recent-documents .document strong").textContent === "renamed.md"'))
  await renamedWindow.webContents.executeJavaScript('document.querySelector("#editor").value = "conflicting draft"; document.querySelector("#editor").dispatchEvent(new Event("input"))')
  await fs.writeFile(path.join(globalThis.previewApiFolder, 'renamed.md'), 'external edit')
  await runPanel('document.querySelector("#recent-documents [data-file-action=delete]").click(); document.querySelector("#file-form").requestSubmit()')
  await until(() => runPanel('document.querySelector("#file-error").textContent.length > 0'))
  assert.equal(await fs.readFile(path.join(globalThis.previewApiFolder, 'renamed.md'), 'utf8'), 'external edit')
  assert.equal(await renamedWindow.webContents.executeJavaScript('document.querySelector("#editor").value'), 'conflicting draft')
  await renamedWindow.webContents.executeJavaScript('window.confirm = () => true; document.querySelector("#reload").click()')
  await until(() => renamedWindow.webContents.executeJavaScript('document.querySelector("#editor").value === "external edit"'))
  await runPanel('document.querySelector("#file-form").requestSubmit()')
  await until(() => Promise.resolve(!syncFs.existsSync(path.join(globalThis.previewApiFolder, 'renamed.md'))))
  await until(() => Promise.resolve(previewQA.previewWindows.size === 0))
  await until(() => runPanel('!document.querySelector("#file-dialog").open && ![...document.querySelectorAll(".document strong")].some(item => item.textContent === "renamed.md")'))
  results.push('panel creates a document and opens it; rename saves an open draft and reopens the new path; delete preserves conflicts and moves the resolved file to trash; recents follow both changes')
  await launcher.showPanel(true)
  if (process.env.FLOADE_LAUNCHER_SCREENSHOT) {
    // Show the populated recent section and the expanded folder in the preview.
    const bounds = launcher.panel.getBounds()
    globalThis.previewCursor = { x: bounds.x + bounds.width - 10, y: bounds.y + bounds.height - 10 }
    await runPanel('window.floadeLauncher.sizeDrag("start")')
    globalThis.previewCursor = { x: globalThis.previewCursor.x, y: globalThis.previewCursor.y + 150 }
    await runPanel('window.floadeLauncher.sizeDrag("move")')
    await runPanel('window.floadeLauncher.sizeDrag("end")')
    await runPanel('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await fs.writeFile(process.env.FLOADE_LAUNCHER_SCREENSHOT, (await launcher.panel.webContents.capturePage()).toPNG())
  }
  await runPanel('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))')
  assert.equal(launcher.panel.__qaShown, false)
  await launcher.showPanel(true)
  launcher.panel.close()
  assert.equal(launcher.panel.isDestroyed(), false, 'native close hides the panel so it can still be reopened')
  assert.equal(launcher.panel.__qaShown, false)
  results.push('tray has Settings, ball visibility, app updates and Quit; shortcut focuses search, Enter opens a document, and Escape closes the panel')
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
  const demoMarkdown = '# 即時預覽\n\n**粗體** 和 *斜體*\n\n- [x] 貼上截圖\n\n| 項目 | 狀態 |\n| --- | --- |\n| 圖片 | 已貼上 |\n\n```js\nconst hello = "Floade"\n```\n\n'
  await input(demoMarkdown)
  await until(() => run('document.querySelector("#rendered h1")?.textContent === "即時預覽"'))
  assert.equal(await run('document.querySelector("#rendered strong").textContent'), '粗體')
  assert.equal(await run('document.querySelectorAll("#rendered table td").length'), 2)
  assert.equal(await run('document.querySelector("#rendered input").disabled'), true)
  await run(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 220
    const context = canvas.getContext('2d'); context.fillStyle = '#203a61'; context.fillRect(0, 0, 400, 220)
    context.fillStyle = '#b8d8ff'; context.font = '24px sans-serif'; context.fillText('Floade screenshot', 38, 105)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const data = new DataTransfer(); data.items.add(new File([blob], 'Screenshot.png', { type: 'image/png' }))
    const editor = document.querySelector('#editor'); editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length)
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })()`)
  await until(async () => /!\[.*\]\(images\/floade-.*\.png\)/.test(await text()))
  await until(() => run('document.querySelector("#rendered img")?.naturalWidth === 400'))
  const imageMarkdown = await text()
  const pastedPath = imageMarkdown.match(/\]\((images\/[^)]+)\)/)[1]
  assert.ok((await fs.readFile(path.join(temporary, pastedPath))).length > 100)
  await until(async () => await fs.readFile(file, 'utf8') === imageMarkdown)
  await run('document.querySelector("button[data-view=preview]").click()')
  assert.equal(await run('getComputedStyle(document.querySelector("#editor")).display'), 'none')
  await run('document.querySelector("button[data-view=edit]").click()')
  assert.equal(await run('getComputedStyle(document.querySelector("#rendered")).display'), 'none')
  await run('document.querySelector("button[data-view=split]").click()')
  if (process.env.FLOADE_MARKDOWN_SCREENSHOT) {
    window.setSize(900, 720)
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await fs.writeFile(process.env.FLOADE_MARKDOWN_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
  }
  results.push('image paste saves a PNG beside the document and autosaves a relative Markdown link; live GFM preview displays the real image, headings, formatting, tables and task lists in three view modes')
  await input('<script>window.markdownExecuted = true</script><img src="x" onerror="window.markdownExecuted = true"><a href="javascript:alert(1)">unsafe</a><iframe src="https://example.com"></iframe>')
  await until(() => run('document.querySelector("#rendered a")?.textContent === "unsafe"'))
  assert.equal(await run('Boolean(window.markdownExecuted)'), false)
  assert.equal(await run('Boolean(document.querySelector("#rendered script, #rendered iframe, #rendered [onerror], #rendered a[href^=javascript]"))'), false)
  const invalidPaste = await run('window.floadePreview.pasteImage(new Uint8Array([1, 2, 3]))')
  assert.equal(invalidPaste.ok, false)
  results.push('rendered Markdown removes executable HTML and unsafe links; invalid image data fails without changing the document')
  await input('original\n')
  await until(async () => await fs.readFile(file, 'utf8') === 'original\n')
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
  assert.equal(await previewQA.requestQuit(), false)
  assert.equal(window.isDestroyed(), false)
  assert.equal(await text(), 'unsaved local draft\n')
  assert.equal(await fs.readFile(file, 'utf8'), 'concurrent external edit\n')
  results.push('Quit pauses when an editor has a conflict and preserves its draft and the external file')
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
  await fs.writeFile(file, imageMarkdown)
  await previewQA.openMarkdownPreview(temporary, 'sample.md')
  const imageReopened = [...previewQA.previewWindows.values()][0]
  await until(() => imageReopened.webContents.executeJavaScript('document.querySelector("#rendered img")?.naturalWidth === 400'))
  assert.equal(await imageReopened.webContents.executeJavaScript('document.querySelector("#workspace").dataset.view'), 'split')
  imageReopened.close()
  await until(() => Promise.resolve(previewQA.previewFiles.size === 0))
  results.push('reopening saved Markdown resolves the pasted image from disk and restores the chosen view mode')

  await runPanel('window.floadeLauncher.action("settings")')
  await until(() => Promise.resolve(BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('settings.html'))))
  const startupWindow = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('settings.html'))
  const runSettings = code => startupWindow.webContents.executeJavaScript(code)
  await until(() => runSettings('Boolean(window.floadeSettings && document.querySelector("#start-at-login").checked)'))
  await runSettings('document.querySelector("#start-at-login").checked = false; document.querySelector("#start-at-login").dispatchEvent(new Event("change"))')
  await until(async () => JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.startAtLogin === false)
  assert.equal(loginWrites.at(-1).openAtLogin, false)
  await runSettings('document.querySelector("#start-at-login").checked = true; document.querySelector("#start-at-login").dispatchEvent(new Event("change"))')
  await until(async () => JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.startAtLogin === true)
  assert.equal(loginWrites.at(-1).openAtLogin, true)
  assert.equal(loginWrites.at(-1).enabled, true)
  assert.deepEqual(loginWrites.at(-1).args, ['--background'])
  assert.equal(await runSettings('document.querySelector("#auto-pull").checked'), true)
  await runSettings('document.querySelector("#auto-pull").checked = false; document.querySelector("#auto-pull").dispatchEvent(new Event("change"))')
  await until(async () => JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.autoPull === false)
  await runSettings('document.querySelector("#auto-pull").checked = true; document.querySelector("#auto-pull").dispatchEvent(new Event("change"))')
  await until(async () => JSON.parse(await fs.readFile(qaConfigPath, 'utf8')).settings.autoPull === true)
  assert.equal(await runSettings('Boolean(document.querySelector("#open-mobile"))'), true)
  assert.equal(await runSettings('document.querySelector("#auto-update").checked'), true)
  assert.equal(await runSettings('document.querySelector("#check-update").disabled'), true)
  assert.equal(await runSettings('document.querySelector("#install-update").hidden'), true)
  assert.match(await runSettings('document.querySelector("#app-version").textContent'), /Stable|穩定/)
  results.push('settings show the stable app update channel and disable installation in source mode')
  results.push('automatic Pull defaults on; the real settings IPC persists disable/enable, and the mobile entry is available')
  startupWindow.close()
  results.push('Windows startup defaults on; the settings checkbox persists disable/enable and registers the executable with background arguments without touching the real startup registry in QA')

  const clipboardBefore = clipboard.readText()
  const translateItem = { click: () => runPanel('window.floadeLauncher.action("text-translate")') }
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
  results.push('floating panel opens one focused blank text window without reading or replacing clipboard')
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
  let failedLanguage
  let extraDelay
  globalThis.fetch = async (_url, options) => {
    requests.push(Object.fromEntries(options.body))
    if (responseMode === 'failure' || options.body.get('tl') === failedLanguage) return { ok: false, status: 503 }
    if (responseMode === 'delayed') await new Promise(resolve => { pendingReply = resolve })
    if (extraDelay?.language === options.body.get('tl')) await new Promise(resolve => { extraDelay.resolve = resolve })
    const apple = { 'zh-TW': '蘋果', ja: 'りんご', es: 'manzana' }
    const result = options.body.get('q') === 'Old fruit' && options.body.get('tl') === 'ja' ? '古い果物'
      : options.body.get('q') === 'apple' && apple[options.body.get('tl')] ? apple[options.body.get('tl')]
      : options.body.get('tl') === 'en' ? 'Hello' : options.body.get('tl') === 'ja' ? 'こんにちは' : options.body.get('tl') === 'es' ? 'Hola' : '你好'
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
  await runTranslation('document.querySelector("#target-language").value = "zh-TW"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  await until(idle)
  await translationInput('apple')
  await until(() => runTranslation('document.querySelector("#translation").value === "蘋果"'))
  const extraClick = language => runTranslation(`document.querySelector('#extra-choices [data-language="${language}"]').click()`)
  const extraReady = language => runTranslation(`Boolean(document.querySelector('#extra-${language} .extra-text.ready'))`)
  await extraClick('ja')
  await extraClick('es')
  await until(() => extraReady('ja'))
  await until(() => extraReady('es'))
  assert.deepEqual(await runTranslation('[document.querySelector("#source").value, document.querySelector("#translation").value, document.querySelector("#extra-ja .extra-text").textContent, document.querySelector("#extra-es .extra-text").textContent]'), ['apple', '蘋果', 'りんご', 'manzana'])
  assert.equal(requests.filter(request => request.q === 'apple' && request.tl === 'ja').at(-1).sl, 'en')
  const countBeforeReopen = requests.length
  await extraClick('ja')
  await extraClick('ja')
  await until(() => extraReady('ja'))
  assert.equal(requests.length, countBeforeReopen, 'reopening a cached translation makes no request')
  await runTranslation('document.querySelector("#extra-es .extra-action").click()')
  await until(() => Promise.resolve(clipboard.readText() === 'manzana'))
  if (process.env.FLOADE_MULTI_TRANSLATION_SCREENSHOT) {
    await runTranslation('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const screenshot = await translationWindow.webContents.capturePage()
    await fs.writeFile(process.env.FLOADE_MULTI_TRANSLATION_SCREENSHOT, screenshot.toPNG())
  }
  results.push('apple translates to Chinese with Japanese and Spanish expanded together; results copy independently and reuse cached translations')

  const countBeforeExtraComposition = requests.length
  await runTranslation('document.querySelector("#source").dispatchEvent(new CompositionEvent("compositionstart"))')
  await translationInput('a')
  await wait(650)
  assert.equal(requests.length, countBeforeExtraComposition)
  await runTranslation('document.querySelector("#source").value = "New fruit"; document.querySelector("#source").dispatchEvent(new CompositionEvent("compositionend"))')
  await until(() => extraReady('ja'))
  await until(() => extraReady('es'))
  assert.deepEqual(new Set(requests.filter(request => request.q === 'New fruit').map(request => request.tl)), new Set(['zh-TW', 'ja', 'es']))
  results.push('expanded languages update together from the original input after IME composition completes')

  extraDelay = { language: 'ja' }
  await translationInput('Old fruit')
  await runTranslation('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))')
  await until(() => Promise.resolve(Boolean(extraDelay.resolve)))
  const releaseOldExtra = extraDelay.resolve
  extraDelay = undefined
  await lowerInput('新的水果')
  await runTranslation('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }))')
  await until(() => extraReady('ja'))
  await until(() => extraReady('es'))
  releaseOldExtra()
  await wait(100)
  assert.equal(await runTranslation('document.querySelector("#extra-ja .extra-text").textContent'), 'こんにちは')
  assert.equal(await runTranslation('document.querySelector("#translation").value'), '新的水果')
  assert.ok(requests.some(request => request.q === '新的水果' && request.sl === 'zh-TW' && request.tl === 'ja'))
  assert.ok(requests.some(request => request.q === '新的水果' && request.sl === 'zh-TW' && request.tl === 'es'))
  results.push('extra languages use lower input for reverse translation and ignore stale replies from the previous input')

  failedLanguage = 'es'
  await translationInput('Retry extra')
  await until(() => runTranslation('Boolean(document.querySelector("#extra-es .extra-text.error"))'))
  await until(() => extraReady('ja'))
  await until(() => runTranslation('document.querySelector("#translation").value === "你好"'))
  const countBeforeRetryExtra = requests.length
  failedLanguage = undefined
  await runTranslation('document.querySelector("#extra-es .extra-action").click()')
  await until(() => extraReady('es'))
  assert.equal(requests.length, countBeforeRetryExtra + 1)
  assert.equal(requests.at(-1).tl, 'es')
  await runTranslation('document.querySelector("#extra-language").value = "fr"; document.querySelector("#extra-language").dispatchEvent(new Event("change"))')
  await until(() => extraReady('fr'))
  assert.equal(requests.at(-1).q, 'Retry extra')
  assert.equal(requests.at(-1).tl, 'fr')
  results.push('one extra language can fail and retry without affecting the primary result; the full language picker adds another result')
  await translationInput('')
  await wait(650)
  assert.equal(await runTranslation('document.querySelectorAll(".extra-text.ready").length'), 0)
  await translationInput('Hello')
  await until(() => extraReady('fr'))
  for (const language of ['ja', 'es', 'fr']) await extraClick(language)
  await runTranslation('document.querySelector("#target-language").value = "ja"; document.querySelector("#target-language").dispatchEvent(new Event("change"))')
  await until(() => runTranslation('document.querySelector("#translation").value === "こんにちは"'))
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
  results.push('translation window closes and can be reopened from the floating panel')
  const savedLauncherState = JSON.parse(await fs.readFile(qaConfigPath, 'utf8'))
  launcher.dispose()
  previewQA.loadFolders()
  globalThis.restoredLauncher = createFloatingLauncher({
    appPath: root, iconPath: () => path.join(root, 'assets', 'tray.ico'), getLocale: () => 'zh-TW', getOpacity: () => 1,
    getState: () => ({ visible: savedLauncherState.settings.launcherVisible, position: savedLauncherState.settings.launcherPosition, size: savedLauncherState.settings.launcherSize }),
    readData: previewQA.readLauncherData, openDocument: async () => false, mutateDocument: async () => {}, action: async () => {},
    saveVisible: () => {}, savePosition: () => {}, saveSize: () => {}, onVisibilityChange: () => {}
  })
  await restoredLauncher.showPanel(true)
  const restoredBounds = restoredLauncher.panel.getBounds()
  assert.ok(Math.abs(restoredBounds.width - savedLauncherState.settings.launcherSize.width) <= 2)
  assert.ok(Math.abs(restoredBounds.height - savedLauncherState.settings.launcherSize.height) <= 2)
  await until(() => restoredLauncher.panel.webContents.executeJavaScript('document.querySelectorAll("#recent-documents .document").length === 2'))
  results.push('loading saved configuration and rebuilding the panel restores its chosen size and recent documents')
  const nativeQuit = app.quit.bind(app)
  let quitCalled = false
  app.quit = () => { quitCalled = true }
  try {
    previewQA.buildTrayMenu().items.at(-1).click()
    await until(() => Promise.resolve(quitCalled))
    assert.equal(previewQA.previewWindows.size, 0)
    results.push('tray Quit closes document windows through their save handlers before quitting')
  } finally { app.quit = nativeQuit }
  console.log(JSON.stringify({ ok: true, checks: results }, null, 2))
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: true, checks: results }, null, 2))
} catch (error) {
  console.error(error)
  if (process.env.FLOADE_QA_REPORT) await fs.writeFile(process.env.FLOADE_QA_REPORT, JSON.stringify({ ok: false, checks: results, error: error.stack }, null, 2))
  process.exitCode = 1
} finally {
  globalThis.previewQA?.getLauncher()?.dispose()
  globalThis.restoredLauncher?.dispose()
  app.removeListener('browser-window-created', hideQAWindow)
  globalThis.fetch = originalFetch
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  await fs.rm(temporary, { recursive: true, force: true }).catch(error => {
    // Chromium may hold profile files until app.exit on Windows.
    if (!['EBUSY', 'EPERM'].includes(error.code)) throw error
  })
  app.exit(process.exitCode || 0)
}
