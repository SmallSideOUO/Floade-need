const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadeTranslation', {
  onData: callback => ipcRenderer.once('translation-result:data', (_event, data) => callback(data)),
  togglePin: () => ipcRenderer.invoke('translation-result:toggle-pin'),
  copy: text => ipcRenderer.invoke('translation-result:copy', text),
  close: () => ipcRenderer.invoke('translation-result:close')
})
