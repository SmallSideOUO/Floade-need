const test = require('node:test');
const assert = require('node:assert/strict');
const tree = require('../tree.cjs');
const {routes, boxOf} = require('../connections.cjs');
const {applyOperations, publicHistory} = require('../api.cjs');
const {aiMap} = require('../privacy.cjs');

function fixture() {
  const state = {revision: 1, settings: {aiMode:'protected'}, graph: {version:1, current:'a', nodes:[
    {id:'world',title:'Root',note:'Keep root',x:800,y:900,shape:'rounded'},
    {id:'a',title:'A',note:'Keep A',parentId:'world',width:400,height:140,shape:'rounded'},
    {id:'b',title:'B',parentId:'world',height:80,shape:'rounded'},
    {id:'c',title:'C',parentId:'a',shape:'rounded'}
  ],edges:[{id:'wa',from:'world',to:'a',label:'Keep relation'}, {id:'wb',from:'world',to:'b',label:''}, {id:'ac',from:'a',to:'c',label:''}]}};
  tree.enable(state.graph); return state;
}

test('migration builds one rooted tree from cycles, cross-links and disconnected nodes without changing text or the input state', () => {
  const before = fixture(); delete before.graph.treeMode;
  before.graph.edges.push({id:'cross',from:'b',to:'c',label:'Old cross-link'});
  before.graph.nodes.push({id:'loose',title:'Ambiguous',note:'Maybe, maybe not',aiVisibility:'text'});
  const original = structuredClone(before);
  const result = applyOperations(before,[{op:'tree.enable',id:'convert'}]);
  tree.validate(result.next.graph);
  assert.deepEqual(before,original);
  assert.equal(result.next.graph.edges.length,result.next.graph.nodes.length-1);
  for (const node of original.graph.nodes) {
    const updated=result.next.graph.nodes.find(n=>n.id===node.id);
    for (const key of ['title','note','aiVisibility']) assert.equal(updated[key],node[key]);
  }
  const record={id:'migration',status:'committed',affectedNodes:result.affectedNodes,affectedEdges:result.affectedEdges,before,after:result.next};
  assert.ok(record.before.graph.edges.some(edge=>edge.id==='cross'));
  assert.ok(result.affectedEdges.includes('cross'));
  assert.ok(!JSON.stringify(publicHistory(record,result.next)).includes('Maybe, maybe not'));
});

