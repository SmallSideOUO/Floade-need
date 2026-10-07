async page => {
  const checks = []
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  await page.setViewportSize({ width: 390, height: 844 })
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  let offline = false, pausePut = false, signalPut, releasePut
  let remote = { sha: 'base-sha', content: '# Apple 蘋果\n\n- 第一則筆記\n\n![圖片](images/apple.png)\n\n<script>window.injected = true</script>\n<img src="https://untrusted.example/track">\n' }
  const saved = []
  await page.route('https://api.github.com/**', async route => {
    if (offline) return route.abort('internetdisconnected')
    const request = route.request(), url = new URL(request.url())
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname.endsWith('/fixture/notes')) return json({ permissions: { push: true } })
    if (url.pathname.includes('/git/trees/')) return json({ truncated: false, tree: [{ path: 'notes', type: 'tree' }, { path: 'notes/note.md', type: 'blob', sha: remote.sha }] })
    if (url.pathname.endsWith('/images/apple.png')) return json({ type: 'file', encoding: 'base64', size: 68, content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aizkAAAAASUVORK5CYII=' })
    if (request.method() === 'PUT') {
      const body = request.postDataJSON()
      if (body.sha !== remote.sha) return route.fulfill({ status: 409, contentType: 'application/json', body: '{}' })
      if (pausePut) { signalPut(); await new Promise(resolve => { releasePut = resolve }) }
      remote = { sha: `saved-${saved.length + 1}`, content: Buffer.from(body.content, 'base64').toString('utf8') }; saved.push(remote)
      return json({ content: { sha: remote.sha } })
    }
    return json({ type: 'file', encoding: 'base64', size: Buffer.byteLength(remote.content), content: Buffer.from(remote.content).toString('base64'), sha: remote.sha })
  })
  await page.goto('http://127.0.0.1:8765/mobile/')
  await page.evaluate(async () => { const store = await import('./store.js'); await store.clear() })
  await page.reload()
  await page.locator('#repository').fill('fixture/notes')
  await page.locator('#token').fill('fixture-scoped-token')
  await page.locator('#connect').click()
  await page.locator('#library').waitFor({ state: 'visible' })
  await page.locator('summary').click()
  await page.getByRole('button', { name: /note.md/ }).first().click()
  await page.locator('#document').waitFor({ state: 'visible' })
  await page.locator('#rendered img').waitFor()
  assert(await page.locator('#rendered h1').textContent() === 'Apple 蘋果', 'Markdown did not render')
  assert(await page.locator('#rendered img').getAttribute('src').then(value => value.startsWith('data:image/')), 'Private image must use authenticated API data')
  assert(await page.locator('#rendered script').count() === 0, 'Executable HTML survived sanitization')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout overflows')
  checks.push('390px Android-sized layout; folder expansion; Markdown and authenticated images; executable HTML removed')
  await page.screenshot({ path: 'C:/Users/darre/Downloads/Floade-need/out/mobile-0.1.17.png', fullPage: true })
  await page.locator('#edit').click()
  await page.locator('#editor').fill('# 手機修改 🍎\n保存 UTF-8\n')
  await page.locator('#save').click()
  await page.waitForFunction(() => document.querySelector('#document-status').textContent.includes('已同步到 GitHub'))
  assert(remote.content.includes('手機修改 🍎'), 'Save lost UTF-8 content')
  checks.push('Edit and save commits correct UTF-8 against opened SHA')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  offline = true; await page.context().setOffline(true)
  await page.locator('#editor').fill('# 離線草稿\n不能遺失\n')
  await page.locator('#save').click()
  await page.waitForFunction(() => document.querySelector('#document-status').textContent.includes('離線草稿已保留'))
  await page.reload()
  await page.locator('#library').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /note.md/ }).first().click()
  await page.locator('#editor').waitFor({ state: 'visible' })
  assert((await page.locator('#editor').inputValue()).includes('不能遺失'), 'Offline reload lost draft')
  checks.push('Service worker reopens app offline; cached files and IndexedDB draft survive reload')
  offline = false; await page.context().setOffline(false)
  remote = { sha: 'desktop-update', content: '# 桌機最新版本\n保留另一端\n' }
  await page.locator('#save').click()
  await page.locator('#conflict').waitFor({ state: 'visible' })
  assert((await page.locator('#editor').inputValue()).includes('不能遺失'), 'Conflict overwrote draft')
  assert((await page.locator('#remote-content').textContent()).includes('桌機最新版本'), 'Latest remote not shown')
  await page.locator('#editor').fill('# 合併後\n手機與桌機都保留\n')
  await page.evaluate(() => { window.confirm = () => true })
  await page.locator('#resolve').click()
  await page.waitForFunction(() => document.querySelector('#document-status').textContent.includes('已同步到 GitHub'))
  assert(remote.content.includes('手機與桌機都保留'), 'Explicit conflict resolution failed')
  checks.push('Remote edits show both versions; explicit reviewed resolution saves using latest SHA')
  pausePut = true
  const waiting = new Promise(resolve => { signalPut = resolve })
  await page.locator('#editor').fill('第一個待儲存內容')
  await page.locator('#save').click(); await waiting
  await page.locator('#editor').fill('儲存期間又輸入的草稿')
  releasePut(); pausePut = false
  await page.waitForFunction(() => document.querySelector('#document-status').textContent.includes('新輸入仍是草稿'))
  const draft = await page.evaluate(async () => (await import('./store.js')).get('draft:fixture/notes@main:notes/note.md'))
  assert(draft.content === '儲存期間又輸入的草稿', 'Pending save cleared later edits')
  checks.push('Typing during a pending save remains a new unsynced draft')
  assert(failures.length === 0, `Browser errors: ${failures.join('; ')}`)
  return { ok: true, checks }
}
