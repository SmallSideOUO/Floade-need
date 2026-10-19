'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {profilePath,legacyProfilePaths,migrateBestLegacy}=require('../profile.cjs');
test('canonical profile is outside AppData virtualization and migrates the newer user map instead of the seed',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'floade-map-migration-'));
  try{
    const home=path.join(root,'home'),real=path.join(root,'Roaming/Floade/work-map'),cached=path.join(root,'Local/Packages/OpenAI.Codex_test/LocalCache/Roaming/Floade/work-map'),destination=profilePath(home);
    function fixture(dir,revision,title){fs.mkdirSync(path.join(dir,'profile'),{recursive:true});fs.mkdirSync(path.join(dir,'ai-history'));fs.writeFileSync(path.join(dir,'map.private'),'ciphertext-'+title);fs.writeFileSync(path.join(dir,'profile','Local State'),'key-'+title);fs.writeFileSync(path.join(dir,'ai-history','record.private'),'audit-'+title);fs.writeFileSync(path.join(dir,'ai-map.json'),JSON.stringify({revision,graph:{nodes:[{id:'root',title}]}}));}
    fixture(real,1,'seed');fixture(cached,1837,'user');
    assert.equal(destination,path.join(home,'.floade','work-map'));
    const sources=legacyProfilePaths({appData:path.join(root,'Roaming'),localAppData:path.join(root,'Local')});
    assert.ok(sources.includes(real));if(process.platform==='win32')assert.ok(sources.includes(cached));
    assert.equal(migrateBestLegacy([real,cached],destination),cached);
    assert.equal(fs.readFileSync(path.join(destination,'map.private'),'utf8'),'ciphertext-user');
    assert.equal(fs.readFileSync(path.join(destination,'profile','Local State'),'utf8'),'key-user');
    assert.equal(fs.readFileSync(path.join(destination,'ai-history','record.private'),'utf8'),'audit-user');
    assert.equal(fs.readFileSync(path.join(real,'map.private'),'utf8'),'ciphertext-seed');
    assert.equal(fs.readFileSync(path.join(cached,'map.private'),'utf8'),'ciphertext-user');
    assert.equal(migrateBestLegacy([real,cached],destination),null);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('conflicting legacy maps at the same revision do not silently replace one another',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'floade-map-conflict-'));
  try{
    const sources=['a','b'].map(name=>{const dir=path.join(root,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'map.private'),'opaque');fs.writeFileSync(path.join(dir,'ai-map.json'),JSON.stringify({revision:7,graph:{nodes:[{id:name}]}}));return dir;});
    const destination=path.join(root,'destination');assert.throws(()=>migrateBestLegacy(sources,destination),/多份不同/);assert.ok(!fs.existsSync(path.join(destination,'map.private')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
