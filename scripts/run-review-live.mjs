import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {LineDecoder} from '../src/transport.mjs';
import {BROWSER_TOOLS,validateToolOutput} from '../src/browser-tools.mjs';

// Explicit opt-in; only disposable loopback pages are mutated. The visible base
// tab scopes the window and is retained. No uncertain write or close is retried.
const root=fileURLToPath(new URL('..',import.meta.url));
if(process.argv.length!==5||process.argv[2]!=='--live'||process.argv[3]!=='--base-url')throw Error('Usage: node scripts/run-review-live.mjs --live --base-url HTTP_URL');
const base=new URL(process.argv[4]);
if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('BASE_URL_MUST_BE_HTTP');
const nonce=randomUUID(),reports=new Map(),timers=new Set(),ownedTabs=[],contexts=new Set(),releaseAttempts=new Set();
const receipt={schemaVersion:1,checkedAt:new Date().toISOString(),mode:'live',passed:false,steps:[],cleanup:{tabsClosed:false,contextsReleased:false,serverStopped:false,clientExited:false},limitations:[
  'Owned loopback regression fixtures only; not all planned scenarios, options or websites.',
  'Native StopWebRequestMonitoring failure is simulated offline only; it is not induced here.',
  'Unicode launcher paths and Unicode fixture checkout paths have separate offline/Windows process evidence; this run uses the installed checkout.'
]};
let origin,child,manager,baseRef,connectionRef;
const state=name=>{if(!reports.has(name))reports.set(name,{events:[],pending:0,nextLoads:0});return reports.get(name);};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  const prefix=`/${nonce}/`;if(!u.pathname.startsWith(prefix)){res.writeHead(404).end();return;}
  const [name,route]=u.pathname.slice(prefix.length).split('/'),s=state(name);
  res.setHeader('Cache-Control','no-store');
  if(route==='report'){
    const kind=u.searchParams.get('kind'),value=u.searchParams.get('value')??'';
    if(!['input','held-start','held-end','next-click'].includes(kind)||value.length>100){res.writeHead(400).end();return;}
    s.events.push({kind,value,at:Date.now()});res.end('ok');return;
  }
  if(route==='slow'){
    s.pending++;
    const timer=setTimeout(()=>{timers.delete(timer);s.pending--;res.end('done');},5000);timers.add(timer);return;
  }
  if(route!=='page'){res.writeHead(404).end();return;}
  const second=u.searchParams.get('page')==='2';if(second)s.nextLoads++;
  const pagination=name.startsWith('pagination'),nav=name==='pagination-navigation';
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Owned review regression ${name}</title>
<h1>Owned review regression: ${name}</h1><input id="text" value="initial"><div id="scope">
<table id="table"><tr><th>Name</th></tr><tr><td>${second?'Two':'One'}</td></tr></table></div>
<button id="next" ${second?'disabled':''}>Next</button><script>
const report=(kind,value='')=>fetch('./report?'+new URLSearchParams({kind,value}));
document.querySelector('#text').addEventListener('input',e=>report('input',e.target.value));
document.querySelector('#next').onclick=()=>{report('next-click');${nav?"setTimeout(()=>location.href='./page?page=2',100)":"document.querySelector('#table').rows[1].cells[0].textContent='Two';document.querySelector('#next').disabled=true"}};
window.fixtureReady=true;window.fixturePagination=${pagination};</script>`);
});
const pending=new Map(),decoder=new LineDecoder();let id=0;
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('MCP_TRANSPORT_TIMEOUT'));},40000);
  pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');
});
async function call(name,args={},expectSuccess=true){
  const response=await send('tools/call',{name,arguments:args});assert.equal(response.error,undefined,JSON.stringify(response.error));
  const result=response.result.structuredContent??JSON.parse(response.result.content[0].text);
  if(BROWSER_TOOLS.some(t=>t.name===name))assert.ok(validateToolOutput(name,result),`OUTPUT_SCHEMA_${name}`);
  if(expectSuccess)assert.ok(result.ok??!response.result.isError,`${name}: ${JSON.stringify(result.error)}`);
  return result;
}
const args=t=>({contextRef:t.contextRef,tabRef:t.tabRef,timeoutMs:15000});
const find=async(t,value)=>(await call('browser_find_element',{...args(t),locator:{kind:'css',value}})).data.elementRef;
const evaluate=async(t,script)=>(await call('browser_evaluate',{...args(t),script})).data.value;
async function waitUntil(check,ms=3000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('FIXTURE_REPORT_TIMEOUT');await delay(20);}}
async function release(contextRef){
  releaseAttempts.add(contextRef);const r=await call('browser_attach',{action:'release',contextRef});assert.equal(r.data.cleanupConfirmed,true);contexts.delete(contextRef);
}
async function open(name){
  const url=`${origin}/${nonce}/${name}/page`,result=await call('browser_tab_open',{contextRef:manager,tabRef:baseRef,url});
  const t={contextRef:manager,tabRef:result.data.tabRef,url,name,closed:false,closeAttempted:false};ownedTabs.push(t);
  if(result.data.metadataPending)t.tabRef=(await call('browser_tab_get',args(t))).data.tabRef;
  await call('browser_wait_for',{...args(t),condition:'ready'});assert.equal(await evaluate(t,'()=>window.fixtureReady'),true);return t;
}
async function close(t){
  // Pagination can replace the document/ref. Rediscover only the two exact URLs
  // issued by this fixture, never a broad match or a user tab.
  const matches=[];
  for(const url of [t.url,t.url+'?page=2']){
    const found=(await call('browser_tabs',{contextRef:manager,url})).data;assert.equal(found.complete,true);matches.push(...found.tabs);
  }
  assert.equal(matches.length,1,'OWNED_TAB_NOT_UNIQUE');t.tabRef=matches[0].tabRef;t.closeAttempted=true;
  const r=await call('browser_tab_close',{contextRef:manager,tabRef:t.tabRef,timeoutMs:5000});assert.equal(r.ok,true);
  for(const url of [t.url,t.url+'?page=2']){
    const absent=(await call('browser_tabs',{contextRef:manager,url})).data;assert.equal(absent.complete,true);assert.equal(absent.tabs.length,0,'OWNED_TAB_STILL_PRESENT');
  }
  t.closed=true;
}
async function step(name,fn){
  const started=Date.now();try{const evidence=await fn();receipt.steps.push({name,passed:true,elapsedMs:Date.now()-started,evidence});console.log(JSON.stringify(receipt.steps.at(-1)));}
  catch(e){receipt.steps.push({name,passed:false,elapsedMs:Date.now()-started,error:e.message.slice(0,600)});throw e;}
}
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  child=spawn(process.execPath,['src/bridge.mjs','mcp'],{cwd:root,stdio:['pipe','pipe','pipe'],windowsHide:true});child.stderr.on('data',()=>{});
  child.stdout.on('data',chunk=>{for(const m of decoder.push(chunk)){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);p.resolve(m);}}});
  child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('MCP_EXITED'));}pending.clear();});
  await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'owned-review-live-fixture',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const capResponse=await call('browser_capabilities'),statusResponse=await call('uipath_bridge_status');
  const cap=capResponse.data??capResponse,status=statusResponse.data??statusResponse;
  assert.equal(status.connected,true);assert.equal(status.browserRuntime.runtimeVersion,'0.3.0');assert.equal(status.g0ProbeProtocol,null);assert.equal(status.browserRuntime.cleanupUnconfirmed,0);
  receipt.loadedHostSourceHashes=status.browserRuntime.sourceHashes;
  for(const [f,h] of Object.entries(receipt.loadedHostSourceHashes))assert.equal(createHash('sha256').update(await readFile(path.join(root,f))).digest('hex'),h,`HOST_SOURCE_NOT_RELOADED:${f}`);
  const extension=path.join(process.env.LOCALAPPDATA,'Google/Chrome/User Data/Default/Extensions/jfcmnbofjlffnejneillkgbniiidiigd/23.10.1_0/EmbeddedDriversContainer.js');
  receipt.extensionSourceSha256=createHash('sha256').update(await readFile(extension)).digest('hex');assert.equal(receipt.extensionSourceSha256,'4de732c63b8a6b1b22e12a9db2a4a13ae2c0700a80669fd26631f7488f4b7308');
  connectionRef=cap.connectionRef;const found=(await call('browser_tabs',{connectionRef,url:base.href})).data;
  assert.equal(found.complete,true);assert.equal(found.tabs.length,1,'BASE_TAB_NOT_UNIQUE');assert.equal(found.tabs[0].visibility,'visible');
  const attached=(await call('browser_attach',{connectionRef,tabRef:found.tabs[0].tabRef})).data;manager=attached.contextRef;baseRef=attached.tabRef;contexts.add(manager);
  await step('busy-network-timeout-cleanup-and-subsequent-write',async()=>{
    const t=await open('network'),s=state('network'),watch=(await call('browser_network_wait',{...args(t),action:'arm'})).data.watchRef;
    await evaluate(t,'()=>{fetch("./slow");return true}');await waitUntil(()=>s.pending===1);
    const result=await call('browser_network_wait',{...args(t),action:'wait',watchRef:watch,quietMs:100,timeoutMs:500},false);
    assert.equal(result.ok,false);assert.equal(result.error.code,'TIMEOUT');assert.equal(result.error.dispatchState,'notSent');assert.equal(s.pending,1);
    const elementRef=await find(t,'#text');await call('browser_type',{contextRef:t.contextRef,elementRef,text:'after timeout'});
    assert.equal((await call('browser_get_element',{contextRef:t.contextRef,elementRef})).data.value,'after timeout');
    const next=(await call('browser_network_wait',{...args(t),action:'arm'})).data.watchRef;
    assert.equal((await call('browser_network_wait',{...args(t),action:'cancel',watchRef:next})).data.monitorStopped,true);
    await close(t);return {error:result.error.code,dispatchState:result.error.dispatchState,requestStillPendingAtTimeout:true,writeReadback:true,rearmAndCancel:true};
  });
  await step('queued-deadline-settles-without-late-write-or-overtake',async()=>{
    const t=await open('queue'),s=state('queue'),elementRef=await find(t,'#text');let heldFinished=false,next;
    const held=call('browser_evaluate',{...args(t),script:'async()=>{await fetch("./report?kind=held-start");await new Promise(r=>setTimeout(r,2500));await fetch("./report?kind=held-end");return true}'}).finally(()=>{heldFinished=true;});
    held.catch(()=>{});
    try{
      await waitUntil(()=>s.events.some(e=>e.kind==='held-start'));
      const started=Date.now(),expired=await Promise.all([
        call('browser_type',{contextRef:t.contextRef,elementRef,text:'must not write',requestKey:'queued-expiry',timeoutMs:300},false),
        call('browser_tab_get',{...args(t),timeoutMs:300},false)
      ]),elapsedMs=Date.now()-started;
      for(const r of expired){assert.equal(r.ok,false);assert.equal(r.error.code,'TIMEOUT');assert.equal(r.error.dispatchState,'notSent');}
      assert.equal(heldFinished,false,'DEADLINE_WAITED_FOR_PREDECESSOR');
      next=call('browser_type',{contextRef:t.contextRef,elementRef,text:'after queue',timeoutMs:6000});next.catch(()=>{});
      await delay(200);assert.equal(heldFinished,false);assert.equal(s.events.filter(e=>e.kind==='input').length,0,'LATER_WRITE_OVERTOOK_PREDECESSOR');
      await held;await next;await waitUntil(()=>s.events.some(e=>e.kind==='input'));
      assert.deepEqual(s.events.filter(e=>e.kind==='input').map(e=>e.value),['after queue']);
      assert.ok(s.events.findIndex(e=>e.kind==='held-end')<s.events.findIndex(e=>e.kind==='input'));
      assert.equal((await call('browser_get_element',{contextRef:t.contextRef,elementRef})).data.value,'after queue');
      await close(t);return {queuedReadAndWriteTimedOut:true,elapsedMs,settledBeforePredecessor:true,noLateOrOvertakingInput:true,finalValue:'after queue'};
    }finally{await Promise.allSettled([held,...(next?[next]:[])]);}
  });
  for(const mode of ['dom','navigation'])await step('pagination-root-ref-'+mode,async()=>{
    const t=await open('pagination-'+mode),rootRef=await find(t,'#scope');
    const single=await call('browser_extract_table',{...args(t),elementRef:await find(t,'#table')});assert.equal(single.evidence.dispatchState,'notSent');
    const result=await call('browser_extract_table',{...args(t),rootRef,pagination:{rootLocator:{kind:'css',value:'#table'},nextLocator:{kind:'css',value:'#next'},maxPages:3}});
    assert.equal(result.data.pages,2);assert.deepEqual(result.data.rows.map(row=>Object.values(row)[0]),['One','Two']);assert.equal(result.data.partial,false);assert.equal(result.evidence.dispatchState,'acknowledged');
    const s=state(t.name);await waitUntil(()=>s.events.some(e=>e.kind==='next-click'));assert.equal(s.events.filter(e=>e.kind==='next-click').length,1);assert.equal(s.nextLoads,mode==='navigation'?1:0);
    await close(t);return {pages:2,rows:['One','Two'],partial:false,dispatchState:result.evidence.dispatchState,nextClicks:1,navigationLoads:s.nextLoads};
  });
  for(const unknown of [false,true])await step('full-256-key-cache-'+(unknown?'unknown-recovery':'release'),async()=>{
    const t=await open('cache-'+unknown),discovered=(await call('browser_tabs',{connectionRef,url:t.url})).data;assert.equal(discovered.tabs.length,1);
    const attached=(await call('browser_attach',{connectionRef,tabRef:discovered.tabs[0].tabRef})).data;contexts.add(attached.contextRef);
    const own={...t,contextRef:attached.contextRef,tabRef:attached.tabRef},elementRef=await find(own,'#text');
    for(let i=0;i<(unknown?255:256);i++)await call('browser_set_attribute',{contextRef:own.contextRef,elementRef,name:'data-count',value:String(i)});
    if(unknown){const result=await call('browser_evaluate',{...args(own),script:'()=>{throw new Error("fixture intentional unknown")}',requestKey:'last-write'},false);assert.equal(result.ok,false);assert.equal(result.error.dispatchState,'unknown');}
    const overflow=await call('browser_set_attribute',{contextRef:own.contextRef,elementRef,name:'data-count',value:'overflow'},false);assert.equal(overflow.ok,false);assert.equal(overflow.error.code,'LIMIT_EXCEEDED');
    const invalid=await call('browser_tab_get',{...args(own),resolve:{requestKey:'missing',resolution:'abandon-unknown'}},false);assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'LIMIT_EXCEEDED');
    if(unknown)await call('browser_tab_get',{...args(own),resolve:{requestKey:'last-write',resolution:'abandon-unknown'},requestKey:'resolve-last'});
    await release(own.contextRef);
    // Explicit unknown recovery invalidates the document generation. The
    // manager also needs a fresh ref before the independent overflow readback.
    const refreshed=(await call('browser_tabs',{contextRef:manager,url:t.url})).data;assert.equal(refreshed.complete,true);assert.equal(refreshed.tabs.length,1);t.tabRef=refreshed.tabs[0].tabRef;
    assert.equal(await evaluate(t,'()=>document.querySelector("#text").getAttribute("data-count")'),String(unknown?254:255),'OVERFLOW_WRITE_CHANGED_PAGE');
    await close(t);return {filledKeys:256,overflow:'LIMIT_EXCEEDED',overflowDidNotChangePage:true,invalidRecoveryBounded:true,unknownRecovered:unknown,releaseConfirmed:true};
  });
  receipt.passed=true;
}catch(e){receipt.error=e.message.slice(0,1000);process.exitCode=1;console.log(JSON.stringify({passed:false,error:receipt.error}));}
finally{
  for(const t of ownedTabs.filter(t=>!t.closed&&!t.closeAttempted))try{await close(t);}catch(e){t.cleanupError=e.message.slice(0,200);}
  for(const contextRef of [...contexts])if(!releaseAttempts.has(contextRef))try{await release(contextRef);}catch{}
  receipt.cleanup.tabsClosed=ownedTabs.every(t=>t.closed);receipt.cleanup.contextsReleased=contexts.size===0;
  if(child){child.stdin.end();await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},12000);child.once('exit',()=>{clearTimeout(timer);receipt.cleanup.clientExited=true;resolve();});});}
  for(const timer of timers)clearTimeout(timer);timers.clear();
  if(server.listening)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});receipt.cleanup.serverStopped=true;
  if(!Object.values(receipt.cleanup).every(v=>v===true)){receipt.passed=false;process.exitCode=1;}
  receipt.sourceHashes={...receipt.loadedHostSourceHashes,'scripts/run-review-live.mjs':createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')};
  await mkdir(path.join(root,'work'),{recursive:true});await writeFile(path.join(root,'work/REVIEW-LIVE-VERIFICATION.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({passed:receipt.passed,steps:receipt.steps.length,cleanup:receipt.cleanup}));
}
