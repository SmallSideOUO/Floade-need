import { spawn } from 'node:child_process'
import path from 'node:path'
import { createInterface } from 'node:readline'

// Keep the native helper warm so it reads the foreground window immediately.
export function createWindowPin({ appPath, platform = process.platform } = {}) {
  let worker
  let ready
  let stopping = false
  let nextId = 0
  let toggling = false
  const pending = new Map()

  function start() {
    if (platform !== 'win32') return Promise.reject(new Error('WINDOWS_ONLY'))
    if (stopping) return Promise.reject(new Error('STOPPED'))
    if (ready) return ready
    ready = new Promise((resolve, reject) => {
      const runtimePath = appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath
      const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(runtimePath, 'src', 'window-pin-worker.ps1')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      worker = child
      const timeout = setTimeout(() => { fail(new Error('START_TIMEOUT')); child.kill() }, 15000)
      function fail(error) {
        clearTimeout(timeout)
        if (worker === child) { worker = undefined; ready = undefined }
        reject(error)
        for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error) }
        pending.clear()
      }
      child.on('error', fail)
      child.on('exit', () => fail(new Error('WORKER_EXITED')))
      child.stdin.on('error', fail)
      child.stderr.resume()
      createInterface({ input: child.stdout }).on('line', line => {
        let response
        try { response = JSON.parse(line) } catch { return }
        if (response.ready) { clearTimeout(timeout); resolve(); return }
        const request = pending.get(response.id)
        if (!request) return
        pending.delete(response.id)
        clearTimeout(request.timeout)
        if (response.success) request.resolve(response)
        else request.reject(new Error(response.error || 'PIN_FAILED'))
      })
    })
    return ready
  }

  async function toggle() {
    if (toggling) return null
    toggling = true
    try {
      await start()
      const id = ++nextId
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('PIN_TIMEOUT')) }, 3000)
        pending.set(id, { resolve, reject, timeout })
        worker.stdin.write(`${JSON.stringify({ id })}\n`)
      })
    } finally { toggling = false }
  }

  function dispose() {
    stopping = true
    // EOF also handles a crashed parent: the helper restores windows it pinned.
    worker?.stdin.end()
  }

  return { start, toggle, dispose }
}
