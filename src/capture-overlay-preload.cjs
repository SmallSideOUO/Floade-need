const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadeCapture', {
  select: rectangle => ipcRenderer.send('capture:select', rectangle),
  cancel: () => ipcRenderer.send('capture:cancel')
})
