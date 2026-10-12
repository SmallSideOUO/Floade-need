'use strict';
const http=require('node:http'),crypto=require('node:crypto');
const {aiMap}=require('./privacy.cjs');
const {removeNode,removeEdge,boxOf}=require('./connections.cjs');
const nodeFields=['title','note','mark','x','y','width','height','shape','background','textColor','opacity'];
const edgeFields=['from','to','label','color','width','lineStyle','routing','fromPort','toPort','curvature','offset','cornerRadius','controlPoints','waypoints'];
class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
const fail=message=>{throw new ApiError(400,message)};
function fields(patch,allowed){if(!patch||typeof patch!=='object'||Array.isArray(patch))fail('patch must be an object');for(const key of Object.keys(patch))if(!allowed.includes(key))fail('Unsupported property: '+key)}
function finite(value,min,max,key){if(!Number.isFinite(value)||value<min||value>max)fail('Invalid '+key)}
function text(value,max,key){if(typeof value!=='string'||value.length>max)fail('Invalid '+key)}
function validateNode(node){
  for(const key of ['title','note','mark'])if(node[key]!==undefined)text(node[key],key==='note'?20000:160,key);
  for(const key of ['x','y'])finite(node[key],-100000,100000,key);
  for(const [key,min,max]of [['width',70,600],['height',50,500],['opacity',0,1]])if(node[key]!==undefined)finite(node[key],min,max,key);
  if(!['ellipse','circle','diamond','rounded','rectangle'].includes(node.shape))fail('Invalid shape');
  for(const key of ['background','textColor'])if(node[key]!==undefined&&!/^#[\da-f]{6}$/i.test(node[key]))fail('Invalid '+key);
}
function validateEdge(edge){
  if(edge.label!==undefined)text(edge.label,80,'label');
  if(edge.color!==undefined&&!/^#[\da-f]{6}$/i.test(edge.color))fail('Invalid color');
  for(const [key,min,max]of [['width',.5,12],['curvature',0,1],['offset',-1000,1000],['cornerRadius',0,300]])if(edge[key]!==undefined)finite(edge[key],min,max,key);
  for(const [key,values]of [['lineStyle',['solid','dashed']],['routing',['curve','rounded']],['fromPort',['auto','top','right','bottom','left']],['toPort',['auto','top','right','bottom','left']]])if(edge[key]!==undefined&&!values.includes(edge[key]))fail('Invalid '+key);
  for(const key of ['controlPoints','waypoints'])if(edge[key]!=null){if(!Array.isArray(edge[key])||(key==='controlPoints'?edge[key].length!==2:edge[key].length>12))fail('Invalid '+key);for(const point of edge[key]){fields(point,['x','y']);finite(point.x,-100000,100000,key);finite(point.y,-100000,100000,key)}}
}
function applyOperations(state,operations){
  if(!Array.isArray(operations)||!operations.length||operations.length>100)fail('Supply 1..100 operations');
  const next=structuredClone(state),affectedNodes=new Set(),affectedEdges=new Set();
  for(const op of operations){
    fields(op,['op','id','patch']);text(op.id,160,'id');if(!op.id||/^[\s]|[\x00-\x1f]/.test(op.id))fail('Invalid id');
    const publicGraph=aiMap(next).graph,readable=new Map(publicGraph.nodes.map(n=>[n.id,n]));
    const node=next.graph.nodes.find(n=>n.id===op.id),edge=next.graph.edges.find(e=>e.id===op.id);
    const allowNode=id=>{if(!readable.has(id))throw new ApiError(403,'Object is not AI-accessible')};
    if(op.op==='node.create'||op.op==='node.update'){
      fields(op.patch,nodeFields);
      if(op.op==='node.create'&&node)throw new ApiError(409,'Object already exists');
      if(op.op==='node.update'){allowNode(op.id);if(readable.get(op.id).textWithheld&&['title','note','mark'].some(key=>key in op.patch))throw new ApiError(403,'Object text is withheld')}
      const updated={...(node||{id:op.id,title:'新想法',note:'',shape:'ellipse',x:0,y:0}),...op.patch};validateNode(updated);
      if(node)Object.assign(node,updated);else next.graph.nodes.push(updated);affectedNodes.add(op.id);
    }else if(op.op==='node.delete'){
      allowNode(op.id);for(const relation of next.graph.edges.filter(e=>e.from===op.id||e.to===op.id))affectedEdges.add(relation.id);
      for(const child of next.graph.nodes.filter(n=>n.parentId===op.id))affectedNodes.add(child.id);
      removeNode(next.graph,op.id);affectedNodes.add(op.id);
    }else if(['edge.create','edge.update','edge.delete'].includes(op.op)){
      if(op.op==='edge.create'&&edge)throw new ApiError(409,'Connection already exists');
      if(op.op!=='edge.create'&&!publicGraph.edges.some(e=>e.id===op.id))throw new ApiError(403,'Connection is not AI-accessible');
      if(op.op==='edge.delete'){removeEdge(next.graph,op.id);affectedEdges.add(op.id);for(const n of state.graph.nodes)if(n.id===edge.from&&n.parentId===edge.to||n.id===edge.to&&n.parentId===edge.from)affectedNodes.add(n.id);continue}
      fields(op.patch,edgeFields);const updated={...(edge||{id:op.id,label:'',routing:'curve'}),...op.patch};
      allowNode(updated.from);allowNode(updated.to);if(updated.from===updated.to)fail('Self connection is not allowed');
      if(next.graph.edges.some(e=>e.id!==op.id&&(e.from===updated.from&&e.to===updated.to||e.to===updated.from&&e.from===updated.to)))throw new ApiError(409,'Objects are already connected');
      if('label'in op.patch&&(readable.get(updated.from).textWithheld||readable.get(updated.to).textWithheld))throw new ApiError(403,'Connection text is withheld');
      validateEdge(updated);
      if(edge&&(edge.from!==updated.from||edge.to!==updated.to))for(const n of next.graph.nodes)if(n.id===edge.from&&n.parentId===edge.to||n.id===edge.to&&n.parentId===edge.from){n.parentId=null;affectedNodes.add(n.id)}
      if(edge)Object.assign(edge,updated);else next.graph.edges.push(updated);affectedEdges.add(op.id);
    }else fail('Unknown operation');
  }
  return {next,affectedNodes:[...affectedNodes],affectedEdges:[...affectedEdges]};
}
function publicHistory(record,current){
  const currentNodes=new Map(current.graph.nodes.map(n=>[n.id,n]));
  const project=snapshot=>aiMap({...snapshot,settings:current.settings,graph:{...snapshot.graph,nodes:snapshot.graph.nodes.map(n=>({...n,aiVisibility:currentNodes.get(n.id)?.aiVisibility??n.aiVisibility}))}}).graph;
  const before=project(record.before),after=project(record.after);
  const pick=graph=>({nodes:graph.nodes.filter(n=>record.affectedNodes.includes(n.id)),edges:graph.edges.filter(e=>record.affectedEdges.includes(e.id))});
  const changes={before:pick(before),after:pick(after)},visibleIds=new Set([...before.nodes,...after.nodes].filter(n=>!n.textWithheld).map(n=>n.id));
  const edges=[...record.before.graph.edges,...record.after.graph.edges].filter(e=>record.affectedEdges.includes(e.id));
  const safe=record.affectedNodes.every(id=>visibleIds.has(id))&&edges.every(e=>visibleIds.has(e.from)&&visibleIds.has(e.to));
  return {id:record.id,requestId:record.requestId,actor:record.actor,reason:safe?record.reason:'[依隱私設定遮蔽]',time:record.time,status:record.status,baseRevision:record.baseRevision,revision:record.revision,changes};
}
function regionFor(state,input){
  const graph=aiMap(state).graph;
  let region=input.region;
  if(input.nodeIds){if(!Array.isArray(input.nodeIds)||!input.nodeIds.length||input.nodeIds.length>100)fail('Invalid nodeIds');const nodes=input.nodeIds.map(id=>graph.nodes.find(n=>n.id===id));if(nodes.some(n=>!n))throw new ApiError(403,'Object is not AI-accessible');const boxes=nodes.map(boxOf),left=Math.min(...boxes.map(b=>b.x))-60,top=Math.min(...boxes.map(b=>b.y))-60;region={x:left,y:top,width:Math.max(...boxes.map(b=>b.x+b.w))+60-left,height:Math.max(...boxes.map(b=>b.y+b.h))+60-top}}
  fields(region,['x','y','width','height']);for(const key of ['x','y'])finite(region[key],-100000,100000,key);for(const key of ['width','height'])finite(region[key],1,20000,key);
  const scale=input.scale??1;finite(scale,.1,3,'scale');if(region.width*scale>4096||region.height*scale>4096)fail('Output must fit 4096 × 4096; reduce scale');
  return {graph,region,scale,revision:state.revision};
}
function createApi({getState,flush,release,change,history,capture}){
  const token=crypto.randomBytes(32).toString('hex');let queue=Promise.resolve();
  const server=http.createServer((request,response)=>{
    const run=async()=>{
      const reply=(status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(data))};
      try{
        if(request.headers.origin||request.headers.authorization!=='Bearer '+token){reply(401,{error:'Local API token required; browser origins are not accepted'});return}
        const url=new URL(request.url,'http://localhost');let body={};
        if(request.method==='POST'){let text='';for await(const chunk of request){text+=chunk;if(Buffer.byteLength(text)>256*1024)throw new ApiError(413,'Request too large')}try{body=JSON.parse(text)}catch{fail('Invalid JSON')}}
        if(request.method==='GET'&&url.pathname==='/v1/describe'){reply(200,{version:1,endpoints:['GET /v1/graph','POST /v1/changes','GET /v1/history?limit=50&before=<record-id>','POST /v1/screenshot'],nodeFields,edgeFields,operations:['node.create','node.update','node.delete','edge.create','edge.update','edge.delete'],changeRequest:{requestId:'unique id',expectedRevision:'GET graph revision',actor:'AI name',reason:'why',operations:[{op:'edge.update',id:'edge-id',patch:{routing:'curve',curvature:.4,offset:30}}]},screenshotRequest:{region:{x:0,y:0,width:1000,height:700},scale:1},privacy:'AI-filtered graph/history/screenshots; privacy controls cannot be changed through this API'});return}
        if(request.method==='GET'&&url.pathname==='/v1/graph'){await flush(false);const state=getState();reply(200,{...aiMap(state),revision:state.revision});return}
        if(request.method==='GET'&&url.pathname==='/v1/history'){await flush(false);const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),records=history();let start=0;const before=url.searchParams.get('before');if(before){start=records.findIndex(r=>r.id===before)+1;if(!start)fail('Unknown history cursor')}const selected=records.slice(start,start+limit);reply(200,{records:selected.map(r=>publicHistory(r,getState())),nextCursor:start+limit<records.length?selected.at(-1)?.id:null});return}
        if(request.method==='POST'&&url.pathname==='/v1/changes'){await flush(true);try{const result=change(body);reply(200,result)}finally{release()}return}
        if(request.method==='POST'&&url.pathname==='/v1/screenshot'){await flush(false);const scene=regionFor(getState(),body),png=await capture(scene);response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Map-Revision':String(scene.revision),'X-Map-Region':JSON.stringify(scene.region),'X-Map-Privacy':'AI-filtered'});response.end(png);return}
        reply(404,{error:'Unknown endpoint'});
      }catch(error){reply(error.status||500,{error:error.status?error.message:'Map API failed'})}
    };queue=queue.then(run,run);
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,token};
}
module.exports={ApiError,applyOperations,publicHistory,regionFor,createApi};
