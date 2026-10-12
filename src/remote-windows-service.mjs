import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

export function createRemoteWindowsService(runtimeDirectory) {
  let installing = false
  let lastExitCode = null
  const executable = path.join(runtimeDirectory, 'FloadeRemote.exe')
  async function status() {
    if (process.platform !== 'win32') return { supported: false, ready: false }
    const script = `$ErrorActionPreference='Stop'; $s=Get-CimInstance Win32_Service -Filter "Name='FloadeRemote'"; $p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); @{installed=($null -ne $s); running=($s.State -eq 'Running'); startMode=$s.StartMode; account=$s.StartName; path=$s.PathName; processElevated=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress`
    const native = await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000 }, (error, stdout) => error ? reject(Object.assign(new Error('Windows service status unavailable.'), { apiCode: 'REMOTE_SERVICE_FAILED' })) : resolve(JSON.parse(stdout))))
    const directory = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'FloadeRemote')
    const expected = path.join(directory, 'FloadeRemote.exe')
    const protectedPath = typeof native.path === 'string' && native.path.toLowerCase() === `"${expected}" --service`.toLowerCase()
    let binaryMatchesBundle = false
    if (protectedPath) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, 'floade-build.json'), 'utf8').replace(/^\uFEFF/, ''))
        binaryMatchesBundle = ['FloadeRemote.exe', 'librustdesk.dll', 'data/app.so'].every(name =>
          createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex').toLowerCase() === manifest.files[name]?.toLowerCase())
      } catch { /* Incomplete installations are never advertised as ready. */ }
    }
    return { supported: true, ...native, protectedPath, binaryMatchesBundle,
      ready: Boolean(native.running && native.startMode === 'Auto' && native.account === 'LocalSystem' && protectedPath && binaryMatchesBundle),
      installing, lastExitCode, consent: 'Windows UAC approval is required for installation; no OS consent bypass',
      capabilities: ['administrator applications', 'UAC secure desktop', 'Windows login screen'],
      note: 'Service readiness does not prove an end-to-end secure-desktop session.' }
  }
  async function install() {
    if (process.platform !== 'win32') throw Object.assign(new Error('Windows service installation is supported on Windows only.'), { apiCode: 'REMOTE_UNSUPPORTED' })
    if (installing) return { requested: false, pending: true }
    // Verify every shipped file before asking the native installer to copy it into Program Files.
    const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, 'floade-build.json'), 'utf8').replace(/^\uFEFF/, ''))
    if (!manifest.files?.['FloadeRemote.exe'] || !manifest.files?.['librustdesk.dll']) throw new Error('Incomplete remote runtime.')
    for (const [name, expected] of Object.entries(manifest.files)) {
      if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..') || !/^[a-f\d]{64}$/i.test(expected) ||
          createHash('sha256').update(fs.readFileSync(path.join(runtimeDirectory, name))).digest('hex').toLowerCase() !== expected.toLowerCase()) {
        throw Object.assign(new Error('Remote runtime integrity check failed.'), { apiCode: 'REMOTE_RUNTIME_INVALID' })
      }
    }
    const child = spawn(executable, ['--silent-install', 'printer=0'], {
      cwd: runtimeDirectory, detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, FLOADE_RUSTDESK_TEST_PROFILE: '0', FLOADE_RUSTDESK_LOW_LATENCY: '1' }
    })
    installing = true
    lastExitCode = null
    child.once('error', () => { installing = false; lastExitCode = -1 })
    child.once('exit', code => { installing = false; lastExitCode = code })
    child.unref()
    return { requested: true, pending: true, requiresWindowsConsent: true,
      message: 'Approve the Windows UAC request, then query remote.service.status. The native installer may restart the remote engine.' }
  }
  return { status, install }
}
