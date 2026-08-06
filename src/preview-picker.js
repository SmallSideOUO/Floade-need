const search = document.querySelector('#search')
const fileList = document.querySelector('#files')
const folderLabel = document.querySelector('#folder')
const countLabel = document.querySelector('#selection-count')
const openButton = document.querySelector('#open')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')
let files = []
const selectedFiles = new Set()
const t = (key, variables) => window.floadeI18n.t(key, variables)

function updateSelection() {
  const count = selectedFiles.size
  countLabel.textContent = count === 0 ? t('picker.noneSelected') : t('picker.selected', { count })
  openButton.disabled = count === 0
}

function render() {
  const query = search.value.trim().toLowerCase()
  const visibleFiles = files.filter(file => file.toLowerCase().includes(query))
  fileList.replaceChildren()

  if (visibleFiles.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = files.length === 0 ? t('picker.emptyFolder') : t('picker.notFound')
    fileList.append(empty)
    return
  }

  for (const file of visibleFiles) {
    const label = document.createElement('label')
    label.className = 'file'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selectedFiles.has(file)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedFiles.add(file)
      else selectedFiles.delete(file)
      updateSelection()
    })

    const customCheckbox = document.createElement('span')
    customCheckbox.className = 'checkbox'
    const path = document.createElement('span')
    path.className = 'path'
    path.textContent = file
    label.append(checkbox, customCheckbox, path)
    fileList.append(label)
  }
}

window.floadePicker.onFiles(payload => {
  files = payload.files
  folderLabel.textContent = payload.folder
  folderLabel.title = payload.folder
  pinButton.classList.toggle('active', payload.pinned)
  pinButton.title = payload.pinned ? t('common.unpin') : t('common.pin')
  render()
  updateSelection()
  search.focus()
})

search.addEventListener('input', render)
openButton.addEventListener('click', async () => {
  await window.floadePicker.openFiles([...selectedFiles])
})
pinButton.addEventListener('click', async () => {
  const pinned = await window.floadePicker.togglePin()
  pinButton.classList.toggle('active', pinned)
  pinButton.title = pinned ? t('common.unpin') : t('common.pin')
})
closeButton.addEventListener('click', () => window.floadePicker.close())
window.addEventListener('floade-locale-changed', () => {
  render()
  updateSelection()
  pinButton.title = pinButton.classList.contains('active') ? t('common.unpin') : t('common.pin')
})
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.floadePicker.close()
})
