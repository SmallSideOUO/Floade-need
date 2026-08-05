import { app, BrowserWindow, dialog, Menu, screen, Tray, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const commitMessage = 'chore: sync data'

const controlSocket = process.platform === 'win32'
  ? '\\\\.\\pipe\\floade-local-data-control'
  : path.join(os.tmpdir(), 'floade-local-data-control.sock')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let tray
  let controlServer
  let folders = []
  let configFile
  const pushingFolders = new Set()

  function loadFolders() {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      folders = Array.isArray(config.folders)
        ? config.folders
            .map(folder => typeof folder === 'string'
              ? { path: folder, repo: null }
              : { path: folder?.path, repo: folder?.repo ?? null })
            .filter(folder => typeof folder.path === 'string')
        : []
    } catch {
      folders = []
    }
  }

  function saveFolders() {
    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    fs.writeFileSync(configFile, `${JSON.stringify({ folders }, null, 2)}\n`, 'utf8')
  }

  function showDeletePrompt(folderPath) {
    return new Promise(resolve => {
      const window = new BrowserWindow({
        width: 430,
        height: 230,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      let settled = false
      const finish = result => {
        if (settled) return
        settled = true
        if (!window.isDestroyed()) window.close()
        resolve(result)
      }

      window.on('closed', () => finish(false))
      window.webContents.on('will-navigate', (event, targetUrl) => {
        if (!targetUrl.startsWith('floade-action://')) return
        event.preventDefault()
        finish(new URL(targetUrl).hostname === 'delete')
      })
      window.once('ready-to-show', () => {
        window.show()
        window.focus()
      })
      window.loadFile(path.join(app.getAppPath(), 'src', 'delete-dialog.html'), {
        query: { folder: folderPath }
      })
    })
  }

  function showToast(title, message, type, duration = 2500) {
    const window = new BrowserWindow({
      width: 370,
      height: 96,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      focusable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const x = display.workArea.x + display.workArea.width - 386
    const y = display.workArea.y + display.workArea.height - 112
    window.setPosition(x, y)
    window.once('ready-to-show', () => window.showInactive())
    window.loadFile(path.join(app.getAppPath(), 'src', 'toast.html'), {
      query: {
        title,
        message,
        type,
        duration: String(duration)
      }
    })
    if (duration > 0) {
      setTimeout(() => {
        if (!window.isDestroyed()) window.close()
      }, duration)
    }
    return window
  }

  async function showRepoPicker(repositories) {
    return new Promise(resolve => {
      const window = new BrowserWindow({
        width: 520,
        height: 480,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      let settled = false
      const finish = repository => {
        if (settled) return
        settled = true
        if (!window.isDestroyed()) window.close()
        resolve(repository)
      }

      window.on('closed', () => finish(null))
      window.webContents.on('will-navigate', (event, targetUrl) => {
        if (!targetUrl.startsWith('floade-link://')) return
        event.preventDefault()
        const action = new URL(targetUrl)
        finish(action.hostname === 'select' ? action.searchParams.get('repo') : null)
      })
      window.webContents.once('did-finish-load', () => {
        window.webContents.executeJavaScript(`window.setRepositories(${JSON.stringify(repositories)})`)
      })
      window.once('ready-to-show', () => {
        window.show()
        window.focus()
      })
      window.loadFile(path.join(app.getAppPath(), 'src', 'link-dialog.html'))
    })
  }

  async function linkFolder(folder) {
    try {
      const { stdout } = await execFileAsync('gh', [
        'repo', 'list', '--limit', '100', '--json', 'nameWithOwner,isPrivate'
      ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
      const repositories = JSON.parse(stdout)
        .filter(repository => repository.isPrivate)
        .map(repository => repository.nameWithOwner)
        .sort((left, right) => left.localeCompare(right))

      if (repositories.length === 0) {
        showToast('Link 失敗', '目前登入的 GitHub 帳號沒有 Private Repo。', 'error')
        return
      }

      const repository = await showRepoPicker(repositories)
      if (!repository) return
      folder.repo = repository
      saveFolders()
      refreshTrayMenu()
    } catch (error) {
      showToast('Link 失敗', commandErrorMessage(error), 'error')
    }
  }

  function commandErrorMessage(error) {
    const output = `${error?.stderr ?? ''}`.trim() || `${error?.message ?? error}`.trim()
    return output.split(/\r?\n/).filter(Boolean).at(-1) ?? '發生未知錯誤。'
  }

  async function command(command, args, cwd) {
    return execFileAsync(command, args, {
      cwd,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    })
  }

  async function pushFolder(folder) {
    if (!folder.repo || pushingFolders.has(folder.path)) return
    pushingFolders.add(folder.path)
    refreshTrayMenu()
    const processingToast = showToast('Push 處理中', `${folder.repo} 正在同步…`, 'loading', 0)

    try {
      await command('gh', ['auth', 'setup-git'], folder.path)
      await command('git', ['init'], folder.path)

      const { stdout: remotes } = await command('git', ['remote'], folder.path)
      const remoteUrl = `https://github.com/${folder.repo}.git`
      if (remotes.split(/\r?\n/).includes('origin')) {
        await command('git', ['remote', 'set-url', 'origin', remoteUrl], folder.path)
      } else {
        await command('git', ['remote', 'add', 'origin', remoteUrl], folder.path)
      }

      await command('git', ['add', '-A'], folder.path)

      let hasStagedChanges = false
      try {
        await command('git', ['diff', '--cached', '--quiet'], folder.path)
      } catch (error) {
        if (error.code === 1) hasStagedChanges = true
        else throw error
      }

      let hasCommit = true
      try {
        await command('git', ['rev-parse', '--verify', 'HEAD'], folder.path)
      } catch {
        hasCommit = false
      }

      if (hasStagedChanges) {
        await command('git', ['commit', '-m', commitMessage], folder.path)
      } else if (!hasCommit) {
        await command('git', ['commit', '--allow-empty', '-m', commitMessage], folder.path)
      }

      await command('git', ['branch', '-M', 'main'], folder.path)
      await command('git', ['push', '-u', 'origin', 'main'], folder.path)
      if (!processingToast.isDestroyed()) processingToast.close()
      showToast('Push 完成', `${folder.repo} 已同步。`, 'success')
    } catch (error) {
      if (!processingToast.isDestroyed()) processingToast.close()
      showToast('Push 失敗', commandErrorMessage(error), 'error')
    } finally {
      if (!processingToast.isDestroyed()) processingToast.close()
      pushingFolders.delete(folder.path)
      refreshTrayMenu()
    }
  }

  async function addFolder() {
    const result = await dialog.showOpenDialog({
      title: '新增資料夾',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return

    const selectedPath = path.resolve(result.filePaths[0])
    const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value
    if (!folders.some(folder => normalize(folder.path) === normalize(selectedPath))) {
      folders.push({ path: selectedPath, repo: null })
      folders.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hant'))
      saveFolders()
    }

    refreshTrayMenu()
  }

  async function removeFolder(folder) {
    if (!(await showDeletePrompt(folder.path))) return
    folders = folders.filter(candidate => candidate.path !== folder.path)
    saveFolders()
    refreshTrayMenu()
  }

  function buildTrayMenu() {
    const folderItems = folders.length > 0
      ? folders.map(folder => ({
          label: folder.path,
          submenu: [
            {
              label: pushingFolders.has(folder.path) ? 'Push 中…' : 'Push',
              enabled: Boolean(folder.repo) && !pushingFolders.has(folder.path),
              click: () => pushFolder(folder)
            },
            {
              label: folder.repo ? `Link：${folder.repo}` : 'Link',
              click: () => linkFolder(folder)
            },
            { type: 'separator' },
            {
              label: '刪除',
              click: () => removeFolder(folder)
            }
          ]
        }))
      : [{ label: '目前沒有資料夾', enabled: false }]

    return Menu.buildFromTemplate([
      {
        label: '新增資料夾',
        click: addFolder
      },
      { type: 'separator' },
      ...folderItems,
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit()
      }
    ])
  }

  function refreshTrayMenu() {
    tray?.setContextMenu(buildTrayMenu())
  }

  app.on('window-all-closed', event => event.preventDefault())

  app.whenReady().then(() => {
    configFile = path.join(app.getPath('userData'), 'folders.json')
    loadFolders()

    if (process.platform !== 'win32' && fs.existsSync(controlSocket)) {
      fs.unlinkSync(controlSocket)
    }

    controlServer = net.createServer(socket => {
      socket.once('data', data => {
        const command = data.toString('utf8').trim()
        socket.end('ok')
        if (command === 'stop') setImmediate(() => app.quit())
      })
    })
    controlServer.listen(controlSocket)

    const iconFile = process.platform === 'win32' ? 'tray.ico' : 'tray.png'
    const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', iconFile))

    tray = new Tray(icon)
    tray.setToolTip('Floade')
    refreshTrayMenu()
  })

  app.on('before-quit', () => {
    controlServer?.close()
    if (process.platform !== 'win32' && fs.existsSync(controlSocket)) {
      fs.unlinkSync(controlSocket)
    }
  })
}
