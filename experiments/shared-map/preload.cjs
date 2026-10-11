const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mapStore',{load:()=>ipcRenderer.invoke('map:load'),save:value=>ipcRenderer.invoke('map:save',value),saveNow:value=>ipcRenderer.sendSync('map:save-now',value)});
