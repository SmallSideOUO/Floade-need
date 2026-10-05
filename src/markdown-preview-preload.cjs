const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadePreview', {
  onDocument: callback => ipcRenderer.once('preview:document', (_event, document) => callback(document)),
  onChange: callback => ipcRenderer.on('preview:changed', (_event, content) => callback(content)),
  read: () => ipcRenderer.invoke('preview:read'),
  pasteImage: bytes => ipcRenderer.invoke('preview:paste-image', bytes),
  resolveImage: url => ipcRenderer.invoke('preview:resolve-image', url),
  openLink: url => ipcRenderer.invoke('preview:open-link', url),
  save: (content, base) => ipcRenderer.invoke('preview:save', content, base),
  saveSync: (content, base) => ipcRenderer.sendSync('preview:save-sync', content, base),
  togglePin: () => ipcRenderer.invoke('preview:toggle-pin'),
  close: () => ipcRenderer.invoke('preview:close')
})
