const assert=require('node:assert/strict'),test=require('node:test'),{aiMap}=require('../privacy.cjs');
test('AI filtering remains independent of every visual mode',()=>{
 for(const aiMode of ['protected','open'])for(const visualMode of ['selective','show','mask'])for(const aiVisibility of ['full','text','object'])for(const visualVisibility of ['full','text','object']){
  const state={settings:{aiMode,visualMode},graph:{version:1,current:'secret',nodes:[{id:'public',title:'Public',note:''},{id:'secret',title:'PRIVATE_TITLE_8076',note:'PRIVATE_NOTE_2319',mark:'PRIVATE_MARK_0034',aiVisibility,visualVisibility}],edges:[{id:'e',from:'public',to:'secret',label:'PRIVATE_EDGE_4995'}]}};
  const result=aiMap(state),text=JSON.stringify(result),open=aiMode==='open'||aiVisibility==='full';
  assert.equal(text.includes('PRIVATE_TITLE_8076'),open);assert.equal(text.includes('PRIVATE_NOTE_2319'),open);assert.equal(text.includes('PRIVATE_MARK_0034'),open);assert.equal(text.includes('PRIVATE_EDGE_4995'),open);
  assert.equal(result.graph.nodes.length,aiMode==='protected'&&aiVisibility==='object'?1:2);
  if(aiMode==='protected'&&aiVisibility==='object'){assert.equal(result.graph.current,null);assert.equal(result.graph.edges.length,0)}
 }
});
