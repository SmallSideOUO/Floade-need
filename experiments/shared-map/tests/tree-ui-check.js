async page => {
  // Run only on the dedicated synthetic --map-profile tree test, never user data.
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.reload();
  const check=(condition,message)=>{if(!condition)throw new Error(message)};
  const state=()=>page.evaluate(()=>window.mapStore.load());
  const panel=id=>page.locator('.object-panel[data-kind="node"][data-panel-id="'+id+'"]');
  const close=async()=>{for(const button of await page.locator('.object-panel [data-action="close"]').all())await button.click()};
  const valid=async()=>{
    const saved=await state(),g=saved.graph,lookup=new Map(g.nodes.map(n=>[n.id,n]));
    check(g.treeMode&&g.rootId==='world','Strict root missing');
    check(g.edges.length===g.nodes.length-1,'Not a tree');
    for(const node of g.nodes.filter(n=>n.id!==g.rootId)) {
      const parent=lookup.get(node.parentId);check(Boolean(parent),'Missing parent');
      check(g.edges.filter(e=>e.to===node.id&&e.from===node.parentId).length===1,'Multiple or absent parent line');
      check(node.y>=parent.y+(parent.height||(parent.shape==='circle'?140:parent.shape==='diamond'?130:100))+100,'Child is not below parent');
    }
    const depths=new Map();
    for(const node of g.nodes){let n=node,d=0;while(n.parentId){n=lookup.get(n.parentId);d++;check(d<g.nodes.length,'Cycle')};if(depths.has(d))check(depths.get(d)===node.y,'Same depth not aligned');else depths.set(d,node.y)}
    return saved;
  };
  await page.locator('.node').first().waitFor();
  check((await state()).graph.nodes.length===10,'Use a fresh synthetic tree fixture');
  await valid();
  check(await page.locator('.connection-port[data-port="left"],.connection-port[data-port="right"]').count()===0,'Free connection ports remain');
  check(await page.locator('.node[data-id="world"] .connection-port[data-port="top"]').count()===0,'Root has an input port');
  async function child(parentId,title){
    await close();await page.locator('.node[data-id="'+parentId+'"]').click({button:'right'});
    await page.locator('[data-menu="child"]').click();
    const id=await page.locator('.node[data-selected="true"]').getAttribute('data-id');
    await panel(id).locator('[data-field="title"]').fill(title);await page.waitForTimeout(220);return id;
  }
  const first=await child('product','TREE_UI_FIRST');
  check((await state()).graph.nodes.find(n=>n.id===first).parentId==='product','Context child used wrong parent');
  await panel(first).locator('[data-field="parentId"]').selectOption('funding');await page.waitForTimeout(220);
  check((await state()).graph.nodes.find(n=>n.id===first).parentId==='funding','Parent selector failed');
  const second=await child('funding','TREE_UI_SECOND');
  await panel(second).locator('[data-action="earlier"]').click();await page.waitForTimeout(220);
  let saved=await valid();
  check(saved.graph.nodes.find(n=>n.id===second).x<saved.graph.nodes.find(n=>n.id===first).x,'Sibling ordering failed');
  await close();await page.locator('.node[data-id="product"]').click();
  check(await panel('product').locator('[data-field="parentId"] option[value="funding"]').count()===0,'Descendant offered as parent');
  await close();await page.keyboard.press('f');await page.waitForTimeout(180);
  const root=page.locator('.node[data-id="world"]'),before=saved.graph.nodes.find(n=>n.id==='world'),box=await root.boundingBox();
  const target=await page.locator('.node[data-id="product"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});await page.mouse.up();
  check((await state()).graph.nodes.find(n=>n.id==='world').parentId===null,'Root could be dragged into a cycle');
  check((await state()).graph.nodes.find(n=>n.id==='world').y===before.y,'Free drag changed level');
  await root.click();await panel('world').locator('[data-action="delete"]').click();
  check((await page.locator('#save-status').textContent()).includes('根節點仍有子節點'),'Root deletion not explained');
  check((await state()).graph.nodes.length===12,'Root deletion lost content');
  await close();await page.locator('.connection-hit').first().click({force:true});
  check(await page.locator('.object-panel[data-kind="edge"] [data-field="edgeRouting"]').isHidden(),'Free routing editor remains');
  check(await page.locator('.object-panel[data-kind="edge"] [data-action="edge-delete"]').isHidden(),'Parent line delete remains');
  await close();await page.waitForTimeout(220);await page.reload();await page.locator('.node').first().waitFor();
  saved=await valid();check(saved.graph.nodes.some(n=>n.title==='TREE_UI_FIRST')&&saved.graph.nodes.some(n=>n.title==='TREE_UI_SECOND'),'Reload lost edits');
  check(errors.length===0,'Renderer errors: '+errors.join('; '));
  return {passed:true,profile:'isolated synthetic tree',checks:['strict hierarchy and depth alignment','child creation','parent selector','descendant rejection','sibling order','drag cannot create cycle or free position','root delete protection','fixed routing controls','reload persistence'],created:[first,second]};
}
