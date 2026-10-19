'use strict';
// Read-only smoke check using a Codex-resolved, installed MCP transport.
const fs=require('node:fs'),assert=require('node:assert/strict'),readline=require('node:readline'),{spawn}=require('node:child_process');
async function main(){
  const {transport}=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
  assert.equal(transport.type,'stdio');
  const child=spawn(transport.command,transport.args,{cwd:transport.cwd,env:{...process.env,...transport.env},windowsHide:true,stdio:['pipe','pipe','pipe']});
  let id=0;const pending=new Map(),lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{const response=JSON.parse(line);pending.get(response.id)?.(response);});
  const request=(method,params)=>new Promise((resolve,reject)=>{const current=++id,timer=setTimeout(()=>reject(new Error('Installed MCP timed out')),25000);pending.set(current,result=>{clearTimeout(timer);resolve(result)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');});
  const call=async(name,args={})=>{const result=await request('tools/call',{name,arguments:args});assert.ok(!result.error,JSON.stringify(result.error));assert.ok(!result.result.isError,JSON.stringify(result.result.content));return result.result;};
  try{
    assert.ok((await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Floade installed smoke',version:'1'}})).result.capabilities.tools);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=(await request('tools/list')).result.tools;assert.equal(listed.length,5);
    const graph=(await call('graph')).structuredContent;assert.ok(Array.isArray(graph.graph.nodes));
    await call('describe');const history=(await call('history',{limit:1})).structuredContent;assert.ok(Array.isArray(history.records));
    const target=graph.graph.nodes[0];if(target){const screenshot=await call('screenshot',{nodeIds:[target.id],scale:1});assert.equal(screenshot.content[0].type,'image');assert.equal(Buffer.from(screenshot.content[0].data,'base64').subarray(1,4).toString(),'PNG');}
    console.log(JSON.stringify({passed:true,installedTransport:true,toolNames:listed.map(tool=>tool.name),nodes:graph.graph.nodes.length,revision:graph.revision,readOnly:true}));
  }finally{child.kill();lines.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
