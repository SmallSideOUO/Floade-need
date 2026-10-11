const assert = require('node:assert/strict');
const test = require('node:test');
const {lineage, canParent, outline} = require('../hierarchy.cjs');
const {applyOrganization} = require('../organization.cjs');
const {aiMap} = require('../privacy.cjs');

test('context is ordered from purpose to detail without ordering cross-links', () => {
  const nodes = [{id:'detail',parentId:'product'},{id:'goal'},{id:'product',parentId:'goal'},{id:'loose'}];
  assert.deepEqual(lineage(nodes,'detail').map(n=>n.id), ['goal','product','detail']);
  assert.deepEqual(outline(nodes).map(({node,depth})=>[node.id,depth]), [['goal',0],['product',1],['detail',2],['loose',0]]);
  assert.equal(canParent(nodes,'goal','detail'), false);
  assert.equal(canParent(nodes,'goal','goal'), false);
  assert.equal(canParent(nodes,'detail','missing'), false);
});

test('malformed cycles and hidden parents still produce a finite outline', () => {
  const nodes = [{id:'a',parentId:'b'},{id:'b',parentId:'a'},{id:'orphan',parentId:'hidden'}];
  assert.equal(outline(nodes).length, 3);
  assert.equal(lineage(nodes,'a').length, 2);
  assert.equal(outline(nodes).find(row=>row.node.id==='orphan').depth, 0);
});

test('AI hierarchy never exposes an excluded object through a parent reference', () => {
  const state={graph:{version:1,current:'child',nodes:[{id:'secret',title:'SECRET',aiVisibility:'object'},{id:'child',title:'Visible',parentId:'secret'}],edges:[]},settings:{aiMode:'protected'}};
  assert.equal(JSON.stringify(aiMap(state)).includes('secret'),false);
  state.settings.aiMode='open';
  assert.equal(aiMap(state).graph.nodes[1].parentId,'secret');
});

test('local organization preserves layout, privacy, cross-links and later user edits', () => {
  const state={graph:{version:1,current:'public',nodes:[{id:'public',title:'Before',x:80,y:90,background:'#123456'},{id:'goal',title:'Goal'},{id:'masked',title:'Secret',aiVisibility:'text'},{id:'hidden',title:'Hidden',aiVisibility:'object'}],edges:[{id:'link',from:'public',to:'goal',label:'Related'}]},settings:{aiMode:'protected'}};
  const plan={revision:'once',nodes:[{id:'public',title:'After',parentId:'goal',x:999,aiVisibility:'full'},{id:'masked',title:'Overwrite'},{id:'hidden',title:'Overwrite'},{id:'goal',parentId:'public'}]};
  assert.equal(applyOrganization(state,plan),true);
  assert.equal(state.graph.nodes[0].x,80);assert.equal(state.graph.nodes[0].y,90);
  assert.equal(state.graph.nodes[0].background,'#123456');assert.equal(state.graph.nodes[0].parentId,'goal');
  assert.equal(state.graph.nodes[1].parentId,undefined);
  assert.equal(state.graph.nodes[2].title,'Secret');assert.equal(state.graph.nodes[3].title,'Hidden');
  assert.equal(state.graph.edges[0].label,'Related');
  state.graph.nodes[0].title='User edit';assert.equal(applyOrganization(state,plan),false);
  assert.equal(state.graph.nodes[0].title,'User edit');
});
