const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadeSettings', {
  onState: callback => ipcRenderer.once('settings:state', (_event, state) => callback(state)),
  setShortcut: shortcut => ipcRenderer.invoke('settings:set-shortcut', shortcut),
  setTranslationShortcut: shortcut => ipcRenderer.invoke('settings:set-translation-shortcut', shortcut),
  setOpacity: opacity => ipcRenderer.invoke('settings:set-opacity', opacity),
  setLanguage: language => ipcRenderer.invoke('settings:set-language', language),
  close: () => ipcRenderer.invoke('settings:close')
})
