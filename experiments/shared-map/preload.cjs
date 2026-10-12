const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('mapStore',{
 load:()=>ipcRenderer.invoke('map:load'),save:value=>ipcRenderer.invoke('map:save',value),saveNow:value=>ipcRenderer.sendSync('map:save-now',value),ready:()=>ipcRenderer.send('map:ready'),
 onFlush:handler=>ipcRenderer.on('map:flush',(_event,request)=>{try{handler(request.lock);ipcRenderer.send('map:flushed',{id:request.id})}catch(error){ipcRenderer.send('map:flushed',{id:request.id,error:error.message})}}),
 onState:handler=>ipcRenderer.on('map:external-state',(_event,state)=>handler(state))
});
