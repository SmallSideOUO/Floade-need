import test from 'node:test'
import assert from 'node:assert/strict'
import { createGithubClient, encodeText, decodeText, validatePath } from '../mobile/github.js'

test('mobile preserves UTF-8 and encodes paths without leaking credentials to other hosts', async () => {
  const text = '# 蘋果 🍎\nHello\n'
  assert.equal(decodeText(encodeText(text)), text)
  const calls = []
  const client = createGithubClient({ repo: 'fixture/notes', token: 'fixture-secret', fetcher: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ type: 'file', encoding: 'base64', size: 30, content: encodeText(text), sha: 'original' }))
  } })
  assert.equal((await client.read('筆記/蘋果.md')).content, text)
  assert.equal(calls[0].url, 'https://api.github.com/repos/fixture/notes/contents/%E7%AD%86%E8%A8%98/%E8%98%8B%E6%9E%9C.md?ref=main')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-secret')
  assert.equal(calls[0].options.redirect, 'error')
  for (const path of ['../escape', '.git/config', 'a\\b', '/outside']) assert.throws(() => validatePath(path))
  assert.throws(() => createGithubClient({ repo: 'https://malicious.example/notes' }))
})
test('mobile saves against the opened revision and propagates conflicts instead of retrying', async () => {
  let call
  const client = createGithubClient({ repo: 'fixture/notes', token: 'fixture-secret', fetcher: async (url, options) => { call = { url, options }; return new Response('{}', { status: 409 }) } })
  await assert.rejects(client.save('note.md', '草稿', 'opened-sha'), error => error.status === 409)
  assert.deepEqual(JSON.parse(call.options.body), { message: 'docs: update note.md from Floade mobile', branch: 'main', content: encodeText('草稿'), sha: 'opened-sha' })
})
test('mobile refuses truncated directory listings and oversized documents', async () => {
  const client = createGithubClient({ repo: 'fixture/notes', fetcher: async () => new Response(JSON.stringify({ truncated: true, tree: [] })) })
  await assert.rejects(client.tree(), /目錄太大/)
  await assert.rejects(client.save('note.md', 'a'.repeat(1024 * 1024 + 1)), /1 MB/)
})
