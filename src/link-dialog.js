const search = document.querySelector('#search')
const repositoryList = document.querySelector('#repositories')
const close = document.querySelector('#close')
const status = document.querySelector('#status')
const actions = document.querySelector('#auth-actions')
const login = document.querySelector('#login')
const retry = document.querySelector('#retry')
let repositories = []
let currentState = 'loading'
let currentCode = ''
let currentMessage = ''
const t = key => window.floadeI18n.t(key)

function render() {
  const query = search.value.trim().toLowerCase()
  const visible = repositories.filter(repository => repository.toLowerCase().includes(query))
  repositoryList.replaceChildren()

  if (visible.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = t('link.empty')
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

window.setLinkState = ({ state, repositories: values = [], code = '', message = '' }) => {
  currentState = state
  currentCode = code
  currentMessage = message
  repositories = values
  updateState()
}

function updateState() {
  const ready = currentState === 'ready'
  search.hidden = !ready
  repositoryList.hidden = !ready
  actions.hidden = !['signedOut', 'error'].includes(currentState)
  login.hidden = currentState !== 'signedOut'
  retry.hidden = currentState !== 'error'
  if (ready) {
    status.textContent = repositories.length === 0 ? t('link.noPrivateRepos') : ''
    render()
    if (repositories.length > 0) search.focus()
  } else if (currentState === 'signedOut') {
    status.textContent = currentMessage || t('link.signedOut')
  } else if (currentState === 'signingIn') {
    status.textContent = currentCode ? t('link.enterCode', { code: currentCode }) : t('link.signingIn')
  } else if (currentState === 'error') {
    status.textContent = currentMessage || t('link.loginFailed')
  } else {
    status.textContent = t('link.loading')
  }
}

search.addEventListener('input', render)
window.addEventListener('floade-locale-changed', updateState)
login.addEventListener('click', () => { window.location.href = 'floade-link://login' })
retry.addEventListener('click', () => { window.location.href = 'floade-link://retry' })
close.addEventListener('click', () => { window.location.href = 'floade-link://cancel' })
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.location.href = 'floade-link://cancel'
})
updateState()
