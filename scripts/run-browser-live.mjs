import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LineDecoder} from '../src/transport.mjs';
import {DRIVER_VERSION,ipcCall} from '../src/bridge.mjs';
import {startBrowserFixture} from './browser-runtime-fixture.mjs';
import {BROWSER_TOOLS,CORE_BROWSER_TOOLS,ADVANCED_BROWSER_TOOL_NAMES,UNAVAILABLE_TOOLS,validateToolOutput} from '../src/browser-tools.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),live=process.argv.includes('--live'),captureOnly=process.argv.includes('--capture-only'),captureFormat=process.argv.includes('--jpeg')?'jpeg':'png';
let baseUrl;
for(let i=2;i<process.argv.length;i++){
  if(process.argv[i]==='--base-url'){baseUrl=process.argv[++i];const u=new URL(baseUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('BASE_URL_MUST_BE_HTTP');baseUrl=u.href;}
  else if(!['--live','--capture-only','--jpeg'].includes(process.argv[i]))throw Error('Usage: node scripts/run-browser-live.mjs [--live] [--capture-only] [--jpeg] [--base-url HTTP_URL]');
}
const receipt={schemaVersion:2,checkedAt:new Date().toISOString(),driverVersion:DRIVER_VERSION,mode:live?'live':'preflight',passed:false,steps:[],toolsExercised:[],unsupported:UNAVAILABLE_TOOLS,
  advancedReadiness:Object.fromEntries(ADVANCED_BROWSER_TOOL_NAMES.map(name=>[name,{implementationStatus:'implemented-source',live:'not-run',available:null,backend:null,reason:'Readiness not yet sampled.'}])),
  cleanup:{tabsClosed:null,serversStopped:false,contextReleased:null,clientExited:false},limitations:['This runner exercises only the 42 core browser tools against the owned UiPath fixture. Advanced tools are recorded as readiness observations and are not live-tested here.','Smoke coverage is distinct from the 423 planned negative/boundary scenarios.']};
receipt.suite=captureOnly?'capture-only':'full';receipt.captureFormat=captureFormat;
const child=spawn(process.execPath,['src/bridge.mjs','mcp'],{cwd:root,stdio:['pipe','pipe','pipe'],windowsHide:true}),pending=new Map(),decoder=new LineDecoder();let id=0,fixture,contextRef,tabRef,extraTab,clientEnded=false;
child.stderr.on('data',()=>{});child.stdout.on('data',chunk=>{for(const x of decoder.push(chunk)){const r=pending.get(x.id);if(r){pending.delete(x.id);clearTimeout(r.timer);r.resolve(x);}}});
child.on('exit',()=>{for(const x of pending.values()){clearTimeout(x.timer);x.reject(Error('MCP_EXITED'));}pending.clear();});
const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('MCP_TIMEOUT'));},40000);pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
const check=(v,message)=>{if(!v)throw Error(message);};
const closeAttempts=new Set();
async function call(name,args={}){if(name==='browser_tab_close')closeAttempts.add(args.tabRef);const response=await send('tools/call',{name,arguments:args});check(!response.error,`RPC_${name}`);const result=response.result;
  const data=result.structuredContent??JSON.parse(result.content[0].text);
  if(BROWSER_TOOLS.some(t=>t.name===name)){check(validateToolOutput(name,data),`OUTPUT_SCHEMA_${name}`);if(!data.ok)receipt.lastFailure={tool:name,code:data.error?.code,dispatchState:data.error?.dispatchState,details:data.error?.details,elapsedMs:data.timing?.elapsedMs};check(data.ok,`${name}:${data.error?.code}:${data.error?.message}`);}
  else check(!result.isError,`LEGACY_${name}`);
  if(!receipt.toolsExercised.includes(name))receipt.toolsExercised.push(name);return {data:data.data??data,raw:data,content:result.content};}
