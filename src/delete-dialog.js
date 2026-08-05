const folder = document.querySelector('#folder')
const cancel = document.querySelector('#cancel')
const remove = document.querySelector('#delete')

const folderPath = new URLSearchParams(window.location.search).get('folder') ?? ''
folder.textContent = folderPath
folder.title = folderPath

cancel.addEventListener('click', () => { window.location.href = 'floade-action://cancel' })
remove.addEventListener('click', () => { window.location.href = 'floade-action://delete' })

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.location.href = 'floade-action://cancel'
  if (event.key === 'Enter') window.location.href = 'floade-action://delete'
})

cancel.focus()
