const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('floadeSettings', {
  onState: callback => ipcRenderer.once('settings:state', (_event, state) => callback(state)),
  setShortcut: shortcut => ipcRenderer.invoke('settings:set-shortcut', shortcut),
  setTranslationShortcut: shortcut => ipcRenderer.invoke('settings:set-translation-shortcut', shortcut),
  setOpacity: opacity => ipcRenderer.invoke('settings:set-opacity', opacity),
  setLanguage: language => ipcRenderer.invoke('settings:set-language', language),
  setStartAtLogin: enabled => ipcRenderer.invoke('settings:set-start-at-login', enabled),
  setAutoPull: enabled => ipcRenderer.invoke('settings:set-auto-pull', enabled),
  setAutoUpdate: enabled => ipcRenderer.invoke('settings:set-auto-update', enabled),
  checkUpdate: () => ipcRenderer.invoke('settings:check-update'),
  installUpdate: () => ipcRenderer.invoke('settings:install-update'),
  onAppUpdate: callback => ipcRenderer.on('settings:app-update', (_event, state) => callback(state)),
  openMobile: () => ipcRenderer.invoke('settings:open-mobile'),
  close: () => ipcRenderer.invoke('settings:close')
})
