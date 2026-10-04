const { contextBridge } = require('electron')

const defer = callback => setTimeout(callback, 0)

contextBridge.exposeInMainWorld('floadePicker', {
  onFiles: callback => defer(() => callback({
    folder: 'C:\\Floade Demo',
    files: ['notes.md', 'todo.md'],
    pinned: false
  })),
  openFiles: async () => undefined,
  togglePin: async () => true,
  close: () => undefined
})

contextBridge.exposeInMainWorld('floadePreview', {
  onDocument: callback => defer(() => callback({
    name: 'todo.md',
    path: 'C:\\Floade Demo\\todo.md',
    content: '# Today\n\n- [x] Publish Floade on Hacker News\n- [ ] Review feedback\n- [ ] Prepare the Product Hunt launch\n- [ ] Sync this list to my laptop\n',
    pinned: true
  })),
  save: async () => undefined,
  saveSync: () => undefined,
  togglePin: async () => true,
  close: () => undefined
})

contextBridge.exposeInMainWorld('floadeSettings', {
  onState: callback => defer(() => callback({
    shortcut: 'Alt+Shift+F',
    translationShortcut: 'Alt+Shift+T',
    language: 'en',
    opacity: 1
  })),
  setShortcut: async shortcut => ({ success: true, shortcut }),
  setTranslationShortcut: async shortcut => ({ success: true, shortcut }),
  setOpacity: async opacity => ({ success: true, opacity }),
  setLanguage: async language => ({ success: true, language }),
  close: () => undefined
})

contextBridge.exposeInMainWorld('floadeTranslation', {
  onVoice: () => undefined,
  startVoice: async () => ({ success: true }),
  stopVoice: async () => undefined,
  onData: callback => defer(() => callback({
    sourceText: 'Keep your files private, portable, and easy to restore.',
    translation: '讓你的檔案保持私密、可攜，並且容易還原。',
    sourceLanguage: 'en',
    sourceLanguageName: 'English',
    targetLanguage: 'zh-TW',
    targetLanguageName: 'Traditional Chinese',
    detectedLanguage: 'en',
    confidence: 97
  })),
  togglePin: async () => true,
  copy: async () => true,
  translate: async () => ({ success: true }),
  close: () => undefined
})
