import fs from 'node:fs'
import path from 'node:path'

const methods = {
  'api.describe': { description: 'Describe the local API.', params: {} },
  'folders.list': { description: 'List folders already added to Floade and their repository links.', params: {} },
  'repositories.list': { description: 'List writable private GitHub repositories. Use owner for an organization; inspect possiblyTruncated before assuming a complete list.', params: { owner: 'optional GitHub account or organization', limit: 'optional integer, 1–1000; default 100' } },
  'folders.link': { description: 'Link an existing Floade folder to an existing writable private GitHub repository. Saves the link without committing or pushing.', params: { path: 'required absolute folder path from folders.list', repo: 'required owner/repo', replace: 'optional boolean; true to change an existing link' } },
}
const writable = permission => ['ADMIN', 'MAINTAIN', 'WRITE'].includes(permission)
const normalizedPath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
function fail(code, message, details = {}) { throw Object.assign(new Error(message), { apiCode: code, details }) }

export function createLocalApi({ getFolders, command, saveLink, refresh, busyFolders, isPushing = () => false }) {
  const isBusy = folderPath => busyFolders.has(folderPath) || isPushing(folderPath)
  async function github(args) {
    try { return await command('gh', args) } catch (error) {
      if (error.code === 'ENOENT') fail('GITHUB_CLI_MISSING', 'Install GitHub CLI, then sign in with gh auth login.')
      if (args[0] === 'auth') fail('GITHUB_AUTH_REQUIRED', 'Sign in with gh auth login --hostname github.com --web, then retry.')
      fail('GITHUB_REQUEST_FAILED', String(error.stderr || error.message).trim())
    }
  }
  const authenticate = () => github(['auth', 'status', '--active', '--hostname', 'github.com'])
  function findFolder(folderPath) { return getFolders().find(folder => normalizedPath(folder.path) === normalizedPath(folderPath)) }
  async function dispatch(method, params) {
    if (method === 'api.describe') return { apiVersion: 1, transport: 'newline-delimited JSON over local control pipe', methods }
    if (method === 'folders.list') return { folders: getFolders().map(folder => ({
      path: folder.path, repo: folder.repo, exists: fs.existsSync(folder.path), busy: isBusy(folder.path)
    })) }
    if (method === 'repositories.list') {
      const { owner, limit = 100 } = params
      if (owner !== undefined && (typeof owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner))) fail('INVALID_PARAMS', 'owner must be a GitHub account or organization name.')
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_PARAMS', 'limit must be an integer between 1 and 1000.')
      await authenticate()
      const args = ['repo', 'list', ...(owner ? [owner] : []), '--visibility', 'private', '--limit', String(limit), '--json', 'nameWithOwner,isPrivate,viewerPermission']
      const { stdout } = await github(args)
      const repositories = JSON.parse(stdout)
      return { repositories: repositories.filter(repo => repo.isPrivate && writable(repo.viewerPermission))
        .map(repo => ({ repo: repo.nameWithOwner, permission: repo.viewerPermission })).sort((a, b) => a.repo.localeCompare(b.repo)), possiblyTruncated: repositories.length >= limit, limit }
    }
    const { path: folderPath, repo, replace = false } = params
    if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath) || typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || typeof replace !== 'boolean') fail('INVALID_PARAMS', 'Provide an absolute path, owner/repo, and an optional boolean replace.')
    const folder = findFolder(folderPath)
    if (!folder) fail('FOLDER_NOT_FOUND', 'Add this folder from the floating Floade panel first.')
    try { if (!fs.statSync(folder.path).isDirectory()) fail('FOLDER_UNAVAILABLE', 'The registered path is not a directory.') } catch { fail('FOLDER_UNAVAILABLE', 'The folder does not exist or cannot be accessed.') }
    if (isBusy(folder.path)) fail('FOLDER_BUSY', 'This folder has an operation in progress; retry when it finishes.')
    busyFolders.add(folder.path)
    refresh()
    try {
      await authenticate()
      const { stdout } = await github(['repo', 'view', repo, '--json', 'nameWithOwner,isPrivate,viewerPermission'])
      const repository = JSON.parse(stdout)
      if (!repository.isPrivate) fail('REPOSITORY_NOT_PRIVATE', 'Floade links only private repositories.')
      if (!writable(repository.viewerPermission)) fail('REPOSITORY_NOT_WRITABLE', 'Your GitHub account needs write access to this repository.')
      if (typeof repository.nameWithOwner !== 'string' || repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()) fail('REPOSITORY_MISMATCH', 'The repository resolves to a different name. Query repositories.list and choose its current name.')
      if (findFolder(folderPath) !== folder) fail('FOLDER_NOT_FOUND', 'The folder was removed while checking the repository.')
      if (folder.repo && folder.repo.toLowerCase() !== repository.nameWithOwner.toLowerCase() && !replace) fail('ALREADY_LINKED', 'This folder has another link. Set replace=true to change it.', { currentRepo: folder.repo })
      const changed = folder.repo !== repository.nameWithOwner
      if (changed) saveLink(folder, repository.nameWithOwner)
      return { folder: { path: folder.path, repo: folder.repo }, changed }
    } finally {
      busyFolders.delete(folder.path)
      refresh()
    }
  }
  return async request => {
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request) || !Object.hasOwn(methods, request.method)) fail('METHOD_NOT_FOUND', 'Use api.describe to discover supported methods.')
      const params = request.params ?? {}
      if (typeof params !== 'object' || Array.isArray(params)) fail('INVALID_PARAMS', 'params must be an object.')
      return { ok: true, result: await dispatch(request.method, params) }
    } catch (error) {
      return { ok: false, error: { code: error.apiCode || 'INTERNAL_ERROR', message: error.message, ...error.details } }
    }
  }
}

export function attachControlSocket(socket, api, stop) {
  let buffer = Buffer.alloc(0)
  let handled = false
  socket.setTimeout(15000, () => socket.destroy())
  socket.on('error', () => {})
  socket.on('data', chunk => {
    if (handled) return
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 65536) {
      handled = true
      socket.end(`${JSON.stringify({ ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Maximum request size is 64 KiB.' } })}\n`)
      return
    }
    const end = buffer.indexOf(10)
    if (end < 0) return
    handled = true
    const text = buffer.subarray(0, end).toString('utf8').trim()
    if (text === 'ping' || text === 'stop') {
      socket.end('ok')
      if (text === 'stop') setImmediate(stop)
      return
    }
    socket.setTimeout(90000)
    void (async () => {
      let response
      try { response = await api(JSON.parse(text)) } catch { response = { ok: false, error: { code: 'INVALID_JSON', message: 'Send one JSON request followed by a newline.' } } }
      if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`)
    })()
  })
}
