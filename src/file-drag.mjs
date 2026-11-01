import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

export async function createFileDrag({ appPath, dataDirectory, transfer }) {
  if (process.platform !== 'win32') return { start: async () => { throw new Error('Explorer drag-out is available on Windows.') } }
  const source = fs.readFileSync(path.join(appPath, 'src/file-drag.cs'))
  const directory = path.join(dataDirectory, 'file-transfer', 'native')
  fs.mkdirSync(directory, { recursive: true })
  const name = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const executable = path.join(directory, `drag-${name}.exe`)
  if (!fs.existsSync(executable)) {
    const file = path.join(directory, `drag-${name}.cs`)
    fs.writeFileSync(file, source)
    const compiler = ['Framework64', 'Framework'].map(part => path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', part, 'v4.0.30319', 'csc.exe')).find(item => fs.existsSync(item))
    if (!compiler) throw new Error('The Windows drag provider requires .NET Framework 4.')
    await promisify(execFile)(compiler, ['/nologo', '/target:winexe', '/platform:anycpu', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${executable}`, file], { windowsHide: true, timeout: 30000 })
  }
  return {
    executable,
    async start(deviceId, offerIds) {
      const session = await transfer.drag(deviceId, offerIds)
      const child = spawn(executable, [session.url], { windowsHide: true, stdio: 'ignore' })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      const code = await new Promise(resolve => child.once('exit', resolve))
      if (code !== 0 && code !== 1) throw new Error('Windows could not finish this drag. Partial downloads are kept; drag the item again to resume.')
      return { completed: code === 0 }
    }
  }
}
