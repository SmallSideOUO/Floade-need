import {
  BrowserWindow,
  clipboard,
  desktopCapturer,
  ipcMain,
  screen
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createWorker, OEM } from 'tesseract.js'

const OCR_LANGUAGES = ['eng', 'chi_tra', 'chi_sim']
const GOOGLE_TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single'

function cleanOcrText(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function translatedText(payload) {
  if (!Array.isArray(payload?.[0])) return ''
  return payload[0]
    .map(segment => Array.isArray(segment) ? segment[0] : '')
    .filter(Boolean)
    .join('')
    .trim()
}

function languageName(code, translateUi) {
  if (!code) return translateUi('language.auto')
  const knownCodes = new Set(['en', 'zh-CN', 'zh-TW', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'])
  return knownCodes.has(code) ? translateUi(`language.${code}`) : code
}

export function createScreenTranslator({ appPath, userDataPath, iconPath, getOpacity, getLocale, showToast, translateUi }) {
  let captureState
  let busy = false
  let workerPromise
  let textWindow
  const resultWindows = new Map()

  function ensureWorker() {
    if (!workerPromise) {
      const cachePath = path.join(userDataPath, 'ocr-cache')
      fs.mkdirSync(cachePath, { recursive: true })
      workerPromise = createWorker(OCR_LANGUAGES, OEM.LSTM_ONLY, {
        langPath: path.join(appPath, 'assets', 'ocr-data'),
        cachePath,
        gzip: true
      }).catch(error => {
        workerPromise = undefined
        throw error
      })
    }
    return workerPromise
  }

  async function googleRequest(text, target, source = 'auto') {
    const body = new URLSearchParams({
      client: 'gtx',
      sl: source,
      tl: target,
      dt: 't',
      q: text
    })
    const response = await fetch(GOOGLE_TRANSLATE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body,
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(translateUi('translator.httpError', { status: response.status }))
    return response.json()
  }

  async function translate(text) {
    const englishProbe = await googleRequest(text, 'en', 'auto')
    const detectedLanguage = englishProbe?.[2] ?? ''
    const sourceIsChinese = detectedLanguage === 'zh' || detectedLanguage.startsWith('zh-')
    const targetLanguage = sourceIsChinese ? 'en' : 'zh-TW'
    const payload = sourceIsChinese ? englishProbe : await googleRequest(text, targetLanguage)
    const translation = translatedText(payload)
    if (!translation) throw new Error(translateUi('translator.emptyResult'))
    return {
      translation,
      detectedLanguage,
      sourceLanguage: detectedLanguage,
      sourceLanguageName: languageName(detectedLanguage, translateUi),
      targetLanguage,
      targetLanguageName: languageName(targetLanguage, translateUi)
    }
  }

  async function translateTo(text, sourceLanguage, targetLanguage) {
    const source = sourceLanguage || 'auto'
    const payload = await googleRequest(text, targetLanguage, source)
    const translation = translatedText(payload)
    if (!translation) throw new Error(translateUi('translator.emptyResult'))
    const detectedLanguage = payload?.[2] ?? (source === 'auto' ? '' : source)
    return {
      translation,
      detectedLanguage,
      sourceLanguage: source === 'auto' ? detectedLanguage : source,
      sourceLanguageName: languageName(source === 'auto' ? detectedLanguage : source, translateUi),
      targetLanguage,
      targetLanguageName: languageName(targetLanguage, translateUi)
    }
  }

  function openResult(data) {
    const window = new BrowserWindow({
      width: 560,
      height: 440,
      icon: iconPath(),
      opacity: getOpacity(),
      minWidth: 390,
      minHeight: 300,
      frame: false,
      transparent: true,
      resizable: true,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: path.join(appPath, 'src', 'translation-result-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    const webContentsId = window.webContents.id
    resultWindows.set(webContentsId, window)
    window.on('closed', () => resultWindows.delete(webContentsId))
    window.webContents.once('did-finish-load', () => {
      window.webContents.send('translation-result:data', data)
    })
    window.once('ready-to-show', () => {
      window.show()
      window.focus()
    })
    window.loadFile(path.join(appPath, 'src', 'translation-result.html'), {
      query: { lang: getLocale() }
    })
    return window
  }

  function openTextWindow() {
    if (textWindow && !textWindow.isDestroyed()) {
      if (textWindow.isMinimized()) textWindow.restore()
      textWindow.show()
      textWindow.focus()
      return textWindow
    }
    textWindow = openResult({ sourceText: '', translation: '', sourceLanguage: 'en', targetLanguage: 'zh-TW' })
    textWindow.on('closed', () => { textWindow = undefined })
    return textWindow
  }

  async function recognizeAndTranslate(image) {
    const processingToast = showToast(
      translateUi('translator.processing'),
      translateUi('translator.processingMessage'),
      'loading',
      0
    )
    try {
      const size = image.getSize()
      const scale = size.width < 1200 ? Math.min(2, 1800 / Math.max(size.width, 1)) : 1
      const input = scale > 1
        ? image.resize({ width: Math.round(size.width * scale), quality: 'best' })
        : image
      const worker = await ensureWorker()
      const result = await worker.recognize(input.toPNG())
      const sourceText = cleanOcrText(result.data.text)
      if (!sourceText) throw new Error(translateUi('translator.noText'))
      const translated = await translate(sourceText)
      if (!processingToast.isDestroyed()) processingToast.close()
      openResult({
        sourceText,
        confidence: Math.round(result.data.confidence ?? 0),
        ...translated
      })
    } catch (error) {
      if (!processingToast.isDestroyed()) processingToast.close()
      showToast(translateUi('translator.failed'), error?.message ?? String(error), 'error')
    } finally {
      busy = false
    }
  }

  async function captureDisplay(display) {
    const requestedSize = {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor)
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: requestedSize
    })
    const source = sources.find(candidate => candidate.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) throw new Error(translateUi('translator.captureUnavailable'))
    return source.thumbnail
  }

  async function finishSelection(selection) {
    const state = captureState
    if (!state) return
    captureState = undefined
    if (!state.window.isDestroyed()) {
      state.window.hide()
      state.window.close()
    }

    if (Number(selection.width) < 8 || Number(selection.height) < 8) {
      busy = false
      return
    }

    try {
      // 等透明選取層完全離開畫面後，再擷取仍在正常更新的桌面。
      await new Promise(resolve => setTimeout(resolve, 90))
      const image = await captureDisplay(state.display)
      const sourceSize = image.getSize()
      const scaleX = sourceSize.width / state.display.bounds.width
      const scaleY = sourceSize.height / state.display.bounds.height
      const x = Math.max(0, Math.round(Number(selection.x) * scaleX))
      const y = Math.max(0, Math.round(Number(selection.y) * scaleY))
      const width = Math.min(sourceSize.width - x, Math.round(Number(selection.width) * scaleX))
      const height = Math.min(sourceSize.height - y, Math.round(Number(selection.height) * scaleY))
      const cropped = image.crop({ x, y, width, height })
      void recognizeAndTranslate(cropped)
    } catch (error) {
      busy = false
      showToast(translateUi('translator.captureFailed'), error?.message ?? String(error), 'error')
    }
  }

  function cancelSelection() {
    if (captureState?.window && !captureState.window.isDestroyed()) captureState.window.close()
    captureState = undefined
    busy = false
  }

  async function start() {
    if (busy) return
    busy = true
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const window = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        movable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
          preload: path.join(appPath, 'src', 'capture-overlay-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      captureState = { window, display }
      window.setAlwaysOnTop(true, 'screen-saver')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      window.on('closed', () => {
        if (captureState?.window === window) {
          captureState = undefined
          busy = false
        }
      })
      await window.loadFile(path.join(appPath, 'src', 'capture-overlay.html'), {
        query: { lang: getLocale() }
      })
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
    } catch (error) {
      busy = false
      showToast(translateUi('translator.captureFailed'), error?.message ?? String(error), 'error')
    }
  }

  function registerIpc() {
    ipcMain.on('capture:select', (event, selection) => {
      if (event.sender === captureState?.window.webContents) void finishSelection(selection ?? {})
    })
    ipcMain.on('capture:cancel', event => {
      if (event.sender === captureState?.window.webContents) cancelSelection()
    })
    ipcMain.handle('translation-result:toggle-pin', event => {
      const window = resultWindows.get(event.sender.id)
      if (!window || window.isDestroyed()) return false
      const pinned = !window.isAlwaysOnTop()
      window.setAlwaysOnTop(pinned)
      return pinned
    })
    ipcMain.handle('translation-result:copy', (event, text) => {
      if (!resultWindows.has(event.sender.id) || typeof text !== 'string') return false
      clipboard.writeText(text)
      return true
    })
    ipcMain.handle('translation-result:translate', async (event, request) => {
      if (!resultWindows.has(event.sender.id)) {
        return { success: false, message: translateUi('translator.windowMissing') }
      }
      const text = typeof request?.text === 'string' ? request.text.trim() : ''
      const sourceLanguage = typeof request?.sourceLanguage === 'string' ? request.sourceLanguage : 'auto'
      const targetLanguage = typeof request?.targetLanguage === 'string' ? request.targetLanguage : 'zh-TW'
      if (!text) return { success: false, message: translateUi('translator.inputRequired') }
      try {
        return { success: true, ...(await translateTo(text, sourceLanguage, targetLanguage)) }
      } catch (error) {
        return { success: false, message: error?.message ?? String(error) }
      }
    })
    ipcMain.handle('translation-result:close', event => {
      const window = resultWindows.get(event.sender.id)
      if (window && !window.isDestroyed()) window.close()
    })
  }

  async function dispose() {
    cancelSelection()
    for (const window of resultWindows.values()) {
      if (!window.isDestroyed()) window.close()
    }
    if (workerPromise) {
      try {
        const worker = await workerPromise
        await worker.terminate()
      } catch {}
    }
  }

  return { start, openTextWindow, registerIpc, dispose }
}
