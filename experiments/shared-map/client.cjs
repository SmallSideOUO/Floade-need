'use strict';
const fs=require('node:fs'),path=require('node:path');
async function main(){
  const args=process.argv.slice(2),profileArg=args.find(arg=>arg.startsWith('--profile='));
  const profile=profileArg?path.resolve(profileArg.slice(10)):path.join(__dirname,'data');
  const [command,input,output]=args.filter(arg=>!arg.startsWith('--profile='));
  if(!['describe','graph','history','apply','screenshot'].includes(command))throw new Error('Usage: node client.cjs describe|graph|history|apply request.json|screenshot region.json output.png [--profile=<directory>]');
  const runtime=JSON.parse(fs.readFileSync(path.join(profile,'api-runtime.json'),'utf8'));
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.endpoint))throw new Error('Invalid local map endpoint');
  const route={describe:'describe',graph:'graph',history:'history',apply:'changes',screenshot:'screenshot'}[command],post=command==='apply'||command==='screenshot';
  const response=await fetch(runtime.endpoint+'/v1/'+route,{method:post?'POST':'GET',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:post?fs.readFileSync(input,'utf8'):undefined,signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Map API '+response.status+': '+(await response.json()).error);
  if(command==='screenshot'){if(!output)throw new Error('Supply an output PNG path');fs.writeFileSync(path.resolve(output),Buffer.from(await response.arrayBuffer()));console.log(JSON.stringify({path:path.resolve(output),revision:Number(response.headers.get('x-map-revision')),privacy:response.headers.get('x-map-privacy')}))}
  else console.log(JSON.stringify(await response.json(),null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
