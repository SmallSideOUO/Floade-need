'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyOperations,publicHistory,regionFor,createApi}=require('../api.cjs');
const fixture=()=>({revision:3,settings:{aiMode:'protected',visualMode:'show'},graph:{version:1,nodes:[{id:'a',title:'PUBLIC',shape:'ellipse',x:0,y:0},{id:'b',title:'SECRET_TEXT',note:'SECRET_NOTE',aiVisibility:'text',shape:'ellipse',x:500,y:0},{id:'hidden',title:'SECRET_OBJECT',aiVisibility:'object',shape:'ellipse',x:200,y:100}],edges:[{id:'e',from:'a',to:'b',label:'SECRET_RELATION'}]}});
test('AI batches are atomic, allow withheld-object geometry, and reject private text or privacy changes',()=>{
  const state=fixture(),before=JSON.stringify(state);
  assert.throws(()=>applyOperations(state,[{op:'node.update',id:'a',patch:{x:50}},{op:'node.update',id:'b',patch:{title:'replace'}}]),error=>error.status===403);
  assert.equal(JSON.stringify(state),before);
  assert.throws(()=>applyOperations(state,[{op:'node.update',id:'hidden',patch:{x:50}}]),error=>error.status===403);
  assert.throws(()=>applyOperations(state,[{op:'node.update',id:'a',patch:{aiVisibility:'full'}}]),/Unsupported/);
  assert.throws(()=>applyOperations(state,[{op:'edge.update',id:'e',patch:{label:'replace'}}]),error=>error.status===403);
  const result=applyOperations(state,[{op:'node.update',id:'b',patch:{x:450}},{op:'edge.update',id:'e',patch:{color:'#ffaa22',width:3,controlPoints:[{x:250,y:-100},{x:350,y:-100}]}}]);
  assert.equal(result.next.graph.nodes[1].title,'SECRET_TEXT');assert.equal(result.next.graph.edges[0].width,3);assert.equal(state.graph.edges[0].width,undefined);
});
test('AI create/delete connections validate endpoints and remove hierarchy without resurrection',()=>{
  const state=fixture();state.graph.nodes[1].parentId='a';
  assert.throws(()=>applyOperations(state,[{op:'edge.create',id:'hidden-edge',patch:{from:'a',to:'hidden'}}]),error=>error.status===403);
  assert.throws(()=>applyOperations(state,[{op:'edge.create',id:'duplicate',patch:{from:'b',to:'a'}}]),error=>error.status===409);
  const deleted=applyOperations(state,[{op:'edge.delete',id:'e'}]);assert.equal(deleted.next.graph.edges.length,0);assert.equal(deleted.next.graph.nodes[1].parentId,null);
  const created=applyOperations(state,[{op:'node.create',id:'c',patch:{title:'New',x:200,y:300}},{op:'edge.create',id:'new',patch:{from:'a',to:'c',routing:'curve',curvature:.6}}]);assert.equal(created.next.graph.nodes.length,4);assert.equal(created.next.graph.edges.length,2);
  assert.throws(()=>applyOperations(state,[{op:'edge.update',id:'e',patch:{controlPoints:[{x:NaN,y:0},{x:0,y:0}]}}]),/Invalid/);
});
test('history applies current privacy even when old snapshots were fully open',()=>{
  const before=fixture();before.settings.aiMode='open';const after=structuredClone(before);after.graph.nodes[1].x=450;
  const record={id:'r',requestId:'req',actor:'AI',reason:'Move SECRET_TEXT',time:'now',status:'committed',baseRevision:2,revision:3,affectedNodes:['b','hidden'],affectedEdges:['e'],before,after};
  const result=publicHistory(record,fixture());assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.equal(result.changes.before.nodes.length,1);assert.equal(result.changes.after.nodes[0].x,450);
});
test('region screenshots only receive AI-safe data and reject excluded object targets or excessive resolution',()=>{
  const state=fixture(),scene=regionFor(state,{nodeIds:['a','b'],scale:.5});assert.equal(scene.graph.nodes.length,2);assert.equal(JSON.stringify(scene).includes('SECRET'),false);
  assert.throws(()=>regionFor(state,{nodeIds:['hidden']}),error=>error.status===403);
  assert.throws(()=>regionFor(state,{region:{x:0,y:0,width:5000,height:5000},scale:1}),/4096/);
});
test('loopback HTTP rejects unauthenticated/browser requests and returns PNG with privacy metadata',async()=>{
  const state=fixture(),api=createApi({getState:()=>state,flush:async()=>{},release:()=>{},change:()=>({id:'r'}),history:()=>[],capture:async scene=>{assert.equal(JSON.stringify(scene).includes('SECRET'),false);return Buffer.from('PNG_FIXTURE')}});
  await new Promise(resolve=>api.server.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+api.server.address().port;
  try{assert.equal((await fetch(endpoint+'/v1/graph')).status,401);assert.equal((await fetch(endpoint+'/v1/graph',{headers:{authorization:'Bearer '+api.token,origin:'http://evil.example'}})).status,401);
    const headers={authorization:'Bearer '+api.token,'content-type':'application/json'},graph=await(await fetch(endpoint+'/v1/graph',{headers})).json();assert.equal(graph.revision,3);assert.equal(JSON.stringify(graph).includes('SECRET'),false);
    const screenshot=await fetch(endpoint+'/v1/screenshot',{method:'POST',headers,body:JSON.stringify({region:{x:0,y:0,width:1000,height:500}})});assert.equal(screenshot.status,200);assert.equal(screenshot.headers.get('x-map-privacy'),'AI-filtered');assert.equal(await screenshot.text(),'PNG_FIXTURE');
  }finally{await new Promise(resolve=>api.server.close(resolve))}
});
