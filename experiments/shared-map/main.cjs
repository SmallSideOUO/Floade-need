const {app,BrowserWindow,ipcMain,nativeTheme,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{aiMap}=require('./privacy.cjs');
const {applyOrganization}=require('./organization.cjs');
const profileArg=process.argv.find(a=>a.startsWith('--map-profile='));
const dataDir=profileArg?path.resolve(profileArg.slice(14)):path.join(__dirname,'data');
fs.mkdirSync(dataDir,{recursive:true});app.setPath('userData',path.join(dataDir,'profile'));app.setName('共用地圖');nativeTheme.themeSource='dark';
let window;
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
 const privatePath=path.join(dataDir,'map.private'),legacyPath=path.join(dataDir,'map.json'),publicPath=path.join(dataDir,'ai-map.json');
 function valid(value){if(!value||value.graph?.version!==1||!Array.isArray(value.graph.nodes)||!Array.isArray(value.graph.edges)||Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw new Error('地圖格式無效');return value;}
 function atomic(file,content){const staged=file+'.writing';fs.writeFileSync(staged,content);fs.renameSync(staged,file);}
 function save(value){valid(value);if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 私人資料加密不可用，未寫入明文');atomic(publicPath,JSON.stringify(aiMap(value),null,2));if(fs.existsSync(privatePath))fs.copyFileSync(privatePath,privatePath+'.bak');atomic(privatePath,safeStorage.encryptString(JSON.stringify(value)));for(const file of [legacyPath,legacyPath+'.bak'])if(fs.existsSync(file))fs.unlinkSync(file);return true;}
 function load(){let state;if(fs.existsSync(privatePath))state=valid(JSON.parse(safeStorage.decryptString(fs.readFileSync(privatePath))));else if(fs.existsSync(legacyPath))state=valid(JSON.parse(fs.readFileSync(legacyPath,'utf8')));else state={graph:JSON.parse(fs.readFileSync(path.join(__dirname,'seed.json'),'utf8'))};const planPath=path.join(dataDir,'organization.json');if(fs.existsSync(planPath)&&applyOrganization(state,JSON.parse(fs.readFileSync(planPath,'utf8'))))delete state.view;save(state);return state;}
 ipcMain.handle('map:load',()=>load());ipcMain.handle('map:save',(_event,value)=>save(value));ipcMain.on('map:save-now',(event,value)=>{try{event.returnValue=save(value)}catch(error){event.returnValue={error:error.message}}});
 app.whenReady().then(()=>{window=new BrowserWindow({width:1320,height:900,minWidth:800,minHeight:560,show:false,title:'共用地圖',backgroundColor:'#0d0d0f',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.loadFile(path.join(__dirname,'index.html'));window.once('ready-to-show',()=>{window.show();window.focus()});});
 app.on('window-all-closed',()=>app.quit());
}
