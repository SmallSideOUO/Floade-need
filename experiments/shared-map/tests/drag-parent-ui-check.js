async page => {
  // Dedicated synthetic --map-profile only, never the user's private map.
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.reload();await page.locator('.node').first().waitFor();
  const check=(value,message)=>{if(!value)throw new Error(message)};
  const read=()=>page.evaluate(()=>window.mapStore.load());
  const initial=await read();check(initial.graph.nodes.length===10,'Use a synthetic profile');
  for(const close of await page.locator('.object-panel [data-action="close"]').all())await close.click();
  await page.locator('#visual-mode').selectOption('show');await page.locator('#minimap').focus();await page.keyboard.press('f');
  const node=id=>page.locator('.node[data-id="'+id+'"]');
  async function start(id,target,edge){
    const a=await node(id).boundingBox(),b=await node(target).boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(edge==='left'?b.x+2:edge==='right'?b.x+b.width-2:b.x+b.width/2,b.y+b.height/2,{steps:8});
  }
  async function finish(){await page.mouse.up();await page.waitForTimeout(180);return read()}
  await start('happy','funding');
  check(await node('funding').getAttribute('data-link-target')==='true','New parent was not highlighted');
  check(await page.locator('.sibling-drop-marker').count()===0,'Center drop incorrectly offered sibling ordering');
  let saved=await finish();
  check(saved.graph.nodes.find(n=>n.id==='happy').parentId==='funding','Center drop on sibling did not reparent');
  for(const old of initial.graph.nodes.filter(n=>n.id!=='happy'))check(saved.graph.nodes.find(n=>n.id===old.id).parentId===old.parentId,'Moving subtree changed descendant ancestry');
  check(saved.graph.edges.filter(e=>e.to==='happy').length===1&&saved.graph.edges.some(e=>e.from==='funding'&&e.to==='happy'),'Reparent created multiple parent lines');
  await page.reload();await node('happy').waitFor();
  check((await read()).graph.nodes.find(n=>n.id==='happy').parentId==='funding','Reload lost drag parent');
  await start('happy','product');saved=await finish();check(saved.graph.nodes.find(n=>n.id==='happy').parentId==='product','Cross-level drop did not reparent');
  let before=await read();await start('happy','quality');
  check(await node('quality').getAttribute('data-drop-invalid')==='true','Descendant target was not marked invalid');
  saved=await finish();check(JSON.stringify(saved.graph)===JSON.stringify(before.graph),'Descendant drop created a cycle or changed graph');
  check((await page.locator('#save-status').textContent()).includes('子孫'),'Invalid drop was not explained');
  await start('world','funding');saved=await finish();check(saved.graph.nodes.find(n=>n.id==='world').parentId===null,'Root could be reparented');
  before=await read();await start('happy','funding');await page.keyboard.press('Escape');saved=await finish();check(JSON.stringify(saved.graph)===JSON.stringify(before.graph),'Escape committed a reparent');
  const edgeSnapshot=JSON.stringify(saved.graph.edges);
  await start('funding','happy','left');check(await page.locator('.sibling-drop-marker').count()===1,'Left-edge drop has no ordering marker');saved=await finish();
  check(saved.graph.nodes.find(n=>n.id==='funding').x<saved.graph.nodes.find(n=>n.id==='happy').x,'Left-edge drop did not reorder');
  await start('funding','happy','right');saved=await finish();
  check(saved.graph.nodes.find(n=>n.id==='funding').x>saved.graph.nodes.find(n=>n.id==='happy').x,'Right-edge drop did not reorder');
  check(JSON.stringify(saved.graph.edges)===edgeSnapshot,'Edge ordering changed parent lines');
  check(await page.locator('.object-panel').count()===0,'Drag opened an editing panel');
  for(const old of initial.graph.nodes){const updated=saved.graph.nodes.find(n=>n.id===old.id);check(updated.title===old.title&&updated.note===old.note,'Drag changed node text')}
  check(errors.length===0,'Renderer errors: '+errors.join('; '));
  return {passed:true,checks:['center drop changes parent','cross-level drop','subtree preserved','one parent line','reload persistence','descendant and root rejected','Escape cancels','left and right edges reorder','no text changes']};
}
