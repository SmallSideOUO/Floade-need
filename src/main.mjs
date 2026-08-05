import { app, BrowserWindow, dialog, ipcMain, Menu, screen, Tray, nativeImage } from 'electron'
import { execFile, spawnSync } from 'node:child_process'
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
  const previewPickers = new Map()
  const previewWindows = new Map()
  const previewFiles = new Map()

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

  async function findMarkdownFiles(folderPath) {
    const markdownFiles = []

    async function walk(directory) {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.git') continue
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          await walk(entryPath)
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
          markdownFiles.push(path.relative(folderPath, entryPath).split(path.sep).join('/'))
        }
      }
    }

    await walk(folderPath)
    return markdownFiles.sort((left, right) => left.localeCompare(right, 'zh-Hant'))
  }

  function markdownPath(folderPath, relativePath) {
    const absolutePath = path.resolve(folderPath, relativePath)
    const relative = path.relative(folderPath, absolutePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null
    if (path.extname(absolutePath).toLowerCase() !== '.md') return null
    return absolutePath
  }

  async function openMarkdownPreview(folderPath, relativePath) {
    const filePath = markdownPath(folderPath, relativePath)
    if (!filePath || !fs.existsSync(filePath)) return

    const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath
    const existingWindow = previewWindows.get(key)
    if (existingWindow && !existingWindow.isDestroyed()) {
      existingWindow.show()
      existingWindow.focus()
      return
    }

    const window = new BrowserWindow({
      width: 480,
      height: 560,
      minWidth: 320,
      minHeight: 260,
      frame: false,
      transparent: true,
      resizable: true,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'markdown-preview-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const webContentsId = window.webContents.id
    previewWindows.set(key, window)
    previewFiles.set(webContentsId, filePath)
    window.on('closed', () => {
      previewWindows.delete(key)
      previewFiles.delete(webContentsId)
    })
    window.webContents.once('did-finish-load', async () => {
      try {
        const content = await fs.promises.readFile(filePath, 'utf8')
        window.webContents.send('preview:document', {
          name: path.basename(filePath),
          path: relativePath,
          content,
          pinned: window.isAlwaysOnTop()
        })
      } catch (error) {
        if (!window.isDestroyed()) window.close()
        showToast('預覽失敗', commandErrorMessage(error), 'error')
      }
    })
    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })
    window.loadFile(path.join(app.getAppPath(), 'src', 'markdown-preview.html'))
  }

  async function syncFolderForPreview(folder) {
    if (!folder.repo) return

    const gitDirectory = path.join(folder.path, '.git')
    const remoteUrl = `https://github.com/${folder.repo}.git`
    if (!fs.existsSync(gitDirectory)) {
      const entries = await fs.promises.readdir(folder.path)
      if (entries.length === 0) {
        await command('gh', ['auth', 'setup-git'], folder.path)
        await command('git', ['clone', remoteUrl, '.'], folder.path)
      }
      return
    }

    const { stdout: status } = await command(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      folder.path
    )
    if (status.trim()) return

    await command('gh', ['auth', 'setup-git'], folder.path)
    const { stdout: remotes } = await command('git', ['remote'], folder.path)
    if (remotes.split(/\r?\n/).includes('origin')) {
      await command('git', ['remote', 'set-url', 'origin', remoteUrl], folder.path)
    } else {
      await command('git', ['remote', 'add', 'origin', remoteUrl], folder.path)
    }

    try {
      await command('git', ['ls-remote', '--exit-code', '--heads', 'origin', 'main'], folder.path)
    } catch (error) {
      if (error.code === 2) return
      throw error
    }

    await command('git', ['pull', '--ff-only', 'origin', 'main'], folder.path)
  }

  async function showPreviewPicker(folder) {
    if (!fs.existsSync(folder.path)) {
      showToast('預覽失敗', '找不到這個資料夾。', 'error')
      return
    }

    const existingPicker = [...previewPickers.values()].find(picker => picker.folderPath === folder.path)
    if (existingPicker && !existingPicker.window.isDestroyed()) {
      existingPicker.window.show()
      existingPicker.window.focus()
      return
    }

    if (folder.repo) {
      const processingToast = showToast('讀取 Markdown', `${folder.repo} 正在檢查更新…`, 'loading', 0)
      try {
        await syncFolderForPreview(folder)
      } catch (error) {
        showToast('同步失敗', commandErrorMessage(error), 'error')
      } finally {
        if (!processingToast.isDestroyed()) processingToast.close()
      }
    }

    let markdownFiles
    try {
      markdownFiles = await findMarkdownFiles(folder.path)
    } catch (error) {
      showToast('預覽失敗', commandErrorMessage(error), 'error')
      return
    }

    const window = new BrowserWindow({
      width: 540,
      height: 550,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'preview-picker-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const webContentsId = window.webContents.id
    previewPickers.set(webContentsId, {
      window,
      folderPath: folder.path,
      markdownFiles: new Set(markdownFiles)
    })
    window.on('closed', () => previewPickers.delete(webContentsId))
    window.webContents.once('did-finish-load', () => {
      window.webContents.send('picker:files', {
        folder: folder.path,
        files: markdownFiles,
        pinned: window.isAlwaysOnTop()
      })
    })
    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })
    window.loadFile(path.join(app.getAppPath(), 'src', 'preview-picker.html'))
  }

  function registerPreviewHandlers() {
    ipcMain.handle('picker:toggle-pin', event => {
      const picker = previewPickers.get(event.sender.id)
      if (!picker || picker.window.isDestroyed()) return false
      const pinned = !picker.window.isAlwaysOnTop()
      picker.window.setAlwaysOnTop(pinned)
      return pinned
    })

    ipcMain.handle('picker:close', event => {
      const picker = previewPickers.get(event.sender.id)
      if (picker && !picker.window.isDestroyed()) picker.window.close()
    })

    ipcMain.handle('picker:open-files', async (event, selectedFiles) => {
      const picker = previewPickers.get(event.sender.id)
      if (!picker || !Array.isArray(selectedFiles)) return
      const allowedFiles = selectedFiles.filter(file => picker.markdownFiles.has(file))
      for (const file of allowedFiles) {
        await openMarkdownPreview(picker.folderPath, file)
      }
    })

    ipcMain.handle('preview:toggle-pin', event => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window || window.isDestroyed()) return false
      const pinned = !window.isAlwaysOnTop()
      window.setAlwaysOnTop(pinned)
      return pinned
    })

    ipcMain.handle('preview:close', event => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window && !window.isDestroyed()) window.close()
    })

    ipcMain.handle('preview:save', async (event, content) => {
      const filePath = previewFiles.get(event.sender.id)
      if (!filePath || typeof content !== 'string') throw new Error('找不到 Markdown 檔案。')
      await fs.promises.writeFile(filePath, content, 'utf8')
      refreshTrayMenu()
      return true
    })

    ipcMain.on('preview:save-sync', (event, content) => {
      const filePath = previewFiles.get(event.sender.id)
      try {
        if (filePath && typeof content === 'string') {
          fs.writeFileSync(filePath, content, 'utf8')
        }
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
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
    if (!hasPushableChanges(folder)) {
      refreshTrayMenu()
      return
    }
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

  function hasPushableChanges(folder) {
    if (!folder.repo || pushingFolders.has(folder.path) || !fs.existsSync(folder.path)) {
      return false
    }

    const gitDirectory = path.join(folder.path, '.git')
    if (!fs.existsSync(gitDirectory)) {
      try {
        return fs.readdirSync(folder.path).some(entry => entry !== '.git')
      } catch {
        return false
      }
    }

    const git = args => spawnSync('git', args, {
      cwd: folder.path,
      windowsHide: true,
      encoding: 'utf8'
    })

    const status = git(['status', '--porcelain', '--untracked-files=normal'])
    if (status.error || status.status !== 0) return false
    if (status.stdout.trim()) return true

    const head = git(['rev-parse', '--verify', 'HEAD'])
    if (head.error || head.status !== 0) return false

    const remoteMain = git(['rev-parse', '--verify', 'refs/remotes/origin/main'])
    if (remoteMain.error || remoteMain.status !== 0) return true

    const ahead = git(['rev-list', '--count', 'refs/remotes/origin/main..HEAD'])
    return !ahead.error && ahead.status === 0 && Number(ahead.stdout.trim()) > 0
  }

  function buildTrayMenu() {
    const pushItems = []
    const folderItems = folders.length > 0
      ? folders.map(folder => {
          const submenu = Menu.buildFromTemplate([
            {
              label: '預覽',
              click: () => showPreviewPicker(folder)
            },
            {
              label: pushingFolders.has(folder.path) ? 'Push 中…' : 'Push',
              enabled: hasPushableChanges(folder),
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
          ])
          pushItems.push({ folder, pushItem: submenu.items[1] })

          return {
            label: folder.path,
            submenu
          }
        })
      : [{ label: '目前沒有資料夾', enabled: false }]

    const menu = Menu.buildFromTemplate([
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

    menu.on('menu-will-show', () => {
      for (const { folder, pushItem } of pushItems) {
        pushItem.label = pushingFolders.has(folder.path) ? 'Push 中…' : 'Push'
        pushItem.enabled = hasPushableChanges(folder)
      }
    })

    return menu
  }

  function refreshTrayMenu() {
    tray?.setContextMenu(buildTrayMenu())
  }

  app.on('window-all-closed', () => {})

  app.whenReady().then(() => {
    configFile = path.join(app.getPath('userData'), 'folders.json')
    loadFolders()
    registerPreviewHandlers()

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
