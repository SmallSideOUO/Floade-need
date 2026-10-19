'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function legacyProfilePath(appData){
  const base=appData||(process.platform==='win32'?process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'):process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support'):process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'));
  return path.join(base,'Floade','work-map');
}
// AppData is virtualized for descendants of the Store/MSIX Codex app. A path
// under the actual home directory is shared with normally launched Floade.
function profilePath(home=os.homedir()){return path.join(home,'.floade','work-map')}
function legacyProfilePaths({appData,localAppData=process.env.LOCALAPPDATA}={}){
  const candidates=[];
  if(process.platform==='win32'&&localAppData){
    const packages=path.join(localAppData,'Packages');
    if(fs.existsSync(packages))for(const entry of fs.readdirSync(packages,{withFileTypes:true}))if(entry.isDirectory()&&/^OpenAI\.Codex_/i.test(entry.name))candidates.push(path.join(packages,entry.name,'LocalCache','Roaming','Floade','work-map'));
  }
  candidates.push(legacyProfilePath(appData));return [...new Set(candidates.map(candidate=>path.resolve(candidate)))];
}
function migrateBestLegacy(sources,destination){
  if(fs.existsSync(path.join(destination,'map.private'))||fs.existsSync(path.join(destination,'map.json')))return null;
  const candidates=[...new Set(sources.map(source=>path.resolve(source)))].filter(source=>fs.existsSync(path.join(source,'map.private'))||fs.existsSync(path.join(source,'map.json'))).map(source=>{
    let exported;try{exported=JSON.parse(fs.readFileSync(path.join(source,'ai-map.json'),'utf8'))}catch{}
    return {source,revision:Number.isSafeInteger(exported?.revision)?exported.revision:-1,graph:exported?.graph};
  }).sort((a,b)=>b.revision-a.revision);
  if(!candidates.length)return null;
  const latest=candidates[0],ties=candidates.filter(candidate=>candidate.revision===latest.revision);
  if(ties.some(candidate=>JSON.stringify(candidate.graph)!==JSON.stringify(latest.graph))||ties.length>1&&latest.revision<0)throw new Error('找到多份不同的 Work Map 舊資料，已保留原檔；請用 --map-profile 指定要開啟的資料夾。');
  migrateLegacy(latest.source,destination);return latest.source;
}
function migrateLegacy(source,destination){
  if(path.resolve(source)===path.resolve(destination)||fs.existsSync(path.join(destination,'map.private'))||fs.existsSync(path.join(destination,'map.json')))return;
  if(!fs.existsSync(path.join(source,'map.private'))&&!fs.existsSync(path.join(source,'map.json')))return;
  fs.mkdirSync(destination,{recursive:true});
  // Copy ciphertext unchanged; keep the old profile as a backup. Write the
  // primary map last so an interrupted migration can finish on the next run.
  const primary=fs.existsSync(path.join(source,'map.private'))?'map.private':'map.json';
  for(const name of ['ai-history','organization.json','map.private.bak','map.json.bak','profile/Local State',primary]){
    const from=path.join(source,name),to=path.join(destination,name);
    if(fs.existsSync(from))fs.cpSync(from,to,{recursive:true,force:name==='profile/Local State'});
  }
}
module.exports={profilePath,legacyProfilePath,legacyProfilePaths,migrateLegacy,migrateBestLegacy};
