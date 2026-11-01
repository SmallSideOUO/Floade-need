const { contextBridge, ipcRenderer, webUtils } = require('electron')
contextBridge.exposeInMainWorld('floadeLauncher', {
  hover: entered => ipcRenderer.invoke('launcher:hover', entered),
  drag: phase => ipcRenderer.invoke('launcher:drag', phase),
  close: () => ipcRenderer.invoke('launcher:close'),
  resize: height => ipcRenderer.invoke('launcher:resize', height),
  sizeDrag: phase => ipcRenderer.invoke('launcher:size-drag', phase),
  interacting: value => ipcRenderer.invoke('launcher:interacting', value),
  mutate: request => ipcRenderer.invoke('launcher:mutate', request),
  open: document => ipcRenderer.invoke('launcher:open', document),
  action: (name, folderPath) => ipcRenderer.invoke('launcher:action', name, folderPath),
  transfer: (method, params) => ipcRenderer.invoke('launcher:transfer', method, params),
  offerFiles: files => ipcRenderer.invoke('launcher:transfer', 'transfers.offer', { paths: files.map(file => webUtils.getPathForFile(file)) }),
  dragFiles: (deviceId, offerIds) => ipcRenderer.send('launcher:transfer-drag', deviceId, offerIds),
  onTransfers: callback => ipcRenderer.on('launcher:transfers', (_event, data) => callback(data)),
  onData: callback => ipcRenderer.on('launcher:data', (_event, data) => callback(data)),
  onError: callback => ipcRenderer.on('launcher:error', (_event, message) => callback(message)),
  onFocus: callback => ipcRenderer.on('launcher:focus', callback)
})
