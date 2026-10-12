'use strict';
// This helper simulates crash boundaries using only our synthetic test profile.
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const profile=path.resolve(process.argv.find(arg=>arg.startsWith('--audit-profile='))?.slice(16)||'');
const testRoot=path.resolve(__dirname,'../test-output'),relative=path.relative(testRoot,profile);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('An isolated test-output profile is required');
app.setPath('userData',path.join(profile,'profile'));app.setName('共用地圖');
app.whenReady().then(()=>{
  const state=JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(profile,'map.private'))));
  const lastFile=path.join(profile,'ai-history',state.lastAIChange+'.private');
  const committed=JSON.parse(safeStorage.decryptString(fs.readFileSync(lastFile)));committed.status='prepared';fs.writeFileSync(lastFile,safeStorage.encryptString(JSON.stringify(committed)));
  const interrupted={...committed,id:crypto.randomUUID(),requestId:crypto.randomUUID(),time:new Date().toISOString(),reason:'Simulated exit before map write',baseRevision:state.revision,revision:state.revision+1,status:'prepared',affectedNodes:[],affectedEdges:[],before:state,after:state};
  fs.writeFileSync(path.join(profile,'ai-history',interrupted.id+'.private'),safeStorage.encryptString(JSON.stringify(interrupted)));
  fs.writeFileSync(path.join(profile,'recovery-check.json'),JSON.stringify({committed:committed.id,interrupted:interrupted.id}));
  console.log(JSON.stringify({preparedRecoveryFixtures:true}));app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
