import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWindowPin } from '../src/window-pin.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pin = createWindowPin({ appPath: process.env.FLOADE_QA_APP_PATH || root })
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const windows = []
const toggle = async () => {
  const focused = BrowserWindow.getFocusedWindow()
  const result = await pin.toggle()
  assert.equal(result.title, focused?.getTitle(), 'Native helper must target the foreground fixture')
  await wait(100)
  return result
}
const createWindow = async (title, alwaysOnTop = false) => {
  const window = new BrowserWindow({ width: 420, height: 220, title, alwaysOnTop })
  windows.push(window)
  await window.loadURL(`data:text/html,<title>${title}</title><p>Floade window pin verification</p>`)
  window.show(); window.focus()
  await wait(200)
  for (let i = 0; i < 30 && !window.isFocused(); i++) { window.focus(); await wait(100) }
  assert.equal(window.isFocused(), true, 'Test window must be in the foreground')
  return window
}
try {
  await pin.start()
  const first = await createWindow('Floade pin test A')
  const bounds = first.getBounds()
  assert.equal(first.isAlwaysOnTop(), false)
  assert.equal((await toggle()).pinned, true)
  assert.equal(first.isAlwaysOnTop(), true)
  assert.deepEqual(first.getBounds(), bounds)
  assert.equal(first.isFocused(), true)
  assert.equal((await toggle()).pinned, false)
  assert.equal(first.isAlwaysOnTop(), false)
  assert.equal((await toggle()).pinned, true)
  const second = await createWindow('Floade pin test B')
  assert.equal((await toggle()).pinned, true)
  assert.equal(first.isAlwaysOnTop(), true)
  const existing = await createWindow('Floade existing topmost', true)
  const toggled = await createWindow('Floade initially topmost', true)
  assert.equal((await toggle()).pinned, false)
  assert.equal(toggled.isAlwaysOnTop(), false)
  pin.dispose()
  for (let i = 0; i < 50 && (first.isAlwaysOnTop() || second.isAlwaysOnTop()); i++) await wait(100)
  assert.equal(first.isAlwaysOnTop(), false, 'Shutdown restores A')
  assert.equal(second.isAlwaysOnTop(), false, 'Shutdown restores B')
  assert.equal(existing.isAlwaysOnTop(), true, 'Unrelated pre-existing topmost window is preserved')
  console.log('PASS: native pin/unpin, multiple windows, unchanged bounds/focus, existing topmost toggle, and shutdown restoration')
} catch (error) { console.error(error); process.exitCode = 1 }
finally { pin.dispose(); windows.forEach(window => window.destroy()); app.exit(process.exitCode || 0) }
