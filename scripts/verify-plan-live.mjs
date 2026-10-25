import { EXTENSION_ROOT } from './paths.mjs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {LineDecoder} from '../src/transport.mjs';
const bridge=fileURLToPath(new URL('../src/bridge.mjs',import.meta.url));
const nonce=randomUUID(), title='UiPath MCP verification '+nonce.slice(0,8);
const html='<!doctype html><meta charset="utf-8"><title>'+title+'</title><main><h1>'+title+'</h1><p>Local verification fixture. No user data.</p><label>Text <input id="text" value="initial"></label><input id="check" type="checkbox"><select id="select"><option value="a">Alpha</option><option value="b">Beta</option></select><button id="button">Count click</button><output id="count">0</output></main><script>document.querySelector("#button").onclick=()=>{let e=document.querySelector("#count");e.textContent=Number(e.textContent)+1}</script>';
let hits=0;
const server=createServer((req,res)=>{if(req.url!=='/'+nonce){res.writeHead(404);res.end();return}hits++;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/'+nonce;
const child=spawn(process.execPath,[bridge,'mcp'],{stdio:['pipe','pipe','pipe']});
const decoder=new LineDecoder(), pending=new Map();let id=0,stderr='';
child.stderr.on('data',c=>stderr+=String(c));
child.stdout.on('data',c=>{for(const m of decoder.push(c)){const p=pending.get(m.id);if(!p)continue;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
const request=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('Timeout '+method))},45000);pending.set(n,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n')});
const call=async(name,args={})=>{const x=await request('tools/call',{name,arguments:args});assert.equal(x.isError,false,x.content?.[0]?.text);return JSON.parse(x.content[0].text)};
const receipt={verificationDate:'2026-10-26',checkedAt:new Date().toISOString(),scope:'Fresh existing MCP primitives on a local HTTP fixture; no DOM action probe.',fixture:{url,title,contentSha256:createHash('sha256').update(html).digest('hex')},results:[],domAutomationLiveVerified:false};
try{
 await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'plan-verifier',version:'1.0'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 receipt.tools=(await request('tools/list')).tools.map(t=>t.name);
 const status=await call('uipath_bridge_status');assert(status.connected);receipt.connection={connected:status.connected,driverVersion:status.driverVersion,nativePid:status.nativePid};
 receipt.results.push({tool:'uipath_bridge_status',passed:true});
 const versions=await call('uipath_driver_versions');assert(versions.versions.includes('23.4.55.39317'));
 receipt.results.push({tool:'uipath_driver_versions',passed:true,versions:versions.versions});
 const opened=await call('uipath_open_url',{url});receipt.openedTabId=opened.tabId;
 receipt.results.push({tool:'uipath_open_url',passed:Number.isInteger(opened.tabId),tabId:opened.tabId});
 let observed;
 for(let i=0;i<10;i++){observed=await call('uipath_tab_info',{tabId:opened.tabId});if(observed.status==='complete'&&observed.title===title)break;await new Promise(r=>setTimeout(r,250))}
 assert.equal(observed.url,url);assert.equal(observed.title,title);assert.equal(observed.status,'complete');assert(hits>0);
 receipt.results.push({tool:'uipath_tab_info',passed:true,observed});receipt.fixture.httpRequestsServed=hits;
 receipt.passed=true;
}catch(e){receipt.passed=false;receipt.error=String(e);process.exitCode=1}
finally{
 for(const p of pending.values())clearTimeout(p.timer);
 child.stdin.end();child.kill();server.closeAllConnections();await new Promise(r=>server.close(r));receipt.fixture.serverStopped=true;
 receipt.stderrEmpty=stderr.length===0;
 for(const name of ['BackgroundMain.js','EmbeddedDriversContainer.js']){
  const p=EXTENSION_ROOT + '/'+name;
  (receipt.sourceHashes??={})[name]=createHash('sha256').update(await readFile(p)).digest('hex');
 }
 await writeFile('docs/EXTENSION-LIVE-VERIFICATION.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({passed:receipt.passed,tools:receipt.results,domAutomationLiveVerified:false,error:receipt.error},null,2));
}