test('layout aligns each depth, gives parents clearance and prevents overlapping subtrees', () => {
  const graph=fixture().graph,lookup=new Map(graph.nodes.map(n=>[n.id,n]));
  assert.equal(lookup.get('world').x,0);assert.equal(lookup.get('a').y,lookup.get('b').y);
  for(const node of graph.nodes.filter(n=>n.parentId)) {
    const parent=boxOf(lookup.get(node.parentId));assert.ok(node.y>=parent.y+parent.h+100);
  }
  for(let i=0;i<graph.nodes.length;i++)for(let j=i+1;j<graph.nodes.length;j++) {
    const a=boxOf(graph.nodes[i]),b=boxOf(graph.nodes[j]);
    assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
  }
  const edgeRoutes=routes(graph),parent=boxOf(lookup.get('world'));
  for(const id of ['wa','wb']) {
    const route=edgeRoutes.get(id);assert.equal(route.points[0].x,parent.x+parent.w/2);assert.equal(route.points[0].y,parent.y+parent.h);
    for(let i=1;i<route.points.length;i++)assert.ok(route.points[i].x===route.points[i-1].x||route.points[i].y===route.points[i-1].y);
    const rendered=[...route.d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
    assert.equal(rendered.length,4);
    for(let i=1;i<rendered.length;i++)assert.ok(rendered[i].x===rendered[i-1].x||rendered[i].y===rendered[i-1].y,'Rendered SVG contains a diagonal');
    assert.ok(!route.d.includes('C'));
  }
  assert.equal(edgeRoutes.get('wa').points[1].y,edgeRoutes.get('wb').points[1].y);
});

test('migration keeps explicit ancestry even when a cross-link offers a shorter route to the root', () => {
  const graph={nodes:[{id:'world'},{id:'a',parentId:'world'},{id:'b',parentId:'a'},{id:'c',parentId:'b'},{id:'d',parentId:'world'}],edges:[{id:'shortcut',from:'d',to:'c',label:'Not the parent'}]};
  tree.enable(graph);tree.validate(graph);
  assert.equal(graph.nodes.find(n=>n.id==='c').parentId,'b');
  assert.ok(!graph.edges.some(e=>e.id==='shortcut'));
});

test('API keeps the tree strict through creation, reparenting and sibling ordering', () => {
  const before=fixture();
  const result=applyOperations(before,[{op:'node.create',id:'d',patch:{title:'D',parentId:'b'}},{op:'node.update',id:'c',patch:{parentId:'b',x:10000,y:-10000}}]);
  tree.validate(result.next.graph);
  assert.equal(result.next.graph.nodes.find(n=>n.id==='c').parentId,'b');
  assert.equal(result.next.graph.nodes.find(n=>n.id==='c').y,result.next.graph.nodes.find(n=>n.id==='d').y);
  assert.notEqual(result.next.graph.nodes.find(n=>n.id==='c').x,10000);
  assert.equal(result.next.graph.edges.find(e=>e.to==='c').from,'b');
  const ordered=applyOperations(result.next,[{op:'node.update',id:'d',patch:{order:-1}}]).next.graph;
  assert.ok(ordered.nodes.find(n=>n.id==='d').x<ordered.nodes.find(n=>n.id==='c').x);
});

test('cycles, multiple parents, detached children and custom free routes are rejected atomically', () => {
  const state=fixture(),before=structuredClone(state);
  for(const operations of [
    [{op:'node.update',id:'a',patch:{title:'Must not persist'}},{op:'node.update',id:'a',patch:{parentId:'c'}}],
    [{op:'edge.create',id:'extra',patch:{from:'b',to:'c'}}],
    [{op:'edge.delete',id:'wa'}],
    [{op:'node.update',id:'a',patch:{parentId:null}}],
    [{op:'node.update',id:'world',patch:{parentId:'a'}}],
    [{op:'edge.update',id:'wa',patch:{routing:'curve'}}]
  ]) assert.throws(()=>applyOperations(state,operations));
  assert.deepEqual(state,before);
});

test('deleting an interior node retains its children under its own parent and protects the root', () => {
  const state=fixture(),graph=applyOperations(state,[{op:'node.delete',id:'a'}]).next.graph;
  tree.validate(graph);assert.equal(graph.nodes.find(n=>n.id==='c').parentId,'world');
  assert.throws(()=>applyOperations(state,[{op:'node.delete',id:'world'}]),/根節點/);
  let empty={graph:{version:1,nodes:[],edges:[]}};tree.enable(empty.graph);
  empty=applyOperations(empty,[{op:'node.create',id:'root',patch:{title:'First'}}]).next;
  assert.equal(empty.graph.rootId,'root');
  empty=applyOperations(empty,[{op:'node.delete',id:'root'}]).next;
  tree.validate(empty.graph);assert.equal(empty.graph.rootId,null);
});

test('hidden parents remain hidden in tree exports, and API cannot reparent onto hidden objects', () => {
  const state=fixture();state.graph.nodes.find(n=>n.id==='world').aiVisibility='object';
  const exported=aiMap(state);assert.equal(exported.graph.rootId,null);assert.ok(exported.graph.treeMode);
  assert.ok(!JSON.stringify(exported).includes('world'));
  assert.throws(()=>applyOperations(state,[{op:'node.create',id:'private-child',patch:{title:'No'}}]),error=>error.status===403);
  state.graph.nodes.find(n=>n.id==='b').aiVisibility='object';
  assert.throws(()=>applyOperations(state,[{op:'node.update',id:'c',patch:{parentId:'b'}}]),error=>error.status===403);
});

test('sibling reordering moves a subtree without changing ancestry or edge text', () => {
  const graph=fixture().graph,before=structuredClone(graph),edgeText=graph.edges.map(edge=>[edge.id,edge.label]);
  tree.reorder(graph,'b','a');tree.arrange(graph);tree.validate(graph);
  assert.ok(graph.nodes.find(n=>n.id==='b').x<graph.nodes.find(n=>n.id==='a').x);
  for(const node of before.nodes)assert.equal(graph.nodes.find(n=>n.id===node.id).parentId,node.parentId);
  assert.deepEqual(graph.edges.map(edge=>[edge.id,edge.label]),edgeText);
  tree.reorder(graph,'b',null);tree.arrange(graph);
  assert.ok(graph.nodes.find(n=>n.id==='b').x>graph.nodes.find(n=>n.id==='a').x);
  assert.throws(()=>tree.reorder(graph,'b','c'),/同一上層/);
  assert.throws(()=>tree.reorder(graph,'world','a'),/根節點/);
});
