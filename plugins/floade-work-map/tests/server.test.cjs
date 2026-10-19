'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),readline=require('node:readline');
const {dispatch}=require('../server.cjs');
test('MCP tools forward only through the current loopback API, preserve revision errors and return filtered PNGs',async t=>{
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'floade-plugin-test-')),previous=process.env.FLOADE_WORK_MAP_PROFILE;
  process.env.FLOADE_WORK_MAP_PROFILE=profile;
  let token='test-token',received,redirect=false;
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer '+token);let body='';for await(const part of req)body+=part;
    received={url:req.url,body:body&&JSON.parse(body)};
    if(redirect){res.writeHead(302,{location:'http://example.invalid'});res.end();return;}
    if(req.url==='/v1/changes'){res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:'地圖版本已更新'}));return;}
    if(req.url==='/v1/screenshot'){res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.from('AI-filtered-test-png'));return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({revision:12,graph:{nodes:[{id:'masked',title:'[已遮蔽]',textWithheld:true}],edges:[]}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const runtime=()=>fs.writeFile(path.join(profile,'api-runtime.json'),JSON.stringify({endpoint:'http://127.0.0.1:'+server.address().port,token}));await runtime();
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true});if(previous===undefined)delete process.env.FLOADE_WORK_MAP_PROFILE;else process.env.FLOADE_WORK_MAP_PROFILE=previous;});
  const call=async(name,args={})=>(await dispatch({id:1,method:'tools/call',params:{name,arguments:args}})).result;
  const listed=await dispatch({id:1,method:'tools/list'});assert.equal(listed.result.tools.length,5);
  assert.equal(listed.result.tools.find(tool=>tool.name==='apply').annotations.readOnlyHint,false);
  let result=await call('graph');assert.equal(result.structuredContent.graph.nodes[0].textWithheld,true);assert.ok(!JSON.stringify(result).includes(token));
  token='rotated-token';await runtime();assert.ok(!(await call('graph')).isError);
  await call('history',{limit:5,before:'older'});assert.equal(received.url,'/v1/history?limit=5&before=older');
  const args={requestId:'unique',expectedRevision:11,actor:'Test',reason:'Test conflict',operations:[{op:'node.update',id:'masked',patch:{note:'Cannot overwrite'}}]};
  result=await call('apply',args);assert.ok(result.isError);assert.match(result.content[0].text,/409/);assert.deepEqual(received.body,args);
  result=await call('screenshot',{nodeIds:['masked'],scale:1});assert.equal(result.content[0].type,'image');assert.equal(result.content[0].mimeType,'image/png');
  for(const [name,args]of [['graph',{profile:'private'}],['history',{limit:-1}],['apply',{}],['screenshot',{}],['screenshot',{nodeIds:['a'],region:{x:0,y:0,width:1,height:1}}]])assert.ok((await call(name,args)).isError);
  redirect=true;assert.ok((await call('graph')).isError);redirect=false;
  await fs.writeFile(path.join(profile,'api-runtime.json'),JSON.stringify({endpoint:'https://example.invalid',token}));assert.ok((await call('graph')).isError);
});
test('stdio startup speaks JSON-RPC and discovers all tools without map access',async t=>{
  const child=spawn(process.execPath,[path.resolve(__dirname,'../server.cjs')],{stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
  const pending=new Map(),lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{const response=JSON.parse(line);pending.get(response.id)?.(response);});
  let id=0;const request=(method,params)=>new Promise((resolve,reject)=>{const current=++id,timer=setTimeout(()=>reject(new Error('MCP timed out')),5000);pending.set(current,result=>{clearTimeout(timer);resolve(result)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');});
  const initialized=await request('initialize',{protocolVersion:'2025-03-26'});assert.equal(initialized.result.protocolVersion,'2025-03-26');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.equal((await request('tools/list')).result.tools.length,5);assert.deepEqual((await request('ping')).result,{});
  assert.equal((await request('unknown')).error.code,-32601);
});
test('portable and Codex manifests agree and all referenced components exist',async()=>{
  const root=path.resolve(__dirname,'..'),read=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
  const portable=await read('plugin.json'),legacy=await read('.codex-plugin/plugin.json');
  assert.equal(portable.name,legacy.name);assert.equal(portable.version,legacy.version);assert.deepEqual(portable.extensions['com.openai'].interface,legacy.interface);
  const mcp=await read('mcp.json'),old=await read('.mcp.json');assert.equal(mcp.mcpServers[portable.name].command,old.mcpServers[portable.name].command);assert.deepEqual(mcp.mcpServers[portable.name].args,old.mcpServers[portable.name].args);
  assert.ok(portable.extensions['com.openai'].interface.shortDescription.length<=30);await fs.access(path.join(root,'server.cjs'));await fs.access(path.join(root,'skills/work-map/SKILL.md'));
});
