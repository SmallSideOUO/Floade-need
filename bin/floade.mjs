#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestLocalApi, parseApiArguments } from '../src/local-api-client.mjs'

const require = createRequire(import.meta.url)
const electron = require('electron-runtime')
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const controlSocket = process.platform === 'win32'
  ? '\\\\.\\pipe\\floade-local-data-control'
  : path.join(os.tmpdir(), 'floade-local-data-control.sock')
const cliLanguage = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
const cliMessages = {
  en: {
    stopped: 'Floade stopped.',
    notRunning: 'Floade is not running.',
    restarted: 'Floade restarted.',
    unknown: 'Unknown command: {command}',
    started: 'Floade is running in the background.'
  },
  'zh-TW': {
    stopped: 'Floade 已停止。',
    notRunning: 'Floade 目前沒有執行。',
    restarted: 'Floade 已重新啟動。',
    unknown: '未知指令：{command}',
    started: 'Floade 已在背景執行。'
  }
}

function cliText(key, variables = {}) {
  return cliMessages[cliLanguage][key].replace(/\{(\w+)\}/g, (_match, name) => String(variables[name] ?? ''))
}

function launch() {
  const child = spawn(electron, [packageRoot, '--background'], {
    detached: true,
    stdio: 'ignore'
  })

  child.unref()
}

function sendCommand(command) {
  return new Promise(resolve => {
    const socket = net.createConnection(controlSocket)
    let settled = false

    const finish = result => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(1500)
    socket.once('connect', () => socket.write(`${command}\n`))
    socket.once('data', data => finish(data.toString('utf8').trim() === 'ok'))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

async function waitUntilStopped() {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (!(await sendCommand('ping'))) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

const command = process.argv[2]?.toLowerCase()

if (command === 'api') {
  try {
    const request = parseApiArguments(process.argv.slice(3))
    let response
    try { response = await requestLocalApi(request) } catch (error) {
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
      launch()
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200))
        try { response = await requestLocalApi(request); break } catch (retryError) {
          if (!['ENOENT', 'ECONNREFUSED'].includes(retryError.code)) throw retryError
        }
      }
      if (!response) throw new Error('Floade did not start. Open Floade and retry.')
    }
    console.log(JSON.stringify(response))
    if (!response.ok) process.exitCode = 1
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: { code: 'CLIENT_ERROR', message: error.message } }))
    process.exitCode = 1
  }
} else if (command === 'stop') {
  if (await sendCommand('stop')) {
    console.log(cliText('stopped'))
  } else {
    console.log(cliText('notRunning'))
  }
} else if (command === 'restart') {
  await sendCommand('stop')
  await waitUntilStopped()
  launch()
  console.log(cliText('restarted'))
} else if (command) {
  console.error(cliText('unknown', { command }))
  process.exitCode = 1
} else {
  launch()
  console.log(cliText('started'))
}
