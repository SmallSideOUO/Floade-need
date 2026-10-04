import test from 'node:test'
import assert from 'node:assert/strict'
import { ballSize, clampBall, placePanel, containsPoint } from '../src/launcher-layout.mjs'

test('restored ball and panel stay within positive and negative monitor work areas', () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: -200, width: 1280, height: 900 }, { x: 0, y: 0, width: 300, height: 300 }]) {
    for (const position of [{ x: -10000, y: -10000 }, { x: 10000, y: 10000 }, { x: area.x + 50, y: area.y + 50 }]) {
      const ball = clampBall(position, area)
      assert.ok(ball.x >= area.x && ball.y >= area.y)
      assert.ok(ball.x + ballSize <= area.x + area.width && ball.y + ballSize <= area.y + area.height)
      const panel = placePanel(ball, area, 320)
      assert.ok(panel.x >= area.x && panel.y >= area.y)
      assert.ok(panel.x + panel.width <= area.x + area.width && panel.y + panel.height <= area.y + area.height)
      const resized = placePanel(ball, area, 10000, 10000)
      assert.ok(resized.x >= area.x && resized.y >= area.y)
      assert.ok(resized.x + resized.width <= area.x + area.width && resized.y + resized.height <= area.y + area.height)
    }
  }
})

test('panel chooses the available side and shrinks to fit; hover bounds include their origin but not outside edges', () => {
  const area = { x: 0, y: 0, width: 1200, height: 800 }
  const rightBall = { x: 1100, y: 300 }
  const leftBall = { x: 20, y: 300 }
  assert.ok(placePanel(rightBall, area).x < rightBall.x)
  assert.ok(placePanel(leftBall, area).x > leftBall.x + ballSize)
  assert.equal(placePanel(leftBall, area, 310).height, 310)
  assert.equal(placePanel(leftBall, area, 520, 600).width, 600)
  assert.equal(containsPoint({ x: 10, y: 10, width: 50, height: 50 }, { x: 10, y: 10 }), true)
  assert.equal(containsPoint({ x: 10, y: 10, width: 50, height: 50 }, { x: 60, y: 20 }), false)
})
