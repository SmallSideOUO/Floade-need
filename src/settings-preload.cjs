const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadeSettings', {
  onState: callback => ipcRenderer.once('settings:state', (_event, state) => callback(state)),
  setShortcut: shortcut => ipcRenderer.invoke('settings:set-shortcut', shortcut),
  setTranslationShortcut: shortcut => ipcRenderer.invoke('settings:set-translation-shortcut', shortcut),
  setOpacity: opacity => ipcRenderer.invoke('settings:set-opacity', opacity),
  setLanguage: language => ipcRenderer.invoke('settings:set-language', language),
  setStartAtLogin: enabled => ipcRenderer.invoke('settings:set-start-at-login', enabled),
  setAutoPull: enabled => ipcRenderer.invoke('settings:set-auto-pull', enabled),
  openMobile: () => ipcRenderer.invoke('settings:open-mobile'),
  close: () => ipcRenderer.invoke('settings:close')
})
