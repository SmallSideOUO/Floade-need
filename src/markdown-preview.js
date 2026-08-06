const nameLabel = document.querySelector('#name')
const pathLabel = document.querySelector('#path')
const editor = document.querySelector('#editor')
const status = document.querySelector('#status')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')
let saveTimer
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
  if (!loaded || editor.value === lastSavedContent) return true
  const content = editor.value
  setStatus('preview.saving', 'saving')

  try {
    await window.floadePreview.save(content)
    lastSavedContent = content
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

editor.addEventListener('input', () => {
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

window.addEventListener('beforeunload', () => {
  if (loaded && editor.value !== lastSavedContent) {
    window.floadePreview.saveSync(editor.value)
  }
})
window.addEventListener('floade-locale-changed', () => {
  status.textContent = t(statusKey)
  pinButton.title = pinButton.classList.contains('active') ? t('common.unpin') : t('common.pin')
})
