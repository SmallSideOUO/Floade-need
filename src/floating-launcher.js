const t = (key, variables) => window.floadeI18n.t(key, variables)
const ball = document.querySelector('#ball')
const panel = document.querySelector('#panel')
const isBall = new URLSearchParams(location.search).get('mode') === 'ball'
if (isBall) {
  let dragging = false
  ball.addEventListener('mouseenter', () => window.floadeLauncher.hover(true))
  ball.addEventListener('mouseleave', () => window.floadeLauncher.hover(false))
  ball.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    dragging = true
    ball.setPointerCapture(event.pointerId)
    void window.floadeLauncher.drag('start')
  })
  ball.addEventListener('pointermove', () => { if (dragging) void window.floadeLauncher.drag('move') })
  const finish = event => {
    if (!dragging) return
    dragging = false
    if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId)
    void window.floadeLauncher.drag('end')
  }
  ball.addEventListener('pointerup', finish)
  ball.addEventListener('pointercancel', finish)
} else {
  ball.hidden = true
  panel.hidden = false
  document.body.classList.add('panel-mode')
  const search = document.querySelector('#search')
  const folders = document.querySelector('#folders')
  const documents = document.querySelector('#documents')
  const status = document.querySelector('#status')
  let data = { folders: [], documents: [], indexing: true }
  let documentButtons = []
  let activeIndex = -1
  let opening = false
  const expandedFolders = new Set()
  const key = document => `${document.folderPath}\n${document.relativePath}`
  function resize() {
    const fixedHeight = [...panel.children].filter(child => child.id !== 'items' && getComputedStyle(child).display !== 'none')
      .reduce((height, child) => { const style = getComputedStyle(child); return height + child.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom) }, 0)
    void window.floadeLauncher.resize(fixedHeight + folders.scrollHeight + documents.scrollHeight + 20)
  }

  function updateActive() {
    documentButtons.forEach((button, index) => button.classList.toggle('active', index === activeIndex))
    documentButtons[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }
  async function open(document) {
    if (opening) return
    opening = true
    const result = await window.floadeLauncher.open(document)
    opening = false
    if (!result?.ok) { status.className = 'error'; status.textContent = result?.message || t('launcher.openFailed') }
  }
  function documentButton(document, withinFolder = false) {
    const button = window.document.createElement('button')
    button.type = 'button'
    button.className = 'document'
    button.dataset.key = key(document)
    button.title = `${document.folderPath}\n${document.relativePath}`
    const name = window.document.createElement('strong')
    name.textContent = document.name
    const location = window.document.createElement('small')
    location.textContent = withinFolder ? document.relativePath : `${document.folderName} · ${document.relativePath}`
    button.append(name, location)
    button.addEventListener('click', () => void open(document))
    button.addEventListener('mouseenter', () => { activeIndex = documentButtons.indexOf(button); updateActive() })
    return button
  }
  async function perform(name, folderPath) {
    const result = await window.floadeLauncher.action(name, folderPath)
    if (!result?.ok) { status.className = 'error'; status.textContent = result?.message || t('launcher.actionFailed') }
  }
  function render() {
    const previous = documentButtons[activeIndex]?.dataset.key
    const query = search.value.trim().toLocaleLowerCase()
    const terms = query.split(/\s+/).filter(Boolean)
    const matches = value => terms.every(term => value.toLocaleLowerCase().includes(term))
    folders.replaceChildren()
    documents.replaceChildren()
    const visibleFolders = data.folders.filter(folder => matches(`${folder.name} ${folder.path} ${folder.repo || ''}`))
    for (const folder of visibleFolders) {
      const card = document.createElement('article')
      card.className = 'folder'
      card.dataset.path = folder.path
      const heading = document.createElement('button')
      heading.type = 'button'
      heading.className = 'folder-open'
      heading.title = folder.path
      heading.disabled = !folder.exists
      const expanded = expandedFolders.has(folder.path)
      heading.setAttribute('aria-expanded', String(expanded))
      heading.setAttribute('aria-controls', `folder-documents-${data.folders.indexOf(folder)}`)
      const icon = document.createElement('span')
      icon.className = 'folder-icon'
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 3h9v11H3V6Z"/></svg>'
      const copy = document.createElement('span')
      copy.className = 'folder-copy'
      const name = document.createElement('strong')
      name.textContent = folder.name
      const state = document.createElement('small')
      state.textContent = !folder.exists ? t('launcher.missingFolder') : folder.repo || t('launcher.unlinked')
      copy.append(name, state)
      const chevron = document.createElement('span')
      chevron.className = 'folder-chevron'
      chevron.textContent = '›'
      chevron.setAttribute('aria-hidden', 'true')
      heading.append(icon, copy, chevron)
      heading.addEventListener('click', () => {
        if (expandedFolders.has(folder.path)) expandedFolders.delete(folder.path)
        else expandedFolders.add(folder.path)
        render()
        const updatedCard = [...folders.querySelectorAll('.folder')].find(item => item.dataset.path === folder.path)
        updatedCard?.querySelector('.folder-open').focus({ preventScroll: true })
      })
      const actions = document.createElement('div')
      actions.className = 'folder-actions'
      for (const [action, label] of [['preview', 'launcher.preview'], ['push', folder.pushing ? 'launcher.pushing' : 'launcher.push'], ['remove', 'launcher.delete']]) {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.action = action
        button.textContent = t(label)
        button.disabled = action === 'push' ? !folder.canPush : action === 'preview' ? !folder.exists : folder.busy
        if (action === 'remove') button.className = 'delete'
        button.addEventListener('click', () => void perform(action, folder.path))
        actions.append(button)
      }
      card.append(heading, actions)
      const files = document.createElement('div')
      files.id = heading.getAttribute('aria-controls')
      files.className = 'folder-documents'
      files.hidden = !expanded
      if (expanded) {
        const folderFiles = data.documents.filter(file => file.folderPath === folder.path)
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }))
        for (const file of folderFiles) files.append(documentButton(file, true))
        if (!folderFiles.length) {
          const empty = document.createElement('div')
          empty.className = 'folder-empty'
          empty.textContent = t(data.indexing ? 'launcher.loading' : 'launcher.noDocuments')
          files.append(empty)
        }
      }
      card.append(files)
      folders.append(card)
    }
    const visibleDocuments = query ? data.documents.filter(file => matches(`${file.name} ${file.folderName} ${file.relativePath}`)).slice(0, 40) : []
    for (const file of visibleDocuments) documents.append(documentButton(file))
    documentButtons = [...document.querySelectorAll(query ? '#documents .document' : '#folders .document')]
    activeIndex = documentButtons.findIndex(button => button.dataset.key === previous)
    if (activeIndex < 0 && query && documentButtons.length) activeIndex = 0
    updateActive()
    document.querySelector('#list-heading').textContent = t(query ? 'launcher.results' : 'launcher.folders')
    document.querySelector('#document-count').textContent = String(visibleFolders.length + visibleDocuments.length)
    status.className = ''
    status.textContent = data.indexing && query ? t('launcher.loading') : ''
    if (!visibleFolders.length && !visibleDocuments.length) {
      const empty = document.createElement('div')
      empty.className = 'empty'
      empty.textContent = t(query ? data.indexing ? 'launcher.loading' : 'launcher.noResults' : 'launcher.noFolders')
      folders.append(empty)
    }
    resize()
  }
  panel.addEventListener('mouseenter', () => window.floadeLauncher.hover(true))
  panel.addEventListener('mouseleave', () => window.floadeLauncher.hover(false))
  search.addEventListener('input', render)
  window.floadeLauncher.onData(next => { data = next; render() })
  window.floadeLauncher.onError(message => { status.className = 'error'; status.textContent = message })
  window.floadeLauncher.onFocus(() => { search.focus(); search.select() })
  window.addEventListener('floade-locale-changed', render)
  document.querySelector('#close').addEventListener('click', () => window.floadeLauncher.close())
  for (const name of ['add-folder', 'text-translate', 'screen-translate', 'settings', 'quit']) document.querySelector(`#${name}`).addEventListener('click', () => void perform(name))
  window.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); window.floadeLauncher.close() }
    if (event.target === search && ['ArrowDown', 'ArrowUp'].includes(event.key) && documentButtons.length) {
      event.preventDefault()
      activeIndex = Math.max(0, Math.min(documentButtons.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)))
      updateActive()
    }
    if (event.target === search && event.key === 'Enter' && documentButtons[activeIndex]) {
      event.preventDefault()
      documentButtons[activeIndex].click()
    }
  })
}
