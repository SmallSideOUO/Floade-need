const { app } = require('electron')

// Electron must finish startup before the ESM harness performs asynchronous I/O.
app.whenReady().then(() => import('./test-preview.mjs')).catch(error => {
  console.error(error)
  app.exit(1)
})
