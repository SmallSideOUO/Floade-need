const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadePreview', {
  onDocument: callback => ipcRenderer.once('preview:document', (_event, document) => callback(document)),
  save: content => ipcRenderer.invoke('preview:save', content),
  saveSync: content => ipcRenderer.sendSync('preview:save-sync', content),
  togglePin: () => ipcRenderer.invoke('preview:toggle-pin'),
  close: () => ipcRenderer.invoke('preview:close')
})
