import fs from 'node:fs'
import path from 'node:path'
import { translate } from './i18n-main.mjs'

export async function openFloadeCut({ openPath, env = process.env, exists = fs.existsSync, locale = 'en' }) {
  const candidates = [
    [env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Floade Cut.lnk'],
    [env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Floade Cut.lnk'],
    [env.LOCALAPPDATA, 'Programs', 'FloadeCut', 'Floade.exe'],
    [env.ProgramFiles, 'FloadeCut', 'Floade.exe'],
    [env['ProgramFiles(x86)'], 'FloadeCut', 'Floade.exe']
  ].filter(parts => parts[0]).map(parts => path.win32.join(...parts))
  let failure
  for (const target of new Set(candidates)) {
    if (!exists(target)) continue
    try {
      const error = await openPath(target)
      if (!error) return
      failure = error
    } catch (error) { failure = error.message || String(error) }
  }
  throw new Error(translate(locale, failure ? 'floadeCut.launchFailed' : 'floadeCut.notInstalled', { message: failure }))
}
