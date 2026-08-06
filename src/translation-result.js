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

const languageCodes = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'vi', 'th', 'id']
const t = (key, variables) => window.floadeI18n.t(key, variables)

let translating = false
let detectedLanguage = ''

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
  sourceLanguage.disabled = value
  targetLanguage.disabled = value
  swapButton.disabled = value
  status.className = ''
  status.textContent = value ? t('translation.translating') : ''
}

async function retranslate() {
  if (translating || !source.value.trim()) return
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
  if (!result.success) {
    status.textContent = result.message || t('translation.failed')
    status.className = 'error'
    return
  }
  detectedLanguage = result.detectedLanguage || detectedLanguage
  ensureLanguageOption(sourceLanguage, result.sourceLanguage, result.sourceLanguageName)
  if (sourceLanguage.value === 'auto' && result.sourceLanguage) sourceLanguage.value = result.sourceLanguage
  translation.value = result.translation
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
  confidence.textContent = `OCR ${data.confidence}%`
  translation.value = data.translation
  source.value = data.sourceText
})

sourceLanguage.addEventListener('change', () => void retranslate())
targetLanguage.addEventListener('change', () => void retranslate())

swapButton.addEventListener('click', async () => {
  const oldSourceLanguage = sourceLanguage.value === 'auto' ? detectedLanguage : sourceLanguage.value
  const oldTargetLanguage = targetLanguage.value
  const editedTranslation = translation.value
  source.value = editedTranslation
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
  pinButton.title = pinned ? t('common.unpin') : t('common.pin')
})
closeButton.addEventListener('click', () => window.floadeTranslation.close())
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.floadeTranslation.close()
})
window.addEventListener('floade-locale-changed', () => {
  for (const option of document.querySelectorAll('[data-language-code]')) {
    option.textContent = t(`language.${option.dataset.languageCode}`)
  }
  pinButton.title = pinButton.classList.contains('active') ? t('common.unpin') : t('common.pin')
})
