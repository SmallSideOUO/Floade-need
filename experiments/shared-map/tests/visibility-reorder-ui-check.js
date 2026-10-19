async page => {
  // Synthetic profile only. Never use private mapStore on the user's profile.
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.reload();await page.locator('.node').first().waitFor();
  const read=()=>page.evaluate(()=>window.mapStore.load());
  const check=(value,message)=>{if(!value)throw new Error(message)};
  check((await read()).graph.nodes.length===10,'Use a synthetic profile');
  await page.keyboard.press('Escape');
  for(const button of await page.locator('.object-panel [data-action="close"]').all())await button.click();
  await page.locator('#visual-mode').selectOption('show');await page.locator('#ai-mode').selectOption('protected');
  const badges=page.locator('.node-visibility[data-node-id="funding"]');
  check(await page.locator('.visibility-badge').count()===20,'Missing two visibility icons per visible node');
  await badges.locator('[data-kind="ai"]').click();
  check(await page.locator('.object-panel').count()===0,'Visibility icon opened a panel');
  check(await badges.locator('[data-kind="ai"]').getAttribute('data-level')==='text','AI icon did not toggle directly');
  await page.locator('.node[data-id="funding"]').click();
  const panel=page.locator('.object-panel[data-kind="node"][data-panel-id="funding"]');
  await panel.locator('[data-field="aiVisibility"]').selectOption('object');
  check(await badges.locator('[data-kind="ai"]').getAttribute('data-level')==='object','AI hidden-object state not shown');
  await page.locator('#ai-mode').selectOption('open');
  check(await badges.locator('[data-kind="ai"]').getAttribute('data-level')==='full'&&await badges.locator('[data-kind="ai"]').getAttribute('data-override')==='true','Global AI override icon is stale');
  await page.locator('#ai-mode').selectOption('protected');
  check(await badges.locator('[data-kind="ai"]').getAttribute('data-level')==='object','AI icon did not return to configured state');
  await panel.locator('[data-field="visualVisibility"]').selectOption('text');await page.locator('#visual-mode').selectOption('selective');
  check(await badges.locator('[data-kind="visual"]').getAttribute('data-level')==='text','Masked visual status missing');
  await page.locator('#visual-mode').selectOption('show');await panel.locator('[data-field="visualVisibility"]').selectOption('object');await page.locator('#visual-mode').selectOption('selective');
  check(await badges.count()===0,'Hidden object left visibility icons');
  await page.locator('#visual-mode').selectOption('show');await page.locator('.node[data-id="funding"]').click();
  await panel.locator('[data-field="visualVisibility"]').selectOption('full');await panel.locator('[data-field="aiVisibility"]').selectOption('full');await panel.locator('[data-action="close"]').click();
  await page.keyboard.press('f');await page.waitForTimeout(220);
  const initial=await read(),node=id=>page.locator('.node[data-id="'+id+'"]');
  const siblingIds=initial.graph.nodes.filter(n=>n.parentId==='product').sort((a,b)=>a.x-b.x).map(n=>n.id);
  check(siblingIds.length>=2,'Need two siblings');const moving=siblingIds.at(-1),first=siblingIds[0];
  async function drag(before){
    const start=await node(moving).boundingBox(),end=await node(first).boundingBox();
    await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
    await page.mouse.move(before?end.x+2:end.x+end.width-2,end.y+end.height/2,{steps:10});
    check(await page.locator('.sibling-drop-marker').count()===1,'Insertion indicator missing');await page.mouse.up();await page.waitForTimeout(220);
  }
  await drag(true);let saved=await read();
  check(saved.graph.nodes.find(n=>n.id===moving).x<saved.graph.nodes.find(n=>n.id===first).x,'Drag left did not reorder');
  check(JSON.stringify(saved.graph.edges)===JSON.stringify(initial.graph.edges),'Sibling drag changed parent lines');
  for(const old of initial.graph.nodes)check(saved.graph.nodes.find(n=>n.id===old.id).parentId===old.parentId,'Sibling drag changed ancestry');
  await page.reload();await node(moving).waitFor();saved=await read();
  check(saved.graph.nodes.find(n=>n.id===moving).x<saved.graph.nodes.find(n=>n.id===first).x,'Reload lost drag order');
  await drag(false);saved=await read();check(saved.graph.nodes.find(n=>n.id===moving).x>saved.graph.nodes.find(n=>n.id===first).x,'Drag right did not reorder');
  const start=await node(moving).boundingBox(),target=await node('world').boundingBox(),before=await read();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:10});await page.mouse.up();
  await page.waitForTimeout(220);
  check((await read()).graph.nodes.find(n=>n.id===moving).parentId==='world','Dragging onto another node did not change parent');
  check(errors.length===0,'Renderer errors: '+errors.join('; '));
  return {passed:true,checks:['AI and visual icons','direct icon toggle','global overrides','hidden object privacy','drag left and right','insertion indicator','subtree and edges retained','reload persistence','drag onto node changes parent']};
}
