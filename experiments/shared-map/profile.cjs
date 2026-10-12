'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function profilePath(appData){
  const base=appData||(process.platform==='win32'?process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'):process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support'):process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'));
  return path.join(base,'Floade','work-map');
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
module.exports={profilePath,migrateLegacy};
