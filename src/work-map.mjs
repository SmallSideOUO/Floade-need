import { spawn } from 'node:child_process'

export function openWorkMap({ appPath, isPackaged, executable = process.execPath, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [...(isPackaged ? [] : [appPath]), '--work-map'], {
      detached: true, stdio: 'ignore', windowsHide: false
    })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}
