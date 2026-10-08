// Exercise the real NSIS downloader in an isolated profile. Never install in QA.
const { app } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const yaml = require('js-yaml')

const root = path.resolve(__dirname, '..')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'floade-update-qa-'))
app.setPath('userData', temporary)
app.setName('floade-update-qa')
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => { console.error('Update QA timed out'); app.exit(1) }, 180000)

app.whenReady().then(async () => {
  const { NsisUpdater } = require('electron-updater')
  const { createAppUpdater } = await import(pathToFileURL(path.join(root, 'src', 'app-updater.mjs')).href)
  const manifest = yaml.load(fs.readFileSync(path.join(root, 'dist', 'latest.yml'), 'utf8'))
  const descriptor = manifest.files.find(file => file.url.endsWith('.exe'))
  const installer = path.join(root, 'dist', descriptor.url)
  const installerHash = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64')
  assert.equal(descriptor.sha512, installerHash)
  assert.equal(descriptor.size, fs.statSync(installer).size)
  const config = yaml.load(fs.readFileSync(path.join(root, 'dist', 'win-unpacked', 'resources', 'app-update.yml'), 'utf8'))
  assert.equal(config.provider, 'github')
  assert.equal(config.owner, 'SmallSideOUO')
  assert.equal(config.repo, 'Floade-need')
  let corrupt = true
  let server
  let service
  try {
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/latest.yml') { response.end(fs.readFileSync(path.join(root, 'dist', 'latest.yml'))); return }
      if (url.pathname === '/' + descriptor.url) {
        if (corrupt) { response.end('corrupted installer'); return }
        response.setHeader('Content-Length', descriptor.size)
        fs.createReadStream(installer).pipe(response)
        return
      }
      response.writeHead(404); response.end()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const makeService = (provider, name) => {
      const updateConfig = path.join(temporary, name + '.yml')
      fs.writeFileSync(updateConfig, yaml.dump({ ...config, updaterCacheDirName: name }))
      const updater = new NsisUpdater()
      let lastError
      updater.on('error', error => { lastError = error })
      // Pretend to be the previous release only in this test process.
      updater.currentVersion = new updater.currentVersion.constructor('0.1.17')
      updater.forceDevUpdateConfig = true
      updater.updateConfigPath = updateConfig
      updater.setFeedURL(provider)
      Object.defineProperty(updater.app, 'baseCachePath', { get: () => temporary })
      updater.disableDifferentialDownload = true
      updater.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
      updater.quitAndInstall = () => { throw new Error('QA must not run an installer') }
      const service = createAppUpdater({ updater, currentVersion: '0.1.17' })
      return { service, updater, error: () => lastError }
    }
    const local = { provider: 'generic', url: `http://127.0.0.1:${server.address().port}` }
    let fixture = makeService(local, 'corrupt')
    service = fixture.service
    assert.equal((await service.check()).status, 'error')
    assert.match(fixture.error()?.message || '', /checksum|sha512/i)
    assert.equal(service.install(), false)
    service.dispose()
    corrupt = false
    fixture = makeService(process.argv.includes('--github') ? config : local, 'valid')
    service = fixture.service
    const state = await service.check()
    assert.equal(state.status, 'ready', fixture.error()?.stack || JSON.stringify(state))
    assert.equal(state.availableVersion, manifest.version)
    assert.equal(fixture.updater.autoInstallOnAppQuit, false)
    const downloaded = fixture.updater.installerPath
    assert.ok(downloaded)
    assert.equal(crypto.createHash('sha512').update(fs.readFileSync(downloaded)).digest('base64'), installerHash)
    const report = { ok: true, source: process.argv.includes('--github') ? 'GitHub Releases' : 'local fixture', version: manifest.version,
      checks: ['manifest SHA-512 and size match the built installer', 'embedded feed targets the intended GitHub repository', 'corrupt download is rejected and cannot install', 'real NSIS updater downloads and verifies the installer', 'normal quit never installs; QA never invokes the installer'] }
    fs.writeFileSync(path.join(root, 'dist', process.argv.includes('--github') ? 'app-update-github-qa.json' : 'app-update-local-qa.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    service?.dispose()
    await new Promise(resolve => server?.close(resolve) || resolve())
  }
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  clearTimeout(timeout)
  await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {})
  app.exit(process.exitCode || 0)
})
