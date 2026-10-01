import fs from 'node:fs'

// Read the path again each time: editors often save by replacing the file inode.
export function createMarkdownDocument(filePath, onChange, { interval = 1000 } = {}) {
  let content = fs.readFileSync(filePath, 'utf8')
  let disposed = false
  function read() { return fs.readFileSync(filePath, 'utf8') }
  function refresh() {
    if (disposed) return
    try {
      const current = read()
      if (current !== content) {
        content = current
        onChange(current)
      }
    } catch {
      // A replacement can temporarily remove the path. Never turn that into
      // an empty document; saves still fail until the file is readable again.
    }
  }
  const timer = setInterval(refresh, interval)
  timer.unref()
  return {
    read,
    refresh,
    save(next, base) {
      if (disposed || typeof next !== 'string' || typeof base !== 'string') {
        throw new Error('Invalid Markdown save')
      }
      const current = read()
      if (current !== base && current !== next) {
        return { ok: false, conflict: true, content: current }
      }
      // Serialize this short read/check/write with all other preview saves in
      // the main process, including the synchronous close handler.
      if (current !== next) fs.writeFileSync(filePath, next, 'utf8')
      content = next
      return { ok: true }
    },
    dispose() { disposed = true; clearInterval(timer) }
  }
}
