import fs from 'node:fs'
import path from 'node:path'

export function documentName(value) {
  if (typeof value !== 'string') throw new Error('invalidName')
  const name = value.trim()
  if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('invalidName')
  const result = /\.md$/i.test(name) ? name : `${name}.md`
  if (result.length > 240) throw new Error('invalidName')
  return result
}

export function managedDocumentPath(folderPath, relativePath) {
  if (typeof relativePath !== 'string' || /[<>:"|?*\x00-\x1f]/.test(relativePath) || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).some(part => part.toLowerCase() === '.git' || part === '..')) throw new Error('invalidPath')
  const root = fs.realpathSync(folderPath)
  const target = path.resolve(root, relativePath)
  const inside = value => { const relative = path.relative(root, value); return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }
  if (!inside(target) || path.extname(target).toLowerCase() !== '.md'
    || !inside(path.join(fs.realpathSync(path.dirname(target)), path.basename(target)))) throw new Error('invalidPath')
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isFile()
    || !inside(fs.realpathSync(target)))) throw new Error('invalidPath')
  return target
}

export function createLauncherFile(folderPath, name) {
  const relativePath = documentName(name)
  const target = managedDocumentPath(folderPath, relativePath)
  fs.writeFileSync(target, '', { flag: 'wx' })
  return relativePath
}

export function renameLauncherFile(folderPath, relativePath, name) {
  const source = managedDocumentPath(folderPath, relativePath)
  const next = path.posix.join(path.posix.dirname(relativePath.replaceAll('\\', '/')), documentName(name))
  const target = managedDocumentPath(folderPath, next)
  if (source === target) return next
  if (process.platform === 'win32' && source.toLowerCase() === target.toLowerCase()) fs.renameSync(source, target)
  else {
    // Claim the destination without overwriting an existing document.
    fs.linkSync(source, target)
    try { fs.unlinkSync(source) } catch (error) { fs.unlinkSync(target); throw error }
  }
  return next
}
