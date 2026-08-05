const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadePicker', {
  onFiles: callback => ipcRenderer.once('picker:files', (_event, payload) => callback(payload)),
  openFiles: files => ipcRenderer.invoke('picker:open-files', files),
  togglePin: () => ipcRenderer.invoke('picker:toggle-pin'),
  close: () => ipcRenderer.invoke('picker:close')
})
