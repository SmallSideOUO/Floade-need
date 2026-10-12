const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('floadeRemote', {
  request: (method, params = {}) => ipcRenderer.invoke('remote:request', { method, params }),
  close: () => ipcRenderer.invoke('remote:close'),
  legal: () => ipcRenderer.invoke('remote:legal'),
  onView: callback => ipcRenderer.on('remote:view', (_event, view) => callback(view))
})
