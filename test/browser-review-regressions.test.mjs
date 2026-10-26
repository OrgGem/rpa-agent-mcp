import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {harness,HTML} from './browser-harness.mjs';

test('network observation timeout cleans the monitor without quarantining page writes',async t=>{
  const h=await harness(t),watchRef=(await h.must('browser_network_wait',{...h.args,action:'arm'})).data.watchRef;
  h.setHook(name=>name==='AnyWebRequestsInFlight'?{retCode:1,inFlight:true}:undefined);
  const result=await h.call('browser_network_wait',{...h.args,action:'wait',watchRef,timeoutMs:100});
  assert.equal(result.error.code,'TIMEOUT');assert.equal(result.error.dispatchState,'notSent');
  assert.equal(h.runtime.network.size,0);assert.equal(h.runtime.unknownTabs.size,0);
  assert.equal(h.calls.filter(c=>c.name==='StopWebRequestMonitoring').length,1);
  await h.must('browser_type',{contextRef:h.args.contextRef,elementRef:await h.find('text'),text:'still writable'});
});

test('failed network wait cleanup has a recoverable generated request key',async t=>{
  const h=await harness(t),watchRef=(await h.must('browser_network_wait',{...h.args,action:'arm'})).data.watchRef;
  h.setHook(name=>name==='StopWebRequestMonitoring'?{retCode:0}:undefined);
  const result=await h.call('browser_network_wait',{...h.args,action:'wait',watchRef,quietMs:100});
  assert.equal(result.error.code,'MONITOR_CLEANUP_UNCONFIRMED');assert.equal(result.error.dispatchState,'unknown');
  const requestKey=result.error.details.requestKey;
  assert.equal(h.runtime.contexts.get(h.args.contextRef).keys.get(requestKey).status,'unknown');
  h.setHook(null);await h.runtime.sweep();assert.equal(h.runtime.network.size,0);
  const resolved=await h.must('browser_tab_get',{...h.args,resolve:{requestKey,resolution:'abandon-unknown'}});
  h.args.tabRef=resolved.data.tabRef;assert.equal(h.runtime.unknownTabs.size,0);
  await h.must('browser_type',{contextRef:h.args.contextRef,elementRef:await h.find('text'),text:'recovered'});
});

test('a full write cache still permits release and valid unknown recovery',async t=>{
  for(const unknown of [false,true]){
    const h=await harness(t),elementRef=await h.find('text');
    for(let i=0;i<(unknown?255:256);i++)await h.must('browser_set_attribute',{contextRef:h.args.contextRef,elementRef,name:'data-count',value:String(i)});
    if(unknown){
      const failed=await h.call('browser_evaluate',{...h.args,script:'()=>{throw new Error("unknown")}',requestKey:'last-write'});
      assert.equal(failed.error.dispatchState,'unknown');
    }
    const ctx=h.runtime.contexts.get(h.args.contextRef);assert.equal(ctx.keys.size,256);
    assert.equal((await h.call('browser_set_attribute',{contextRef:h.args.contextRef,elementRef,name:'data-count',value:'overflow'})).error.code,'LIMIT_EXCEEDED');
    assert.equal((await h.call('browser_tab_get',{...h.args,resolve:{requestKey:'missing',resolution:'abandon-unknown'}})).error.code,'LIMIT_EXCEEDED');
    assert.equal(ctx.keys.size,256,'Invalid recovery must not bypass the bound');
    if(unknown){
      const args={...h.args,resolve:{requestKey:'last-write',resolution:'abandon-unknown'},requestKey:'resolve-last'};
      const recovered=await h.must('browser_tab_get',args);assert.equal(h.runtime.unknownTabs.size,0);
      assert.deepEqual(await h.call('browser_tab_get',args),recovered,'Recovery request keys still deduplicate');
    }
    const released=await h.must('browser_attach',{action:'release',contextRef:h.args.contextRef});
    assert.equal(released.data.cleanupConfirmed,true);assert.equal(ctx.alive,false);
    assert.equal(h.runtime.clients.get(h.client).contexts.has(ctx.ref),false);
  }
});

