'use strict';
const {app,BrowserWindow,ipcMain,nativeTheme,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {aiMap}=require('./privacy.cjs'),{applyOrganization}=require('./organization.cjs'),{materialize}=require('./connections.cjs');
const {ApiError,applyOperations,createApi}=require('./api.cjs');
const {profilePath,legacyProfilePaths,migrateBestLegacy}=require('./profile.cjs');
const tree=require('./tree.cjs');
const profileArg=process.argv.find(a=>a.startsWith('--map-profile='));
const hiddenTest=Boolean(profileArg&&process.argv.includes('--map-test-hidden'));
const dataDir=profileArg?path.resolve(profileArg.slice(14)):profilePath();
const iconPath=path.join(__dirname,'..','..','assets',process.platform==='win32'?'tray.ico':'tray.png');
// Chromium loads the safeStorage key from Local State during startup. Copy it
// with the encrypted files before changing userData and before app readiness.
if(!profileArg)migrateBestLegacy([...legacyProfilePaths({appData:app.getPath('appData')}),path.join(__dirname,'data')],dataDir);
fs.mkdirSync(dataDir,{recursive:true});app.setPath('userData',path.join(dataDir,'profile'));app.setName('Floade Work Map');nativeTheme.themeSource='dark';
let window,screenshotWindow,state,api,rendererReady=false;
const pendingFlush=new Map(),auditDir=path.join(dataDir,'ai-history');
const privatePath=path.join(dataDir,'map.private'),legacyPath=path.join(dataDir,'map.json'),publicPath=path.join(dataDir,'ai-map.json'),runtimePath=path.join(dataDir,'api-runtime.json');
function atomic(file,content){const staged=file+'.writing';fs.writeFileSync(staged,content);fs.renameSync(staged,file)}
function valid(value){if(!value||value.graph?.version!==1||!Array.isArray(value.graph.nodes)||!Array.isArray(value.graph.edges)||Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw new Error('地圖格式無效');if(value.graph.treeMode)tree.validate(value.graph);return value}
function encrypt(value){if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 私人資料加密不可用，未寫入明文');return safeStorage.encryptString(JSON.stringify(value))}
function persist(next){
  valid(next);const encrypted=encrypt(next);
  if(fs.existsSync(privatePath))fs.copyFileSync(privatePath,privatePath+'.bak');atomic(privatePath,encrypted);state=next;
  try{atomic(publicPath,JSON.stringify({...aiMap(state),revision:state.revision},null,2))}catch(error){if(fs.existsSync(publicPath))fs.unlinkSync(publicPath);throw error}
  for(const file of [legacyPath,legacyPath+'.bak'])if(fs.existsSync(file))fs.unlinkSync(file);
}
function readEncrypted(file){return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))}
function history(){return fs.readdirSync(auditDir).filter(name=>name.endsWith('.private')).map(name=>{const file=path.join(auditDir,name),record=readEncrypted(file);if(record.status==='prepared'){record.status=state.lastAIChange===record.id?'committed':'interrupted';atomic(file,encrypt(record))}return record}).sort((a,b)=>b.time.localeCompare(a.time)||b.revision-a.revision)}
function load(){
  let loaded=fs.existsSync(privatePath)?valid(readEncrypted(privatePath)):fs.existsSync(legacyPath)?valid(JSON.parse(fs.readFileSync(legacyPath,'utf8'))):{graph:JSON.parse(fs.readFileSync(path.join(__dirname,'seed.json'),'utf8'))};
  const planPath=path.join(dataDir,'organization.json');if(!loaded.graph.treeMode&&fs.existsSync(planPath)&&applyOrganization(loaded,JSON.parse(fs.readFileSync(planPath,'utf8'))))delete loaded.view;
  materialize(loaded.graph);for(const node of loaded.graph.nodes)if(node.title==='新念頭')node.title='新想法';loaded.revision=Number.isSafeInteger(loaded.revision)?loaded.revision:0;persist(loaded);
  fs.mkdirSync(auditDir,{recursive:true});history();
  if(!state.graph.treeMode){
    change({requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:'Floade',reason:'依樹狀圖規格轉換為唯一上層與固定上下分層；原圖保留在加密修改紀錄中。',operations:[{op:'tree.enable',id:'strict-tree'}]});
    delete state.view;persist(state);
  }
}
function saveUI(value){
  valid(value);if(value.revision!==state.revision)throw new ApiError(409,'地圖已更新，請重新載入');
  if(state.graph.treeMode&&!value.graph.treeMode)throw new ApiError(400,'地圖必須維持樹狀結構');
  tree.arrange(value.graph);
  persist({...value,revision:state.revision+1,lastAIChange:state.lastAIChange});return {revision:state.revision};
}
function release(){if(window&&!window.isDestroyed())window.webContents.send('map:external-state',structuredClone(state))}
function flush(lock){
  if(!rendererReady||!window||window.isDestroyed())throw new ApiError(503,'Map window is not ready');
  const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pendingFlush.delete(id);release();reject(new ApiError(503,'Map window did not respond'))},5000);pendingFlush.set(id,{resolve,reject,timeout});window.webContents.send('map:flush',{id,lock})});
}
function change(body){
  if(typeof body.requestId!=='string'||!body.requestId||body.requestId.length>160||typeof body.actor!=='string'||!body.actor||body.actor.length>100||typeof body.reason!=='string'||!body.reason||body.reason.length>1000)throw new ApiError(400,'requestId, actor and reason are required');
  const requestHash=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'),old=history().find(record=>record.requestId===body.requestId);
  if(old){if(old.requestHash!==requestHash||old.status!=='committed')throw new ApiError(409,'Request id already used');return {id:old.id,revision:old.revision,idempotent:true}}
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==state.revision)throw new ApiError(409,'Revision changed; GET /v1/graph again');
  const before=structuredClone(state),result=applyOperations(state,body.operations),id=crypto.randomUUID();
  const next={...result.next,revision:state.revision+1,lastAIChange:id},record={id,requestId:body.requestId,requestHash,actor:body.actor,reason:body.reason,time:new Date().toISOString(),status:'prepared',baseRevision:state.revision,revision:next.revision,affectedNodes:result.affectedNodes,affectedEdges:result.affectedEdges,before,after:structuredClone(next)};
  // The encrypted intent precedes the map write. lastAIChange proves whether
  // a prepared record committed when recovering after a process exit.
  atomic(path.join(auditDir,id+'.private'),encrypt(record));persist(next);record.status='committed';atomic(path.join(auditDir,id+'.private'),encrypt(record));
  return {id,revision:state.revision,idempotent:false};
}
async function captureScene(scene){
  const width=Math.ceil(scene.region.width*scene.scale),height=Math.ceil(scene.region.height*scene.scale);
  if(!screenshotWindow||screenshotWindow.isDestroyed()){
    screenshotWindow=new BrowserWindow({width,height,minWidth:width,minHeight:height,useContentSize:true,show:false,frame:false,backgroundColor:'#101012',webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    screenshotWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));screenshotWindow.webContents.on('will-navigate',event=>event.preventDefault());
    await screenshotWindow.loadFile(path.join(__dirname,'screenshot.html'));
  }else {screenshotWindow.setMinimumSize(width,height);screenshotWindow.setContentSize(width,height)}
  const viewport=await screenshotWindow.webContents.executeJavaScript(`window.renderScene(${JSON.stringify(scene)})`);
  // Windows can add 1–2 DIP of non-client rounding even to offscreen windows.
  // Capture exactly the requested area instead of stretching the whole window.
  if(viewport.width<width||viewport.height<height||viewport.width-width>4||viewport.height-height>4)throw new Error('Screenshot viewport does not match requested region');
  const image=await screenshotWindow.webContents.capturePage({x:0,y:0,width,height},{stayHidden:true,stayAwake:true});
  if(image.isEmpty())throw new Error('Screenshot is empty');return image.resize({width,height}).toPNG();
}
async function capture(scene){
  let timeout;try{return await Promise.race([captureScene(scene),new Promise((_resolve,reject)=>{timeout=setTimeout(()=>{if(screenshotWindow&&!screenshotWindow.isDestroyed())screenshotWindow.destroy();reject(new ApiError(503,'Screenshot timed out'))},15000)})])}finally{clearTimeout(timeout)}
}
function trusted(event){if(event.sender!==window?.webContents)throw new Error('Unknown map window')}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(window&&!window.isDestroyed()){if(window.isMinimized())window.restore();window.show();window.focus()}});
  ipcMain.handle('map:load',event=>{trusted(event);return structuredClone(state)});
  ipcMain.handle('map:save',(event,value)=>{trusted(event);return saveUI(value)});
  ipcMain.on('map:save-now',(event,value)=>{try{trusted(event);event.returnValue=saveUI(value)}catch(error){event.returnValue={error:error.message}}});
  ipcMain.on('map:ready',event=>{trusted(event);rendererReady=true});
  ipcMain.on('map:flushed',(event,{id,error})=>{trusted(event);const pending=pendingFlush.get(id);if(!pending)return;clearTimeout(pending.timeout);pendingFlush.delete(id);if(error)pending.reject(new ApiError(409,error));else pending.resolve()});
  app.whenReady().then(async()=>{
    if(process.platform==='win32')app.setAppUserModelId('com.smallside.floade.work-map');
    load();window=new BrowserWindow({width:1320,height:900,minWidth:800,minHeight:560,show:false,title:'Floade Work Map',icon:iconPath,backgroundColor:'#0d0d0f',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!hiddenTest}});
    window.setMenu(null);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
    window.loadFile(path.join(__dirname,'index.html'));window.once('ready-to-show',()=>{if(!hiddenTest){window.show();window.focus()}});
    api=createApi({getState:()=>state,flush,release,change,history,capture});
    await new Promise(resolve=>api.server.listen(0,'127.0.0.1',resolve));atomic(runtimePath,JSON.stringify({version:1,endpoint:`http://127.0.0.1:${api.server.address().port}`,token:api.token,pid:process.pid},null,2));
    window.on('closed',()=>{rendererReady=false;if(screenshotWindow&&!screenshotWindow.isDestroyed())screenshotWindow.destroy();api?.server.close();app.quit()});
  }).catch(error=>{console.error(error);app.quit()});
  app.on('before-quit',()=>{if(api&&fs.existsSync(runtimePath))fs.unlinkSync(runtimePath)});
  app.on('window-all-closed',()=>app.quit());
}
