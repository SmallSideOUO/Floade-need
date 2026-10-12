'use strict';
// Run only against an isolated synthetic test-output profile, never user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
async function main(){
  const profile=path.resolve(process.argv[2]||'');assert.ok(profile.includes(path.join('shared-map','test-output')),'Synthetic profile required');
  const runtime=JSON.parse(fs.readFileSync(path.join(profile,'api-runtime.json'),'utf8')),headers={authorization:'Bearer '+runtime.token,'content-type':'application/json'};
  const request=async(route,body)=>{const response=await fetch(runtime.endpoint+'/v1/'+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return {status:response.status,data:await response.json()}};
  const graph=async()=>{const response=await request('graph');assert.equal(response.status,200);return response.data};
  const infoPath=path.join(profile,'live-check.json');
  if(process.argv.includes('--restart')){
    const info=JSON.parse(fs.readFileSync(infoPath,'utf8')),state=await graph(),history=await request('history');
    assert.equal(state.graph.nodes.find(n=>n.id===info.nodeId).title,'AI_LIVE_CREATED');assert.equal(state.graph.edges.find(e=>e.id===info.edgeId).controlPoints.length,2);
    assert.equal(history.data.records.find(r=>r.id===info.recordId).status,'committed');
    const large=await fetch(runtime.endpoint+'/v1/screenshot',{method:'POST',headers,body:JSON.stringify({region:{x:1200,y:1300,width:2800,height:1600},scale:1}),signal:AbortSignal.timeout(20000)});
    if(!large.ok)throw new Error('Large screenshot failed: '+await large.text());const png=Buffer.from(await large.arrayBuffer());assert.equal(png.readUInt32BE(16),2800);assert.equal(png.readUInt32BE(20),1600);fs.writeFileSync(path.join(profile,'api-large-region.png'),png);
    console.log(JSON.stringify({passed:true,checks:['API changes survive native restart','encrypted audit survives native restart','region screenshot larger than desktop']}));return;
  }
  let state=await graph();assert.equal((await fetch(runtime.endpoint+'/v1/graph')).status,401);
  const ids={nodeId:crypto.randomUUID(),peerId:crypto.randomUUID(),edgeId:crypto.randomUUID()},body={requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:'API live test',reason:'Exercise creation, drawing and audited changes',operations:[
    {op:'node.create',id:ids.nodeId,patch:{title:'AI_LIVE_CREATED',note:'Public synthetic fixture',x:1300,y:1400,width:220,height:100,background:'#243449'}},
    {op:'node.create',id:ids.peerId,patch:{title:'AI_LIVE_PEER',x:1800,y:1650,shape:'rounded',textColor:'#d0e7ff'}},
    {op:'edge.create',id:ids.edgeId,patch:{from:ids.nodeId,to:ids.peerId,routing:'curve',fromPort:'right',toPort:'top',color:'#88bbff',width:3,controlPoints:[{x:1600,y:1400},{x:1800,y:1450}]}}
  ]};
  const changed=await request('changes',body);assert.equal(changed.status,200,JSON.stringify(changed.data));const repeated=await request('changes',body);assert.equal(repeated.data.idempotent,true);assert.equal(repeated.data.id,changed.data.id);
  assert.equal((await request('changes',{...body,requestId:crypto.randomUUID()})).status,409);
  state=await graph();assert.equal(state.graph.nodes.find(n=>n.id===ids.nodeId).title,'AI_LIVE_CREATED');
  const update={requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:'API live test',reason:'Adjust the line and object attributes',operations:[{op:'node.update',id:ids.nodeId,patch:{x:1320,opacity:.85}},{op:'edge.update',id:ids.edgeId,patch:{color:'#66ddcc',width:2.5,lineStyle:'dashed',offset:40}}]};
  assert.equal((await request('changes',update)).status,200);
  state=await graph();const withheld=state.graph.nodes.find(n=>n.textWithheld);assert.ok(withheld,'Run ui-check.js first');
  const invalid={requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:'API live test',reason:'Must reject without partial changes',operations:[{op:'node.update',id:ids.nodeId,patch:{x:999}},{op:'node.update',id:withheld.id,patch:{title:'FORBIDDEN'}}]};
  assert.equal((await request('changes',invalid)).status,403);assert.equal((await graph()).graph.nodes.find(n=>n.id===ids.nodeId).x,1320);
  const history=(await request('history')).data.records;assert.equal(history.length,2);const first=history.find(r=>r.id===changed.data.id);assert.equal(first.changes.before.nodes.length,0);assert.equal(first.changes.after.nodes.length,2);
  for(const name of fs.readdirSync(path.join(profile,'ai-history')))assert.equal(fs.readFileSync(path.join(profile,'ai-history',name)).includes(Buffer.from('AI_LIVE_CREATED')),false,'Audit was written as plaintext');
  const screenshot=await fetch(runtime.endpoint+'/v1/screenshot',{method:'POST',headers,body:JSON.stringify({nodeIds:[ids.nodeId,ids.peerId],scale:1}),signal:AbortSignal.timeout(20000)});assert.equal(screenshot.status,200);assert.equal(screenshot.headers.get('x-map-privacy'),'AI-filtered');
  const png=Buffer.from(await screenshot.arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>1000);fs.writeFileSync(path.join(profile,'api-region.png'),png);
  const privateShot=await fetch(runtime.endpoint+'/v1/screenshot',{method:'POST',headers,body:JSON.stringify({nodeIds:[withheld.id],scale:1}),signal:AbortSignal.timeout(20000)});assert.equal(privateShot.status,200);fs.writeFileSync(path.join(profile,'api-masked-region.png'),Buffer.from(await privateShot.arrayBuffer()));
  fs.writeFileSync(infoPath,JSON.stringify({...ids,recordId:changed.data.id}));
  console.log(JSON.stringify({passed:true,checks:['authenticated loopback API','create/update objects and curved lines','idempotency','revision conflict','invalid batch is atomic','encrypted before/after audit','region PNG','masked region PNG'],screenshot:path.join(profile,'api-region.png')}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
