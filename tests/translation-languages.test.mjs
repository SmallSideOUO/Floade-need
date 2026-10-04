import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const context = vm.createContext({})
vm.runInContext(fs.readFileSync(new URL('../src/translation-languages.js', import.meta.url), 'utf8'), context)
const { codes, rank, record } = context.floadeLanguages
const now = Date.UTC(2026, 9, 4)

test('language groups are complete, unique and start with locale defaults', () => {
  assert.equal(codes.length, 55)
  const groups = rank({}, 'zh-TW', now)
  assert.deepEqual(Array.from(groups.frequent), ['zh-TW', 'en', 'ja', 'ko', 'zh-CN', 'es'])
  assert.equal(rank({}, 'en', now).frequent[0], 'en')
  const combined = [...groups.frequent, ...groups.other]
  assert.equal(new Set(combined).size, codes.length)
  assert.ok(codes.every(code => combined.includes(code)))
})

test('intentional uses promote a language; counts and recent use both matter', () => {
  let usage = record({}, ['ar', 'ar', 'auto'], now)
  assert.equal(usage.ar.count, 1)
  assert.equal(usage.auto, undefined)
  assert.equal(rank(usage, 'zh-TW', now).frequent[0], 'ar')
  usage = record(usage, ['hi'], now)
  usage = record(usage, ['hi'], now)
  assert.equal(rank(usage, 'zh-TW', now).frequent[0], 'hi')
  assert.equal(rank({ fr: { count: 1, lastUsed: now }, de: { count: 1, lastUsed: now - 28 * 86400000 } }, 'zh-TW', now).frequent[0], 'fr')
  assert.equal(rank(JSON.parse(JSON.stringify(usage)), 'zh-TW', now).frequent[0], 'hi')
})

test('corrupt history and future timestamps cannot break ranking', () => {
  for (const usage of [null, [], 'bad', { en: { count: 'oops', lastUsed: Infinity }, ja: { count: -4 } }]) {
    assert.equal(rank(usage, 'zh-TW', now).frequent.length, 6)
  }
  const usage = record({ en: { count: Infinity, lastUsed: now + 10000 }, fake: { count: 12 } }, ['en'], now)
  assert.equal(usage.en.count, 1)
  assert.equal(usage.en.lastUsed, now)
  assert.equal(usage.fake, undefined)
})
