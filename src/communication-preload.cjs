const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('floadeCommunication', {
  state: (channel, before) => ipcRenderer.invoke('communication:state', channel, before),
  request: (method, params = {}) => ipcRenderer.invoke('communication:request', method, params),
  sync: () => ipcRenderer.invoke('communication:sync'),
  markRead: (channel, cursor) => ipcRenderer.invoke('communication:read', channel, cursor),
  close: () => ipcRenderer.invoke('communication:close'),
  pin: () => ipcRenderer.invoke('communication:pin'),
  external: channel => ipcRenderer.invoke('communication:external', channel),
  onChange: callback => ipcRenderer.on('communication:changed', callback)
})
