import test from 'node:test'
import assert from 'node:assert/strict'
import { openFloadeCut } from '../src/floade-cut.mjs'

const env = {
  APPDATA: 'C:\\Users\\Test User\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Test User\\AppData\\Local',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)'
}

test('opens a Start Menu shortcut so custom install locations are respected', async () => {
  const opened = []
  await openFloadeCut({ env, exists: () => true, openPath: async target => { opened.push(target); return '' } })
  assert.deepEqual(opened, ['C:\\Users\\Test User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Floade Cut.lnk'])
})

test('finds per-user and machine installations when no shortcut exists', async () => {
  for (const installed of [
    'C:\\Users\\Test User\\AppData\\Local\\Programs\\FloadeCut\\Floade.exe',
    'C:\\Program Files\\FloadeCut\\Floade.exe',
    'C:\\Program Files (x86)\\FloadeCut\\Floade.exe',
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Floade Cut.lnk'
  ]) {
    const opened = []
    await openFloadeCut({ env, exists: target => target === installed, openPath: async target => { opened.push(target); return '' } })
    assert.deepEqual(opened, [installed])
  }
})

test('falls back from an unusable shortcut to the installed executable', async () => {
  const opened = []
  await openFloadeCut({ env, exists: target => target.includes('Test User'), openPath: async target => {
    opened.push(target)
    return target.endsWith('.lnk') ? 'Broken shortcut' : ''
  } })
  assert.equal(opened.length, 2)
  assert.ok(opened[1].endsWith('FloadeCut\\Floade.exe'))
})

test('reports missing installations and launch failures in the selected language', async () => {
  let opened = false
  await assert.rejects(openFloadeCut({ env: {}, locale: 'zh-TW', exists: () => true, openPath: async () => { opened = true } }), /找不到 FloadeCut/)
  assert.equal(opened, false)
  for (const openPath of [async () => 'Access denied', async () => { throw new Error('Access denied') }]) {
    await assert.rejects(openFloadeCut({ env, locale: 'zh-TW', exists: () => true, openPath }), /無法開啟 FloadeCut：Access denied/)
  }
})
