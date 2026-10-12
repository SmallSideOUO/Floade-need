const assert = require('node:assert/strict');
const test = require('node:test');
const {lineage, canParent, outline, layout} = require('../hierarchy.cjs');
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

test('top-down layout puts the primary purpose above branches without overlaps or content changes', () => {
  const nodes=[{id:'leaf',parentId:'branch',width:600,height:200,title:'Evidence',x:9,y:8},{id:'world',width:260,height:160},{id:'branch',parentId:'world',width:340,height:140},{id:'sibling',parentId:'world',width:500,height:180},{id:'loose',width:300,height:160},{id:'second-leaf',parentId:'branch',width:200,height:100}];
  const before=JSON.stringify(nodes), positions=layout(nodes), lookup=new Map(positions.map(node=>[node.id,node]));
  assert.equal(JSON.stringify(nodes),before);
  assert.equal(lookup.get('world').y,0);
  for(const node of nodes.filter(node=>node.id!=='world'))assert.ok(lookup.get(node.id).y>0);
  for(const node of nodes.filter(node=>node.parentId)){const parent=nodes.find(item=>item.id===node.parentId);assert.ok(lookup.get(node.id).y>=lookup.get(parent.id).y+(parent.height||100)+100)}
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j],p=lookup.get(a.id),q=lookup.get(b.id);
    const overlapX=Math.abs(p.x-q.x)<((a.width||210)+(b.width||210))/2;
    const overlapY=p.y<q.y+(b.height||100)&&q.y<p.y+(a.height||100);
    assert.equal(overlapX&&overlapY,false,`Overlap between ${a.id} and ${b.id}`);
  }
  assert.deepEqual(layout([]),[]);
  assert.equal(layout([{id:'a',parentId:'b'},{id:'b',parentId:'a'}]).length,2);
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
