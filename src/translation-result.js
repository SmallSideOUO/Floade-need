const sourceLanguage = document.querySelector('#source-language')
const targetLanguage = document.querySelector('#target-language')
const confidence = document.querySelector('#confidence')
const translation = document.querySelector('#translation')
const source = document.querySelector('#source')
const copyButton = document.querySelector('#copy')
const pinButton = document.querySelector('#pin')
const closeButton = document.querySelector('#close')

window.floadeTranslation.onData(data => {
  sourceLanguage.textContent = data.sourceLanguageName
  targetLanguage.textContent = data.targetLanguageName
  confidence.textContent = `OCR ${data.confidence}%`
  translation.textContent = data.translation
  source.textContent = data.sourceText
})

copyButton.addEventListener('click', async () => {
  if (await window.floadeTranslation.copy(translation.textContent)) {
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
