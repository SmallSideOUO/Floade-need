const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadeTranslation', {
  onData: callback => ipcRenderer.once('translation-result:data', (_event, data) => callback(data)),
  togglePin: () => ipcRenderer.invoke('translation-result:toggle-pin'),
  copy: text => ipcRenderer.invoke('translation-result:copy', text),
  translate: request => ipcRenderer.invoke('translation-result:translate', request),
  startVoice: request => ipcRenderer.invoke('translation-result:voice-start', request),
  stopVoice: id => ipcRenderer.invoke('translation-result:voice-stop', id),
  onVoice: callback => ipcRenderer.on('translation-result:voice', (_event, data) => callback(data)),
  close: () => ipcRenderer.invoke('translation-result:close')
})
