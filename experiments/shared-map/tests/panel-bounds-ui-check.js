async page => {
  // This script is only for a dedicated synthetic --map-profile.
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.reload();await page.locator('.node').first().waitFor();
  const check=(value,message)=>{if(!value)throw new Error(message)};
  const read=()=>page.evaluate(()=>window.mapStore.load());
  const initial=await read();check(initial.graph.nodes.length===10,'Use a fresh synthetic profile');
  const closeAll=async()=>{for(const button of await page.locator('.object-panel [data-action="close"]').all())await button.click()};
  const fit=async()=>{await page.locator('#minimap').focus();await page.keyboard.press('f')};
  const inside=async()=>{
    await page.waitForFunction(()=>{
      const canvas=document.querySelector('#canvas').getBoundingClientRect(),panels=[...document.querySelectorAll('.object-panel')];
      return panels.length&&panels.every(el=>{const b=el.getBoundingClientRect();return b.left>=canvas.left+11&&b.top>=canvas.top+11&&b.right<=canvas.right-11&&b.bottom<=canvas.bottom-11});
    },{},{timeout:4000});
    const result=await page.evaluate(()=>{
      const canvas=document.querySelector('#canvas').getBoundingClientRect();
      return [...document.querySelectorAll('.object-panel')].map(el=>{const box=el.getBoundingClientRect();return {kind:el.dataset.kind,inside:box.left>=canvas.left+11&&box.top>=canvas.top+11&&box.right<=canvas.right-11&&box.bottom<=canvas.bottom-11}});
    });
    check(result.length>0&&result.every(item=>item.inside),'Panel escaped the canvas: '+JSON.stringify(result));
  };
  const nodePanel=page.locator('.object-panel[data-kind="node"][data-panel-id="world"]');
  await closeAll();await page.setViewportSize({width:1320,height:860});await page.locator('#visual-mode').selectOption('show');await fit();
  await page.locator('.node[data-id="world"]').click();await inside();
  await nodePanel.locator('summary').click();await inside();
  // A short window must scroll its content while keeping the heading reachable.
  await page.setViewportSize({width:800,height:420});await inside();
  const body=nodePanel.locator('.panel-body');check(await body.evaluate(el=>el.scrollHeight>el.clientHeight),'Short panel has no internal scroll');
  for(const selector of ['[data-field="title"]','[data-field="shape"]','[data-field="opacity"]','[data-action="delete"]']){
    const control=nodePanel.locator(selector);await control.scrollIntoViewIfNeeded();
    check(await control.evaluate(el=>{const box=el.getBoundingClientRect(),body=el.closest('.panel-body').getBoundingClientRect();const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return box.top>=body.top-1&&box.bottom<=body.bottom+1&&(hit===el||el.contains(hit));}),'Control remains clipped or covered: '+selector);
  }
  async function dragTo(x,y){const heading=await nodePanel.locator('.panel-heading').boundingBox();await page.mouse.move(heading.x+50,heading.y+heading.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:8});await page.mouse.up();await inside();}
  await dragTo(2,2);
  check(await nodePanel.locator('[data-action="close"]').evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return hit===el||el.contains(hit)}),'Minimap covers panel controls');
  await dragTo(798,360);
  // Panning and zooming should keep the complete panel inside the viewport.
  const canvas=await page.locator('#canvas').boundingBox();await page.mouse.move(canvas.x+30,canvas.y+canvas.height-20);await page.mouse.down({button:'middle'});await page.mouse.move(canvas.x+500,canvas.y+30,{steps:8});await page.mouse.up({button:'middle'});await inside();
  await page.mouse.move(canvas.x+20,canvas.y+canvas.height-60);const scale=await page.locator('#scale').textContent();
  await page.mouse.wheel(0,-500);await page.waitForFunction(previous=>document.querySelector('#scale').textContent!==previous,scale);await inside();
  // Restore deliberately invalid historical panel positions in the synthetic profile.
  await page.waitForTimeout(220);await page.evaluate(async()=>{const state=await window.mapStore.load();state.panels=state.panels.map(panel=>({...panel,x:100000,y:-100000}));const result=window.mapStore.saveNow(state);if(result.error)throw new Error(result.error)});
  await page.reload();await nodePanel.waitFor();await inside();
  await closeAll();await fit();
  await page.locator('.node[data-id="world"]').click();
  const related=nodePanel.locator('[data-related] button').first();await related.scrollIntoViewIfNeeded();await related.click();await inside();
  const edgePanel=page.locator('.object-panel[data-kind="edge"]');check(await edgePanel.count()===1,'Edge panel did not open');
  await nodePanel.locator('[data-action="close"]').click();
  const label=edgePanel.locator('[data-field="edgeLabel"]');await label.fill('PANEL_BOUNDS_EDGE');await inside();
  await closeAll();await fit();await page.locator('.note-orb[data-node-id="world"]').click();
  const note=page.locator('.note-popover[data-panel-id="world"]'),editor=note.locator('textarea');await inside();
  await editor.evaluate(el=>{el.style.height='360px'});await inside();
  await page.setViewportSize({width:380,height:300});await inside();
  await editor.scrollIntoViewIfNeeded();await editor.fill('PANEL_BOUNDS_NOTE');
  check(await editor.inputValue()==='PANEL_BOUNDS_NOTE','Small note editor is not usable');
  // Revealing a masked note remains reachable at the bottom of the note body.
  await page.locator('#visual-mode').selectOption('mask');
  const reveal=note.locator('[data-action="reveal"]');await reveal.scrollIntoViewIfNeeded();await reveal.click();await inside();
  check(!await editor.isDisabled(),'Reveal button is unreachable');
  await page.setViewportSize({width:1320,height:860});await inside();
  await page.waitForTimeout(220);await page.reload();await note.waitFor();await inside();
  check(errors.length===0,'Renderer errors: '+errors.join('; '));
  return {passed:true,checks:['node and edge and note panels','expanded content','short and narrow viewport','all controls reachable by scrolling','drag to every edge','minimap cannot cover controls','pan and zoom','restore old offscreen positions','textarea resizing','masked-note reveal','reload']};
}
