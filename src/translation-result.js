const sourceLanguage = document.querySelector('#source-language')
const targetLanguage = document.querySelector('#target-language')
const confidence = document.querySelector('#confidence')
const translation = document.querySelector('#translation')
const source = document.querySelector('#source')
const status = document.querySelector('#status')
const copyButton = document.querySelector('#copy')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')
const translateButton = document.querySelector('#translate')
const provider = document.querySelector('#provider')

const languageCodes = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'vi', 'th', 'id']
const t = (key, variables) => window.floadeI18n.t(key, variables)

let translating = false
let detectedLanguage = ''
let inputRevision = 0
let activeSide = 'source'
let debounceTimer
let pendingRequest = false
let composing = false

const inputField = () => activeSide === 'source' ? source : translation
const outputField = () => activeSide === 'source' ? translation : source

function updateTranslateButton() {
  translateButton.disabled = translating || composing || !inputField().value.trim()
}

function addLanguageOptions(select) {
  for (const value of languageCodes) {
    const option = document.createElement('option')
    option.value = value
    option.dataset.languageCode = value
    option.textContent = t(`language.${value}`)
    select.append(option)
  }
}

function ensureLanguageOption(select, value, label = value) {
  if (!value || [...select.options].some(option => option.value === value)) return
  const option = document.createElement('option')
  option.value = value
  option.textContent = label
  select.append(option)
}

function setBusy(value) {
  translating = value
  updateTranslateButton()
  status.className = ''
  status.textContent = value ? t('translation.translating') : ''
}

async function retranslate() {
  if (translating || composing || !inputField().value.trim()) return
  pendingRequest = false
  const revision = inputRevision
  const forward = activeSide === 'source'
  const output = outputField()
  const upperLanguage = sourceLanguage.value === 'auto' ? detectedLanguage || 'en' : sourceLanguage.value
  setBusy(true)
  let result
  try {
    result = await window.floadeTranslation.translate({
      text: inputField().value,
      sourceLanguage: forward ? sourceLanguage.value : targetLanguage.value,
      targetLanguage: forward ? targetLanguage.value : upperLanguage
    })
  } catch (error) {
    result = { success: false, message: error?.message || t('translation.failed') }
  }
  setBusy(false)
  // Keep results tied to the submitted text when the user edits during a request.
  if (revision !== inputRevision) {
    if (pendingRequest) void retranslate()
    return
  }
  if (!result.success) {
    status.textContent = result.message || t('translation.failed')
    status.className = 'error'
    return
  }
  if (forward) {
    detectedLanguage = result.detectedLanguage || detectedLanguage
    ensureLanguageOption(sourceLanguage, result.sourceLanguage, result.sourceLanguageName)
  } else if (sourceLanguage.value === 'auto' && !detectedLanguage) {
    sourceLanguage.value = upperLanguage
  }
  output.value = result.translation
  updateTranslateButton()
  status.textContent = t('translation.updated')
  setTimeout(() => {
    if (!translating && status.textContent === t('translation.updated')) status.textContent = ''
  }, 1400)
}

function requestTranslation() {
  clearTimeout(debounceTimer)
  pendingRequest = true
  void retranslate()
}

function edit(side) {
  activeSide = side
  inputRevision += 1
  pendingRequest = false
  clearTimeout(debounceTimer)
  confidence.hidden = true
  status.textContent = ''
  status.className = ''
  outputField().value = ''
  updateTranslateButton()
  if (!composing && inputField().value.trim()) {
    debounceTimer = setTimeout(requestTranslation, 500)
  }
}

addLanguageOptions(sourceLanguage)
addLanguageOptions(targetLanguage)

window.floadeTranslation.onData(data => {
  detectedLanguage = data.detectedLanguage || data.sourceLanguage || ''
  ensureLanguageOption(sourceLanguage, data.sourceLanguage, data.sourceLanguageName)
  ensureLanguageOption(targetLanguage, data.targetLanguage, data.targetLanguageName)
  sourceLanguage.value = data.sourceLanguage || 'auto'
  targetLanguage.value = data.targetLanguage || 'zh-TW'
  confidence.hidden = !Number.isFinite(data.confidence)
  confidence.textContent = confidence.hidden ? '' : `OCR ${data.confidence}%`
  provider.dataset.i18n = confidence.hidden ? 'translation.textProvider' : 'translation.provider'
  provider.textContent = t(provider.dataset.i18n)
  translation.value = data.translation || ''
  source.value = data.sourceText || ''
  updateTranslateButton()
  if (!source.value) source.focus()
})

for (const [side, field] of [['source', source], ['translation', translation]]) {
  field.addEventListener('input', () => edit(side))
  field.addEventListener('compositionstart', () => {
    composing = true
    inputRevision += 1
    pendingRequest = false
    clearTimeout(debounceTimer)
    updateTranslateButton()
  })
  field.addEventListener('compositionend', () => {
    composing = false
    edit(side)
  })
}
translateButton.addEventListener('click', requestTranslation)
for (const select of [sourceLanguage, targetLanguage]) {
  select.addEventListener('change', () => {
    inputRevision += 1
    outputField().value = ''
    if (select === sourceLanguage) detectedLanguage = ''
    requestTranslation()
  })
}

copyButton.addEventListener('click', async () => {
  if (await window.floadeTranslation.copy(translation.value)) {
    copyButton.textContent = t('translation.copied')
    setTimeout(() => { copyButton.textContent = t('translation.copy') }, 1400)
  }
})

pinButton.addEventListener('click', async () => {
  const pinned = await window.floadeTranslation.togglePin()
  pinButton.classList.toggle('active', pinned)
  pinButton.setAttribute('aria-pressed', String(pinned))
  pinButton.title = pinned ? t('common.unpin') : t('common.pin')
  pinButton.setAttribute('aria-label', pinButton.title)
})
pinButton.setAttribute('aria-pressed', 'false')
closeButton.addEventListener('click', () => window.floadeTranslation.close())
window.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault()
    requestTranslation()
  }
  if (event.key === 'Escape') window.floadeTranslation.close()
})
window.addEventListener('floade-locale-changed', () => {
  for (const option of document.querySelectorAll('[data-language-code]')) {
    option.textContent = t(`language.${option.dataset.languageCode}`)
  }
  pinButton.title = pinButton.classList.contains('active') ? t('common.unpin') : t('common.pin')
  pinButton.setAttribute('aria-label', pinButton.title)
})
window.addEventListener('beforeunload', () => clearTimeout(debounceTimer))