const a=()=>({contextRef,tabRef,timeoutMs:20000}),element=elementRef=>({contextRef,elementRef,timeoutMs:20000});
const find=async value=>(await call('browser_find_element',{...a(),locator:{kind:'css',value}})).data.elementRef;
const evalJS=async script=>(await call('browser_evaluate',{...a(),script})).data.value;
async function step(name,fn){try{await fn();receipt.steps.push({name,passed:true});console.log(JSON.stringify({step:name,passed:true}));}catch(e){receipt.steps.push({name,passed:false,error:e.message.slice(0,250)});throw e;}}
async function capture(){
  await call('browser_tab_activate',a());
  const shot=(await call('browser_screenshot',{...a(),format:captureFormat})).data,artifact=shot.artifactRef;await call('browser_image_artifact',{contextRef,artifactRef:artifact,action:'inspect'});
  const image=await call('browser_image_artifact',{contextRef,artifactRef:artifact,action:'read'}),block=image.content.find(c=>c.type==='image'&&c.mimeType===`image/${captureFormat}`);check(block,'MCP_IMAGE_BLOCK');
  const bytes=Buffer.from(block.data,'base64');check(createHash('sha256').update(bytes).digest('hex')===shot.sha256,'MCP_IMAGE_HASH');
  await call('browser_image_artifact',{contextRef,artifactRef:artifact,action:'save',name:captureFormat==='png'?'fixture.png':'fixture.jpg'});
  receipt.captureArtifact={mimeType:shot.mimeType,bytes:shot.bytes,width:shot.width,height:shot.height,sha256:shot.sha256,mcpImageBlock:true,inspectReadSavePassed:true};
  await mkdir(path.join(root,'work'),{recursive:true});await writeFile(path.join(root,`work/browser-live-fixture.${captureFormat==='png'?'png':'jpg'}`),bytes);
}
try{
  await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'owned-browser-live-fixture',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=(await send('tools/list')).result.tools;check(list.length===57,'TOOLS_COUNT');
  for(const name of Object.keys(UNAVAILABLE_TOOLS))check(!list.some(t=>t.name===name),'UNSUPPORTED_EXPOSED');
  const cap=await call('browser_capabilities');check(cap.data.schemaVersion===2&&typeof cap.data.connectionRef==='string','NEW_HOST_NOT_LOADED');
  for(const name of ADVANCED_BROWSER_TOOL_NAMES){const item=cap.data.tools?.find(value=>value.name===name);receipt.advancedReadiness[name]={
    implementationStatus:'implemented-source',live:'not-run',available:item?.available===true,backend:item?.backend??null,reason:item?.unsupportedReason??null,
    ...(item?.modes?{modes:item.modes}:{})};}
  const status=(await call('uipath_bridge_status')).data;
  check(status.browserRuntime?.runtimeVersion==='0.3.0','HOST_RUNTIME_VERSION_MISMATCH');
  for(const file of ['src/bridge.mjs','src/transport.mjs','src/capabilities.mjs','src/browser-runtime.mjs','src/browser-operations.mjs','src/browser-page.mjs','src/browser-observers.mjs','src/browser-composites.mjs','src/browser-artifacts.mjs','src/browser-tools.mjs','src/browser-advanced.mjs','src/browser-accessibility.mjs','src/browser-semantic.mjs','src/browser-visual.mjs','src/browser-visual-worker.mjs','src/browser-launch.mjs','src/windows-browser-helper.mjs','src/companion-protocol.mjs','src/companion-pairing.mjs','src/companion-client.mjs','companion/manifest.json','companion/service-worker.mjs','companion/backend.mjs','companion/protocol.mjs','companion/storage.mjs','scripts/Windows-BrowserHelper.ps1','scripts/Windows-BrowserLaunch.ps1','docs/browser-tool-contracts.json','package-lock.json']){
    const hash=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');check(status.browserRuntime.sourceHashes?.[file]===hash,'HOST_SOURCE_NOT_RELOADED:'+file);
  }
  receipt.loadedHostSourceHashes=status.browserRuntime.sourceHashes;
  receipt.hostConnectionRef=cap.data.connectionRef;
  if(live){
    const source=path.join(process.env.LOCALAPPDATA,'Google/Chrome/User Data/Default/Extensions/jfcmnbofjlffnejneillkgbniiidiigd/23.10.1_0/EmbeddedDriversContainer.js');
    receipt.extensionSourceSha256=createHash('sha256').update(await readFile(source)).digest('hex');check(receipt.extensionSourceSha256==='4de732c63b8a6b1b22e12a9db2a4a13ae2c0700a80669fd26631f7488f4b7308','SOURCE_MISMATCH');
    fixture=await startBrowserFixture();receipt.fixtureBundleSha256=fixture.bundleSha256;
    await call('uipath_bridge_status');await call('uipath_driver_versions');
    let base;
    if(baseUrl){const found=(await call('browser_tabs',{connectionRef:cap.data.connectionRef,url:baseUrl})).data;check(found.complete&&found.tabs.length===1,'BASE_TAB_NOT_UNIQUE');base=found.tabs[0];check(base.visibility==='visible','BASE_TAB_NOT_VISIBLE');}
    const attached=await call('browser_attach',{connectionRef:cap.data.connectionRef,...(base?{tabRef:base.tabRef}:{})});contextRef=attached.data.contextRef;receipt.cleanup.contextReleased=false;
    receipt.windowScope=base?'explicit-visible-base-window':'new-window';
    const opened=await call('browser_tab_open',{contextRef,...(base?{tabRef:attached.data.tabRef}:{}),url:fixture.url});tabRef=opened.data.tabRef;receipt.cleanup.tabsClosed=false;
    if(opened.data.metadataPending){const x=await call('browser_tab_get',a());tabRef=x.data.tabRef;}
    for(let i=0;i<50;i++){if(await evalJS('()=>window.fixtureReady===true'))break;await delay(100);}check(await evalJS('()=>window.fixtureReady===true'),'FIXTURE_NOT_READY');
    receipt.chromeVersion=await evalJS('()=>navigator.userAgent.split("Chrome/")[1]?.split(" ")[0]??null');
    if(captureOnly){await step('capture-only-'+captureFormat,capture);await call('browser_tab_close',a());tabRef=null;receipt.cleanup.tabsClosed=true;}
    else{
    await step('session-discovery-snapshot-strict-find-read',async()=>{
      const tabs=await call('browser_tabs',{contextRef,url:fixture.url});check(tabs.data.tabs.some(t=>t.tabRef===tabRef),'TAB_NOT_ENUMERATED');await call('browser_tab_get',a());
      await call('browser_snapshot',a());check((await call('browser_find_elements',{...a(),locator:{kind:'css',value:'.absent'}})).data.matchCount===0,'ZERO_FIND');
      await call('browser_find_element',{...a(),locator:{kind:'attributes',tag:'INPUT',attributes:{id:'text'}}});
      const ambiguous=(await send('tools/call',{name:'browser_find_element',arguments:{...a(),locator:{kind:'css',value:'#form input'}}})).result.structuredContent;check(!ambiguous.ok&&ambiguous.error.code==='AMBIGUOUS_TARGET','STRICT_AMBIGUITY');
      await call('browser_get_element',{...element(await find('#text')),fields:['text','value','attributes','state','rect']});await call('browser_wait_for',{...a(),condition:'ready'});
      const promise=await call('browser_evaluate',{...a(),script:'async()=>{await new Promise(r=>setTimeout(r,30));return {resolved:true}}'});check(promise.data.value.resolved===true&&promise.data.awaitedPromise,'PROMISE_RESULT');
    });
    await step('dom-native-input-react-and-idempotency',async()=>{
      const text=await find('#text');await call('browser_type',{...element(text),text:'Tiếng Việt',method:'dom',requestKey:'dom-text'});
      await call('browser_type',{...element(text),text:'Tiếng Việt',method:'dom',requestKey:'dom-text'});
      await call('browser_type',{...element(text),text:' 😎',mode:'append',method:'uipath'});await call('browser_set_text',{...element(text),text:'selection text'});
      const controlled=await find('#controlled');await call('browser_type',{...element(controlled),text:'React accepted'});check(await evalJS('()=>window.fixtureModel')==='React accepted','REACT_MODEL');
      await call('browser_type',{...element(controlled),text:'React native',method:'uipath'});await call('browser_type',{...element(controlled),text:' retained',mode:'append',method:'uipath'});check(await evalJS('()=>window.fixtureModel')==='React native retained','REACT_NATIVE_MODEL');
      await call('browser_set_checked',{...element(await find('#check')),checked:true});await call('browser_select_options',{...element(await find('#select')),values:['b']});
      await call('browser_set_checked',{...element(await find('#check')),checked:false,method:'uipath'});await call('browser_select_options',{...element(await find('#select')),values:['a'],method:'uipath'});
      const password=await find('#secret');const masked=await call('browser_type',{...element(password),text:'fixture-replacement'});check(masked.data.redacted&&masked.data.value===null,'PASSWORD_REDACTION');
      await call('browser_text_selection',{...element(text),action:'set',start:0,end:4});check((await call('browser_text_selection',{...element(text),action:'get'})).data.text==='sele','SELECTION');
      await call('browser_set_attribute',{...element(text),name:'data-fixture',value:'ok'});await call('browser_focus',element(text));
    });
    await step('events-pointer-scroll-highlight-drag-popup',async()=>{
      const watch=(await call('browser_events',{...a(),action:'subscribe',eventTypes:['click','input']})).data.watchRef;
      const button=await find('#button');await call('browser_scroll',{...a(),elementRef:button,action:'intoView'});await call('browser_hover',element(button));
      await call('browser_highlight',{...element(button),action:'start',color:'#ff0000',ttlMs:1000});await call('browser_click',element(button));check(await evalJS('()=>window.fixtureClicks')===1,'CLICK_EFFECT');
      const nativeClick={...element(button),method:'uipath',requestKey:'native-click-once'};await call('browser_click',nativeClick);await call('browser_click',nativeClick);check(await evalJS('()=>window.fixtureClicks')===2,'NATIVE_CLICK_AND_KEY_DEDUP');
      check((await call('browser_events',{...a(),action:'poll',watchRef:watch})).data.events.length>0,'EVENT_WITNESS');await call('browser_events',{...a(),action:'unsubscribe',watchRef:watch});
      await call('browser_drag_and_drop',{contextRef,sourceRef:await find('#drag'),targetRef:await find('#drop')});check(await evalJS('()=>document.querySelector("#drop").dataset.dropped')==='yes','DROP_WITNESS');
      await call('browser_close_popup',{...a(),closeLocator:{kind:'css',value:'#close'}});check(await evalJS('()=>!document.querySelector("#popup")'),'POPUP_WITNESS');
    });
    await step('forms-table-cell-tree-calendar-cookies',async()=>{
      const form=await find('#form');await call('browser_form_read',{...a(),elementRef:form});await call('browser_form_fill',{...a(),fields:[{locator:{kind:'css',value:'#text'},value:'filled'},{locator:{kind:'css',value:'#check'},checked:false},{locator:{kind:'css',value:'#select'},selectedValues:['a']}]});
      const table=await find('#table');const x=await call('browser_extract_table',{...a(),elementRef:table});check(x.data.rows.length===2,'TABLE_ROWS');await call('browser_table_cell',{...element(table),row:1,column:0});
      await call('browser_tree',{...element(await find('#tree')),action:'read'});await call('browser_tree',{...element(await find('#branch')),action:'expand'});
      await call('browser_calendar_select',{...element(await find('#date')),date:'2026-10-26'});
      await call('browser_cookies',{...a(),action:'set',name:'fixture',value:'ok',path:'/'});check((await call('browser_cookies',{...a(),action:'list'})).data.cookies.some(c=>c.name==='fixture'),'COOKIE_WITNESS');await call('browser_cookies',{...a(),action:'delete',name:'fixture',path:'/'});
    });
    await step('explicit-same-cross-origin-iframe-and-stale-ref',async()=>{
      const childRefs={};await call('browser_frames',a());for(const id of ['same','cross']){
        const frame=(await call('browser_frame_attach',element(await find('#'+id)))).data.frameRef;
        const input=(await call('browser_find_element',{...a(),frameRef:frame,locator:{kind:'css',value:'#frame-input'}})).data.elementRef;
        await call('browser_type',{...element(input),text:id+' frame'});check((await call('browser_get_element',element(input))).data.value===id+' frame','FRAME_VALUE');
        childRefs[id]={frame,input};
      }
      for(const id of ['same','cross']){
        await call('browser_evaluate',{...a(),input:{id},script:'async(_,input)=>{const f=document.querySelector("#"+input.id);await new Promise(resolve=>{f.addEventListener("load",resolve,{once:true});f.src=f.src+"?reload=1"});return true}'});
        const staleChild=(await send('tools/call',{name:'browser_type',arguments:{...element(childRefs[id].input),text:'must not write'}})).result.structuredContent;check(!staleChild.ok&&staleChild.error.code==='STALE_FRAME','RELOADED_CHILD_REF');
        const sibling=id==='same'?'cross':'same';await call('browser_get_element',element(childRefs[sibling].input));
        const frame=(await call('browser_frame_attach',element(await find('#'+id)))).data.frameRef,input=(await call('browser_find_element',{...a(),frameRef:frame,locator:{kind:'css',value:'#frame-input'}})).data.elementRef;childRefs[id]={frame,input};
      }
      const old=await find('#text');await evalJS('()=>{const e=document.querySelector("#text");e.replaceWith(e.cloneNode(true));return true}');
      const stale=(await send('tools/call',{name:'browser_type',arguments:{...element(old),text:'must not write'}})).result.structuredContent;check(!stale.ok&&stale.error.code==='STALE_ELEMENT','STALE_REF');
    });
    await step('network-window-new-tab-navigation',async()=>{
      const watch=(await call('browser_network_wait',{...a(),action:'arm'})).data.watchRef;await evalJS('()=>{fetch("./slow");return true}');check((await call('browser_network_wait',{...a(),action:'wait',watchRef:watch,quietMs:200})).data.quiet,'NETWORK_QUIET');
      await call('browser_tab_activate',a());await call('browser_window',{...a(),action:'get'});await call('browser_window',{...a(),action:'maximize'});
      const newUrl=fixture.url+'?new=1',w=(await call('browser_wait_new_tab',{contextRef,action:'arm',url:newUrl})).data.watchRef;
      const opened=await call('browser_tab_open',{contextRef,tabRef,url:newUrl});extraTab=opened.data.tabRef;const found=await call('browser_wait_new_tab',{contextRef,action:'wait',watchRef:w});check(found.data.tab.tabRef===extraTab,'NEW_TAB_CORRELATION');await call('browser_tab_close',{contextRef,tabRef:extraTab});extraTab=null;
      let next=await call('browser_navigate',{...a(),url:fixture.url+'?navigation=1'});tabRef=next.data.tabRef;next=await call('browser_history',{...a(),action:'reload'});tabRef=next.data.tabRef;
    });
    await step('screenshot-image-artifact',capture);
    await call('browser_tab_close',a());tabRef=null;receipt.cleanup.tabsClosed=true;
    }
    const released=await call('browser_attach',{action:'release',contextRef});receipt.cleanup.contextReleased=released.data.cleanupConfirmed;check(released.data.cleanupConfirmed,'OWNER_CLEANUP_UNCONFIRMED');contextRef=null;
    if(!captureOnly)check(CORE_BROWSER_TOOLS.every(t=>receipt.toolsExercised.includes(t.name)),'MISSING_CORE_TOOL_SMOKE');receipt.passed=true;
  }
}catch(e){receipt.error=e.message.slice(0,300);process.exitCode=1;console.log(JSON.stringify({passed:false,error:receipt.error}));}
finally{
  for(const ref of [extraTab,tabRef].filter(Boolean)){if(closeAttempts.has(ref))continue;try{await call('browser_tab_close',{contextRef,tabRef:ref,timeoutMs:5000});if(ref===tabRef)receipt.cleanup.tabsClosed=true;}catch{}}
  if(contextRef){try{const released=await call('browser_attach',{action:'release',contextRef});receipt.cleanup.contextReleased=released.data.cleanupConfirmed;}catch{receipt.cleanup.contextReleased=false;}}
  child.stdin.end();await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},12000);child.once('exit',()=>{clearTimeout(timer);clientEnded=true;resolve();});});receipt.cleanup.clientExited=clientEnded;
  if(fixture)await fixture.close();receipt.cleanup.serversStopped=true;
  if(fixture&&(!receipt.cleanup.tabsClosed||receipt.cleanup.contextReleased!==true||!clientEnded)){receipt.passed=false;process.exitCode=1;}
  receipt.sourceHashes={};for(const f of ['src/bridge.mjs','src/transport.mjs','src/capabilities.mjs','src/browser-runtime.mjs','src/browser-operations.mjs','src/browser-page.mjs','src/browser-observers.mjs','src/browser-composites.mjs','src/browser-artifacts.mjs','src/browser-tools.mjs','src/browser-advanced.mjs','src/browser-accessibility.mjs','src/browser-semantic.mjs','src/browser-visual.mjs','src/browser-visual-worker.mjs','src/browser-launch.mjs','src/windows-browser-helper.mjs','src/companion-protocol.mjs','src/companion-pairing.mjs','src/companion-client.mjs','companion/manifest.json','companion/service-worker.mjs','companion/backend.mjs','companion/protocol.mjs','companion/storage.mjs','docs/browser-tool-contracts.json','scripts/run-browser-live.mjs','scripts/browser-runtime-fixture.mjs','scripts/fixtures/browser-runtime.jsx','scripts/Windows-BrowserHelper.ps1','scripts/Windows-BrowserLaunch.ps1','package-lock.json'])receipt.sourceHashes[f]=createHash('sha256').update(await readFile(path.join(root,f))).digest('hex');
  await mkdir(path.join(root,'work'),{recursive:true});await writeFile(path.join(root,'work/BROWSER-LIVE-VERIFICATION.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({passed:receipt.passed,steps:receipt.steps.length,tools:receipt.toolsExercised.length,cleanup:receipt.cleanup}));
}
