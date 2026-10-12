'use strict';
window.renderScene=async ({graph,region,scale})=>{
  const {routes,boxOf,shapePath,style}=window.mapConnections;
  const svg=document.querySelector('#lines'),ns='http://www.w3.org/2000/svg';
  const element=(name,attrs={})=>{const e=document.createElementNS(ns,name);for(const[key,value]of Object.entries(attrs))e.setAttribute(key,value);return e};
  svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${innerWidth} ${innerHeight}`);
  const drawing=element('g',{transform:`scale(${scale}) translate(${-region.x} ${-region.y})`});svg.append(drawing);
  const routeMap=routes(graph),lookup=new Map(graph.nodes.map(n=>[n.id,n]));
  for(const edge of graph.edges){const line=routeMap.get(edge.id);if(!line)continue;const appearance=style(edge),attrs={d:line.d,fill:'none',stroke:appearance.color,'stroke-width':appearance.width,'vector-effect':'non-scaling-stroke','stroke-linecap':'round','stroke-linejoin':'round',opacity:Math.min(lookup.get(edge.from).opacity??1,lookup.get(edge.to).opacity??1)};if(appearance.lineStyle==='dashed')attrs['stroke-dasharray']='7 5';drawing.append(element('path',attrs));if(edge.label&&scale>=.65){const p=line.points[Math.floor(line.points.length/2)],text=element('text',{x:p.x,y:p.y-9/scale,fill:'#9999a5','font-size':11/scale,'text-anchor':'middle'});text.textContent=edge.label;drawing.append(text)}}
  for(const node of graph.nodes){const box=boxOf(node),group=element('g',{transform:`translate(${box.x} ${box.y})`,opacity:node.opacity??1});const shape=element('path',{d:shapePath(node),transform:`scale(${box.w/100} ${box.h/100})`,fill:node.background||'#17171b',stroke:'#3b3b43','stroke-width':1.3,'vector-effect':'non-scaling-stroke'});group.append(shape);const foreign=element('foreignObject',{width:box.w,height:box.h}),copy=document.createElement('div');copy.className='scene-text';copy.style.color=node.textColor||'#eeeef1';copy.style.fontSize=Math.max(9,Math.min(15,13*scale))/scale+'px';const title=document.createElement('strong');title.textContent=node.title||'未命名';title.style.fontWeight='500';copy.append(title);if(node.mark&&scale>=.65){const mark=document.createElement('small');mark.textContent=node.mark;mark.style.fontSize=10/scale+'px';mark.style.opacity='.65';mark.style.marginTop='4px';copy.append(mark)}foreign.append(copy);group.append(foreign);drawing.append(group)}
  await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return {width:innerWidth,height:innerHeight};
};
