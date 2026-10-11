'use strict';
function aiMap(state){
 const g=state.graph,open=state.settings?.aiMode==='open';
 const kept=new Set(g.nodes.filter(n=>open||n.aiVisibility!=='object').map(n=>n.id));
 const masked=new Set(g.nodes.filter(n=>!open&&n.aiVisibility==='text').map(n=>n.id));
 const nodes=g.nodes.filter(n=>kept.has(n.id)).map(n=>{
  const out={id:n.id,x:n.x,y:n.y,shape:n.shape||'ellipse'};
  for(const key of ['width','height','opacity','background','textColor'])if(n[key]!==undefined)out[key]=n[key];
  if(n.parentId&&kept.has(n.parentId))out.parentId=n.parentId;
  if(masked.has(n.id)){out.title='[已遮蔽]';out.textWithheld=true;}else{out.title=n.title||'';out.note=n.note||'';if(n.mark)out.mark=n.mark;}
  return out;
 });
 const edges=g.edges.filter(e=>kept.has(e.from)&&kept.has(e.to)).map(e=>({id:e.id,from:e.from,to:e.to,label:masked.has(e.from)||masked.has(e.to)?'':e.label||''}));
 return {version:1,access:open?'全部開放':'依物件隱私設定',graph:{version:1,current:kept.has(g.current)?g.current:null,nodes,edges}};
}
module.exports={aiMap};
