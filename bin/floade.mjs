#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const controlSocket = process.platform === 'win32'
  ? '\\\\.\\pipe\\floade-local-data-control'
  : path.join(os.tmpdir(), 'floade-local-data-control.sock')

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

if (command === 'stop') {
  if (await sendCommand('stop')) {
    console.log('Floade 已停止。')
  } else {
    console.log('Floade 目前沒有執行。')
  }
} else if (command === 'restart') {
  await sendCommand('stop')
  await waitUntilStopped()
  launch()
  console.log('Floade 已重新啟動。')
} else if (command) {
  console.error(`未知指令：${command}`)
  process.exitCode = 1
} else {
  launch()
  console.log('Floade 已在背景執行。')
}
