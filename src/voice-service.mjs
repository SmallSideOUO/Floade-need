import { spawn } from 'node:child_process'
import path from 'node:path'

// One microphone or speaker at a time avoids recording our own playback.
export function createVoiceService({ workerPath, emit, translateUi, spawnProcess = spawn, platform = process.platform }) {
  let active

  function stop(owner, id) {
    if (!active || (owner !== undefined && active.owner !== owner) || (id !== undefined && active.id !== id)) return
    const session = active
    active = undefined
    clearTimeout(session.startupTimer)
    clearTimeout(session.lifetimeTimer)
    session.child.kill()
    emit(session.owner, { id: session.id, side: session.side, mode: session.mode, type: 'stopped' })
  }

  function start(owner, request) {
    if (platform !== 'win32') return { success: false, message: translateUi('voice.windowsOnly') }
    if (!Number.isSafeInteger(request?.id) || !['source', 'translation'].includes(request?.side)
      || !['listen', 'speak'].includes(request?.mode) || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(request?.language || '')) {
      return { success: false, message: translateUi('voice.invalidRequest') }
    }
    if (request.mode === 'speak' && (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 100_000)) {
      return { success: false, message: translateUi('translator.inputRequired') }
    }
    stop()
    let child
    try {
      child = spawnProcess(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', workerPath, '-Mode', request.mode],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      return { success: false, message: error.message }
    }
    const session = { owner, child, id: request.id, side: request.side, mode: request.mode }
    active = session
    const send = data => {
      if (active === session) emit(owner, { ...data, id: session.id, side: session.side, mode: session.mode })
    }
    const fail = message => {
      if (active !== session) return
      send({ type: 'error', message })
      stop()
    }
    session.startupTimer = setTimeout(() => fail(translateUi('voice.startTimeout')), 15_000)
    // A forgotten microphone never stays active indefinitely.
    session.lifetimeTimer = setTimeout(() => stop(owner, session.id), request.mode === 'listen' ? 5 * 60_000 : 10 * 60_000)
    let buffer = ''
    let reportedError = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()
      for (const line of lines) {
        let data
        try { data = JSON.parse(line.replace(/^\uFEFF/, '')) } catch { continue }
        if (data.type === 'ready') clearTimeout(session.startupTimer)
        if (data.type === 'error') {
          reportedError = true
          data.message = ['recognizerMissing', 'voiceMissing'].includes(data.code)
            ? translateUi(`voice.${data.code}`, { language: data.language })
            : data.message || translateUi('voice.failed')
        }
        send(data)
      }
    })
    child.stderr.resume()
    child.once('error', error => fail(error.message))
    child.stdin.on('error', error => fail(error.message))
    child.once('close', code => {
      if (active !== session) return
      if (code !== 0 && !reportedError) send({ type: 'error', message: translateUi('voice.failed') })
      stop(owner, session.id)
    })
    // Keep user text out of command-line arguments and shell syntax.
    child.stdin.end(`${JSON.stringify({ language: request.language, text: request.text })}\n`)
    return { success: true }
  }

  return { start, stop }
}
