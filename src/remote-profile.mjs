import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createDecipheriv } from 'node:crypto'
import { execFileSync } from 'node:child_process'

function unprotectKey(encrypted) {
  // DPAPI input/output stays on private child-process pipes, never command lines.
  const script = 'Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'
  return Buffer.from(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { input: encrypted.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim(), 'base64')
}

function readWithProtectedKey(encrypted, encodedKey, unwrap) {
  const wrapped = Buffer.from(encodedKey, 'base64')
  if (wrapped.length > 16384 || wrapped.subarray(0, 5).toString() !== 'DPAPI' || encrypted.subarray(0, 3).toString() !== 'v10' || encrypted.length < 31) throw new Error('Unsupported saved credential key.')
  const key = unwrap(wrapped.subarray(5))
  let plaintext
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15))
    decipher.setAuthTag(encrypted.subarray(-16))
    plaintext = Buffer.concat([decipher.update(encrypted.subarray(15, -16)), decipher.final()])
    return plaintext.toString('utf8')
  } finally { key.fill(0); plaintext?.fill(0) }
}

// Retain the DPAPI-wrapped origin key with a credential so an MSIX/non-MSIX
// launch can read it without replacing either profile's Chromium Local State.
export function readRemoteCredential(device, source, safeStorage, unwrap = unprotectKey) {
  const encrypted = Buffer.from(device.credential, 'base64')
  let password
  try { password = safeStorage.decryptString(encrypted) }
  catch (error) {
    if (!device.credentialKey) throw error
    password = readWithProtectedKey(encrypted, device.credentialKey, unwrap)
    return { password, credentialKey: device.credentialKey }
  }
  let credentialKey = device.credentialKey
  if (encrypted.subarray(0, 3).toString() === 'v10') {
    try {
      const localState = JSON.parse(fs.readFileSync(path.join(path.dirname(source), 'Local State'), 'utf8'))
      const candidate = localState.os_crypt?.encrypted_key
      if (candidate && candidate !== credentialKey && readWithProtectedKey(encrypted, candidate, unwrap) === password) credentialKey = candidate
    } catch { /* A successful native decrypt remains usable even if key metadata cannot be retained. */ }
  }
  return { password, credentialKey }
}

export function migrateRemoteCredentials(stored, source, safeStorage, unwrap = unprotectKey) {
  let key
  try {
    return { ...stored, devices: stored.devices.map(device => {
      if (!device.credential) return device
      const encrypted = Buffer.from(device.credential, 'base64')
      try { safeStorage.decryptString(encrypted); return device } catch {}
      if (!safeStorage?.isEncryptionAvailable()) throw new Error('Protected storage is required to recover saved remote passwords.')
      if (!key) {
        const localState = JSON.parse(fs.readFileSync(path.join(path.dirname(source), 'Local State'), 'utf8'))
        const wrapped = Buffer.from(localState.os_crypt.encrypted_key, 'base64')
        if (wrapped.subarray(0, 5).toString() !== 'DPAPI') throw new Error('Unsupported legacy remote password key.')
        key = unwrap(wrapped.subarray(5))
      }
      if (encrypted.subarray(0, 3).toString() !== 'v10' || encrypted.length < 31) throw new Error('Unsupported legacy remote password format.')
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(3, 15))
      decipher.setAuthTag(encrypted.subarray(-16))
      const plaintext = Buffer.concat([decipher.update(encrypted.subarray(15, -16)), decipher.final()])
      try { return { ...device, credential: safeStorage.encryptString(plaintext.toString('utf8')).toString('base64') } }
      finally { plaintext.fill(0) }
    }) }
  } finally { key?.fill(0) }
}

// Desktop apps started by an MSIX app can inherit its AppData virtualization.
// Normal Windows startup cannot see that private copy of Floade's profile.
export function remoteProfileSources(dataDirectory, { platform = process.platform, localAppData = process.env.LOCALAPPDATA } = {}) {
  if (platform !== 'win32' || !localAppData || path.basename(dataDirectory).toLowerCase() !== 'floade-local-data') return []
  const packages = path.join(localAppData, 'Packages')
  try {
    return fs.readdirSync(packages, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('OpenAI.Codex_'))
      .map(entry => path.join(packages, entry.name, 'LocalCache', 'Roaming', 'floade-local-data', 'remote.json'))
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

export function recoverRemoteProfile(file, sources, validateSettings, safeStorage) {
  // An existing profile, including an intentionally empty device list, wins.
  if (fs.existsSync(file)) return
  const candidates = []
  for (const source of sources) {
    if (path.resolve(source) === path.resolve(file)) continue
    try {
      const bytes = fs.readFileSync(source)
      const stored = JSON.parse(bytes.toString('utf8'))
      validateSettings(stored.settings || {})
      if (!Array.isArray(stored.devices) || !stored.devices.length || stored.devices.some(device =>
        !device || typeof device.deviceId !== 'string' || !/^\d{6,16}$/.test(device.deviceId) ||
        (device.credential !== undefined && (typeof device.credential !== 'string' || device.credential.length > 16384)))) continue
      candidates.push({ source, bytes, stored, modified: fs.statSync(source).mtimeMs })
    } catch (error) { if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code) && !(error instanceof SyntaxError) && error.apiCode !== 'INVALID_PARAMS') throw error }
  }
  const candidate = candidates.sort((a, b) => b.modified - a.modified)[0]
  if (!candidate) return
  const restored = migrateRemoteCredentials(candidate.stored, candidate.source, safeStorage)
  const bytes = restored.devices.every((device, index) => device.credential === candidate.stored.devices[index].credential)
    ? candidate.bytes : Buffer.from(JSON.stringify(restored, null, 2))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.recovery-${randomUUID()}`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try {
    // Linking the flushed file is atomic and cannot overwrite a concurrent save.
    try { fs.linkSync(temporary, file) } catch (error) { if (error.code === 'EEXIST') return; throw error }
  } finally { fs.unlinkSync(temporary) }
  // Keep the original bytes as a backup, but retire the shadow file so future
  // launches from the packaged parent also use the restored real profile.
  try { fs.renameSync(candidate.source, `${candidate.source}.migrated-${Date.now()}`) }
  catch (error) { console.warn(`Floade remote: profile restored; shadow backup could not be renamed (${error.code}).`) }
}
