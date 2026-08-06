const selection = document.querySelector('#selection')
let startPoint

function rectangle(point) {
  const x = Math.min(startPoint.x, point.x)
  const y = Math.min(startPoint.y, point.y)
  return {
    x,
    y,
    width: Math.abs(point.x - startPoint.x),
    height: Math.abs(point.y - startPoint.y)
  }
}

function render(rect) {
  selection.hidden = false
  selection.style.left = `${rect.x}px`
  selection.style.top = `${rect.y}px`
  selection.style.width = `${rect.width}px`
  selection.style.height = `${rect.height}px`
}

window.addEventListener('mousedown', event => {
  if (event.button !== 0) return
  startPoint = { x: event.clientX, y: event.clientY }
  render({ ...startPoint, width: 0, height: 0 })
})

window.addEventListener('mousemove', event => {
  if (!startPoint) return
  render(rectangle({ x: event.clientX, y: event.clientY }))
})

window.addEventListener('mouseup', event => {
  if (!startPoint || event.button !== 0) return
  const rect = rectangle({ x: event.clientX, y: event.clientY })
  startPoint = undefined
  if (rect.width < 8 || rect.height < 8) {
    selection.hidden = true
    return
  }
  window.floadeCapture.select(rect)
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.floadeCapture.cancel()
})
window.addEventListener('contextmenu', event => {
  event.preventDefault()
  window.floadeCapture.cancel()
})
