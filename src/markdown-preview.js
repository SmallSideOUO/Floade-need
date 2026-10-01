const nameLabel = document.querySelector('#name')
const pathLabel = document.querySelector('#path')
const editor = document.querySelector('#editor')
const status = document.querySelector('#status')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')
const reloadButton = document.querySelector('#reload')
let saveTimer
let saving
let externalContent
let loaded = false
let lastSavedContent = ''
let statusKey = 'preview.loaded'
const t = key => window.floadeI18n.t(key)

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
  lastSavedContent = document.content
  pinButton.classList.toggle('active', document.pinned)
  pinButton.title = document.pinned ? t('common.unpin') : t('common.pin')
  loaded = true
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
  if (externalContent !== undefined) { acceptExternal(externalContent); return }
  setStatus('preview.unsaved')
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 450)
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
