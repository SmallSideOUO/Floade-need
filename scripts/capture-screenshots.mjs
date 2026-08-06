import { app, BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(root, 'docs', 'images')
const preload = path.join(root, 'scripts', 'screenshot-preload.cjs')

const fixtures = [
  { name: 'markdown', file: 'markdown-preview.html', width: 480, height: 560 },
  { name: 'picker', file: 'preview-picker.html', width: 540, height: 550 },
  { name: 'settings', file: 'settings.html', width: 560, height: 650 },
  { name: 'translation', file: 'translation-result.html', width: 560, height: 400 }
]

app.on('window-all-closed', () => {})

async function captureFixture(fixture) {
  const window = new BrowserWindow({
    width: fixture.width,
    height: fixture.height,
    frame: false,
    transparent: true,
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  await window.loadFile(path.join(root, 'src', fixture.file), { query: { lang: 'en' } })
  await new Promise(resolve => setTimeout(resolve, 250))
  const image = await window.webContents.capturePage()
  await fs.writeFile(path.join(outputDirectory, `${fixture.name}.png`), image.toPNG())
  window.destroy()
}

app.whenReady().then(async () => {
  await fs.mkdir(outputDirectory, { recursive: true })
  for (const fixture of fixtures) await captureFixture(fixture)
  app.quit()
})
