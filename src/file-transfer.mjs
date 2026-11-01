import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'

export const transferPort = 52961
export const transferMethods = {
  'transfers.list': { description: 'Read local offers, remembered peer offers and durable receiving jobs. Listing never downloads file contents.', params: {} },
  'transfers.offer': { description: 'Offer existing local files/directories by path without copying or uploading their contents.', params: { paths: 'array of absolute paths' } },
  'transfers.refresh': { description: 'Read a saved device file shelf over an authenticated direct P2P tunnel; transfers metadata only.', params: { deviceId: 'saved remote device code' } },
  'transfers.receive': { description: 'Receive offers into an explicitly chosen local directory. Preserves existing files, verifies contents, and supports resume.', params: { deviceId: 'saved remote device code', offerIds: 'array of offer IDs', destination: 'absolute local directory' } },
  'transfers.pause': { description: 'Pause a receiving job and retain verified partial data.', params: { jobId: 'job ID' } },
  'transfers.resume': { description: 'Resume a paused/interrupted receiving job.', params: { jobId: 'job ID' } },
  'transfers.remove': { description: 'Remove an own offer, or discard a receiving job and its cached partial data. Source files are never deleted.', params: { offerId: 'optional own offer ID', jobId: 'optional job ID' } }
}
const chunkSize = 1024 * 1024
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function fail(message, code = 'TRANSFER_ERROR') { throw Object.assign(new Error(message), { apiCode: code }) }
function safeName(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[ .]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) fail('Invalid file name.', 'INVALID_PARAMS')
  return value
}
function safeRelative(value) {
  if (typeof value !== 'string' || value.length > 245) fail('File path is too long.', 'INVALID_PARAMS')
  return value.split('/').map(safeName).join('/')
}
function validEntry(entry) {
  if (!entry || !/^[a-f0-9]{32}$/.test(entry.id) || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.version !== 'string') fail('Invalid peer file metadata.')
  return { id: entry.id, name: safeRelative(entry.name), size: entry.size, version: entry.version, directory: entry.directory === true }
}
const stamp = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`

export function createFileTransfer({ dataDirectory, remote, port = transferPort, peerOrigin, changed = () => {} }) {
  const root = path.join(dataDirectory, 'file-transfer')
  const stateFile = path.join(root, 'state.json')
  const cache = path.join(root, 'partial')
  fs.mkdirSync(cache, { recursive: true })
  let state = { offers: [], peers: {}, jobs: [] }
  if (fs.existsSync(stateFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (!Array.isArray(state.offers) || !Array.isArray(state.jobs) || !state.peers || typeof state.peers !== 'object') fail('File-transfer state is invalid; the original file was preserved.')
  }
  const events = new EventEmitter()
  events.setMaxListeners(100)
  const running = new Map()
  const dragSessions = new Map()
  let server
  let origin
  let closed = false
  const shutdown = new AbortController()
  const save = () => {
    const temporary = `${stateFile}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2))
    fs.renameSync(temporary, stateFile)
    events.emit('change')
    changed()
  }
  for (const job of state.jobs) if (['receiving', 'waiting', 'verifying'].includes(job.status)) job.status = 'paused'
  const publicOffer = offer => ({ id: offer.id, name: offer.name, createdAt: offer.createdAt, size: offer.entries.reduce((n, e) => n + e.size, 0), files: offer.entries.filter(e => !e.directory).length })
  const list = () => ({ offers: state.offers.map(publicOffer), peers: structuredClone(state.peers), jobs: state.jobs.map(({ hashes, ...job }) => ({ ...job })), ready: Boolean(origin) })
  const sourceFile = (offerId, fileId) => {
    const offer = state.offers.find(item => item.id === offerId)
    const entry = offer?.entries.find(item => item.id === fileId && !item.directory)
    if (!entry) fail('The source offer is no longer available.', 'SOURCE_UNAVAILABLE')
    const current = fs.lstatSync(entry.path)
    if (!current.isFile() || current.isSymbolicLink() || stamp(current) !== entry.version || fs.realpathSync(entry.path) !== entry.realPath) fail('The source file changed. Add its new version to the shelf.', 'SOURCE_CHANGED')
    return entry
  }
  async function offer(paths) {
    if (!Array.isArray(paths) || !paths.length || paths.length > 200 || paths.some(item => typeof item !== 'string' || !path.isAbsolute(item))) fail('Provide absolute file paths.', 'INVALID_PARAMS')
    const additions = []
    for (const input of new Set(paths)) {
      const absolute = path.resolve(input)
      const entries = []
      async function walk(file, name) {
        if (entries.length >= 20000) fail('This offer contains too many files.')
        const stat = await fs.promises.lstat(file)
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('Links and special files cannot be offered.')
        const entry = { id: randomBytes(16).toString('hex'), name: safeRelative(name), size: stat.isDirectory() ? 0 : stat.size, directory: stat.isDirectory(), version: stamp(stat), path: file, realPath: await fs.promises.realpath(file) }
        entries.push(entry)
        if (stat.isDirectory()) for (const name of await fs.promises.readdir(file)) await walk(path.join(file, name), `${entry.name}/${name}`)
      }
      await walk(absolute, path.basename(absolute))
      additions.push({ id: randomUUID(), name: path.basename(absolute), path: absolute, createdAt: new Date().toISOString(), entries })
    }
    state.offers.push(...additions)
    save()
    return { offers: additions.map(publicOffer) }
  }
  async function request(deviceId, route) {
    if (!/^\d{6,16}$/.test(deviceId)) fail('Select a saved device.', 'INVALID_PARAMS')
    const endpoint = peerOrigin ? await peerOrigin(deviceId) : await remote('remote.transfer.open', { deviceId })
    const base = typeof endpoint === 'string' ? endpoint : endpoint.origin
    const parsed = new URL(base)
    if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:') fail('The transfer endpoint must be a local authenticated tunnel.')
    const response = await fetch(`${base}${route}`, { headers: { 'x-floade-transfer': '1' }, signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(45000)]), redirect: 'error' })
    if (!response.ok) {
      const message = await response.json().catch(() => ({}))
      fail(message.error || `Peer returned HTTP ${response.status}`, message.code)
    }
    return response
  }
  async function refresh(deviceId) {
    const data = await (await request(deviceId, '/v1/catalog')).json()
    if (!Array.isArray(data.offers) || data.offers.length > 2000) fail('Invalid peer shelf.')
    state.peers[deviceId] = { updatedAt: Date.now(), offers: data.offers.map(o => ({ id: String(o.id), name: safeName(o.name), size: o.size, files: o.files, entries: Array.isArray(o.entries) ? o.entries.map(validEntry) : undefined })) }
    save()
    return state.peers[deviceId]
  }
  function jobFile(job) { return path.join(cache, `${job.id}.part`) }
  function emitJob(job) { save(); events.emit(job.id) }
  async function validatePartial(job) {
    if (!fs.existsSync(jobFile(job))) { job.bytes = 0; job.hashes = []; return }
    const file = await fs.promises.open(jobFile(job), 'r+')
    let valid = 0
    try {
      for (const expected of job.hashes || []) {
        const count = Math.min(chunkSize, job.size - valid)
        const buffer = Buffer.alloc(count)
        const read = await file.read(buffer, 0, count, valid)
        if (read.bytesRead !== count || digest(buffer) !== expected) break
        valid += count
      }
      await file.truncate(valid)
      job.bytes = valid
      job.hashes = (job.hashes || []).slice(0, Math.ceil(valid / chunkSize))
    } finally { await file.close() }
  }
  async function pump(job) {
    if (running.has(job.id)) return running.get(job.id)
    const task = (async () => {
      await validatePartial(job)
      const file = await fs.promises.open(jobFile(job), fs.existsSync(jobFile(job)) ? 'r+' : 'w+')
      try {
        let failures = 0
        while (job.bytes < job.size && !closed && !['paused', 'cancelled'].includes(job.status)) {
          try {
            const response = await request(job.deviceId, `/v1/offers/${encodeURIComponent(job.offerId)}/files/${job.fileId}/chunk?offset=${job.bytes}&version=${encodeURIComponent(job.version)}`)
            const buffer = Buffer.from(await response.arrayBuffer())
            if (buffer.length !== Math.min(chunkSize, job.size - job.bytes) || digest(buffer) !== response.headers.get('x-content-sha256')) fail('A received block failed verification.', 'CONTENT_MISMATCH')
            if (closed || ['paused', 'cancelled'].includes(job.status)) break
            await file.write(buffer, 0, buffer.length, job.bytes)
            await file.sync()
            job.bytes += buffer.length
            job.hashes.push(digest(buffer))
            job.status = 'receiving'
            job.error = null
            failures = 0
            emitJob(job)
          } catch (error) {
            if (['SOURCE_CHANGED', 'SOURCE_UNAVAILABLE', 'CONTENT_MISMATCH'].includes(error.apiCode)) { job.status = 'error'; job.error = error.message; emitJob(job); return }
            if (closed || ['paused', 'cancelled'].includes(job.status)) return
            job.status = 'waiting'; job.error = error.message; emitJob(job)
            if (++failures >= 3) { job.status = 'paused'; emitJob(job); return }
            await sleep(1000 * failures)
          }
        }
        if (job.bytes === job.size && !closed && !['paused', 'cancelled'].includes(job.status)) {
          job.status = 'verifying'; emitJob(job)
          const expected = await (await request(job.deviceId, `/v1/offers/${encodeURIComponent(job.offerId)}/files/${job.fileId}/digest?version=${encodeURIComponent(job.version)}`)).json()
          const hash = createHash('sha256')
          for await (const block of fs.createReadStream(jobFile(job))) hash.update(block)
          if (hash.digest('hex') !== expected.sha256) fail('The received file failed final verification.', 'CONTENT_MISMATCH')
          job.status = 'ready'; job.error = null; emitJob(job)
        }
      } finally { await file.close() }
    })().catch(error => { if (!['paused', 'cancelled'].includes(job.status)) { job.status = 'error'; job.error = error.message; emitJob(job) } }).finally(() => { running.delete(job.id); events.emit(job.id) })
    running.set(job.id, task)
    return task
  }
  async function prepare(deviceId, offerIds) {
    if (!Array.isArray(offerIds) || !offerIds.length || offerIds.length > 200) fail('Select files to receive.', 'INVALID_PARAMS')
    const files = []
    const roots = new Set()
    for (const offerId of new Set(offerIds)) {
      const remembered = state.peers[deviceId]?.offers.find(o => o.id === offerId)
      const manifest = remembered?.entries ? remembered : await (await request(deviceId, `/v1/offers/${encodeURIComponent(offerId)}/manifest`)).json()
      if (!Array.isArray(manifest.entries) || manifest.entries.length > 20000) fail('Invalid peer manifest.')
      const entries = manifest.entries.map(validEntry)
      const originalRoot = safeName(manifest.name)
      let rootName = originalRoot
      for (let n = 2; roots.has(rootName.toLowerCase()); n++) rootName = `${path.parse(originalRoot).name} (${n})${path.extname(originalRoot)}`
      roots.add(rootName.toLowerCase())
      for (const entry of entries) {
        if (entry.name.split('/')[0] !== originalRoot) fail('A peer file is outside its offered directory.')
        const name = safeRelative(rootName + entry.name.slice(originalRoot.length))
        if (entry.directory) { files.push({ name, directory: true, size: 0 }); continue }
        let job = state.jobs.find(j => j.deviceId === deviceId && j.offerId === offerId && j.fileId === entry.id && j.version === entry.version && j.status !== 'delivered' && j.status !== 'cancelled')
        if (!job) { job = { id: randomUUID(), deviceId, offerId, fileId: entry.id, version: entry.version, name, size: entry.size, bytes: 0, hashes: [], status: 'queued', createdAt: Date.now() }; state.jobs.push(job) }
        files.push({ name, directory: false, size: entry.size, jobId: job.id })
      }
    }
    save()
    return files
  }
  async function waitAvailable(job, end) {
    if (['queued', 'paused', 'error'].includes(job.status)) { job.status = 'receiving'; job.error = null; void pump(job) }
    else if (job.status !== 'ready' && !running.has(job.id)) void pump(job)
    while (!closed && (job.bytes < end || job.status !== 'ready')) {
      if (['paused', 'cancelled', 'error'].includes(job.status)) fail(job.error || 'Transfer paused; drag again or choose Resume.', 'TRANSFER_PAUSED')
      await sleep(100)
    }
    if (closed) fail('Floade is closing.')
  }
  async function receive(deviceId, offerIds, destination) {
    if (typeof destination !== 'string' || !path.isAbsolute(destination) || !fs.statSync(destination).isDirectory()) fail('Choose an existing destination folder.', 'INVALID_PARAMS')
    const directory = fs.realpathSync(destination)
    const files = await prepare(deviceId, offerIds)
    const rootMap = new Map()
    for (const file of files) {
      const rootName = file.name.split('/')[0]
      if (!rootMap.has(rootName)) {
        let chosen = rootName
        for (let n = 2; fs.existsSync(path.join(directory, chosen)); n++) chosen = `${path.parse(rootName).name} (${n})${path.extname(rootName)}`
        rootMap.set(rootName, chosen)
      }
      const target = path.join(directory, rootMap.get(rootName), ...file.name.split('/').slice(1))
      if (file.directory) { fs.mkdirSync(target, { recursive: true }); continue }
      const job = state.jobs.find(j => j.id === file.jobId)
      job.destination = target
      await waitAvailable(job, job.size)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      await fs.promises.copyFile(jobFile(job), target, fs.constants.COPYFILE_EXCL)
      job.status = 'delivered'; emitJob(job)
      await fs.promises.unlink(jobFile(job))
    }
    return { files: files.length, destination: directory }
  }
  async function drag(deviceId, offerIds) {
    const files = await prepare(deviceId, offerIds)
    const token = randomBytes(24).toString('hex')
    dragSessions.set(token, { files, createdAt: Date.now() })
    return { url: `${origin}/drag/${token}`, files }
  }
  async function handle(req, res) {
    try {
      if (req.method !== 'GET' || req.headers.origin || req.headers['x-floade-transfer'] !== '1') { res.writeHead(403).end(); return }
      const url = new URL(req.url, 'http://127.0.0.1')
      const parts = url.pathname.split('/').filter(Boolean)
      const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
      if (url.pathname === '/v1/catalog') { json({ offers: state.offers.map(o => ({ ...publicOffer(o), entries: o.entries.map(({ path, realPath, ...entry }) => entry) })) }); return }
      if (parts[0] === 'v1' && parts[1] === 'offers') {
        const offer = state.offers.find(o => o.id === parts[2])
        if (!offer) fail('The source offer is no longer available.', 'SOURCE_UNAVAILABLE')
        if (parts[3] === 'manifest') { json({ name: offer.name, entries: offer.entries.map(({ path, realPath, ...entry }) => entry) }); return }
        if (parts[3] === 'files') {
          const file = sourceFile(offer.id, parts[4])
          if (url.searchParams.get('version') !== file.version) fail('The source file changed.', 'SOURCE_CHANGED')
          if (parts[5] === 'digest') {
            const hash = createHash('sha256')
            for await (const buffer of fs.createReadStream(file.path)) hash.update(buffer)
            sourceFile(offer.id, file.id)
            json({ sha256: hash.digest('hex') }); return
          }
          if (parts[5] === 'chunk') {
            const offset = Number(url.searchParams.get('offset'))
            if (!Number.isSafeInteger(offset) || offset < 0 || offset >= file.size || offset % chunkSize) fail('Invalid block offset.')
            const handle = await fs.promises.open(file.path, 'r')
            try {
              if (stamp(await handle.stat()) !== file.version) fail('The source file changed.', 'SOURCE_CHANGED')
              const buffer = Buffer.alloc(Math.min(chunkSize, file.size - offset))
              const read = await handle.read(buffer, 0, buffer.length, offset)
              sourceFile(offer.id, file.id)
              if (read.bytesRead !== buffer.length) fail('The source file changed.', 'SOURCE_CHANGED')
              res.setHeader('x-content-sha256', digest(buffer)); res.end(buffer); return
            } finally { await handle.close() }
          }
        }
      }
      if (parts[0] === 'drag') {
        const session = dragSessions.get(parts[1])
        if (!session || Date.now() - session.createdAt > 24 * 60 * 60 * 1000) fail('This drag session expired.')
        if (parts.length === 2) { json({ files: session.files }); return }
        if (parts[2] === 'done') {
          if (url.searchParams.get('success') === 'true') for (const file of session.files) {
            const job = state.jobs.find(j => j.id === file.jobId)
            if (job?.status === 'ready') { job.status = 'delivered'; emitJob(job); await fs.promises.unlink(jobFile(job)).catch(() => {}) }
          }
          dragSessions.delete(parts[1]); json({ ok: true }); return
        }
        if (parts[2] === 'file') {
          const file = session.files[Number(parts[3])]
          const job = state.jobs.find(j => j.id === file?.jobId)
          if (!job) fail('Invalid drag file.')
          const offset = Number(url.searchParams.get('offset')), count = Number(url.searchParams.get('count'))
          if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || offset < 0 || count < 0 || count > chunkSize || offset > job.size) fail('Invalid stream range.')
          await waitAvailable(job, Math.min(job.size, offset + count))
          const handle = await fs.promises.open(jobFile(job), 'r')
          try { const buffer = Buffer.alloc(Math.min(count, job.size - offset)); const read = await handle.read(buffer, 0, buffer.length, offset); res.end(buffer.subarray(0, read.bytesRead)); return } finally { await handle.close() }
        }
      }
      res.writeHead(404).end()
    } catch (error) { if (!res.headersSent) { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message, code: error.apiCode || 'TRANSFER_ERROR' })) } else res.destroy() }
  }
  async function start() {
    server = http.createServer((req, res) => { void handle(req, res) })
    server.requestTimeout = 0
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    origin = `http://127.0.0.1:${server.address().port}`
    return { origin }
  }
  async function dispatch(method, p = {}) {
    if (method === 'transfers.list') return list()
    if (method === 'transfers.offer') return offer(p.paths)
    if (method === 'transfers.refresh') return refresh(p.deviceId)
    if (method === 'transfers.receive') return receive(p.deviceId, p.offerIds, p.destination)
    if (method === 'transfers.remove' && p.offerId) { state.offers = state.offers.filter(o => o.id !== p.offerId); save(); return list() }
    const job = state.jobs.find(j => j.id === p.jobId)
    if (!job) fail('Receiving job not found.', 'INVALID_PARAMS')
    if (method === 'transfers.pause') { job.status = 'paused'; emitJob(job); return list() }
    if (method === 'transfers.resume') { if (job.status === 'delivered') return list(); job.status = 'receiving'; emitJob(job); void pump(job); return list() }
    if (method === 'transfers.remove') {
      job.status = 'cancelled'; emitJob(job)
      await running.get(job.id)
      await fs.promises.unlink(jobFile(job)).catch(error => { if (error.code !== 'ENOENT') throw error })
      state.jobs = state.jobs.filter(j => j !== job); save(); return list()
    }
    fail('Unknown transfer operation.', 'METHOD_NOT_FOUND')
  }
  return { start, list, dispatch, drag, events,
    localPaths: ids => ids.map(id => { const offer = state.offers.find(o => o.id === id); if (!offer || !fs.existsSync(offer.path)) fail('The source offer is no longer available.'); return offer.path }),
    async dispose() { if (closed) return; closed = true; shutdown.abort(); for (const job of state.jobs) if (running.has(job.id)) job.status = 'paused'; save(); for (const job of state.jobs) events.emit(job.id); server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); await Promise.allSettled([...running.values()]) } }
}
