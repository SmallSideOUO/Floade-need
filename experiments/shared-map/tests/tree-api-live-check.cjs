'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const tree=require('../tree.cjs');
async function main(){
  const profile=path.resolve(process.argv[2]||'');assert.ok(profile.includes(path.join('shared-map','test-output')),'Synthetic profile required');
  const runtime=JSON.parse(fs.readFileSync(path.join(profile,'api-runtime.json'),'utf8'));
  const headers={authorization:'Bearer '+runtime.token,'content-type':'application/json'};
  async function request(route,body){const response=await fetch(runtime.endpoint+'/v1/'+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return {status:response.status,data:await response.json()}}
  const graph=async()=>{const result=await request('graph');assert.equal(result.status,200);tree.validate(result.data.graph);return result.data};
  const infoPath=path.join(profile,'tree-live-check.json');
  if(process.argv.includes('--restart')){
    const info=JSON.parse(fs.readFileSync(infoPath,'utf8')),state=await graph(),history=(await request('history')).data.records;
    for(const expected of info.nodes){const actual=state.graph.nodes.find(n=>n.id===expected.id);assert.deepEqual(actual,expected)}
    assert.ok(history.some(record=>record.id===info.recordId&&record.status==='committed'));
    console.log(JSON.stringify({passed:true,checks:['native restart retains hierarchy, text, positions and committed audit']}));return;
  }
  let state=await graph();
  const description=await request('describe');assert.ok(description.data.tree.oneParent);assert.ok(!description.data.edgeFields.includes('controlPoints'));
  const parent=crypto.randomUUID(),child=crypto.randomUUID();
  const create={requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:'Tree API test',reason:'Create a synthetic branch through the tree API',operations:[
    {op:'node.create',id:parent,patch:{title:'TREE_API_PARENT',parentId:state.graph.rootId}},
    {op:'node.create',id:child,patch:{title:'TREE_API_CHILD',note:'Keep this exact text',parentId:parent}}
  ]};
  const created=await request('changes',create);assert.equal(created.status,200,JSON.stringify(created.data));
  const repeated=await request('changes',create);assert.equal(repeated.data.id,created.data.id);assert.equal(repeated.data.idempotent,true);
  assert.equal((await request('changes',{...create,requestId:crypto.randomUUID()})).status,409);
  state=await graph();assert.equal(state.graph.nodes.find(n=>n.id===child).parentId,parent);
  for(const operations of [
    [{op:'node.update',id:parent,patch:{title:'MUST_NOT_PERSIST'}},{op:'node.update',id:parent,patch:{parentId:child}}],
    [{op:'edge.create',id:crypto.randomUUID(),patch:{from:state.graph.rootId,to:child}}]
  ]){
    const rejected=await request('changes',{requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:'Tree API test',reason:'Reject an invalid synthetic hierarchy atomically',operations});
    assert.ok(rejected.status===400||rejected.status===409);assert.deepEqual((await graph()).graph,state.graph);
  }
  const history=(await request('history')).data.records;assert.ok(history.some(record=>record.id===created.data.id&&record.status==='committed'));
  fs.writeFileSync(infoPath,JSON.stringify({recordId:created.data.id,nodes:state.graph.nodes.filter(n=>n.id===parent||n.id===child)},null,2));
  const body={nodeIds:state.graph.nodes.map(n=>n.id),scale:0.8},file=path.join(profile,'tree-api-preview.png');
  // A second offscreen frame avoids the initial native paint racing the capture.
  for(let i=0;i<2;i++){
    const response=await fetch(runtime.endpoint+'/v1/screenshot',{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-map-privacy'),'AI-filtered');
    const png=Buffer.from(await response.arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');fs.writeFileSync(file,png);
  }
  console.log(JSON.stringify({passed:true,checks:['strict API capabilities','automatic parent lines','idempotent retry','revision conflict','cycles and second parents rejected atomically','committed audit','API screenshot'],screenshot:file}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
