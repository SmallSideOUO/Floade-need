import { BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'

export function createCommunicationWindow({ appPath, iconPath, getLocale, getOpacity, service, changed }) {
  let window
  let disposed = false
  const fromWindow = event => window && !window.isDestroyed() && event.sender === window.webContents
  const respond = callback => async (event, ...args) => {
    if (!fromWindow(event)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Open the AI communication panel first.' } }
    try { return { ok: true, result: await callback(...args) } }
    catch (error) { return { ok: false, error: { code: error.apiCode || 'INTERNAL_ERROR', message: error.message } } }
  }
  ipcMain.handle('communication:state', respond((channel, before) => service.snapshot(channel, before)))
  ipcMain.handle('communication:request', respond((method, params) => {
    if (method === 'communication.open-link') {
      const url = new URL(params?.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web links can be opened.')
      return shell.openExternal(url.href)
    }
    return service.dispatch(method, params)
  }))
  ipcMain.handle('communication:sync', respond(() => service.sync(true)))
  ipcMain.handle('communication:read', respond((channel, cursor) => service.markRead(channel, cursor)))
  ipcMain.handle('communication:close', respond(() => window.close()))
  ipcMain.handle('communication:pin', respond(() => { const pinned = !window.isAlwaysOnTop(); window.setAlwaysOnTop(pinned); return pinned }))
  ipcMain.handle('communication:external', respond(channel => {
    const state = service.snapshot()
    const room = state.channels.find(item => item.id === Number(channel))
    // Reconstruct from validated repo/number rather than opening remote data URLs.
    if (room) return shell.openExternal(`https://github.com/${state.repo}/issues/${room.id}`)
  }))
  const unsubscribe = service.subscribe(() => {
    if (window && !window.isDestroyed()) window.webContents.send('communication:changed')
    changed?.()
  })
  return {
    open() {
      if (disposed) return
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return }
      window = new BrowserWindow({ width: 900, height: 680, minWidth: 660, minHeight: 480,
        icon: iconPath(), opacity: getOpacity(), frame: false, backgroundColor: '#101013',
        show: false, webPreferences: { preload: path.join(appPath, 'src', 'communication-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      window.once('ready-to-show', () => { window.show(); window.focus() })
      window.on('focus', () => { service.setActive(true); window.webContents.send('communication:changed') })
      window.on('blur', () => service.setActive(false))
      window.on('closed', () => { window = undefined; service.setActive(false) })
      void window.loadFile(path.join(appPath, 'src', 'communication.html'), { query: { lang: getLocale() } })
      void service.sync(true).catch(() => {})
    },
    dispose() {
      disposed = true
      unsubscribe()
      for (const name of ['state', 'request', 'sync', 'read', 'close', 'pin', 'external']) ipcMain.removeHandler(`communication:${name}`)
      if (window && !window.isDestroyed()) window.destroy()
    }
  }
}
