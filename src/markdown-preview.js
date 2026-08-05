const nameLabel = document.querySelector('#name')
const pathLabel = document.querySelector('#path')
const editor = document.querySelector('#editor')
const status = document.querySelector('#status')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')
let saveTimer
let loaded = false
let lastSavedContent = ''

async function save() {
  clearTimeout(saveTimer)
  if (!loaded || editor.value === lastSavedContent) return true
  const content = editor.value
  status.textContent = '儲存中…'
  status.className = 'saving'

  try {
    await window.floadePreview.save(content)
    lastSavedContent = content
    if (editor.value === content) {
      status.textContent = '已儲存'
      status.className = ''
    } else {
      status.textContent = '尚未儲存'
      status.className = ''
      saveTimer = setTimeout(save, 450)
    }
    return true
  } catch {
    status.textContent = '儲存失敗'
    status.className = 'error'
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
  pinButton.title = document.pinned ? '取消置頂' : '置頂'
  loaded = true
  editor.focus()
})

editor.addEventListener('input', () => {
  status.textContent = '尚未儲存'
  status.className = ''
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
  pinButton.title = pinned ? '取消置頂' : '置頂'
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
