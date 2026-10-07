import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCommunication, encodeMessage } from '../src/communication.mjs'
import { createCommunicationWindow } from '../src/communication-window.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = process.env.FLOADE_QA_APP_PATH || root
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-chat-qa-'))
app.setPath('userData', temporary)
app.setAppPath(root)
app.on('window-all-closed', () => {})
const rooms = []
const comments = new Map()
let nextComment = 100
let offline = false
let panel
let window
let service
const checks = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(callback, timeout = 10000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await callback()) return; await delay(40) }
  throw new Error('UI condition timed out')
}
app.on('browser-window-created', (_event, created) => {
  created.show = () => {}
  created.focus = () => {}
  created.webContents.setBackgroundThrottling(false)
})
const run = script => window.webContents.executeJavaScript(script)
const command = async (_program, args) => {
  if (offline) throw new Error('Network unavailable')
  const endpoint = args[3]
  const method = args[args.indexOf('--method') + 1]
  const input = args.includes('--input') ? JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')) : null
  let result
  if (endpoint === 'repos/demo/private') result = { full_name: 'demo/private', private: true, has_issues: true, permissions: { push: true } }
  else if (endpoint.includes('/comments')) {
    const id = Number(endpoint.match(/issues\/(\d+)/)[1])
    const list = comments.get(id)
    if (method === 'POST') {
      result = { id: nextComment++, body: input.body, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), user: { login: 'demo' } }
      list.push(result)
    } else result = list
  } else if (method === 'POST') {
    result = { number: rooms.length + 1, ...input, html_url: 'https://github.com/demo/private/issues/1' }
    rooms.push(result)
    comments.set(result.number, [])
  } else result = rooms
  return { stdout: JSON.stringify(args.includes('--slurp') ? [result] : result) }
}
try {
  service = createCommunication({ userDataPath: temporary, command, deviceName: '測試桌機', autoStart: false })
  panel = createCommunicationWindow({ appPath: runtimeRoot, iconPath: () => path.join(runtimeRoot, 'assets', 'tray.ico'), getLocale: () => 'zh-TW', getOpacity: () => 1, service })
  panel.open()
  window = BrowserWindow.getAllWindows()[0]
  await until(() => run('Boolean(window.floadeCommunication && document.querySelector("#configuration").open)'))
  assert.equal(window.webContents.getLastWebPreferences().sandbox, true)
  assert.equal(window.webContents.getLastWebPreferences().nodeIntegration, false)
  assert.equal(await run('document.querySelector("#send").disabled'), true)
  await run('document.querySelector("#repo").value = "demo/private"; document.querySelector("#config-form").requestSubmit()')
  await until(() => run('!document.querySelector("#configuration").open && document.querySelector("#room-name").textContent === "共用"'))
  assert.equal(rooms.length, 1)
  checks.push('first-run setup creates a private-repository channel using the real sandboxed preload')

  const content = '**你好**\n\n<script>window.injected = true</script><img src="x" onerror="window.injected=true">\n\n[unsafe](javascript:alert(1)) [local](file:///C:/secret) [web](https://example.com)'
  await run(`document.querySelector('#message').value = ${JSON.stringify(content)}; document.querySelector('#agent').value = 'Codex / test'; document.querySelector('#target').value = '筆電'; document.querySelector('#message').dispatchEvent(new Event('input')); document.querySelector('#composer').requestSubmit()`)
  await until(() => run('document.querySelectorAll(".message").length === 1 && !document.querySelector("#send").disabled && !document.querySelector("#message").value'))
  assert.equal(await run('document.querySelector(".message-body strong").textContent'), '你好')
  assert.equal(await run('Boolean(window.injected || document.querySelector(".message-body img, .message-body script"))'), false)
  assert.equal(await run('document.querySelectorAll(".message-body a[data-url]").length'), 1)
  const unsafe = await run('window.floadeCommunication.request("communication.open-link", {url:"file:///C:/secret"})')
  assert.equal(unsafe.ok, false)
  assert.ok((await run('document.querySelector(".message-meta strong").textContent')).includes('測試桌機 / Codex / test → 筆電'))
  checks.push('send renders sanitized Markdown and blocks script, image, JavaScript and local-file links')

  await run('document.querySelector(".message-meta button").click(); document.querySelector("#message").value = "Reply"; document.querySelector("#composer").requestSubmit()')
  await until(() => run('document.querySelectorAll(".message").length === 2 && !document.querySelector("#send").disabled'))
  assert.equal(await run('document.querySelectorAll(".message-reply").length'), 1)
  checks.push('reply keeps the original message ID and displays its context')

  offline = true
  await run('document.querySelector("#message").value = "Offline message"; document.querySelector("#composer").requestSubmit()')
  await until(() => run('document.querySelectorAll(".message.pending").length === 1 && !document.querySelector("#send").disabled'))
  assert.equal(service.snapshot().pendingCount, 1)
  assert.ok((await run('document.querySelector("#sync-status").textContent')).includes('離線'))
  await run('document.querySelector("#message").value = "Unsaved draft 中文"; document.querySelector("#message").dispatchEvent(new Event("input")); window.floadeCommunication.close()')
  await until(() => Promise.resolve(window.isDestroyed()))
  panel.open()
  window = BrowserWindow.getAllWindows()[0]
  await until(() => run('document.querySelector("#message").value === "Unsaved draft 中文" && document.querySelectorAll(".message.pending").length === 1'))
  offline = false
  await service.sync(true)
  await until(() => run('document.querySelectorAll(".message").length === 3 && document.querySelectorAll(".message.pending").length === 0'))
  assert.equal(comments.get(1).length, 3)
  checks.push('offline send is durable; reopening restores the draft and reconnect delivers once')

  const remote = { id: 'remote-message-001', deviceId: 'laptop-id', deviceName: '筆電', agent: 'Claude / review', target: '測試桌機', text: '已完成圖片貼上測試。\n\n| 項目 | 結果 |\n| --- | --- |\n| Ctrl+V | 通過 |', createdAt: new Date().toISOString() }
  comments.get(1).push({ id: nextComment++, body: encodeMessage(remote), created_at: remote.createdAt, updated_at: remote.createdAt, user: { login: 'demo' } })
  await service.sync(true)
  await until(() => run('document.querySelectorAll(".message").length === 4'))
  assert.equal(service.snapshot().unread, 1)
  assert.equal(await run('document.querySelectorAll(".message-body table").length'), 1)
  await run(`window.floadeCommunication.markRead(1, '${nextComment - 1}')`)
  assert.equal(service.snapshot().unread, 0)
  checks.push('remote identity, Markdown tables and local unread acknowledgement work')

  await run('document.querySelector("#new-channel").click(); document.querySelector("#channel-name").value = "Floade 開發"; document.querySelector("#channel-form").requestSubmit()')
  await until(() => run('document.querySelector("#room-name").textContent === "Floade 開發" && !document.querySelector("#channel-dialog").open'))
  assert.equal(rooms.length, 2)
  assert.equal(service.snapshot().channels.length, 2)
  await until(() => run('document.querySelectorAll("#channels button").length === 2'))
  await run('document.querySelector("#channels button").click()')
  await until(() => run('document.querySelector("#room-name").textContent === "共用" && document.querySelector("#message").value === "Unsaved draft 中文"'))
  await run('document.querySelector("#pin").click()')
  await until(() => Promise.resolve(window.isAlwaysOnTop()))
  checks.push('new channels, per-channel drafts and always-on-top control work')

  const impostor = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'src', 'communication-preload.cjs'), contextIsolation: true, sandbox: true } })
  await impostor.loadFile(path.join(root, 'src', 'communication.html'))
  const denied = await impostor.webContents.executeJavaScript('window.floadeCommunication.request("communication.send", {text:"forged"})')
  assert.equal(denied.error.code, 'FORBIDDEN')
  impostor.destroy()
  checks.push('IPC rejects requests from another window')
  // Use readable fixture text for the visual artifact after the injection test.
  comments.get(1)[0].body = encodeMessage({ id: service.snapshot(1).messages[0].id,
    deviceId: service.snapshot().identity.deviceId, deviceName: '測試桌機', agent: 'Codex / 開發',
    target: '筆電', text: '文件預覽已完成，請測試圖片貼上。', createdAt: new Date().toISOString() })
  await service.sync(true)
  await until(() => run('document.querySelectorAll(".message").length === 4'))
  await run('document.querySelector("#message").value = ""; document.querySelector("#messages").scrollTop = document.querySelector("#messages").scrollHeight')
  await delay(500)
  fs.mkdirSync(path.join(root, 'out'), { recursive: true })
  fs.writeFileSync(path.join(root, 'out', 'communication-preview.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG())
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
  fs.writeFileSync(path.join(root, 'out', 'communication-qa.json'), JSON.stringify({ ok: true, checks }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  panel?.dispose()
  service?.dispose()
  for (const item of BrowserWindow.getAllWindows()) item.destroy()
  app.exit(process.exitCode || 0)
}
