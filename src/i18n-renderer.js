(() => {
  const messages = {
    en: {
      'common.close': 'Close', 'common.pin': 'Pin', 'common.unpin': 'Unpin', 'common.cancel': 'Cancel',
      'capture.title': 'Floade screen translation', 'capture.tip': 'Drag to select text to translate', 'capture.cancel': 'Esc to cancel',
      'delete.title': 'Remove from Floade', 'delete.heading': 'Remove this folder?', 'delete.note': 'This only removes it from the Floade menu. Local files will not be deleted.', 'delete.remove': 'Remove',
      'link.title': 'Choose a private repository', 'link.search': 'Search repositories', 'link.empty': 'No repositories found', 'link.loading': 'Checking GitHub sign-in…', 'link.signedOut': 'Sign in to GitHub to list your private repositories.', 'link.signIn': 'Sign in to GitHub', 'link.signingIn': 'Complete sign-in in your browser. The device code is copied to your clipboard.', 'link.enterCode': 'Enter code {code} in your browser. It is also copied to your clipboard.', 'link.retry': 'Retry', 'link.loginFailed': 'GitHub sign-in failed.', 'link.noPrivateRepos': 'This account has no private repositories.',
      'picker.title': 'Choose Markdown', 'picker.heading': 'Choose Markdown to display', 'picker.search': 'Search Markdown', 'picker.noneSelected': 'Nothing selected', 'picker.selected': '{count} files selected', 'picker.open': 'Show selected files', 'picker.emptyFolder': 'This folder has no Markdown files', 'picker.notFound': 'No Markdown files found',
      'preview.content': 'Markdown content', 'preview.loaded': 'Loaded', 'preview.saving': 'Saving…', 'preview.saved': 'Saved', 'preview.unsaved': 'Not saved', 'preview.saveFailed': 'Save failed', 'preview.updated': 'Updated from disk', 'preview.conflict': 'File changed outside Floade. Your edits are kept; copy them before reloading.', 'preview.reload': 'Reload from disk', 'preview.discard': 'Discard your unsaved edits and reload the file from disk?',
      'settings.title': 'Floade settings', 'settings.heading': 'Settings', 'settings.description': 'How Floade looks and behaves on this device.', 'settings.menuShortcut': 'Global shortcut', 'settings.menuShortcutDescription': 'Open the Floade menu from any app with up to three keys.', 'settings.translationShortcut': 'OCR screen translation', 'settings.translationShortcutDescription': 'Press the shortcut, drag over text, run OCR locally, then translate with Google.', 'settings.unset': 'Not set', 'settings.record': 'Click to record', 'settings.recording': 'Release keys to finish', 'settings.pressShortcut': 'Press a shortcut', 'settings.clear': 'Clear', 'settings.opacity': 'Global window opacity', 'settings.opacityDescription': 'Applied to Floade Markdown, picker, notification, and settings windows.', 'settings.language': 'Language', 'settings.languageDescription': 'Follow the system language or choose the Floade interface language.', 'settings.systemLanguage': 'System default', 'settings.maxKeys': 'Press up to three keys together; press Esc to cancel.', 'settings.tooManyKeys': 'A shortcut can contain at most three keys.', 'settings.regularKey': 'A shortcut must include one non-modifier key.', 'settings.saved': 'Shortcut saved.', 'settings.conflict': 'This shortcut could not be registered.', 'settings.cleared': 'Shortcut cleared.', 'settings.cancelled': 'Recording cancelled.', 'settings.blurCancelled': 'The window lost focus, so recording was cancelled.',
      'translation.title': 'Floade translation', 'translation.sourceLanguage': 'Upper language', 'translation.targetLanguage': 'Lower language', 'translation.auto': 'Auto detect', 'translation.source': 'Upper text', 'translation.sourceLabel': 'Upper text; type to translate into the lower language', 'translation.result': 'Lower text', 'translation.resultLabel': 'Lower text; type to translate into the upper language', 'translation.copy': 'Copy', 'translation.copied': 'Copied', 'translation.provider': 'Local OCR · Google Translate', 'translation.translating': 'Translating…', 'translation.failed': 'Translation failed.', 'translation.updated': 'Updated', 'translation.translate': 'Translate', 'translation.shortcut': 'Translate (Ctrl+Enter)', 'translation.placeholder': 'Type or paste text to translate…', 'translation.textProvider': 'Google Translate · Type in either box to translate', 'translation.reversePlaceholder': 'Type here to translate back into the upper language…',
      'language.zh-TW': 'Traditional Chinese', 'language.zh-CN': 'Simplified Chinese', 'language.en': 'English', 'language.ja': 'Japanese', 'language.ko': 'Korean', 'language.fr': 'French', 'language.de': 'German', 'language.es': 'Spanish', 'language.pt': 'Portuguese', 'language.it': 'Italian', 'language.ru': 'Russian', 'language.vi': 'Vietnamese', 'language.th': 'Thai', 'language.id': 'Indonesian'
    },
    'zh-TW': {
      'common.close': '關閉', 'common.pin': '置頂', 'common.unpin': '取消置頂', 'common.cancel': '取消',
      'capture.title': 'Floade 畫面翻譯', 'capture.tip': '拖曳框選要翻譯的文字', 'capture.cancel': 'Esc 取消',
      'delete.title': '從 Floade 移除', 'delete.heading': '移除這個資料夾？', 'delete.note': '只會從 Floade 選單移除，本機檔案不會被刪除。', 'delete.remove': '移除',
      'link.title': '選擇 Private Repo', 'link.search': '搜尋 Repo', 'link.empty': '找不到 Repo', 'link.loading': '正在檢查 GitHub 登入狀態…', 'link.signedOut': '請先登入 GitHub，才能列出你的 Private Repo。', 'link.signIn': '登入 GitHub', 'link.signingIn': '請在瀏覽器完成登入。裝置代碼已複製到剪貼簿。', 'link.enterCode': '請在瀏覽器輸入代碼 {code}。代碼也已複製到剪貼簿。', 'link.retry': '重試', 'link.loginFailed': 'GitHub 登入失敗。', 'link.noPrivateRepos': '這個帳號沒有 Private Repo。',
      'picker.title': '選擇 Markdown', 'picker.heading': '選擇要顯示的 Markdown', 'picker.search': '搜尋 Markdown', 'picker.noneSelected': '尚未選擇', 'picker.selected': '已選擇 {count} 個檔案', 'picker.open': '顯示選取項目', 'picker.emptyFolder': '這個資料夾裡沒有 Markdown', 'picker.notFound': '找不到 Markdown',
      'preview.content': 'Markdown 內容', 'preview.loaded': '已載入', 'preview.saving': '儲存中…', 'preview.saved': '已儲存', 'preview.unsaved': '尚未儲存', 'preview.saveFailed': '儲存失敗', 'preview.updated': '已從檔案更新', 'preview.conflict': '檔案已被外部修改。已保留你的編輯；請先複製再重新載入。', 'preview.reload': '從檔案重新載入', 'preview.discard': '捨棄尚未儲存的編輯，從檔案重新載入？',
      'settings.title': 'Floade 設定', 'settings.heading': '設定', 'settings.description': 'Floade 在這部裝置上的顯示與操作方式。', 'settings.menuShortcut': '全域快捷鍵', 'settings.menuShortcutDescription': '在任何程式中開啟 Floade 選單，最多可同時使用三個按鍵。', 'settings.translationShortcut': 'OCR 畫面翻譯', 'settings.translationShortcutDescription': '按下快捷鍵後拖曳框選文字；本機 OCR 完成後交給 Google 自動翻譯。', 'settings.unset': '尚未設定', 'settings.record': '點擊後錄製', 'settings.recording': '放開按鍵完成', 'settings.pressShortcut': '請按下快捷鍵', 'settings.clear': '清除', 'settings.opacity': '全域視窗透明度', 'settings.opacityDescription': '套用到 Floade 的 Markdown、選擇、通知及設定視窗。', 'settings.language': '語言', 'settings.languageDescription': '跟隨系統語言，或手動選擇 Floade 的介面語言。', 'settings.systemLanguage': '跟隨系統', 'settings.maxKeys': '一次按下最多三個按鍵；按 Esc 取消。', 'settings.tooManyKeys': '快捷鍵最多只能包含三個按鍵。', 'settings.regularKey': '快捷鍵需要包含一個非修飾鍵。', 'settings.saved': '快捷鍵已儲存。', 'settings.conflict': '無法註冊這組快捷鍵。', 'settings.cleared': '已清除快捷鍵。', 'settings.cancelled': '已取消錄製。', 'settings.blurCancelled': '視窗失去焦點，已取消錄製。',
      'translation.title': 'Floade 翻譯', 'translation.sourceLanguage': '上方語言', 'translation.targetLanguage': '下方語言', 'translation.auto': '自動偵測', 'translation.source': '上方文字', 'translation.sourceLabel': '上方文字，輸入後翻譯成下方語言', 'translation.result': '下方文字', 'translation.resultLabel': '下方文字，輸入後翻譯成上方語言', 'translation.copy': '複製', 'translation.copied': '已複製', 'translation.provider': '本機 OCR · Google 翻譯', 'translation.translating': '翻譯中…', 'translation.failed': '翻譯失敗。', 'translation.updated': '已更新', 'translation.translate': '翻譯', 'translation.shortcut': '翻譯（Ctrl+Enter）', 'translation.placeholder': '輸入或貼上要翻譯的文字…', 'translation.textProvider': 'Google 翻譯 · 上下皆可輸入，自動雙向翻譯', 'translation.reversePlaceholder': '在這裡輸入，自動翻譯成上方語言…',
      'language.zh-TW': '繁體中文', 'language.zh-CN': '簡體中文', 'language.en': '英文', 'language.ja': '日文', 'language.ko': '韓文', 'language.fr': '法文', 'language.de': '德文', 'language.es': '西班牙文', 'language.pt': '葡萄牙文', 'language.it': '義大利文', 'language.ru': '俄文', 'language.vi': '越南文', 'language.th': '泰文', 'language.id': '印尼文'
    }
  }

  function normalize(locale) { return String(locale || '').toLowerCase().startsWith('zh') ? 'zh-TW' : 'en' }
  let locale = normalize(new URLSearchParams(location.search).get('lang') || navigator.language)
  function t(key, variables = {}) {
    const value = messages[locale]?.[key] || messages.en[key] || key
    return value.replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? ''))
  }
  function apply() {
    document.documentElement.lang = locale
    const titleKey = document.documentElement.dataset.titleI18n
    if (titleKey) document.title = t(titleKey)
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n) })
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
      const value = t(element.dataset.i18nTitle)
      element.title = value
      element.setAttribute('aria-label', value)
    })
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => { element.placeholder = t(element.dataset.i18nPlaceholder) })
    document.querySelectorAll('[data-i18n-aria]').forEach(element => { element.setAttribute('aria-label', t(element.dataset.i18nAria)) })
  }
  function setLocale(value) {
    locale = normalize(value)
    apply()
    window.dispatchEvent(new CustomEvent('floade-locale-changed'))
  }
  window.floadeI18n = { t, apply, setLocale, get locale() { return locale } }
  apply()
})()
