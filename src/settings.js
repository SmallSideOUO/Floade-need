const opacityInput = document.querySelector('#opacity')
const opacityValue = document.querySelector('#opacity-value')
const closeButton = document.querySelector('#close')
const modifierKeys = new Set(['CommandOrControl', 'Command', 'Alt', 'Shift'])

const recorders = [
  {
    button: document.querySelector('#record'),
    value: document.querySelector('#shortcut-value'),
    hint: document.querySelector('#shortcut-hint'),
    status: document.querySelector('#shortcut-status'),
    clear: document.querySelector('#clear-shortcut'),
    save: shortcut => window.floadeSettings.setShortcut(shortcut),
    current: null
  },
  {
    button: document.querySelector('#translation-record'),
    value: document.querySelector('#translation-shortcut-value'),
    hint: document.querySelector('#translation-shortcut-hint'),
    status: document.querySelector('#translation-shortcut-status'),
    clear: document.querySelector('#clear-translation-shortcut'),
    save: shortcut => window.floadeSettings.setTranslationShortcut(shortcut),
    current: null
  }
]

let activeRecorder
let recordedKeys = []
let pressedCodes = new Set()
let tooManyKeys = false

function shortcutLabel(shortcut) {
  if (!shortcut) return '尚未設定'
  return shortcut
    .split('+')
    .map(key => {
      if (key === 'CommandOrControl') return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
      if (key === 'Command') return '⌘'
      if (key === 'Alt') return navigator.platform.includes('Mac') ? '⌥' : 'Alt'
      if (key === 'Shift') return navigator.platform.includes('Mac') ? '⇧' : 'Shift'
      if (key === 'Space') return 'Space'
      return key
    })
    .join(' + ')
}

function normalizedKey(event) {
  if (event.key === 'Control') return { accelerator: 'CommandOrControl', label: navigator.platform.includes('Mac') ? '⌃' : 'Ctrl' }
  if (event.key === 'Meta') return { accelerator: 'Command', label: '⌘' }
  if (event.key === 'Alt') return { accelerator: 'Alt', label: navigator.platform.includes('Mac') ? '⌥' : 'Alt' }
  if (event.key === 'Shift') return { accelerator: 'Shift', label: navigator.platform.includes('Mac') ? '⇧' : 'Shift' }
  if (/^Key[A-Z]$/.test(event.code)) return { accelerator: event.code.slice(3), label: event.code.slice(3) }
  if (/^Digit[0-9]$/.test(event.code)) return { accelerator: event.code.slice(5), label: event.code.slice(5) }
  if (/^F([1-9]|1[0-2])$/.test(event.key)) return { accelerator: event.key, label: event.key }

  const namedKeys = {
    ' ': ['Space', 'Space'],
    Enter: ['Enter', 'Enter'],
    Tab: ['Tab', 'Tab'],
    Backspace: ['Backspace', 'Backspace'],
    Delete: ['Delete', 'Delete'],
    ArrowUp: ['Up', '↑'],
    ArrowDown: ['Down', '↓'],
    ArrowLeft: ['Left', '←'],
    ArrowRight: ['Right', '→'],
    Home: ['Home', 'Home'],
    End: ['End', 'End'],
    PageUp: ['PageUp', 'Page Up'],
    PageDown: ['PageDown', 'Page Down']
  }
  const named = namedKeys[event.key]
  return named ? { accelerator: named[0], label: named[1] } : null
}

function setStatus(recorder, message = '', type = '') {
  recorder.status.textContent = message
  recorder.status.className = `status ${type}`.trim()
}

function renderRecorder(recorder) {
  const recording = activeRecorder === recorder
  recorder.value.textContent = recording
    ? recordedKeys.map(key => key.label).join(' + ') || '請按下快捷鍵'
    : shortcutLabel(recorder.current)
  recorder.hint.textContent = recording ? '放開按鍵完成' : '點擊後錄製'
  recorder.button.classList.toggle('recording', recording)
  recorder.clear.disabled = !recorder.current || recording
}

