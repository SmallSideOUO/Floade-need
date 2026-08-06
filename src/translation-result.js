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

const languages = [
  ['zh-TW', '繁體中文'],
  ['zh-CN', '簡體中文'],
  ['en', '英文'],
  ['ja', '日文'],
  ['ko', '韓文'],
  ['fr', '法文'],
  ['de', '德文'],
  ['es', '西班牙文'],
  ['pt', '葡萄牙文'],
  ['it', '義大利文'],
  ['ru', '俄文'],
  ['vi', '越南文'],
  ['th', '泰文'],
  ['id', '印尼文']
]

let translating = false
let detectedLanguage = ''

function addLanguageOptions(select) {
  for (const [value, label] of languages) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
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
  status.textContent = value ? '翻譯中…' : ''
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
    result = { success: false, message: error?.message || '翻譯失敗。' }
  }
  setBusy(false)
  if (!result.success) {
    status.textContent = result.message || '翻譯失敗。'
    status.className = 'error'
    return
  }
  detectedLanguage = result.detectedLanguage || detectedLanguage
  ensureLanguageOption(sourceLanguage, result.sourceLanguage, result.sourceLanguageName)
  if (sourceLanguage.value === 'auto' && result.sourceLanguage) sourceLanguage.value = result.sourceLanguage
  translation.value = result.translation
  status.textContent = '已更新'
  setTimeout(() => {
    if (!translating && status.textContent === '已更新') status.textContent = ''
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
    copyButton.textContent = '已複製'
    setTimeout(() => { copyButton.textContent = '複製' }, 1400)
  }
})

pinButton.addEventListener('click', async () => {
  const pinned = await window.floadeTranslation.togglePin()
  pinButton.classList.toggle('active', pinned)
})
closeButton.addEventListener('click', () => window.floadeTranslation.close())
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.floadeTranslation.close()
})
