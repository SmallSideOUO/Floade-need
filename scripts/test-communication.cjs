const { app } = require('electron')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.whenReady().then(() => import('./test-communication.mjs')).catch(error => { console.error(error); app.exit(1) })