function renderAll() {
  for (const recorder of recorders) renderRecorder(recorder)
}

function stopRecording() {
  activeRecorder = undefined
  recordedKeys = []
  pressedCodes = new Set()
  tooManyKeys = false
  renderAll()
}

function startRecording(recorder) {
  if (activeRecorder && activeRecorder !== recorder) {
    setStatus(activeRecorder, '已取消錄製。')
  }
  activeRecorder = recorder
  recordedKeys = []
  pressedCodes = new Set()
  tooManyKeys = false
  setStatus(recorder, '一次按下最多三個按鍵；按 Esc 取消。')
  renderAll()
  recorder.button.focus()
}

async function finishRecording() {
  const recorder = activeRecorder
  if (!recorder) return
  if (tooManyKeys) {
    stopRecording()
    setStatus(recorder, '快捷鍵最多只能包含三個按鍵。', 'error')
    return
  }

  const hasRegularKey = recordedKeys.some(key => !modifierKeys.has(key.accelerator))
  if (!hasRegularKey) {
    stopRecording()
    setStatus(recorder, '快捷鍵需要包含一個非修飾鍵。', 'error')
    return
  }

  const modifiers = recordedKeys.filter(key => modifierKeys.has(key.accelerator))
  const regularKeys = recordedKeys.filter(key => !modifierKeys.has(key.accelerator))
  const accelerator = [...modifiers, ...regularKeys].map(key => key.accelerator).join('+')
  stopRecording()
  const result = await recorder.save(accelerator)
  recorder.current = result.shortcut
  setStatus(
    recorder,
    result.success ? '快捷鍵已儲存。' : result.message || '無法註冊這組快捷鍵。',
    result.success ? 'success' : 'error'
  )
  renderRecorder(recorder)
}

function updateOpacityDisplay() {
  const value = Number(opacityInput.value)
  const progress = ((value - 40) / 60) * 100
  opacityValue.textContent = `${value}%`
  opacityInput.style.setProperty('--progress', `${progress}%`)
}

window.floadeSettings.onState(state => {
  recorders[0].current = state.shortcut
  recorders[1].current = state.translationShortcut
  opacityInput.value = String(Math.round(state.opacity * 100))
  updateOpacityDisplay()
  renderAll()
})

for (const recorder of recorders) {
  recorder.button.addEventListener('click', () => {
    if (activeRecorder === recorder) stopRecording()
    else startRecording(recorder)
  })
  recorder.clear.addEventListener('click', async () => {
    const result = await recorder.save(null)
    if (result.success) {
      recorder.current = null
      setStatus(recorder, '已清除快捷鍵。', 'success')
      renderRecorder(recorder)
    }
  })
}

window.addEventListener('keydown', event => {
  if (!activeRecorder) {
    if (event.key === 'Escape') window.floadeSettings.close()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    const recorder = activeRecorder
    stopRecording()
    setStatus(recorder, '已取消錄製。')
    return
  }
  if (event.repeat || pressedCodes.has(event.code)) return

  const key = normalizedKey(event)
  if (!key) return
  pressedCodes.add(event.code)
  if (!recordedKeys.some(recorded => recorded.accelerator === key.accelerator)) {
    if (recordedKeys.length >= 3) tooManyKeys = true
    else recordedKeys.push(key)
  }
  renderRecorder(activeRecorder)
})

window.addEventListener('keyup', event => {
  if (!activeRecorder) return
  event.preventDefault()
  pressedCodes.delete(event.code)
  if (pressedCodes.size === 0 && recordedKeys.length > 0) void finishRecording()
})

window.addEventListener('blur', () => {
  if (!activeRecorder) return
  const recorder = activeRecorder
  stopRecording()
  setStatus(recorder, '視窗失去焦點，已取消錄製。')
})

opacityInput.addEventListener('input', async () => {
  updateOpacityDisplay()
  await window.floadeSettings.setOpacity(Number(opacityInput.value) / 100)
})
closeButton.addEventListener('click', () => window.floadeSettings.close())
