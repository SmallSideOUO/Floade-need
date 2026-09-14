import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, screen, Tray, nativeImage } from 'electron'
import { execFile, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createScreenTranslator } from './screen-translator.mjs'
import { ensureCommitIdentity } from './git-identity.mjs'
import { normalizeLocale, translate } from './i18n-main.mjs'

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
  let settingsWindow
  let registeredShortcut
  let registeredTranslationShortcut
  let screenTranslator
  let autoPushTimer
  let lastAutoPushDate = null
  let settings = {
    shortcut: null,
    translationShortcut: 'Alt+Shift+T',
    language: 'system',
    opacity: 1
  }
  const pushingFolders = new Set()
  const previewPickers = new Map()
  const previewWindows = new Map()
  const previewFiles = new Map()

  function windowIconPath() {
    const iconFile = process.platform === 'win32' ? 'tray.ico' : 'tray.png'
    return path.join(app.getAppPath(), 'assets', iconFile)
  }

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
      settings = {
        shortcut: typeof config.settings?.shortcut === 'string' ? config.settings.shortcut : null,
        translationShortcut: typeof config.settings?.translationShortcut === 'string'
          ? config.settings.translationShortcut
          : 'Alt+Shift+T',
        language: ['system', 'en', 'zh-TW'].includes(config.settings?.language)
          ? config.settings.language
          : 'system',
        opacity: Number.isFinite(config.settings?.opacity)
          ? Math.min(1, Math.max(0.4, config.settings.opacity))
          : 1
      }
      lastAutoPushDate = typeof config.lastAutoPushDate === 'string' ? config.lastAutoPushDate : null
    } catch {
      folders = []
      settings = { shortcut: null, translationShortcut: 'Alt+Shift+T', language: 'system', opacity: 1 }
      lastAutoPushDate = null
    }
  }

  function saveFolders() {
    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    fs.writeFileSync(configFile, `${JSON.stringify({ folders, settings, lastAutoPushDate }, null, 2)}\n`, 'utf8')
  }

  function effectiveLocale() {
    return settings.language === 'system' ? normalizeLocale(app.getLocale()) : settings.language
  }

  function tr(key, variables) {
    return translate(effectiveLocale(), key, variables)
  }

  function localizedQuery(query = {}) {
    return { ...query, lang: effectiveLocale() }
  }

  function showDeletePrompt(folderPath) {
    return new Promise(resolve => {
      const window = new BrowserWindow({
        width: 430,
        height: 230,
        icon: windowIconPath(),
        opacity: settings.opacity,
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
        query: localizedQuery({ folder: folderPath })
      })
    })
  }

  function showToast(title, message, type, duration = 2500) {
    const window = new BrowserWindow({
      width: 370,
      height: 96,
      icon: windowIconPath(),
      opacity: settings.opacity,
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
        ...localizedQuery(),
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

  async function showRepoPicker() {
    return new Promise(resolve => {
      const window = new BrowserWindow({
        width: 520,
        height: 480,
        icon: windowIconPath(),
        opacity: settings.opacity,
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
      let repositories = []
      let loginProcess = null
      const update = (state, details = {}) => {
        if (!window.isDestroyed() && !window.webContents.isLoading()) {
          window.webContents.executeJavaScript(`window.setLinkState(${JSON.stringify({ state, ...details })})`).catch(() => {})
        }
      }
      const refresh = async () => {
        update('loading')
        try {
          await command('gh', ['auth', 'status', '--active', '--hostname', 'github.com'])
        } catch (error) {
          update('signedOut', { message: error.code === 'ENOENT' ? tr('link.cliMissing') : '' })
          return
        }
        try {
          const { stdout } = await command('gh', [
            'repo', 'list', '--limit', '100', '--json', 'nameWithOwner,isPrivate'
          ])
          repositories = JSON.parse(stdout)
            .filter(repository => repository.isPrivate)
            .map(repository => repository.nameWithOwner)
            .sort((left, right) => left.localeCompare(right))
          update('ready', { repositories })
        } catch (error) {
          update('error', { message: commandErrorMessage(error) })
        }
      }
      const login = () => {
        if (loginProcess) return
        update('signingIn')
        loginProcess = spawn('gh', [
          'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https',
          '--web', '--clipboard', '--scopes', 'repo'
        ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        let output = ''
        let confirmedGit = false
        let openedBrowser = false
        const onOutput = chunk => {
          output += chunk.toString()
          if (!confirmedGit && output.includes('Authenticate Git with your GitHub credentials?')) {
            confirmedGit = true
            loginProcess?.stdin.write('Y\n')
          }
          if (!openedBrowser && output.includes('Press Enter to open')) {
            openedBrowser = true
            loginProcess?.stdin.write('\n')
          }
          const code = output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0]
          if (code) update('signingIn', { code })
        }
        loginProcess.stdout.on('data', onOutput)
        loginProcess.stderr.on('data', onOutput)
        loginProcess.on('error', error => {
          loginProcess = null
          update('error', { message: commandErrorMessage(error) })
        })
        loginProcess.on('close', code => {
          loginProcess = null
          if (settled) return
          if (code === 0) void refresh()
          else if (code !== null) update('error', { message: output.split(/\r?\n/).filter(Boolean).at(-1) || tr('link.loginFailed') })
        })
      }
      const finish = repository => {
        if (settled) return
        settled = true
        loginProcess?.kill()
        if (!window.isDestroyed()) window.close()
        resolve(repository)
      }

      window.on('closed', () => finish(null))
      window.webContents.on('will-navigate', (event, targetUrl) => {
        if (!targetUrl.startsWith('floade-link://')) return
        event.preventDefault()
        const action = new URL(targetUrl)
        if (action.hostname === 'login') login()
        else if (action.hostname === 'retry') void refresh()
        else if (action.hostname === 'select') {
          const repository = action.searchParams.get('repo')
          if (repositories.includes(repository)) finish(repository)
        } else finish(null)
      })
      window.webContents.once('did-finish-load', () => {
        void refresh()
      })
      window.once('ready-to-show', () => {
        window.show()
        window.focus()
      })
      window.loadFile(path.join(app.getAppPath(), 'src', 'link-dialog.html'), {
        query: localizedQuery()
      })
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
      icon: windowIconPath(),
      opacity: settings.opacity,
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
        showToast(tr('preview.failed'), commandErrorMessage(error), 'error')
      }
    })
    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })
    window.loadFile(path.join(app.getAppPath(), 'src', 'markdown-preview.html'), {
      query: localizedQuery()
    })
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
      showToast(tr('preview.failed'), tr('folder.missing'), 'error')
      return
    }

    const existingPicker = [...previewPickers.values()].find(picker => picker.folderPath === folder.path)
    if (existingPicker && !existingPicker.window.isDestroyed()) {
      existingPicker.window.show()
      existingPicker.window.focus()
      return
    }

    if (folder.repo) {
      const processingToast = showToast(
        tr('markdown.reading'),
        tr('markdown.checking', { repo: folder.repo }),
        'loading',
        0
      )
      try {
        await syncFolderForPreview(folder)
      } catch (error) {
        showToast(tr('sync.failed'), commandErrorMessage(error), 'error')
      } finally {
        if (!processingToast.isDestroyed()) processingToast.close()
      }
    }

    let markdownFiles
    try {
      markdownFiles = await findMarkdownFiles(folder.path)
    } catch (error) {
      showToast(tr('preview.failed'), commandErrorMessage(error), 'error')
      return
    }

    const window = new BrowserWindow({
      width: 540,
      height: 550,
      icon: windowIconPath(),
      opacity: settings.opacity,
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
    window.loadFile(path.join(app.getAppPath(), 'src', 'preview-picker.html'), {
      query: localizedQuery()
    })
  }

  function openFloadeMenu() {
    refreshTrayMenu()
    tray?.popUpContextMenu()
  }

  function setGlobalShortcut(shortcut) {
    const previousShortcut = registeredShortcut
    if (previousShortcut) globalShortcut.unregister(previousShortcut)
    registeredShortcut = undefined

    if (!shortcut) {
      settings.shortcut = null
      saveFolders()
      return { success: true, shortcut: null }
    }

    if (globalShortcut.register(shortcut, openFloadeMenu)) {
      registeredShortcut = shortcut
      settings.shortcut = shortcut
      saveFolders()
      return { success: true, shortcut }
    }

    if (previousShortcut && globalShortcut.register(previousShortcut, openFloadeMenu)) {
      registeredShortcut = previousShortcut
    }
    return {
      success: false,
      shortcut: settings.shortcut,
      message: tr('shortcut.conflict')
    }
  }

  function setTranslationShortcut(shortcut) {
    const previousShortcut = registeredTranslationShortcut
    if (previousShortcut) globalShortcut.unregister(previousShortcut)
    registeredTranslationShortcut = undefined

    if (!shortcut) {
      settings.translationShortcut = null
      saveFolders()
      return { success: true, shortcut: null }
    }

    if (globalShortcut.register(shortcut, () => screenTranslator?.start())) {
      registeredTranslationShortcut = shortcut
      settings.translationShortcut = shortcut
      saveFolders()
      return { success: true, shortcut }
    }

    if (previousShortcut && globalShortcut.register(previousShortcut, () => screenTranslator?.start())) {
      registeredTranslationShortcut = previousShortcut
    }
    return {
      success: false,
      shortcut: settings.translationShortcut,
      message: tr('shortcut.conflict')
    }
  }

  function setGlobalOpacity(value) {
    const opacity = Math.min(1, Math.max(0.4, Number(value) || 1))
    settings.opacity = opacity
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setOpacity(opacity)
    }
    saveFolders()
    return opacity
  }

  function setLanguage(value) {
    settings.language = ['system', 'en', 'zh-TW'].includes(value) ? value : 'system'
    saveFolders()
    refreshTrayMenu()
    const locale = effectiveLocale()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        void window.webContents
          .executeJavaScript(`window.floadeI18n?.setLocale(${JSON.stringify(locale)})`)
          .catch(() => {})
      }
    }
    return { language: settings.language, effectiveLanguage: locale }
  }

  function showSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show()
      settingsWindow.focus()
      return
    }

    settingsWindow = new BrowserWindow({
      width: 560,
      height: 650,
      icon: windowIconPath(),
      opacity: settings.opacity,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: false,
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'settings-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    settingsWindow.on('closed', () => { settingsWindow = undefined })
    settingsWindow.webContents.once('did-finish-load', () => {
      settingsWindow.webContents.send('settings:state', {
        ...settings,
        effectiveLanguage: effectiveLocale()
      })
    })
    settingsWindow.once('ready-to-show', () => {
      settingsWindow.show()
      settingsWindow.focus()
    })
    settingsWindow.loadFile(path.join(app.getAppPath(), 'src', 'settings.html'), {
      query: localizedQuery()
    })
  }

  function registerSettingsHandlers() {
    ipcMain.handle('settings:set-shortcut', (event, shortcut) => {
      if (event.sender !== settingsWindow?.webContents) return { success: false }
      return setGlobalShortcut(typeof shortcut === 'string' ? shortcut : null)
    })

    ipcMain.handle('settings:set-translation-shortcut', (event, shortcut) => {
      if (event.sender !== settingsWindow?.webContents) return { success: false }
      return setTranslationShortcut(typeof shortcut === 'string' ? shortcut : null)
    })

    ipcMain.handle('settings:set-opacity', (event, opacity) => {
      if (event.sender !== settingsWindow?.webContents) return settings.opacity
      return setGlobalOpacity(opacity)
    })

    ipcMain.handle('settings:set-language', (event, language) => {
      if (event.sender !== settingsWindow?.webContents) {
        return { language: settings.language, effectiveLanguage: effectiveLocale() }
      }
      return setLanguage(language)
    })

    ipcMain.handle('settings:close', event => {
      if (event.sender === settingsWindow?.webContents && !settingsWindow.isDestroyed()) {
        settingsWindow.close()
      }
    })
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
      if (!filePath || typeof content !== 'string') throw new Error(tr('markdown.missing'))
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
      const repository = await showRepoPicker()
      if (!repository) return
      folder.repo = repository
      saveFolders()
      refreshTrayMenu()
    } catch (error) {
      showToast(tr('link.failed'), commandErrorMessage(error), 'error')
    }
  }

  function commandErrorMessage(error) {
    const output = `${error?.stderr ?? ''}`.trim() || `${error?.message ?? error}`.trim()
    return output.split(/\r?\n/).filter(Boolean).at(-1) ?? tr('error.unknown')
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
      return false
    }
    pushingFolders.add(folder.path)
    refreshTrayMenu()
    const processingToast = showToast(
      tr('push.processing'),
      tr('push.syncing', { repo: folder.repo }),
      'loading',
      0
    )

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
        await ensureCommitIdentity(folder.path, command)
        await command('git', ['commit', '-m', commitMessage], folder.path)
      } else if (!hasCommit) {
        await ensureCommitIdentity(folder.path, command)
        await command('git', ['commit', '--allow-empty', '-m', commitMessage], folder.path)
      }

      await command('git', ['branch', '-M', 'main'], folder.path)
      await command('git', ['push', '-u', 'origin', 'main'], folder.path)
      if (!processingToast.isDestroyed()) processingToast.close()
      showToast(tr('push.completed'), tr('push.synced', { repo: folder.repo }), 'success')
      return true
    } catch (error) {
      if (!processingToast.isDestroyed()) processingToast.close()
      showToast(tr('push.failed'), commandErrorMessage(error), 'error')
      return false
    } finally {
      if (!processingToast.isDestroyed()) processingToast.close()
      pushingFolders.delete(folder.path)
      refreshTrayMenu()
    }
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function runDailyPush() {
    const now = new Date()
    const today = localDateKey(now)
    if (now.getHours() < 20 || lastAutoPushDate === today) return
    const changedFolders = folders.filter(hasPushableChanges)
    if (changedFolders.length === 0) return
    lastAutoPushDate = today
    saveFolders()
    for (const folder of changedFolders) void pushFolder(folder)
  }

  async function addFolder() {
    const result = await dialog.showOpenDialog({
      title: tr('folder.add'),
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
              label: tr('menu.preview'),
              click: () => showPreviewPicker(folder)
            },
            {
              label: pushingFolders.has(folder.path) ? tr('menu.pushing') : tr('menu.push'),
              enabled: hasPushableChanges(folder),
              click: () => pushFolder(folder)
            },
            {
              label: folder.repo ? `${tr('menu.link')}：${folder.repo}` : tr('menu.link'),
              click: () => linkFolder(folder)
            },
            { type: 'separator' },
            {
              label: tr('menu.delete'),
              click: () => removeFolder(folder)
            }
          ])
          pushItems.push({ folder, pushItem: submenu.items[1] })

          return {
            label: folder.path,
            submenu
          }
        })
      : [{ label: tr('menu.noFolders'), enabled: false }]

    const menu = Menu.buildFromTemplate([
      {
        label: tr('menu.addFolder'),
        click: addFolder
      },
      { type: 'separator' },
      ...folderItems,
      { type: 'separator' },
      {
        label: tr('menu.screenTranslate'),
        click: () => screenTranslator?.start()
      },
      {
        label: tr('menu.settings'),
        click: showSettings
      },
      { type: 'separator' },
      {
        label: tr('menu.quit'),
        click: () => app.quit()
      }
    ])

    menu.on('menu-will-show', () => {
      for (const { folder, pushItem } of pushItems) {
        pushItem.label = pushingFolders.has(folder.path) ? tr('menu.pushing') : tr('menu.push')
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
    if (process.platform === 'win32') app.setAppUserModelId('com.smallside.floade')
    configFile = path.join(app.getPath('userData'), 'folders.json')
    loadFolders()
    screenTranslator = createScreenTranslator({
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      iconPath: windowIconPath,
      getOpacity: () => settings.opacity,
      getLocale: effectiveLocale,
      showToast,
      translateUi: tr
    })
    screenTranslator.registerIpc()
    registerSettingsHandlers()
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
    if (process.platform === 'win32' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true })
    }
    runDailyPush()
    autoPushTimer = setInterval(runDailyPush, 60 * 1000)
    if (settings.shortcut) {
      const result = setGlobalShortcut(settings.shortcut)
      if (!result.success) showToast(tr('shortcut.failed'), result.message, 'error')
    }
    if (settings.translationShortcut) {
      const result = setTranslationShortcut(settings.translationShortcut)
      if (!result.success) showToast(tr('translationShortcut.failed'), result.message, 'error')
    }
  })

  app.on('before-quit', () => {
    clearInterval(autoPushTimer)
    globalShortcut.unregisterAll()
    void screenTranslator?.dispose()
    controlServer?.close()
    if (process.platform !== 'win32' && fs.existsSync(controlSocket)) {
      fs.unlinkSync(controlSocket)
    }
  })
}
