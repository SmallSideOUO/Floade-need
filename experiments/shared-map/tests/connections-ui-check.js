async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const node=id=>page.locator('.node[data-id="'+id+'"]'),panel=(kind,id)=>page.locator('.object-panel[data-kind="'+kind+'"][data-panel-id="'+id+'"]');
  const state=()=>page.evaluate(()=>window.mapStore.load()); // Isolated synthetic profile only.
  async function closePanels(){while(await page.locator('.object-panel').count())await page.locator('.object-panel [data-action="close"]').last().click()}
  await closePanels();
  check(await page.locator('[data-menu="arrange"],[data-action="focus"],[data-action="connect"],[data-field="parentId"]').count()===0,'Removed controls remain');
  check(await page.locator('.connection-line[stroke-dasharray]').count()===0,'Existing connections should default to solid');
  const initial=await state();check(await page.locator('.connection-hit').count()===initial.graph.edges.length,'Some connections are not clickable');
  const cb=await page.locator('#canvas').boundingBox();
  async function create(x,y,title){await page.mouse.click(cb.x+x,cb.y+y,{button:'right'});await page.locator('[data-menu="create"]').click();const id=await page.locator('.node[data-selected="true"]').getAttribute('data-id');await panel('node',id).locator('[data-field="title"]').fill(title);await closePanels();return id}
  const source=await create(100,cb.height-100,'SOURCE_FIXTURE'),target=await create(cb.width-100,cb.height-100,'TARGET_FIXTURE');
  const before=await state(),originalBox=await node(source).boundingBox();
  await page.mouse.move(cb.x+20,cb.y+20);check(await node(source).locator('[data-port="right"]').evaluate(element=>getComputedStyle(element).opacity)==='0','Ports should be hidden without hover');
  async function start(){await node(source).hover();const port=node(source).locator('[data-port="right"]');check(await port.evaluate(element=>getComputedStyle(element).opacity)==='1','Hover ports missing');const bounds=await port.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down()}
  async function dropTarget(){const bounds=await node(target).boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2,{steps:8});check(await page.locator('.connection-preview').count()===1,'Link preview missing');await page.mouse.up()}
  await start();await dropTarget();await page.waitForTimeout(200);
  const linked=await state(),edge=linked.graph.edges.find(edge=>edge.from===source&&edge.to===target||edge.to===source&&edge.from===target);
  check(Boolean(edge)&&linked.graph.edges.length===before.graph.edges.length+1,'Port drag did not create connection');
  const afterBox=await node(source).boundingBox();check(Math.abs(afterBox.x-originalBox.x)<1&&Math.abs(afterBox.y-originalBox.y)<1,'Port drag moved source object');
  await start();await dropTarget();await page.waitForTimeout(180);check((await state()).graph.edges.length===linked.graph.edges.length,'Duplicate connection created');
  await start();await page.mouse.move(cb.x+30,cb.y+30,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();check(await page.locator('.connection-preview').count()===0,'Escape left preview');await page.waitForTimeout(180);check((await state()).graph.edges.length===linked.graph.edges.length,'Cancelled connection created');
  await start();await page.mouse.move(cb.x+20,cb.y+20,{steps:4});await page.mouse.up();await page.waitForTimeout(180);check((await state()).graph.edges.length===linked.graph.edges.length,'Blank drop created connection');
  const hit=page.locator('.connection-hit[data-edge-id="'+edge.id+'"]');
  const clickPoint=await hit.evaluate(element=>{const length=element.getTotalLength(),matrix=element.getScreenCTM();for(const fraction of [.5,.35,.65,.2,.8]){const point=element.getPointAtLength(length*fraction),screen=new DOMPoint(point.x,point.y).matrixTransform(matrix);if(document.elementFromPoint(screen.x,screen.y)?.getAttribute('data-edge-id')===element.dataset.edgeId)return{x:screen.x,y:screen.y}}throw new Error('No unobstructed line click point')});
  await page.mouse.click(clickPoint.x,clickPoint.y);const editor=panel('edge',edge.id);check(await editor.count()===1,'Click line did not open editor');
  check(await editor.locator('[data-field="edgeStyle"]').inputValue()==='solid','New connection is not solid');
  await editor.locator('[data-field="edgeColor"]').evaluate(element=>{element.value='#cc8844';element.dispatchEvent(new Event('input',{bubbles:true}))});
  await editor.locator('[data-field="edgeWidth"]').fill('4');await editor.locator('[data-field="edgeWidth"]').dispatchEvent('change');await editor.locator('[data-field="edgeStyle"]').selectOption('dashed');await editor.locator('[data-field="edgeLabel"]').fill('PRIVATE_EDGE_LABEL_FIXTURE');
  let appearance=await page.locator('.connection-line[data-edge-id="'+edge.id+'"]').evaluate(element=>({color:element.getAttribute('stroke'),width:element.getAttribute('stroke-width'),dash:element.getAttribute('stroke-dasharray')}));
  check(appearance.color==='#cc8844'&&appearance.width==='4'&&appearance.dash==='7 5','Line appearance edits failed');
  await page.waitForTimeout(200);await page.reload();await node(source).waitFor();check(await panel('edge',edge.id).count()===1,'Edge panel lost on reload');
  const saved=(await state()).graph.edges.find(item=>item.id===edge.id);check(saved.color==='#cc8844'&&saved.width===4&&saved.lineStyle==='dashed','Line styles did not persist');
  await node(source).click();await panel('node',source).locator('[data-field="visualVisibility"]').selectOption('text');check(await panel('edge',edge.id).locator('[data-field="edgeLabel"]').isDisabled(),'Masked endpoint leaked edge editor text');
  await panel('node',source).locator('[data-field="aiVisibility"]').selectOption('text');await panel('edge',edge.id).locator('[data-field="edgeStyle"]').selectOption('solid');check(await page.locator('.connection-line[data-edge-id="'+edge.id+'"]').getAttribute('stroke-dasharray')===null,'Switch to solid failed');
  await closePanels();await node(source).click({button:'right'});check(await page.locator('[data-menu="delete"]').isVisible(),'Object delete menu missing');await page.locator('[data-menu="delete"]').click();
  await page.waitForTimeout(200);check(await node(source).count()===0,'Context delete did not remove object');check(await page.locator('.connection-line[data-edge-id="'+edge.id+'"]').count()===0,'Deleting object left connected line');
  await page.reload();await node(target).waitFor();check(await node(source).count()===0,'Deleted object returned on reload');check((await state()).graph.edges.every(item=>item.id!==edge.id),'Deleted connection returned');
  check(errors.length===0,'Runtime errors: '+errors.join('; '));
  return {passed:true,checks:['removed controls','all old lines selectable and solid','hover ports','drag connection preview','no object movement','duplicate rejection','Escape cancel','blank drop cancel','click line editor','color width dashed solid','style persistence','edge privacy','right-click object delete','deletion persistence']};
}
