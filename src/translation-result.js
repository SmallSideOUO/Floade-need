const sourceLanguage = document.querySelector('#source-language')
const targetLanguage = document.querySelector('#target-language')
const confidence = document.querySelector('#confidence')
const translation = document.querySelector('#translation')
const source = document.querySelector('#source')
const status = document.querySelector('#status')
const swapButton = document.querySelector('#swap')
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

function updateTranslateButton() {
  translateButton.disabled = translating || !source.value.trim()
  swapButton.disabled = translating || !translation.value.trim()
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
  sourceLanguage.disabled = value
  targetLanguage.disabled = value
  translation.readOnly = value
  status.className = ''
  status.textContent = value ? t('translation.translating') : ''
}

async function retranslate() {
  if (translating || !source.value.trim()) return
  const revision = inputRevision
  setBusy(true)
  let result
  try {
    result = await window.floadeTranslation.translate({
      text: source.value,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value
    })
  } catch (error) {
    result = { success: false, message: error?.message || t('translation.failed') }
  }
  setBusy(false)
  // Keep results tied to the submitted text when the user edits during a request.
  if (revision !== inputRevision) return
  if (!result.success) {
    status.textContent = result.message || t('translation.failed')
    status.className = 'error'
    return
  }
  detectedLanguage = result.detectedLanguage || detectedLanguage
  ensureLanguageOption(sourceLanguage, result.sourceLanguage, result.sourceLanguageName)
  translation.value = result.translation
  updateTranslateButton()
  status.textContent = t('translation.updated')
  setTimeout(() => {
    if (!translating && status.textContent === t('translation.updated')) status.textContent = ''
  }, 1400)
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

source.addEventListener('input', () => {
  inputRevision += 1
  translation.value = ''
  detectedLanguage = ''
  confidence.hidden = true
  status.textContent = ''
  updateTranslateButton()
})
translateButton.addEventListener('click', () => void retranslate())
translation.addEventListener('input', updateTranslateButton)
sourceLanguage.addEventListener('change', () => void retranslate())
targetLanguage.addEventListener('change', () => void retranslate())

swapButton.addEventListener('click', async () => {
  const oldSourceLanguage = sourceLanguage.value === 'auto' ? detectedLanguage : sourceLanguage.value
  const oldTargetLanguage = targetLanguage.value
  const editedTranslation = translation.value
  source.value = editedTranslation
  source.dispatchEvent(new Event('input'))
  ensureLanguageOption(sourceLanguage, oldTargetLanguage)
  ensureLanguageOption(targetLanguage, oldSourceLanguage)
  sourceLanguage.value = oldTargetLanguage
  targetLanguage.value = oldSourceLanguage || 'en'
  await retranslate()
})

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
    void retranslate()
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
