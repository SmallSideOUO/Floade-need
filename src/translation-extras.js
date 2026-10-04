// Translate the last edited input directly into each additional language.
window.floadeExtraTranslations = ({ snapshot, languageLabel, rememberLanguages, t }) => {
  const choices = document.querySelector('#extra-choices')
  const results = document.querySelector('#extra-results')
  const select = document.querySelector('#extra-language')
  const entries = new Map()
  let frequent = []
  const key = input => JSON.stringify([input.text, input.sourceLanguage])
  const excluded = input => [input.resolvedSourceLanguage, input.targetLanguage]
  function entryFor(language) {
    if (!entries.has(language)) entries.set(language, { open: false, state: 'idle', token: 0 })
    return entries.get(language)
  }
  function render() {
    const input = snapshot()
    const languages = [...new Set(['ja', 'es', ...frequent, ...entries.keys()])]
      .filter(language => !excluded(input).includes(language))
    choices.replaceChildren()
    results.replaceChildren()
    for (const language of languages) {
      const entry = entryFor(language)
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.language = language
      button.className = 'extra-choice'
      button.classList.toggle('active', entry.open)
      button.textContent = t('translation.viewLanguage', { language: languageLabel(language) })
      button.setAttribute('aria-expanded', String(entry.open))
      button.setAttribute('aria-controls', `extra-${language}`)
      button.disabled = input.composing || !input.text.trim()
      button.addEventListener('click', () => {
        entry.open = !entry.open
        render()
        if (entry.open) {
          rememberLanguages([language])
          void load(language)
        }
      })
      choices.append(button)
      if (!entry.open) continue
      const card = document.createElement('article')
      card.id = `extra-${language}`
      card.className = 'extra-card'
      card.dataset.language = language
      const title = document.createElement('div')
      title.className = 'section-title'
      const heading = document.createElement('h2')
      heading.textContent = languageLabel(language)
      const action = document.createElement('button')
      action.type = 'button'
      action.className = 'extra-action'
      action.textContent = t(entry.state === 'error' ? 'translation.retry' : 'translation.copy')
      action.disabled = entry.state !== 'error' && entry.state !== 'ready'
      action.addEventListener('click', async () => {
        if (entry.state === 'error') {
          entry.state = 'idle'
          void load(language)
        } else if (await window.floadeTranslation.copy(entry.text)) {
          action.textContent = t('translation.copied')
          setTimeout(() => { action.textContent = t('translation.copy') }, 1400)
        }
      })
      title.append(heading, action)
      const text = document.createElement('p')
      text.className = `extra-text ${entry.state}`
      text.setAttribute('aria-live', 'polite')
      text.textContent = entry.state === 'ready' ? entry.text : entry.state === 'error' ? entry.error
        : input.text.trim() ? t('translation.translating') : t('translation.extraHint')
      card.append(title, text)
      results.append(card)
    }
    select.disabled = input.composing || !input.text.trim()
    for (const option of select.options) option.disabled = excluded(input).includes(option.value)
  }
  async function load(language) {
    const input = snapshot()
    const entry = entryFor(language)
    if (!entry.open || input.composing || !input.text.trim() || excluded(input).includes(language)) return
    const inputKey = key(input)
    if (entry.key === inputKey && entry.state !== 'idle') return
    entry.key = inputKey
    entry.state = 'loading'
    const token = ++entry.token
    render()
    let result
    try {
      result = await window.floadeTranslation.translate({ text: input.text, sourceLanguage: input.sourceLanguage, targetLanguage: language })
    } catch (error) {
      result = { success: false, message: error?.message }
    }
    if (entry.token !== token || key(snapshot()) !== inputKey) return
    entry.state = result.success ? 'ready' : 'error'
    entry.text = result.translation || ''
    entry.error = result.message || t('translation.failed')
    render()
  }
  select.addEventListener('change', () => {
    const language = select.value
    if (!language) return
    entryFor(language).open = true
    select.value = ''
    rememberLanguages([language])
    render()
    void load(language)
  })
  return {
    render,
    options(groups) {
      frequent = groups.frequent
      select.replaceChildren()
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = t('translation.addLanguage')
      select.append(placeholder)
      for (const [groupKey, languages] of Object.entries(groups)) {
        const group = document.createElement('optgroup')
        group.label = t(`translation.${groupKey}Languages`)
        for (const language of languages) {
          const option = document.createElement('option')
          option.value = language
          option.textContent = languageLabel(language)
          group.append(option)
        }
        select.append(group)
      }
      render()
    },
    invalidate() {
      for (const entry of entries.values()) {
        entry.token += 1
        entry.state = 'idle'
        entry.text = ''
      }
      render()
    },
    refresh() {
      for (const [language, entry] of entries) if (entry.open) void load(language)
      render()
    }
  }
}