test('queued deadlines settle before the predecessor and never dispatch later or break ordering',async t=>{
  const h=await harness(t),elementRef=await h.find('text'),args={contextRef:h.args.contextRef,elementRef};
  let entered,unblock;const started=new Promise(r=>entered=r),gate=new Promise(r=>unblock=r);
  h.setHook(async(name,a)=>{if(name==='InjectAndRunJs'){const q=JSON.parse(a.input);if(q.op==='type'&&q.text==='held'){entered();await gate;}}});
  const held=h.call('browser_type',{...args,text:'held',timeoutMs:5000});
  let next;
  try{
    await started;
    const expiredArgs={...args,text:'must not write',timeoutMs:100,requestKey:'queued-expiry'};
    const pending=h.call('browser_type',expiredArgs),read=h.call('browser_tab_get',{...h.args,timeoutMs:100});
    const results=await Promise.race([Promise.all([pending,read]),delay(1500).then(()=>null)]);
    assert.ok(results,'Queued requests must time out while the predecessor is still held');
    for(const result of results){assert.equal(result.error.code,'TIMEOUT');assert.equal(result.error.dispatchState,'notSent');}
    assert.deepEqual(await h.call('browser_type',expiredArgs),results[0]);
    next=h.call('browser_type',{...args,text:'last',timeoutMs:5000});await delay(30);
    assert.equal(h.calls.filter(c=>c.name==='InjectAndRunJs'&&JSON.parse(c.a.input).op==='type').length,1,'Later writes cannot pass the held predecessor through an expired queue entry');
    unblock();assert.equal((await held).ok,true);assert.equal((await next).ok,true);
    assert.equal(h.pages.get(1).w.document.querySelector('#text').value,'last');
    assert.equal(h.calls.some(c=>c.name==='InjectAndRunJs'&&JSON.parse(c.a.input).text==='must not write'),false);
    assert.equal(h.runtime.pending,0);
  }finally{unblock();await held;if(next)await next;}
});

test('table pagination carries click evidence and replaces its initial root after document navigation',async t=>{
  for(const navigation of ['none','immediate','delayed']){
    const h=await harness(t),w=h.pages.get(1).w,wrapper=w.document.createElement('div');
    wrapper.id='wrapper';w.document.body.append(wrapper);wrapper.append(w.document.querySelector('#table'));
    const rootRef=await h.find('wrapper');
    const first=await h.must('browser_extract_table',{...h.args,elementRef:await h.find('table')});assert.equal(first.evidence.dispatchState,'notSent');
    if(navigation!=='none'){
      let clicked=false,documents=0;
      const navigate=()=>{h.page(1,'https://fixture.test/next',HTML.replace('<td>One</td>','<td>Two</td>'));h.pages.get(1).w.document.querySelector('#button').disabled=true;};
      h.setHook(async(name,a)=>{
        if(name!=='InjectAndRunJs')return;const q=JSON.parse(a.input);
        if(navigation==='delayed'){if(q.op==='click')clicked=true;else if(clicked&&q.op==='document'&&++documents===2){h.setHook(null);navigate();}return;}
        if(q.op!=='click')return;
        h.setHook(null);const response=await h.request(name,a);navigate();return response;
      });
    }else w.document.querySelector('#button').onclick=()=>{w.document.querySelector('#table').rows[1].cells[0].textContent='Two';w.document.querySelector('#button').disabled=true;};
    const result=await h.must('browser_extract_table',{...h.args,rootRef,pagination:{rootLocator:{kind:'css',value:'#table'},nextLocator:{kind:'css',value:'#button'},maxPages:3}});
    assert.equal(result.data.pages,2);assert.deepEqual(result.data.rows.map(row=>row.column_1),['One','Two']);
    assert.equal(result.data.partial,false);assert.equal(result.evidence.dispatchState,'acknowledged');assert.equal(h.runtime.unknownTabs.size,0);
  }
});
