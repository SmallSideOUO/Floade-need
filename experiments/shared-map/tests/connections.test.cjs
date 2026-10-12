const assert = require('node:assert/strict');
const test = require('node:test');
const {materialize, removeEdge, removeNode, route, ports, style} = require('../connections.cjs');
const {aiMap} = require('../privacy.cjs');

test('every old hierarchy link becomes editable without duplicates or reappearing after deletion', () => {
  const graph={nodes:[{id:'world'},{id:'child',parentId:'world'},{id:'detail',parentId:'child'}],edges:[{id:'existing',from:'world',to:'child',label:'Condition'}]};
  materialize(graph);materialize(graph);assert.equal(graph.edges.length,2);
  assert.equal(graph.edges[0].label,'Condition');
  removeEdge(graph,graph.edges.find(edge=>edge.to==='detail').id);materialize(graph);
  assert.equal(graph.edges.length,1);assert.equal(graph.nodes[2].parentId,null);
  removeNode(graph,'child');materialize(graph);assert.equal(graph.edges.length,0);assert.equal(graph.nodes.length,2);
});

test('routing uses facing boundary points for direct horizontal and vertical connections', () => {
  const a={id:'a',x:0,y:0,w:200,h:100},b={id:'b',x:500,y:0,w:200,h:100};
  const horizontal=route(a,b,[a,b]);assert.equal(horizontal.fromPort,'right');assert.equal(horizontal.toPort,'left');assert.equal(horizontal.collisions,0);
  const c={id:'c',x:0,y:400,w:200,h:100},vertical=route(a,c,[a,c]);assert.equal(vertical.fromPort,'bottom');assert.equal(vertical.toPort,'top');
});

test('routing avoids an intervening object and rounds bends', () => {
  const a={id:'a',x:0,y:100,w:200,h:100},b={id:'b',x:650,y:100,w:200,h:100},block={id:'block',x:300,y:0,w:220,h:300};
  const result=route(a,b,[a,b,block]);assert.equal(result.collisions,0);assert.ok(result.d.includes(' Q '));
  assert.ok(result.points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
  assert.ok(ports(a).some(point=>point.x===result.points[0].x&&point.y===result.points[0].y));
  assert.ok(ports(b).some(point=>point.x===result.points.at(-1).x&&point.y===result.points.at(-1).y));
});

test('edge styles default to solid and remain in privacy-filtered output without hidden text', () => {
  assert.equal(style({}).lineStyle,'solid');assert.equal(style({width:100}).width,12);
  const state={settings:{aiMode:'protected'},graph:{version:1,nodes:[{id:'a',title:'Public'},{id:'b',title:'SECRET',aiVisibility:'text'}],edges:[{id:'e',from:'a',to:'b',label:'SECRET RELATION',width:4,color:'#ffaa22',lineStyle:'dashed'}]}};
  const result=aiMap(state);assert.equal(result.graph.edges[0].label,'');assert.equal(result.graph.edges[0].width,4);assert.equal(result.graph.edges[0].color,'#ffaa22');assert.equal(result.graph.edges[0].lineStyle,'dashed');
  assert.equal(JSON.stringify(result).includes('SECRET'),false);state.graph.nodes[1].aiVisibility='object';assert.equal(aiMap(state).graph.edges.length,0);
});
