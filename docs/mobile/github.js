export function validateRepository(repo) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('請輸入 owner/repository，例如 your-name/notes。')
  return repo
}
export function validatePath(path) {
  if (typeof path !== 'string' || !path || /[\\\u0000-\u001f]/.test(path) || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase()) || /[<>:"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('請使用儲存庫內的有效文件路徑。')
  return path
}
export function encodeText(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
export function decodeText(base64) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(base64.replace(/\s/g, '')), c => c.charCodeAt(0)))
}
export class GithubError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export function createGithubClient({ repo, token, branch = 'main', fetcher = globalThis.fetch }) {
  validateRepository(repo)
  if (!branch || /[\u0000-\u001f]/.test(branch)) throw new Error('請輸入有效分支。')
  const root = `https://api.github.com/repos/${repo}`
  async function request(endpoint, options = {}) {
    const response = await fetcher(`${root}${endpoint}`, {
      ...options, cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) {
      const messages = { 401: '授權已失效，請重新連線。', 403: '沒有寫入權限或已達 GitHub 請求限制，請稍後重試。', 404: '找不到文件、分支或儲存庫，請確認私人儲存庫授權。', 409: '文件已有其他修改，請比較版本再儲存。', 422: '無法儲存，請確認文件名稱、權限或分支規則。' }
      throw new GithubError(response.status, messages[response.status] || `GitHub 暫時無法回應（${response.status}）。`)
    }
    return response.json()
  }
  const fileEndpoint = path => `/contents/${validatePath(path).split('/').map(encodeURIComponent).join('/')}`
  return {
    repo, branch,
    async connect() { const result = await request(''); if (!result.permissions?.push) throw new Error('請授權此儲存庫的 Contents 讀寫權限。'); return result },
    async tree() {
      const result = await request(`/git/trees/${encodeURIComponent(branch)}?recursive=1`)
      if (result.truncated) throw new Error('儲存庫目錄太大，無法完整載入；請改用較小的文件儲存庫。')
      return result.tree.filter(entry => entry.type === 'tree' || (entry.type === 'blob' && /\.(md|markdown|txt)$/i.test(entry.path))).map(({ path, type, sha }) => ({ path, type, sha }))
    },
    async read(path) {
      const result = await request(`${fileEndpoint(path)}?ref=${encodeURIComponent(branch)}`)
      if (result.type !== 'file' || result.encoding !== 'base64' || result.size > 1024 * 1024) throw new Error('目前可編輯 1 MB 以內的文字文件。')
      return { path, sha: result.sha, content: decodeText(result.content) }
    },
    async image(path) {
      const result = await request(`${fileEndpoint(path)}?ref=${encodeURIComponent(branch)}`)
      if (result.type !== 'file' || result.encoding !== 'base64' || result.size > 1024 * 1024) throw new Error('圖片太大或無法讀取。')
      const extension = path.split('.').pop().toLowerCase()
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[extension]
      if (!mime) throw new Error('不支援此圖片格式。')
      return `data:${mime};base64,${result.content.replace(/\s/g, '')}`
    },
    async save(path, content, sha) {
      if (new TextEncoder().encode(content).length > 1024 * 1024) throw new Error('文件超過 1 MB，請縮小後再儲存。')
      const result = await request(fileEndpoint(path), { method: 'PUT', body: JSON.stringify({ message: `docs: update ${path} from Floade mobile`, branch, content: encodeText(content), ...(sha ? { sha } : {}) }) })
      return { path, content, sha: result.content.sha }
    }
  }
}
