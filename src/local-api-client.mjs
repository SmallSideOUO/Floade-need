import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export const controlSocket = process.platform === 'win32' ? '\\\\.\\pipe\\floade-local-data-control' : path.join(os.tmpdir(), 'floade-local-data-control.sock')

export function requestLocalApi(request, { socketPath = controlSocket, timeout = 80000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.setTimeout(timeout)
    const fail = error => { socket.destroy(); reject(error) }
    socket.once('error', fail)
    socket.once('timeout', () => fail(new Error('Floade API request timed out.')))
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end < 0) return
      try { resolve(JSON.parse(buffer.slice(0, end))); socket.destroy() } catch { fail(new Error('Invalid Floade API response.')) }
    })
    socket.once('end', () => { if (!buffer.includes('\n')) fail(new Error('Floade closed without an API response. Update Floade to 0.1.10 or later.')) })
  })
}

export function parseApiArguments(args) {
  const [method = 'api.describe', ...flags] = args
  const params = {}
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--replace') { params.replace = true; continue }
    if (!['--path', '--repo', '--owner', '--limit'].includes(flag) || flags[index + 1] === undefined) throw new Error(`Invalid API argument: ${flag}`)
    const value = flags[++index]
    params[flag.slice(2)] = flag === '--limit' ? Number(value) : value
  }
  return { method, params }
}
