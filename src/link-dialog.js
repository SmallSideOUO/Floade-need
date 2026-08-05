const search = document.querySelector('#search')
const repositoryList = document.querySelector('#repositories')
const close = document.querySelector('#close')
let repositories = []

function render() {
  const query = search.value.trim().toLowerCase()
  const visible = repositories.filter(repository => repository.toLowerCase().includes(query))
  repositoryList.replaceChildren()

  if (visible.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = '找不到 Repo'
    repositoryList.append(empty)
    return
  }

  for (const repository of visible) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'repo'
    button.textContent = repository
    button.addEventListener('click', () => {
      window.location.href = `floade-link://select?repo=${encodeURIComponent(repository)}`
    })
    repositoryList.append(button)
  }
}

window.setRepositories = values => {
  repositories = values
  render()
  search.focus()
}

search.addEventListener('input', render)
close.addEventListener('click', () => { window.location.href = 'floade-link://cancel' })
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.location.href = 'floade-link://cancel'
})
