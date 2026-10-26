import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {harness} from './browser-harness.mjs';
import {validateToolInput,fingerprint,BROWSER_TOOLS} from '../src/browser-tools.mjs';
import {NativeDecoder,nativeFrame,MAX_BYTES} from '../src/transport.mjs';
import {createArtifactStore} from '../src/browser-artifacts.mjs';
import path from 'node:path';

test('DOM discovery, strict matching, controlled text, native Unicode append and password redaction',async t=>{
  const h=await harness(t),elementRef=await h.find('text'),a={contextRef:h.args.contextRef,elementRef};
  const w=h.pages.get(1).w;w.document.querySelector('#text').addEventListener('input',e=>{w.mirror=e.target.value;});
  assert.equal((await h.must('browser_type',{...a,text:'Tiếng Việt'})).data.valueMatch,true);assert.equal(w.mirror,'Tiếng Việt');
  assert.equal((await h.must('browser_type',{...a,text:' 😎',method:'uipath',mode:'append'})).data.value,'Tiếng Việt 😎');
  assert.equal((await h.must('browser_find_elements',{...h.args,locator:{kind:'css',value:'.missing'}})).data.matchCount,0);
  assert.equal((await h.call('browser_find_element',{...h.args,locator:{kind:'css',value:'input'}})).error.code,'AMBIGUOUS_TARGET');
  const secret=await h.find('secret');await h.must('browser_text_selection',{contextRef:h.args.contextRef,elementRef:secret,action:'set',start:0,end:3});
  assert.ok(!JSON.stringify(await h.must('browser_text_selection',{contextRef:h.args.contextRef,elementRef:secret,action:'get'})).includes('pri'));
  assert.equal((await h.must('browser_get_element',{contextRef:h.args.contextRef,elementRef:secret})).data.value,null);
});
test('stale node replacement and explicit tab/frame scope fail before activation or writes',async t=>{
  const h=await harness(t),elementRef=await h.find('text'),other=(await h.must('browser_tabs',{contextRef:h.args.contextRef})).data.tabs.find(x=>x.url.startsWith('https://other'));
  const before=h.activations;
  for(const [name,args]of [['browser_evaluate',{script:'()=>1'}],['browser_scroll',{action:'intoView'}],['browser_wait_for',{condition:'visible'}],['browser_extract_table',{}]]){
    const v=await h.call(name,{...h.args,tabRef:other.tabRef,elementRef,...args});assert.equal(v.error.code,'REF_SCOPE_MISMATCH');
  }
  assert.equal(h.activations,before);
  h.pages.get(1).w.document.querySelector('#text').outerHTML='<input id="text">';
  assert.equal((await h.call('browser_type',{contextRef:h.args.contextRef,elementRef,text:'bad'})).error.code,'STALE_ELEMENT');
});
test('in-flight request keys join once, conflict before dispatch, unknown blocks and resolution expires every context ref',async t=>{
  const h=await harness(t),elementRef=await h.find('text'),a={contextRef:h.args.contextRef,elementRef,text:'once',requestKey:'same'};
  const [x,y]=await Promise.all([h.call('browser_type',a),h.call('browser_type',a)]);assert.deepEqual(x,y);assert.equal(x.ok,true);
  assert.equal((await h.call('browser_type',{...a,text:'changed'})).error.code,'REQUEST_KEY_CONFLICT');
  assert.notEqual(fingerprint('x',{requestKey:'a',input:{requestKey:'one'}}),fingerprint('x',{requestKey:'a',input:{requestKey:'two'}}));
  const discovery=await h.must('browser_tabs'),ctx2=await h.must('browser_attach',{connectionRef:h.runtime.connectionRef,tabRef:discovery.data.tabs[0].tabRef});
  const failure=await h.call('browser_evaluate',{...h.args,script:'()=>{document.body.dataset.effect="yes";throw new Error("fail")}',requestKey:'failed'});
  assert.equal(failure.error.dispatchState,'unknown');assert.equal(h.pages.get(1).w.document.body.dataset.effect,'yes');
  assert.equal((await h.call('browser_type',{...a,requestKey:'new'})).error.code,'WRITE_BLOCKED');
  const observed=await h.must('browser_tab_get',{...h.args,resolve:{requestKey:'failed',resolution:'abandon-unknown'}});assert.equal(observed.data.resolution,'abandon-unknown');
  assert.equal(h.runtime.tabs.get(ctx2.data.tabRef).retired,true);assert.deepEqual(await h.call('browser_evaluate',{...h.args,script:'()=>{document.body.dataset.effect="yes";throw new Error("fail")}',requestKey:'failed'}),failure);
});
test('navigation waits for a document transition and generations advance; enumeration failure never proves close',async t=>{
  const h=await harness(t);let timer;h.setHook((name,a)=>{if(name==='Navigate'){timer=setTimeout(()=>h.page(a.tabId,a.url),100);return {retCode:1};}});t.after(()=>clearTimeout(timer));
  const before=Date.now(),v=await h.must('browser_navigate',{...h.args,url:'https://fixture.test/new'});assert.ok(Date.now()-before>=90);assert.equal(v.data.documentChanged,true);assert.ok(v.context===null||h.runtime.tabs.get(v.data.tabRef).generation>0);
  h.setHook(name=>name==='FindBrowserTabs'?{retCode:0,results:[],openTabsCount:0}:undefined);
  const result=await h.call('browser_tab_close',{contextRef:h.args.contextRef,tabRef:v.data.tabRef});assert.equal(result.ok,false);assert.notEqual(result.data?.closed,true);
});
test('falsy promise rejection and oversized evaluate quarantine writes without script replay',async t=>{
  const h=await harness(t);for(const script of ['()=>Promise.reject(null)','()=>"x".repeat(100000)']){
    const key=randomUUID(),v=await h.call('browser_evaluate',{...h.args,script,requestKey:key});assert.equal(v.ok,false);assert.equal(v.error.dispatchState,'unknown');
    const x=await h.must('browser_tab_get',{...h.args,resolve:{requestKey:key,resolution:'abandon-unknown'}});h.args.tabRef=x.data.tabRef;
  }
});
test('network cancellation, TTL and failed-stop retry; other tabs do not wait behind a long poll',async t=>{
  const h=await harness(t),arm=await h.must('browser_network_wait',{...h.args,action:'arm',ttlMs:1000}),watchRef=arm.data.watchRef;
  let stopFail=true;h.setHook(name=>name==='StopWebRequestMonitoring'&&stopFail?{retCode:0}:undefined);
  const cancel=await h.call('browser_network_wait',{...h.args,action:'cancel',watchRef});assert.equal(cancel.error.code,'MONITOR_CLEANUP_UNCONFIRMED');stopFail=false;await h.runtime.sweep();assert.equal(h.runtime.network.size,0);
  const next=await h.must('browser_network_wait',{...h.args,action:'arm',ttlMs:1000});await delay(1050);assert.equal(h.runtime.watches.get(next.data.watchRef).stopped,true);
  assert.equal((await h.call('browser_network_wait',{...h.args,action:'wait',watchRef:next.data.watchRef})).error.code,'WATCH_EXPIRED');
  const other=(await h.must('browser_tabs',{contextRef:h.args.contextRef})).data.tabs.find(x=>x.url.startsWith('https://other'));
  const poll=h.call('browser_wait_for',{...h.args,condition:'urlEquals',expected:'https://never.test/',timeoutMs:500});await delay(10);
  const time=Date.now();assert.equal((await h.call('browser_tab_get',{contextRef:h.args.contextRef,tabRef:other.tabRef})).ok,true);assert.ok(Date.now()-time<300);assert.equal((await poll).error.code,'TIMEOUT');
});
test('events release listeners; cookies enforce path boundary; artifact ownership and non-overwrite',async t=>{
  const h=await harness(t),events=await h.must('browser_events',{...h.args,action:'subscribe',eventTypes:['input']});
  const elementRef=await h.find('text');await h.must('browser_type',{contextRef:h.args.contextRef,elementRef,text:'event'});
  assert.ok((await h.must('browser_events',{...h.args,action:'poll',watchRef:events.data.watchRef})).data.events.length>0);
  assert.equal((await h.call('browser_cookies',{...h.args,action:'set',name:'test',value:'ok',path:'/app'})).ok,false);
  const shot=await h.must('browser_screenshot',h.args),artifactRef=shot.data.artifactRef;
  await h.must('browser_image_artifact',{contextRef:h.args.contextRef,artifactRef,action:'save',name:'test.png'});
  assert.equal((await h.call('browser_image_artifact',{contextRef:h.args.contextRef,artifactRef,action:'save',name:'test.png'})).error.code,'ARTIFACT_IO_ERROR');
  await assert.rejects(h.runtime.artifacts.image(randomUUID(),h.args.contextRef,artifactRef),/expired|belongs/);
  assert.equal((await h.must('browser_attach',{action:'release',contextRef:h.args.contextRef})).data.cleanupConfirmed,true);assert.equal(h.runtime.watches.get(events.data.watchRef).ended,true);
});
test('transport raises only native inbound screenshot bound; malformed arguments reject before dispatch',()=>{
  const body=Buffer.from(JSON.stringify({value:'a'.repeat(MAX_BYTES+1)})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);const packet=Buffer.concat([header,body]);
  assert.throws(()=>new NativeDecoder().push(packet));assert.equal(new NativeDecoder(8*MAX_BYTES).push(packet).length,1);assert.throws(()=>nativeFrame({value:'a'.repeat(MAX_BYTES+1)}));
  for(const script of ['doEvil()','function*(){}','()=>1);evil();//'])assert.throws(()=>validateToolInput('browser_evaluate',{contextRef:'ctx_'+randomUUID(),tabRef:'tab_'+randomUUID(),script}));
  assert.equal(BROWSER_TOOLS.length,42);
});
test('child frame reload expires child refs while main stays valid; reattach advances generation',async t=>{
  const h=await harness(t),main=await h.find('text'),iframe=await h.find('frame'),frame=(await h.must('browser_frame_attach',{contextRef:h.args.contextRef,elementRef:iframe})).data;
  const child=(await h.must('browser_find_element',{...h.args,frameRef:frame.frameRef,locator:{kind:'css',value:'#child'}})).data.elementRef;
  await h.must('browser_type',{contextRef:h.args.contextRef,elementRef:child,text:'child'});h.reloadChild();
  assert.equal((await h.call('browser_type',{contextRef:h.args.contextRef,elementRef:child,text:'bad'})).error.code,'STALE_FRAME');
  assert.equal((await h.call('browser_type',{contextRef:h.args.contextRef,elementRef:main,text:'main'})).ok,true);
  const next=await h.must('browser_frame_attach',{contextRef:h.args.contextRef,elementRef:iframe});assert.ok(next.data.documentGeneration>frame.documentGeneration);
});
test('composites return typed table/form/tree/calendar results and retain partial failed form steps',async t=>{
  const h=await harness(t),a=h.args,table=await h.find('table');
  assert.equal((await h.must('browser_extract_table',{...a,elementRef:table})).data.rows.length,1);
  assert.ok((await h.must('browser_table_cell',{contextRef:a.contextRef,elementRef:table,row:1,column:0})).data.elementRef);
  assert.ok((await h.must('browser_form_read',{...a,elementRef:await h.find('form')})).data.fields.length>=4);
  await h.must('browser_calendar_select',{contextRef:a.contextRef,elementRef:await h.find('date'),date:'2026-10-26'});
  const tree=await h.find('tree');assert.equal((await h.must('browser_tree',{contextRef:a.contextRef,elementRef:tree,action:'read'})).data.nodes.length,1);
  const filled=await h.call('browser_form_fill',{...a,fields:[{locator:{kind:'css',value:'#text'},value:'first'},{locator:{kind:'css',value:'.missing'},value:'never'}]});
  assert.equal(filled.ok,false);assert.equal(filled.data.completed,1);assert.equal(filled.data.partial,true);assert.equal(h.pages.get(1).w.document.querySelector('#text').value,'first');
});
test('parallel artifact writes cannot exceed disk quota and malformed adapter results fail closed',async t=>{
  const h=await harness(t),store=createArtifactStore(path.join(h.root,'quota'),{maxTotalBytes:90}),bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=','base64');
  const results=await Promise.allSettled([store.put(h.client,h.args.contextRef,bytes,'image/png'),store.put(h.client,h.args.contextRef,bytes,'image/png')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  h.runtime.handlers.browser_snapshot=async()=>({data:{unexpected:true}});assert.equal((await h.call('browser_snapshot',h.args)).error.code,'CONTRACT_VIOLATION');
});
test('release drains in-flight capture before deleting artifacts and reports failed monitor cleanup',async t=>{
  const h=await harness(t);let started;const gate=new Promise(resolve=>{started=resolve;});
  h.setHook(async(name)=>{if(name==='TakeScreenshot'){started();await delay(70);}return undefined;});
  const shot=h.call('browser_screenshot',h.args);await gate;const released=h.call('browser_attach',{action:'release',contextRef:h.args.contextRef});
  assert.equal((await shot).ok,false);assert.equal((await released).data.cleanupConfirmed,true);assert.equal(h.runtime.artifacts.size,0);
  const ctx=(await h.must('browser_attach',{connectionRef:h.runtime.connectionRef})).data.contextRef;
  const tab=(await h.must('browser_tabs',{contextRef:ctx})).data.tabs[0].tabRef;
  await h.must('browser_network_wait',{contextRef:ctx,tabRef:tab,action:'arm'});
  h.setHook(name=>name==='StopWebRequestMonitoring'?{retCode:0}:undefined);
  assert.equal((await h.must('browser_attach',{action:'release',contextRef:ctx})).data.cleanupConfirmed,false);
});
test('monitor startup cannot outlive TTL; active wait cancellation is distinct from expiry',async t=>{
  const h=await harness(t);h.setHook(async name=>{if(name==='StartWebRequestMonitoring'){await delay(1050);return {retCode:1};}});
  const late=await h.call('browser_network_wait',{...h.args,action:'arm',ttlMs:1000});assert.equal(late.error.code,'WATCH_EXPIRED');assert.equal(h.runtime.network.size,0);
  h.setHook(null);const watch=(await h.must('browser_network_wait',{...h.args,action:'arm'})).data.watchRef;
  let pollStarted;const start=new Promise(resolve=>{pollStarted=resolve;});h.setHook(async name=>{if(name==='AnyWebRequestsInFlight'){pollStarted();await delay(50);return {retCode:1,inFlight:false};}});
  const wait=h.call('browser_network_wait',{...h.args,action:'wait',watchRef:watch,quietMs:200});await start;
  const cancel=h.call('browser_network_wait',{...h.args,action:'cancel',watchRef:watch});assert.equal((await wait).error.code,'WATCH_CANCELLED');assert.equal((await cancel).ok,true);
});
test('evaluate identity loss after dispatch always quarantines the native tab',async t=>{
  const h=await harness(t);h.setHook(async(name,a)=>{if(name==='InjectAndRunJs'&&a.executionWorld===1){h.setHook(null);const result=await h.request(name,a);h.page(a.tabId);return result;}});
  const result=await h.call('browser_evaluate',{...h.args,script:'()=>1'});assert.equal(result.error.code,'ACTION_OUTCOME_UNKNOWN');assert.equal(h.runtime.unknownTabs.has(1),true);
});
test('observer evidence preserves dispatch and repeated unsubscribe cannot hide unconfirmed cleanup',async t=>{
  const h=await harness(t),subscription=await h.must('browser_events',{...h.args,action:'subscribe',eventTypes:['click']});assert.equal(subscription.evidence.dispatchState,'acknowledged');
  const watch=h.runtime.watches.get(subscription.data.watchRef);watch.ended=true;watch.cleanupUnconfirmed=true;
  h.setHook((name,a)=>{if(name==='InjectAndRunJs'&&JSON.parse(a.input).op==='events')return {retCode:0};});
  for(let i=0;i<2;i++){const failed=await h.call('browser_events',{...h.args,action:'unsubscribe',watchRef:watch.ref});assert.equal(failed.ok,false);assert.equal(failed.error.dispatchState,'unknown');}
  h.setHook(null);const clean=await h.must('browser_events',{...h.args,action:'unsubscribe',watchRef:watch.ref});assert.equal(clean.evidence.dispatchState,'acknowledged');assert.equal(watch.cleanupUnconfirmed,false);
});
test('new-tab waits do not hold the window write queue and client release drains discovery refs',async t=>{
  const h=await harness(t),text=await h.find('text'),watch=(await h.must('browser_wait_new_tab',{contextRef:h.args.contextRef,action:'arm',url:'https://never.test/'})).data.watchRef;
  const wait=h.call('browser_wait_new_tab',{contextRef:h.args.contextRef,action:'wait',watchRef:watch,timeoutMs:500});await delay(10);const started=Date.now();
  assert.equal((await h.must('browser_type',{contextRef:h.args.contextRef,elementRef:text,text:'concurrent'})).ok,true);assert.ok(Date.now()-started<300);assert.equal((await wait).error.code,'TIMEOUT');
  await h.must('browser_tabs');assert.ok([...h.runtime.tabs.values()].some(t=>t.clientRef===h.client&&t.contextRef===null&&!t.retired));
  let entered;const gate=new Promise(resolve=>{entered=resolve;});h.setHook(async name=>{if(name==='FindBrowserTabs'){entered();await delay(50);}});
  const discovery=h.call('browser_tabs');await gate;await h.runtime.releaseClient(h.client);assert.equal((await discovery).ok,false);
  assert.equal([...h.runtime.tabs.values()].filter(t=>t.clientRef===h.client&&!t.retired).length,0);assert.equal(h.runtime.clients.has(h.client),false);
  assert.equal((await h.call('browser_tabs')).error.code,'STALE_CONTEXT');assert.equal(h.runtime.clients.has(h.client),false);
});
test('confirmed tab closure proves page resources gone even after ref registry pruning',async t=>{
  const h=await harness(t),events=await h.must('browser_events',{...h.args,action:'subscribe',eventTypes:['input']});
  await h.must('browser_tab_close',h.args);await h.runtime.sweep();
  const calls=h.calls.length;await h.runtime.expireWatch(h.runtime.watches.get(events.data.watchRef));assert.equal(h.runtime.cleanupUnconfirmed,0);
  const result=await h.must('browser_attach',{action:'release',contextRef:h.args.contextRef});assert.equal(result.data.cleanupConfirmed,true);
  assert.equal(h.calls.length,calls,'No page cleanup RPC may target an independently closed native tab');
});
test('structured screenshot rejection is distinct from a missing native reply',async t=>{
  const h=await harness(t);h.setHook(name=>name==='TakeScreenshot'?{retCode:0,error:{code:8,message:'Capture denied'}}:undefined);
  const result=await h.call('browser_screenshot',h.args);assert.equal(result.error.code,'CAPTURE_FAILED');assert.equal(result.error.details.vendorCode,8);assert.equal(result.error.details.reason,'Capture denied');
  h.setHook(name=>name==='TakeScreenshot'?{retCode:0,error:{code:8,message:'Failed to capture tab: image readback failed'}}:undefined);
  const unavailable=await h.call('browser_screenshot',h.args);assert.equal(unavailable.error.code,'CAPTURE_FAILED');assert.equal(h.runtime.descriptor().temporarilyUnavailable.browser_screenshot,undefined);
});
test('a timed-out capture preserves diagnostics without disabling a different visible target',async t=>{
  const h=await harness(t);h.setHook(name=>{if(name==='TakeScreenshot')throw Object.assign(Error('No callback'),{code:'NATIVE_RESPONSE_TIMEOUT'});});
  const failed=await h.call('browser_screenshot',h.args);assert.equal(failed.error.code,'TIMEOUT');assert.equal(failed.error.details.nativeCode,'NATIVE_RESPONSE_TIMEOUT');
  const count=h.calls.filter(c=>c.name==='TakeScreenshot').length;
  const other=(await h.must('browser_tabs',{contextRef:h.args.contextRef})).data.tabs.find(x=>x.url.startsWith('https://other'));
  h.setHook(null);await h.must('browser_tab_activate',{contextRef:h.args.contextRef,tabRef:other.tabRef});
  await h.must('browser_screenshot',{contextRef:h.args.contextRef,tabRef:other.tabRef});assert.equal(h.calls.filter(c=>c.name==='TakeScreenshot').length,count+1);
  assert.equal(h.runtime.descriptor().temporarilyUnavailable.browser_screenshot,undefined);
});
test('visibility refresh rejects hidden targets before native capture and readiness expiry never quarantines writes',async t=>{
  const h=await harness(t),w=h.pages.get(1).w;
  Object.defineProperty(w.document,'visibilityState',{value:'hidden',configurable:true});
  assert.equal((await h.must('browser_tab_get',h.args)).data.visibility,'hidden');
  assert.equal((await h.must('browser_tabs',{contextRef:h.args.contextRef})).data.tabs.find(x=>x.tabRef===h.args.tabRef).visibility,'hidden');
  assert.equal((await h.call('browser_screenshot',h.args)).error.code,'TARGET_NOT_VISIBLE');assert.equal(h.calls.some(c=>c.name==='TakeScreenshot'),false);
  Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
  const failed=await h.call('browser_screenshot',{...h.args,timeoutMs:5000});assert.equal(failed.error.code,'CAPTURE_NOT_READY');assert.equal(failed.error.dispatchState,'notSent');
  assert.equal(h.calls.some(c=>c.name==='TakeScreenshot'),false);assert.equal(h.runtime.unknownTabs.size,0);
  await h.must('browser_type',{contextRef:h.args.contextRef,elementRef:await h.find('text'),text:'still writable'});
});
test('render tickets enforce owner, bounded lifetime, consumption and release cleanup',async t=>{
  const h=await harness(t),w=h.pages.get(1).w,namespace=h.runtime.namespace;
  const run=(owner,action,extra={})=>JSON.parse(w.eval(`(${h.calls.find(c=>c.name==='InjectAndRunJs').a.jsCode})`)(null,JSON.stringify({namespace,owner,op:'render',action,...extra})));
  const ticket=run('one','arm',{ttlMs:2000}).data.ticket;
  assert.equal(run('two','poll',{ticket}).error.code,'REF_SCOPE_MISMATCH');assert.equal(run('two','cancel',{ticket}).error.code,'REF_SCOPE_MISMATCH');
  let observed;const deadline=Date.now()+2000;
  do{await delay(20);observed=run('one','poll',{ticket});}while(observed.ok&&!observed.data.ready&&Date.now()<deadline);
  assert.equal(observed.data?.ready,true);assert.equal(run('one','poll',{ticket}).error.code,'CAPTURE_NOT_READY');assert.equal(run('one','cancel',{ticket}).ok,true);
  run(h.args.contextRef,'arm',{ttlMs:2000});assert.equal(w[Symbol.for(namespace)].renders.size,1);
  // Screenshot registers owner-release cleanup before an arm, even when its acknowledgement is lost.
  const tab=h.runtime.tabs.get(h.args.tabRef),ctx=h.runtime.contexts.get(h.args.contextRef),frame=h.runtime.mainFrame({ctx},tab);h.runtime.touchFrame({ctx},tab,frame);
  await h.must('browser_attach',{action:'release',contextRef:h.args.contextRef});assert.equal(w[Symbol.for(namespace)].renders.size,0);
  w.requestAnimationFrame=()=>1;const expiring=run('one','arm',{ttlMs:100}).data.ticket;await delay(130);assert.equal(run('one','poll',{ticket:expiring}).error.code,'CAPTURE_NOT_READY');assert.equal(w[Symbol.for(namespace)].renders.size,0);
});
test('context and absolute deadline take precedence over a late readiness rejection',async t=>{
  for(const mode of ['context','deadline']){
    const h=await harness(t);h.setHook(async(name,a)=>{
      if(name!=='InjectAndRunJs')return;const q=JSON.parse(a.input);if(q.op!=='render'||q.action!=='poll')return;
      if(mode==='context')h.runtime.contexts.get(h.args.contextRef).alive=false;else await delay(160);
      return {retCode:1,isScriptErr:0,result:JSON.stringify({ok:false,mutated:false,error:{code:'CAPTURE_NOT_READY',message:'expired'}})};
    });
    const result=await h.call('browser_screenshot',{...h.args,timeoutMs:100});assert.equal(result.error.code,mode==='context'?'STALE_CONTEXT':'TIMEOUT');assert.equal(result.error.dispatchState,'notSent');assert.equal(h.runtime.unknownTabs.size,0);assert.equal(h.calls.some(c=>c.name==='TakeScreenshot'),false);
  }
});
