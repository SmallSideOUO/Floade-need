import path from 'node:path'

export function createRemoteWindow({ BrowserWindow, ipcMain, shell, service, appPath, icon, locale }) {
  let window
  ipcMain.handle('remote:request', async (event, request) => {
    if (event.sender !== window?.webContents) return { ok: false, error: { message: 'Window unavailable.' } }
    try { return { ok: true, result: await service.dispatch(request.method, request.params || {}) } }
    catch (error) { return { ok: false, error: { code: error.apiCode, message: error.message } } }
  })
  ipcMain.handle('remote:close', event => { if (event.sender === window?.webContents) window.close() })
  ipcMain.handle('remote:legal', event => { if (event.sender === window?.webContents) return shell.openExternal('https://github.com/SmallSideOUO/Floade-need/blob/main/THIRD-PARTY-NOTICES.md') })
  return view => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.show(); window.focus(); window.webContents.send('remote:view', view || 'connect'); return
    }
    window = new BrowserWindow({ width: 650, height: 760, minWidth: 560, minHeight: 580, title: 'Floade 遠端', icon: icon(),
      backgroundColor: '#0d0d0f', frame: false, show: false,
      webPreferences: { preload: path.join(appPath, 'src', 'remote-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.once('ready-to-show', () => { window.show(); window.focus() })
    window.on('closed', () => { window = undefined })
    void window.loadFile(path.join(appPath, 'src', 'remote.html'), { query: { lang: locale(), view: view || 'connect' } })
  }
}
