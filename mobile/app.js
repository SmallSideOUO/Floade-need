import { createGithubClient, validatePath, GithubError } from './github.js'
import * as store from './store.js'

const $ = id => document.getElementById(id)
let config, client, entries = [], current, remoteConflict, saving = false, generation = 0
let installPrompt
const expanded = new Set()
const identity = () => `${config.repo}@${config.branch}`
const key = (kind, path = '') => `${kind}:${identity()}:${path}`
function status(message = '', error = false) { $('status').textContent = message; $('status').className = error ? 'error' : '' }
function show(page) { for (const name of ['setup', 'library', 'document']) $(name).hidden = name !== page; window.scrollTo(0, 0) }
function report(error) { status(error.message || '連線失敗，草稿仍保留在此裝置。', true) }
function run(action) { return async (...args) => { try { await action(...args) } catch (error) { report(error) } } }
function dirty() { return Boolean(current && $('editor').value !== current.content) }
async function draft() {
  if (!current) return
  await store.put(key('draft', current.path), dirty() || current.isNew ? { path: current.path, sha: current.sha, base: current.content, content: $('editor').value, savedAt: Date.now(), isNew: current.isNew } : undefined)
}
function setup() {
  $('repository').value = config?.repo || new URLSearchParams(location.hash.slice(1)).get('repo') || ''
  $('branch').value = config?.branch || 'main'
  $('token').value = ''
  $('cancel-setup').hidden = !config; $('disconnect').hidden = !config
  show('setup')
}
function fileButton(path, subtitle = path) {
  const button = document.createElement('button'); button.className = 'file'; button.type = 'button'
  const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '≡'
  const copy = document.createElement('span'); copy.className = 'file-copy'
  const name = document.createElement('strong'); name.textContent = path.split('/').pop()
  const small = document.createElement('small'); small.textContent = subtitle
  copy.append(name, small); button.append(icon, copy)
  button.addEventListener('click', run(() => openFile(path)))
  return button
}
async function renderTree() {
  $('tree').replaceChildren(); $('recents').replaceChildren()
  const recent = await store.get(key('recent')) || []
  for (const path of recent.slice(0, 6)) $('recents').append(fileButton(path))
  if (!recent.length) $('recents').textContent = '開啟過的文件會顯示在這裡。'
  const query = $('search').value.trim().toLocaleLowerCase()
  const files = entries.filter(entry => entry.type === 'blob')
  if (query) {
    const matches = files.filter(entry => entry.path.toLocaleLowerCase().includes(query))
    for (const entry of matches) $('tree').append(fileButton(entry.path))
    if (!matches.length) $('tree').textContent = '找不到符合的文件。'
    $('list-title').textContent = '搜尋結果'; return
  }
  $('list-title').textContent = '資料夾與文件'
  const folders = new Map([['', $('tree')]])
  for (const entry of entries.filter(entry => entry.type === 'tree').sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))) {
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
    const details = document.createElement('details'); details.open = expanded.has(entry.path)
    const summary = document.createElement('summary'); summary.textContent = entry.path.split('/').pop()
    const children = document.createElement('div'); children.className = 'children'
    details.append(summary, children); details.addEventListener('toggle', () => details.open ? expanded.add(entry.path) : expanded.delete(entry.path))
    ;(folders.get(parent) || $('tree')).append(details); folders.set(entry.path, children)
  }
  for (const entry of files.sort((a, b) => a.path.localeCompare(b.path))) {
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''
    ;(folders.get(parent) || $('tree')).append(fileButton(entry.path, entry.path.split('/').pop()))
  }
  if (!entries.length) $('tree').textContent = '還沒有文件，按「新文件」開始。'
}
async function library(refresh = false) {
  show('library'); $('repo-label').textContent = `${config.repo} · ${config.branch}`
  if (!entries.length) entries = await store.get(key('tree')) || []
  await renderTree()
  if (refresh) {
    $('refresh').disabled = true
    const revision = generation
    try {
      const result = await client.tree()
      if (revision !== generation) return
      entries = result; await store.put(key('tree'), entries); await renderTree(); status('目錄已更新。尚未 Push 的電腦文件不會出現在這裡。')
    } catch (error) { status(entries.length ? '無法連線，顯示上次載入的目錄。已開啟的文件仍可離線編輯。' : error.message, !entries.length) }
    finally { $('refresh').disabled = false }
  }
}
async function renderMarkdown() {
  const revision = generation
  const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const renderer = new globalThis.marked.Renderer()
  renderer.html = () => ''
  renderer.image = ({ href, text }) => `<img data-floade-src="${escape(href)}" alt="${escape(text)}">`
  const html = globalThis.marked.parse($('editor').value, { gfm: true, renderer })
  $('rendered').innerHTML = globalThis.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio'], FORBID_ATTR: ['style', 'id', 'name'] })
  for (const link of $('rendered').querySelectorAll('a')) {
    const href = link.getAttribute('href') || ''
    if (!/^https?:\/\//i.test(href)) { link.removeAttribute('href'); continue }
    link.target = '_blank'; link.rel = 'noopener noreferrer'
  }
  const images = [...$('rendered').querySelectorAll('img')]
  for (const image of images) {
    const source = image.getAttribute('data-floade-src') || ''; image.removeAttribute('data-floade-src')
    try {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) throw new Error('外部圖片不會自動載入')
      const base = new URL(current.path, 'https://files.invalid/')
      const resolved = new URL(source, base)
      if (resolved.origin !== base.origin) throw new Error('無效圖片')
      const path = validatePath(decodeURIComponent(resolved.pathname.slice(1)))
      let data = await store.get(key('image', path))
      if (navigator.onLine) { try { const fresh = await client.image(path); if (revision !== generation) return; data = fresh; await store.put(key('image', path), data) } catch (error) { if (!data) throw error } }
      if (!data) throw new Error('離線圖片尚未快取')
      if (revision !== generation || !image.isConnected) continue
      image.src = data; image.loading = 'lazy'
    } catch { if (image.isConnected) { const hint = document.createElement('span'); hint.className = 'image-unavailable'; hint.textContent = `[${image.alt || '圖片未載入'}]`; image.replaceWith(hint) } }
  }
}
function mode(editing) {
  $('editor').hidden = !editing; $('rendered').hidden = editing
  $('edit').setAttribute('aria-pressed', String(editing)); $('view').setAttribute('aria-pressed', String(!editing))
  if (editing) $('editor').focus(); else void renderMarkdown().catch(report)
}
async function openFile(path) {
  await draft(); generation++
  const revision = generation; const cached = await store.get(key('file', path)); const savedDraft = await store.get(key('draft', path))
  let file = cached; let offline = false
  try { file = await client.read(path); if (revision !== generation) return; await store.put(key('file', path), file) } catch (error) {
    if (!file && !savedDraft) throw error
    offline = true
  }
  if (revision !== generation) return
  current = savedDraft ? { path, sha: savedDraft.sha, content: savedDraft.base, isNew: savedDraft.isNew } : file
  $('editor').value = savedDraft?.content ?? file.content
  remoteConflict = savedDraft && file && file.sha !== savedDraft.sha ? file : undefined
  $('conflict').hidden = !remoteConflict; $('remote-content').textContent = remoteConflict?.content || ''
  $('document-name').textContent = path.split('/').pop(); $('document-path').textContent = path
  $('document-status').textContent = savedDraft ? '已恢復此裝置的草稿，尚未同步。' : offline ? '離線文件 · 編輯會保留在此裝置。' : '已同步 · 按編輯開始修改。'
  const recent = await store.get(key('recent')) || []
  await store.put(key('recent'), [path, ...recent.filter(item => item !== path)].slice(0, 20))
  show('document'); mode(Boolean(savedDraft)); status('')
}
async function save() {
  if (!current || saving) return
  await draft()
  if (!dirty() && !current.isNew) { $('document-status').textContent = '沒有需要儲存的修改。'; return }
  if (remoteConflict) { $('conflict').hidden = false; $('document-status').textContent = '請先比較最新版本。草稿沒有被覆蓋。'; return }
  if (!navigator.onLine) { $('document-status').textContent = '離線草稿已保留。連線後請按儲存。'; return }
  saving = true; $('save').disabled = true; $('disconnect').disabled = true; $('settings').disabled = true; $('back').disabled = true; $('reload').disabled = true
  const document = current; const revision = generation; const content = $('editor').value
  $('document-status').textContent = '正在同步到 GitHub…'
  try {
    // Show a conflict instead of silently retrying with a newer remote SHA.
    if (!document.isNew) {
      const latest = await client.read(document.path)
      if (latest.sha !== document.sha) { remoteConflict = latest; $('remote-content').textContent = latest.content; $('conflict').hidden = false; throw new GithubError(409, '其他裝置已修改文件，你的草稿已保留。') }
    }
    const result = await client.save(document.path, content, document.sha)
    if (revision !== generation) return
    current = result; await store.put(key('file', current.path), result); await draft()
    $('document-status').textContent = dirty() ? '先前內容已同步，新輸入仍是草稿。' : '已同步到 GitHub。電腦會在下次自動更新時接收。'
    if (!entries.some(entry => entry.path === current.path)) entries.push({ path: current.path, type: 'blob', sha: result.sha })
    await store.put(key('tree'), entries)
    status('')
  } catch (error) { $('document-status').textContent = error.message || '連線失敗，草稿已保留，請稍後重試。'; status('草稿仍在此裝置，尚未同步。', true) }
  finally { saving = false; for (const id of ['save', 'disconnect', 'settings', 'back', 'reload']) $(id).disabled = false }
}
$('connect-form').addEventListener('submit', run(async event => {
  event.preventDefault(); $('connect').disabled = true
  try {
    const next = { repo: $('repository').value.trim(), branch: $('branch').value.trim(), token: $('token').value.trim() }
    const connection = createGithubClient(next); await connection.connect(); const tree = await connection.tree()
    await draft(); generation++; config = next; client = connection; current = undefined; entries = tree
    await store.put('connection', { ...next, token: $('remember').checked ? next.token : '' })
    await store.put(key('tree'), tree); $('token').value = ''; await library(); status('已連線。')
    void navigator.storage?.persist?.()
  } finally { $('connect').disabled = false }
}))
$('settings').addEventListener('click', run(async () => { await draft(); setup() }))
$('cancel-setup').addEventListener('click', run(() => current ? (show('document'), Promise.resolve()) : library()))
$('disconnect').addEventListener('click', run(async () => {
  if (saving || !confirm('登出會移除此裝置的權杖、快取與未同步草稿。確定登出？')) return
  generation++; await store.clear(); config = undefined; client = undefined; current = undefined; entries = []; $('search').value = ''; setup(); status('已登出此裝置。')
}))
$('search').addEventListener('input', run(renderTree))
$('refresh').addEventListener('click', run(() => library(true)))
$('back').addEventListener('click', run(async () => { if (saving) return; await draft(); generation++; current = undefined; remoteConflict = undefined; await library() }))
$('view').addEventListener('click', () => mode(false)); $('edit').addEventListener('click', () => mode(true))
$('editor').addEventListener('input', run(async () => { $('document-status').textContent = '草稿已保留在此裝置，尚未同步。'; await draft() }))
$('save').addEventListener('click', run(save))
$('reload').addEventListener('click', run(async () => {
  if (saving) return
  await draft(); const latest = await client.read(current.path)
  if (latest.sha === current.sha) { $('document-status').textContent = '已是最新版本，草稿保持不變。'; return }
  if (dirty()) { remoteConflict = latest; $('remote-content').textContent = latest.content; $('conflict').hidden = false; return }
  current = latest; $('editor').value = latest.content; await store.put(key('file', current.path), latest); await draft(); mode(!$('editor').hidden); $('document-status').textContent = '已載入最新版本。'
}))
$('resolve').addEventListener('click', run(async () => {
  if (!remoteConflict || saving || !confirm('使用目前編輯的草稿作為合併結果？最新版本保留在 GitHub 歷史中。')) return
  current = { ...remoteConflict }; remoteConflict = undefined; $('conflict').hidden = true; await draft(); await save()
}))
$('use-remote').addEventListener('click', run(async () => {
  if (!remoteConflict || saving || !confirm('放棄此裝置的草稿並採用最新版本？')) return
  current = remoteConflict; remoteConflict = undefined; $('editor').value = current.content; $('conflict').hidden = true; await store.put(key('file', current.path), current); await draft(); mode(false); $('document-status').textContent = '已採用最新版本。'
}))
$('new-file').addEventListener('click', run(async () => {
  const answer = prompt('文件名稱（可包含資料夾，例如 notes/想法.md）：')
  if (!answer) return
  const path = validatePath(answer.trim().replace(/\.(?:md|markdown|txt)$/i, '') + '.md')
  if (entries.some(entry => entry.path === path)) throw new Error('同名文件已存在，請從清單開啟。')
  generation++; current = { path, content: '', sha: undefined, isNew: true }; remoteConflict = undefined
  $('editor').value = ''; $('document-name').textContent = path.split('/').pop(); $('document-path').textContent = path; $('conflict').hidden = true
  $('document-status').textContent = '新文件草稿，按儲存後同步。';
  entries.push({ path, type: 'blob' }); await store.put(key('tree'), entries)
  const recent = await store.get(key('recent')) || []
  await store.put(key('recent'), [path, ...recent.filter(item => item !== path)].slice(0, 20))
  await draft(); show('document'); mode(true)
}))
window.addEventListener('beforeunload', event => { if (saving) { event.preventDefault(); event.returnValue = '' } })
window.addEventListener('online', () => status('已重新連線；有未同步草稿時，請開啟文件並按儲存。'))
window.addEventListener('offline', () => status('目前離線。已開啟文件可繼續編輯，草稿保留在此裝置。'))
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false })
$('install').addEventListener('click', run(async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = undefined; $('install').hidden = true } }))
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => status('離線介面尚未就緒，請保持連線後重新開啟。'))
try {
  config = await store.get('connection')
  if (config) { client = createGithubClient(config); await library(true) } else setup()
} catch (error) { setup(); report(error) }
