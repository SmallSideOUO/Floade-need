async page => {
  // Only run against a dedicated synthetic --map-profile, never the user map.
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.reload();await page.locator('.node').first().waitFor();
  const read=()=>page.evaluate(()=>window.mapStore.load());
  const check=(value,message)=>{if(!value)throw new Error(message)};
  const initial=await read();check(initial.graph.nodes.length===10,'Use a synthetic profile');
  for(const close of await page.locator('.object-panel [data-action="close"]').all())await close.click();
  await page.locator('#ai-mode').selectOption('protected');await page.locator('#visual-mode').selectOption('selective');
  const badges=page.locator('.node-visibility[data-node-id="funding"]');
  const badge=kind=>badges.locator('[data-kind="'+kind+'"]');
  const node=()=>page.locator('.node[data-id="funding"]');
  const configured=async field=>(await read()).graph.nodes.find(n=>n.id==='funding')[field]||'full';
  const click=async(kind,value)=>{await badge(kind).click();await page.waitForTimeout(180);check(await configured(kind==='ai'?'aiVisibility':'visualVisibility')===value,'Setting did not save: '+kind+' '+value)};
  for(const level of ['text','object','full']){
    await click('ai',level);check(await badge('ai').getAttribute('data-level')===level,'AI icon is stale');
    check(await badge('visual').getAttribute('data-level')==='full','AI toggle changed visual privacy');
    check(await page.locator('.object-panel').count()===0,'Icon opened an editing panel');
  }
  await click('ai','text');await page.reload();await node().waitFor();check(await badge('ai').getAttribute('data-level')==='text','Reload lost AI setting');
  await badge('ai').focus();await badge('ai').press('Enter');await page.waitForTimeout(180);
  check(await configured('aiVisibility')==='object','Enter did not toggle');
  check(await badge('ai').evaluate(el=>el===document.activeElement),'Keyboard toggle lost focus');
  await badge('ai').press('Space');await page.waitForTimeout(180);check(await configured('aiVisibility')==='full','Space did not toggle');
  await click('visual','text');check(await node().getAttribute('data-masked')==='true','Visual toggle did not mask node text');
  check(await configured('aiVisibility')==='full','Visual toggle changed AI privacy');
  await click('visual','object');check(await node().count()===0&&await badges.count()===0,'Object toggle did not hide the node and controls');
  await page.reload();check(await node().count()===0,'Reload lost hidden-object setting');
  await page.locator('#visual-mode').selectOption('show');
  check(await badge('visual').getAttribute('data-level')==='full'&&await badge('visual').getAttribute('data-configured')==='object'&&await badge('visual').getAttribute('data-override')==='true','Global show did not expose a truthful override state');
  await click('visual','full');check(await page.locator('#visual-mode').inputValue()==='show','Per-node click changed the global mode');
  await page.locator('#visual-mode').selectOption('selective');check(await node().getAttribute('data-masked')==='false','Hidden node could not be restored with icon');
  await page.locator('#ai-mode').selectOption('open');await click('ai','text');
  check(await badge('ai').getAttribute('data-level')==='full'&&await badge('ai').getAttribute('data-configured')==='text'&&await badge('ai').getAttribute('data-override')==='true','AI global override is misleading');
  check((await badge('ai').getAttribute('title')).includes('物件設定：遮蔽文字'),'Override tooltip omits the individual setting');
  await page.locator('#ai-mode').selectOption('protected');check(await badge('ai').getAttribute('data-level')==='text','Leaving global open lost individual setting');
  await node().click();const panel=page.locator('.object-panel[data-kind="node"][data-panel-id="funding"]');
  await click('ai','object');check(await panel.locator('[data-field="aiVisibility"]').inputValue()==='object','Open panel did not sync with icon');
  await panel.locator('[data-action="close"]').click();
  const final=await read();
  check(JSON.stringify(final.graph.edges)===JSON.stringify(initial.graph.edges),'Toggle changed tree edges');
  for(const old of initial.graph.nodes){const updated=final.graph.nodes.find(n=>n.id===old.id);for(const field of ['title','note','parentId','x','y'])check(updated[field]===old[field],'Toggle changed content or layout');}
  check(errors.length===0,'Renderer errors: '+errors.join('; '));
  return {passed:true,checks:['three AI states','no panels opened','AI and visual independent','save and reload','Enter and Space with retained focus','mask and hide','restore hidden object','global override semantics','existing panel synchronization','content and tree unchanged'],aiExcludedNode:'funding'};
}
