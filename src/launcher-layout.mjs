export const ballSize = 52
export const panelSize = { width: 340, height: 450 }

export function clampBall(position, area) {
  const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)))
  return {
    x: Math.round(clamp(position.x, area.x, area.x + area.width - ballSize)),
    y: Math.round(clamp(position.y, area.y, area.y + area.height - ballSize))
  }
}

export function placePanel(ball, area, preferredHeight = panelSize.height) {
  const width = Math.min(panelSize.width, area.width)
  const height = Math.min(preferredHeight, area.height)
  const left = ball.x - width - 6
  const right = ball.x + ballSize + 6
  const preferred = left >= area.x ? left : right
  return {
    x: Math.round(Math.max(area.x, Math.min(preferred, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(ball.y - 80, area.y + area.height - height))),
    width, height
  }
}

export function containsPoint(bounds, point) {
  return point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height
}
