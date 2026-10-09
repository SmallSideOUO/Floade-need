import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'node:path'
import { ballSize, clampBall, placePanel, containsPoint } from './launcher-layout.mjs'

export function createFloatingLauncher({ appPath, iconPath, getLocale, getOpacity, getState, readData, openDocument, mutateDocument, action, saveVisible, savePosition, saveSize, onVisibilityChange, cursor = () => screen.getCursorScreenPoint() }) {
  let visible = getState().visible
  let keyboardMode = false
  let desiredPanel = false
  let dragging
  let closeTimer
  let hoverTimer
  let disposed = false
  let dataRevision = 0
  let manualSize = getState().size
  let panelHeight = manualSize?.height || 450
  let resizing
  let nativeSizing = false
  let interacting = false
  const initial = getState().position
  const area = screen.getDisplayNearestPoint(initial || cursor()).workArea
  const position = clampBall(initial || { x: area.x + area.width - 84, y: area.y + Math.round(area.height / 2) }, area)
  const createWindow = (mode, bounds) => {
    const window = new BrowserWindow({
      ...bounds, icon: iconPath(), opacity: getOpacity(), frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, resizable: mode === 'panel', maximizable: false,
      ...(mode === 'panel' ? { minWidth: 320, minHeight: 360 } : {}),
      minimizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true,
      focusable: mode === 'panel', show: false,
      webPreferences: { preload: path.join(appPath, 'src', 'floating-launcher-preload.cjs'), contextIsolation: true, nodeIntegration: false }
    })
    // Windows can register a taskbar entry when a window is shown/activated.
    // Apply this after construction and again after the native show/focus completes.
    const hideTaskbarEntry = () => {
      window.setSkipTaskbar(true)
      setImmediate(() => { if (!window.isDestroyed()) window.setSkipTaskbar(true) })
    }
    window.setSkipTaskbar(true)
    window.on('show', hideTaskbarEntry)
    window.on('focus', hideTaskbarEntry)
    return window
  }
  const ball = createWindow('ball', { ...position, width: ballSize, height: ballSize })
  const panel = createWindow('panel', placePanel(position, area))
  const ballReady = ball.loadFile(path.join(appPath, 'src', 'floating-launcher.html'), { query: { mode: 'ball', lang: getLocale() } })
  const panelReady = panel.loadFile(path.join(appPath, 'src', 'floating-launcher.html'), { query: { mode: 'panel', lang: getLocale() } })
  void ballReady.then(() => { if (visible && !disposed) ball.showInactive() })
  const fromBall = event => event.sender === ball.webContents
  const fromPanel = event => event.sender === panel.webContents
  const handlers = []
  const handle = (name, callback) => { handlers.push(name); ipcMain.handle(name, callback) }

  function hidePanel() {
    desiredPanel = false
    keyboardMode = false
    clearTimeout(closeTimer)
    clearTimeout(hoverTimer)
    if (!panel.isDestroyed()) panel.hide()
  }
  async function refreshData() {
    if (!desiredPanel || disposed) return
    const revision = ++dataRevision
    try {
      const data = await readData()
      if (!disposed && desiredPanel && revision === dataRevision) panel.webContents.send('launcher:data', data)
    } catch (error) {
      if (!disposed && desiredPanel && revision === dataRevision) panel.webContents.send('launcher:error', error.message)
    }
  }
  function reposition() {
    const bounds = ball.getBounds()
    const displayArea = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
    panel.setBounds(placePanel(bounds, displayArea, manualSize?.height || panelHeight, manualSize?.width || 340))
  }
  async function showPanel(focus = false) {
    if (disposed || dragging) return
    clearTimeout(closeTimer)
    clearTimeout(hoverTimer)
    desiredPanel = true
    keyboardMode = keyboardMode || focus
    await panelReady
    if (!desiredPanel || disposed) return
    reposition()
    if (keyboardMode) { panel.show(); panel.focus(); panel.webContents.send('launcher:focus') }
    else panel.showInactive()
    void refreshData()
  }
  function scheduleClose() {
    clearTimeout(closeTimer)
    clearTimeout(hoverTimer)
    closeTimer = setTimeout(() => {
      if (disposed || keyboardMode || dragging || resizing || nativeSizing || interacting) return
      const point = cursor()
      if ((visible && containsPoint(ball.getBounds(), point)) || (desiredPanel && containsPoint(panel.getBounds(), point))) { scheduleClose(); return }
      hidePanel()
    }, 360)
  }
  function setVisible(value) {
    visible = Boolean(value)
    if (visible) void ballReady.then(() => { if (visible && !disposed) ball.showInactive() })
    else { ball.hide(); hidePanel() }
    saveVisible(visible)
    onVisibilityChange()
    return visible
  }
  handle('launcher:hover', (event, entered) => {
    if (!fromBall(event) && !fromPanel(event)) return
    if (entered) {
      clearTimeout(closeTimer)
      if (fromBall(event) && !dragging) {
        clearTimeout(hoverTimer)
        hoverTimer = setTimeout(() => { if (visible) void showPanel() }, 160)
      }
    } else scheduleClose()
  })
  handle('launcher:drag', (event, phase) => {
    if (!fromBall(event)) return
    const point = cursor()
    if (phase === 'start') {
      hidePanel()
      const bounds = ball.getBounds()
      dragging = { x: point.x - bounds.x, y: point.y - bounds.y, moved: false, origin: point }
    } else if (phase === 'move' && dragging) {
      if (Math.hypot(point.x - dragging.origin.x, point.y - dragging.origin.y) < 4 && !dragging.moved) return
      dragging.moved = true
      const next = clampBall({ x: point.x - dragging.x, y: point.y - dragging.y }, screen.getDisplayNearestPoint(point).workArea)
      ball.setPosition(next.x, next.y)
    } else if (phase === 'end' && dragging) {
      const moved = dragging.moved
      dragging = undefined
      if (moved) { const bounds = ball.getBounds(); savePosition({ x: bounds.x, y: bounds.y }) }
      else void showPanel(true)
    }
  })
  handle('launcher:close', event => { if (fromPanel(event)) hidePanel() })
  handle('launcher:resize', (event, height) => {
    if (!fromPanel(event) || !Number.isFinite(height)) return
    if (manualSize || resizing) return
    panelHeight = Math.max(360, Math.min(550, Math.ceil(height)))
    if (desiredPanel) reposition()
  })
  handle('launcher:interacting', (event, value) => {
    if (!fromPanel(event)) return
    interacting = Boolean(value)
    if (interacting) clearTimeout(closeTimer)
    else scheduleClose()
  })
  const rememberSize = () => {
    const bounds = panel.getBounds()
    manualSize = { width: bounds.width, height: bounds.height }
    saveSize(manualSize)
  }
  handle('launcher:size-drag', (event, phase) => {
    if (!fromPanel(event)) return
    const point = cursor()
    if (phase === 'start') { resizing = { point: { ...point }, bounds: panel.getBounds() }; clearTimeout(closeTimer) }
    else if (phase === 'move' && resizing) {
      const area = screen.getDisplayMatching(resizing.bounds).workArea
      const width = Math.round(Math.max(320, Math.min(area.x + area.width - resizing.bounds.x, resizing.bounds.width + point.x - resizing.point.x)))
      const height = Math.round(Math.max(360, Math.min(area.y + area.height - resizing.bounds.y, resizing.bounds.height + point.y - resizing.point.y)))
      panel.setSize(width, height)
    } else if (phase === 'end' && resizing) { resizing = undefined; rememberSize(); scheduleClose() }
  })
  panel.on('will-resize', () => { nativeSizing = true; clearTimeout(closeTimer) })
  panel.on('resized', () => { rememberSize(); nativeSizing = false; scheduleClose() })
  handle('launcher:mutate', async (event, request) => {
    if (!fromPanel(event)) return { ok: false }
    try { return { ok: true, document: await mutateDocument(request) } }
    catch (error) { return { ok: false, message: error.message } }
  })
  handle('launcher:open', async (event, document) => {
    if (!fromPanel(event)) return { ok: false }
    try {
      const result = await openDocument(document)
      if (result) hidePanel()
      return { ok: Boolean(result) }
    } catch (error) { return { ok: false, message: error.message } }
  })
  handle('launcher:action', async (event, name, folderPath) => {
    if (!fromPanel(event)) return { ok: false }
    if (name !== 'push') hidePanel()
    try { await action(name, folderPath); return { ok: true } } catch (error) { return { ok: false, message: error.message } }
  })
  panel.on('focus', () => { if (desiredPanel) { keyboardMode = true; clearTimeout(closeTimer) } })
  panel.on('blur', () => { if (keyboardMode && !interacting && !resizing && !nativeSizing) hidePanel() })
  panel.on('close', event => { if (!disposed) { event.preventDefault(); hidePanel() } })
  const onDisplayChange = () => {
    if (disposed) return
    const bounds = ball.getBounds()
    const next = clampBall(bounds, screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea)
    ball.setPosition(next.x, next.y)
    if (desiredPanel) reposition()
  }
  screen.on('display-removed', onDisplayChange)
  screen.on('display-metrics-changed', onDisplayChange)
  return {
    ball, panel, showPanel, hidePanel, refreshData, setVisible, isVisible: () => visible,
    dispose() {
      disposed = true
      clearTimeout(closeTimer)
      clearTimeout(hoverTimer)
      for (const name of handlers) ipcMain.removeHandler(name)
      screen.removeListener('display-removed', onDisplayChange)
      screen.removeListener('display-metrics-changed', onDisplayChange)
      if (!ball.isDestroyed()) ball.destroy()
      if (!panel.isDestroyed()) panel.destroy()
    }
  }
}
