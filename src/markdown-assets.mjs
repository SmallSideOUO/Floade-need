import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { managedDocumentPath } from './launcher-files.mjs'

const inside = (root, target) => {
  const relative = path.relative(root, target)
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
export function saveMarkdownImage(folderPath, relativePath, png) {
  if (!Buffer.isBuffer(png) || png.length > 25 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid image')
  const root = fs.realpathSync(folderPath)
  const document = managedDocumentPath(root, relativePath)
  if (!fs.existsSync(document)) throw new Error('Document unavailable')
  const directory = path.join(path.dirname(document), 'images')
  if (fs.existsSync(directory) && !inside(root, fs.realpathSync(directory))) throw new Error('Image directory is outside the folder')
  fs.mkdirSync(directory, { recursive: true })
  if (!inside(root, fs.realpathSync(directory))) throw new Error('Image directory is outside the folder')
  const name = `floade-${randomUUID()}.png`
  fs.writeFileSync(path.join(directory, name), png, { flag: 'wx' })
  return `images/${name}`
}

export function resolveMarkdownImage(folderPath, url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:' || parsed.host) return null
    const root = fs.realpathSync(folderPath)
    const target = fs.realpathSync(fileURLToPath(parsed))
    if (!inside(root, target) || path.relative(root, target).split(path.sep).some(part => part.toLowerCase() === '.git')
      || !/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(target) || !fs.statSync(target).isFile()) return null
    return pathToFileURL(target).href
  } catch { return null }
}
