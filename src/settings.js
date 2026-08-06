const recordButton = document.querySelector('#record')
const shortcutValue = document.querySelector('#shortcut-value')
const shortcutHint = document.querySelector('#shortcut-hint')
const shortcutStatus = document.querySelector('#shortcut-status')
const clearShortcutButton = document.querySelector('#clear-shortcut')
const opacityInput = document.querySelector('#opacity')
const opacityValue = document.querySelector('#opacity-value')
const closeButton = document.querySelector('#close')

const modifierKeys = new Set(['CommandOrControl', 'Command', 'Alt', 'Shift'])
let currentShortcut = null
let recording = false
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

function renderShortcut() {
  shortcutValue.textContent = recording
    ? recordedKeys.map(key => key.label).join(' + ') || '請按下快捷鍵'
    : shortcutLabel(currentShortcut)
  shortcutHint.textContent = recording ? '放開按鍵完成' : '點擊後錄製'
  recordButton.classList.toggle('recording', recording)
  clearShortcutButton.disabled = !currentShortcut || recording
}

function setStatus(message = '', type = '') {
  shortcutStatus.textContent = message
  shortcutStatus.className = `status ${type}`.trim()
}

function stopRecording() {
  recording = false
  recordedKeys = []
  pressedCodes = new Set()
  tooManyKeys = false
  renderShortcut()
}

function startRecording() {
  recording = true
  recordedKeys = []
  pressedCodes = new Set()
  tooManyKeys = false
  setStatus('一次按下最多三個按鍵；按 Esc 取消。')
  renderShortcut()
  recordButton.focus()
}

async function finishRecording() {
  if (tooManyKeys) {
    stopRecording()
    setStatus('快捷鍵最多只能包含三個按鍵。', 'error')
    return
  }

  const hasRegularKey = recordedKeys.some(key => !modifierKeys.has(key.accelerator))
  if (!hasRegularKey) {
    stopRecording()
    setStatus('快捷鍵需要包含一個非修飾鍵。', 'error')
    return
  }

  const modifiers = recordedKeys.filter(key => modifierKeys.has(key.accelerator))
  const regularKeys = recordedKeys.filter(key => !modifierKeys.has(key.accelerator))
  const accelerator = [...modifiers, ...regularKeys].map(key => key.accelerator).join('+')
  stopRecording()
  const result = await window.floadeSettings.setShortcut(accelerator)
  if (result.success) {
    currentShortcut = result.shortcut
    setStatus('快捷鍵已儲存。', 'success')
  } else {
    currentShortcut = result.shortcut
    setStatus(result.message || '無法註冊這組快捷鍵。', 'error')
  }
  renderShortcut()
}

function updateOpacityDisplay() {
  const value = Number(opacityInput.value)
  const progress = ((value - 40) / 60) * 100
  opacityValue.textContent = `${value}%`
  opacityInput.style.setProperty('--progress', `${progress}%`)
}

window.floadeSettings.onState(state => {
  currentShortcut = state.shortcut
  const opacity = Math.round(state.opacity * 100)
  opacityInput.value = String(opacity)
  updateOpacityDisplay()
  renderShortcut()
})

recordButton.addEventListener('click', () => {
  if (recording) stopRecording()
  else startRecording()
})

window.addEventListener('keydown', event => {
  if (!recording) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    stopRecording()
    setStatus('已取消錄製。')
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
  renderShortcut()
})

window.addEventListener('keyup', event => {
  if (!recording) return
  event.preventDefault()
  pressedCodes.delete(event.code)
  if (pressedCodes.size === 0 && recordedKeys.length > 0) finishRecording()
})

window.addEventListener('blur', () => {
  if (recording) {
    stopRecording()
    setStatus('視窗失去焦點，已取消錄製。')
  }
})

clearShortcutButton.addEventListener('click', async () => {
  const result = await window.floadeSettings.setShortcut(null)
  if (result.success) {
    currentShortcut = null
    setStatus('已清除快捷鍵。', 'success')
    renderShortcut()
  }
})

opacityInput.addEventListener('input', async () => {
  updateOpacityDisplay()
  await window.floadeSettings.setOpacity(Number(opacityInput.value) / 100)
})

closeButton.addEventListener('click', () => window.floadeSettings.close())
window.addEventListener('keydown', event => {
  if (!recording && event.key === 'Escape') window.floadeSettings.close()
})
