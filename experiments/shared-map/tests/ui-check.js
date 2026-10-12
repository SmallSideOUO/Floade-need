async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const panel=id=>page.locator('.object-panel[data-kind="node"][data-panel-id="'+id+'"]');
  const field=(id,name)=>panel(id).locator('[data-field="'+name+'"]');
  await page.locator('.node').first().waitFor();
  check(await page.locator('.node').count()===10,'Fixture should start with ten objects');
  check(await page.locator('header,aside,nav,#outline-panel,#context-trail,.brand,.focus').count()===0,'Removed chrome remains');
  check(await page.locator('.object-panel').count()===0,'Panels should open on demand');
  const initial=await page.evaluate(()=>window.mapStore.load()); // This is an isolated synthetic test profile.
  const root=initial.graph.nodes.find(node=>node.id==='world');
  check(initial.graph.nodes.filter(node=>node.id!=='world').every(node=>node.y>root.y),'Primary purpose is not at the top');
  for(const node of initial.graph.nodes.filter(node=>node.parentId))check(node.y>initial.graph.nodes.find(parent=>parent.id===node.parentId).y,'Child is above parent');
  const cb=await page.locator('#canvas').boundingBox(),world=page.locator('.node[data-id="world"]'),before=await world.boundingBox();
  await page.mouse.move(cb.x+20,cb.y+20);await page.mouse.down({button:'middle'});await page.mouse.move(cb.x+70,cb.y+55,{steps:6});await page.mouse.up({button:'middle'});
  const after=await world.boundingBox();check(Math.abs(after.x-before.x-50)<2&&Math.abs(after.y-before.y-35)<2,'Middle pan failed');
  await page.mouse.move(cb.x+20,cb.y+20);await page.mouse.down();await page.mouse.move(cb.x+60,cb.y+45,{steps:4});await page.mouse.up();check(Math.abs((await world.boundingBox()).x-after.x)<1,'Left blank pans canvas');
  await page.mouse.click(cb.x+80,cb.y+100,{button:'right'});check(await page.locator('.node').count()===10,'Right click created without menu choice');
  check(await page.locator('#context-menu').isVisible(),'Context menu missing');await page.keyboard.press('Escape');check(await page.locator('#context-menu').isHidden(),'Escape did not dismiss menu');
  await page.mouse.click(cb.x+80,cb.y+100,{button:'right'});await page.locator('[data-menu="create"]').click();
  const id=await page.locator('.node[data-selected="true"]').getAttribute('data-id'),created=page.locator('.node[data-id="'+id+'"]'),box=await created.boundingBox();
  check(await page.locator('.node').count()===11,'Menu creation failed');check(Math.abs(box.x+box.width/2-cb.x-80)<2&&Math.abs(box.y+box.height/2-cb.y-100)<2,'Creation moved from right-click position');
  await field(id,'title').fill('UI_PRIVATE_TITLE_8076');await field(id,'note').fill('UI_PRIVATE_NOTE_2319');await field(id,'parentId').selectOption('world');
  // Open another object while retaining the first panel, then edit the first.
  await world.click();check(await page.locator('.object-panel[data-kind="node"]').count()===2,'Second object replaced first panel');
  const originalRootTitle=await field('world','title').inputValue();await field(id,'note').fill('UI_PRIVATE_NOTE_2319 updated');check(await field('world','title').inputValue()===originalRootTitle,'Panel bindings edited the selected object instead of their own');
  const floating=await panel(id).boundingBox(),heading=await panel(id).locator('.panel-heading').boundingBox();
  await page.mouse.move(heading.x+30,heading.y+12);await page.mouse.down();await page.mouse.move(heading.x+85,heading.y+40,{steps:6});await page.mouse.up();
  const dragged=await panel(id).boundingBox();check(Math.abs(dragged.x-floating.x-55)<2&&Math.abs(dragged.y-floating.y-28)<2,'Floating panel drag failed');
  const panStart=await panel(id).boundingBox();await page.mouse.move(cb.x+20,cb.y+20);await page.mouse.down({button:'middle'});await page.mouse.move(cb.x+45,cb.y+35,{steps:5});await page.mouse.up({button:'middle'});
  const panEnd=await panel(id).boundingBox();check(Math.abs(panEnd.x-panStart.x-25)<2&&Math.abs(panEnd.y-panStart.y-15)<2,'Panel did not move with canvas');
  await panel('world').locator('[data-action="close"]').click();check(await panel(id).count()===1&&await panel('world').count()===0,'Close removed other panels');
  await panel(id).locator('summary').click();await field(id,'shape').selectOption('rounded');
  await field(id,'background').evaluate(element=>{element.value='#503f28';element.dispatchEvent(new Event('input',{bubbles:true}))});await field(id,'textColor').evaluate(element=>{element.value='#ffeecc';element.dispatchEvent(new Event('input',{bubbles:true}))});
  await field(id,'width').fill('280');await field(id,'width').dispatchEvent('change');await field(id,'height').fill('140');await field(id,'height').dispatchEvent('change');await field(id,'opacity').evaluate(element=>{element.value='65';element.dispatchEvent(new Event('input',{bubbles:true}))});
  const props=await created.evaluate(element=>({fill:getComputedStyle(element.querySelector('.node-shape')).fill,text:getComputedStyle(element.querySelector('strong')).color,opacity:getComputedStyle(element).opacity}));
  check(props.fill==='rgb(80, 63, 40)'&&props.text==='rgb(255, 238, 204)'&&props.opacity==='0.65','Appearance controls failed');
  // The panel stays open across blank clicks; select its object to expose the resize handle.
  await created.click();const preResize=await created.boundingBox(),resize=await page.locator('.resize-handle').boundingBox();
  await page.mouse.move(resize.x+5,resize.y+5);await page.mouse.down();await page.mouse.move(resize.x+35,resize.y+25,{steps:5});await page.mouse.up();check((await created.boundingBox()).width>preResize.width+20,'Object resize failed');
  const start=await created.boundingBox();await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+start.width/2+40,start.y+start.height/2+20,{steps:5});await page.mouse.up();check(Math.abs((await created.boundingBox()).x-start.x-40)<2,'Object drag failed');
  await world.click();check(await page.locator('.object-panel[data-kind="node"]').count()===2,'Panels lost after selecting another node');
  await field(id,'aiVisibility').selectOption('text');check((await created.textContent()).includes('UI_PRIVATE_TITLE_8076'),'AI hide changed visual display');
  await field(id,'visualVisibility').selectOption('text');check(await field(id,'title').inputValue()==='[視覺遮蔽]'&&await field(id,'note').inputValue()==='[視覺遮蔽]','Masked editor leaked');check(!(await page.locator('body').innerText()).includes('UI_PRIVATE_TITLE_8076'),'Panel headings or parent options leaked');
  await page.locator('#ai-mode').selectOption('open');check(await field(id,'title').isDisabled(),'AI open revealed visual text');
  await page.locator('#visual-mode').selectOption('show');check(await field(id,'title').inputValue()==='UI_PRIVATE_TITLE_8076','Visual show failed');
  await page.locator('#visual-mode').selectOption('mask');check(await field('world','title').isDisabled()&&await field(id,'title').isDisabled(),'Global mask did not affect every open panel');
  await page.locator('#visual-mode').selectOption('show');await page.locator('#ai-mode').selectOption('protected');await field(id,'aiVisibility').selectOption('object');await field(id,'visualVisibility').selectOption('object');
  await page.locator('#visual-mode').selectOption('selective');check(await created.count()===0&&await panel(id).count()===0,'Hidden object left its panel visible');
  await page.locator('#visual-mode').selectOption('mask');check(await created.count()===0,'Global mask revealed hidden object');
  await page.locator('#visual-mode').selectOption('show');await created.click();await field(id,'visualVisibility').selectOption('text');await field(id,'aiVisibility').selectOption('text');await page.locator('#visual-mode').selectOption('selective');
  await page.waitForTimeout(250);await page.reload();await page.locator('.node').first().waitFor();
  check(await page.locator('.object-panel[data-kind="node"]').count()===2,'Open panels lost on reload');check(await field(id,'title').isDisabled(),'Reload lost visual privacy');
  const saved=await page.evaluate(()=>window.mapStore.load());const savedNode=saved.graph.nodes.find(node=>node.id===id);check(savedNode.parentId==='world'&&savedNode.background==='#503f28'&&savedNode.opacity===.65,'Reload lost object settings');
  check(await field(id,'parentId').locator('option[value="'+id+'"]').count()===0,'Self parenting allowed');check(errors.length===0,'Runtime errors: '+errors.join('; '));
  const output=decodeURIComponent(new URL(page.url()).pathname).replace(/^\/(?=[A-Za-z]:)/,'').replace(/\/index.html$/,'/test-output/ui.png');await page.screenshot({path:output});
  return {passed:true,createdId:id,checks:['top-down placement','removed headers and sidebars','context menu creation','multiple independently bound panels','panel dragging and panning','individual close','object appearance resize drag','privacy across all open panels','hidden panels removed','encrypted reload persistence']};
}
