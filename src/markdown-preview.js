const nameLabel = document.querySelector('#name')
const pathLabel = document.querySelector('#path')
const editor = document.querySelector('#editor')
const status = document.querySelector('#status')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')
const reloadButton = document.querySelector('#reload')
const rendered = document.querySelector('#rendered')
const workspace = document.querySelector('#workspace')
let directoryURL
let renderTimer
let pasting = false
let saveTimer
let saving
let externalContent
let loaded = false
let lastSavedContent = ''
let statusKey = 'preview.loaded'
const t = key => window.floadeI18n.t(key)
function renderMarkdown() {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(() => { if (loaded) void window.floadeMarkdown.render(editor.value, rendered, directoryURL) }, 80)
}
function setView(view) {
  workspace.dataset.view = view
  for (const button of document.querySelectorAll('button[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view))
  localStorage.setItem('floade.markdown.view', view)
  if (view === 'preview') rendered.focus()
  else editor.focus()
}
for (const button of document.querySelectorAll('button[data-view]')) button.addEventListener('click', () => setView(button.dataset.view))
setView(['edit', 'split', 'preview'].includes(localStorage.getItem('floade.markdown.view')) ? localStorage.getItem('floade.markdown.view') : 'split')

function setStatus(key, className = '') {
  statusKey = key
  status.textContent = t(key)
  status.className = className
}

async function save() {
  clearTimeout(saveTimer)
  if (saving) { await saving; return save() }
  if (!loaded || editor.value === lastSavedContent) return true
  if (externalContent !== undefined && externalContent !== lastSavedContent) return false
  const content = editor.value
  setStatus('preview.saving', 'saving')

  saving = performSave(content)
  try { return await saving } finally { saving = undefined }
}

function acceptExternal(content) {
  if (!loaded) return
  if (editor.value === lastSavedContent || editor.value === content) {
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const scroll = editor.scrollTop
    editor.value = content
    renderMarkdown()
    editor.setSelectionRange(Math.min(start, content.length), Math.min(end, content.length))
    editor.scrollTop = scroll
    lastSavedContent = content
    externalContent = undefined
    reloadButton.hidden = true
    clearTimeout(saveTimer)
    setStatus('preview.updated')
  } else if (content !== lastSavedContent) {
    externalContent = content
    reloadButton.hidden = false
    clearTimeout(saveTimer)
    setStatus('preview.conflict', 'error')
  } else {
    externalContent = undefined
    reloadButton.hidden = true
    setStatus('preview.unsaved')
    saveTimer = setTimeout(save, 450)
  }
}

async function performSave(content) {
  try {
    const result = await window.floadePreview.save(content, lastSavedContent)
    if (!result.ok) {
      if (result.conflict) acceptExternal(result.content)
      else setStatus('preview.saveFailed', 'error')
      return false
    }
    lastSavedContent = content
    if (externalContent !== undefined) {
      acceptExternal(externalContent)
      return externalContent === undefined
    }
    if (editor.value === content) {
      setStatus('preview.saved')
    } else {
      setStatus('preview.unsaved')
      saveTimer = setTimeout(save, 450)
    }
    return true
  } catch {
    setStatus('preview.saveFailed', 'error')
    return false
  }
}

window.floadePreview.onDocument(document => {
  nameLabel.textContent = document.name
  pathLabel.textContent = document.path
  pathLabel.title = document.path
  editor.value = document.content
  directoryURL = document.directoryURL
  lastSavedContent = document.content
  pinButton.classList.toggle('active', document.pinned)
  pinButton.title = document.pinned ? t('common.unpin') : t('common.pin')
  loaded = true
  renderMarkdown()
  editor.focus()
})
window.floadePreview.onChange(acceptExternal)

reloadButton.addEventListener('click', async () => {
  if (saving) await saving
  if (editor.value !== lastSavedContent && !window.confirm(t('preview.discard'))) return
  editor.disabled = true
  try {
    const content = await window.floadePreview.read()
    lastSavedContent = editor.value
    acceptExternal(content)
  } catch { setStatus('preview.saveFailed', 'error') }
  finally { editor.disabled = false }
})

editor.addEventListener('input', () => {
  renderMarkdown()
  if (externalContent !== undefined) { acceptExternal(externalContent); return }
  setStatus('preview.unsaved')
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 450)
})

document.addEventListener('paste', async event => {
  if (!loaded || !(event.target === editor || rendered.contains(event.target))) return
  const image = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && /^image\//.test(item.type))
  if (!image && ![...(event.clipboardData?.types || [])].some(type => /^image\//.test(type))) return
  event.preventDefault()
  if (pasting) return
  pasting = true
  const previous = editor.value
  const start = editor.selectionStart
  const end = editor.selectionEnd
  setStatus('preview.pasting', 'saving')
  try {
    const file = image?.getAsFile()
    const result = await window.floadePreview.pasteImage(file ? new Uint8Array(await file.arrayBuffer()) : undefined)
    if (!result?.ok) { setStatus('preview.imageFailed', 'error'); return }
    if (editor.value === previous) editor.setSelectionRange(start, end)
    else editor.setSelectionRange(editor.selectionEnd, editor.selectionEnd)
    const markdown = `![${t('preview.screenshot')}](${result.relativePath})`
    editor.setRangeText(markdown, editor.selectionStart, editor.selectionEnd, 'end')
    editor.dispatchEvent(new Event('input'))
    if (workspace.dataset.view !== 'preview') editor.focus()
  } catch { setStatus('preview.imageFailed', 'error') }
  finally { pasting = false }
})

editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault()
    const start = editor.selectionStart
    const end = editor.selectionEnd
    editor.setRangeText('  ', start, end, 'end')
    editor.dispatchEvent(new Event('input'))
  }
})

pinButton.addEventListener('click', async () => {
  const pinned = await window.floadePreview.togglePin()
  pinButton.classList.toggle('active', pinned)
  pinButton.title = pinned ? t('common.unpin') : t('common.pin')
})

closeButton.addEventListener('click', async () => {
  if (await save()) window.floadePreview.close()
})

window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    save()
  }
})

window.addEventListener('beforeunload', event => {
  if (pasting) { event.preventDefault(); event.returnValue = false; return }
  if (loaded && editor.value !== lastSavedContent) {
    const result = window.floadePreview.saveSync(editor.value, lastSavedContent)
    if (!result.ok) {
      if (result.conflict) acceptExternal(result.content)
      else setStatus('preview.saveFailed', 'error')
      event.preventDefault()
      event.returnValue = false
    }
  }
})
window.addEventListener('floade-locale-changed', () => {
  status.textContent = t(statusKey)
  pinButton.title = pinButton.classList.contains('active') ? t('common.unpin') : t('common.pin')
})
