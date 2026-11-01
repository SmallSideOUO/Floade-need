const { app } = require('electron')
app.whenReady().then(() => import('./test-window-pin.mjs')).catch(error => {
  console.error(error)
  app.exit(1)
})
