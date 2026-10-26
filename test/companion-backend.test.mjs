import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeCompanionServiceWorker} from '../companion/service-worker.mjs';
import {COMPANION_EXTENSION_ID,validateCompanionEvent,validateCompanionRequest} from '../src/companion-protocol.mjs';
import {PINNED_UIPATH_EXTENSION_ID} from '../src/companion-pairing.mjs';

function signal(){
  const listeners=new Set();return {addListener(fn){listeners.add(fn);},removeListener(fn){listeners.delete(fn);},emit(...args){for(const fn of [...listeners])fn(...args);}};
}
function storage(){const values=new Map();return {get:key=>values.get(key),set:(key,value)=>values.set(key,value),remove:key=>values.delete(key),values:prefix=>[...values].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value),close(){}};}
function chromeFixture(){
  const commands=[],downloadItems=new Map(),auditTickets=new Map();let downloadId=40,stallNextKeyDown=false,failControlKeyUps=0;
  const api={runtime:{id:COMPANION_EXTENSION_ID,onMessageExternal:signal(),onSuspend:signal(),getManifest:()=>({version:'1.0.0'})},
    debugger:{onEvent:signal(),onDetach:signal(),async attach(target,version){commands.push(['attach',target,version]);},async detach(target){commands.push(['detach',target]);},async sendCommand(target,method,params){commands.push([method,params]);
      if(method==='Input.dispatchKeyEvent'&&params.type==='rawKeyDown'&&stallNextKeyDown){stallNextKeyDown=false;return new Promise(resolve=>setTimeout(resolve,500));}
      if(method==='Input.dispatchKeyEvent'&&params.type==='keyUp'&&params.key==='Control'&&failControlKeyUps>0){failControlKeyUps--;throw new Error('injected key-up failure');}
      if(method==='DOM.getDocument')return {root:{backendNodeId:2}};
      if(method==='Accessibility.queryAXTree'&&!Number.isSafeInteger(params.backendNodeId))throw new Error('root backendNodeId is required');
      if(method==='Runtime.evaluate'){
        const match=params.expression.match(/__uipathAxeTickets(?:\?\.)?\[("audit_[^"]+")\]/),auditRef=match?JSON.parse(match[1]):null;
        if(params.expression.includes('axe.run(document'))auditTickets.set(auditRef,{state:'running',cancelled:false,computationSettled:false,result:null});
        else if(params.expression.includes('t.cancelled=true')){const ticket=auditTickets.get(auditRef);if(ticket)ticket.cancelled=true;}
        else if(params.expression.includes('computationSettled'))return {result:{value:auditTickets.has(auditRef)?{...auditTickets.get(auditRef)}:null}};
      }
      if(method==='DOM.describeNode')return {node:{nodeName:'INPUT',attributes:['type','file']}};
      if(method==='Accessibility.getFullAXTree')return {nodes:[
        {role:{value:'button'},name:{value:'Continue'},backendDOMNodeId:71,properties:[]},
        {role:{value:'textbox'},name:{value:'Email address'},backendDOMNodeId:72,properties:[{name:'value',value:{value:'PRIVATE_VALUE'}}]},
        {role:{value:'textbox'},name:{value:'Password'},backendDOMNodeId:73,properties:[{name:'value',value:{value:'PASSWORD_SECRET'}}]}
      ]};
      if(method==='Accessibility.queryAXTree')return {nodes:[{role:{value:'button'},name:{value:'Continue'},backendDOMNodeId:71,properties:[]}]};
      if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame-main'}}};
      if(method==='Page.createIsolatedWorld')return {executionContextId:19};
      return {};
    }},
    tabs:{onUpdated:signal(),onRemoved:signal()},downloads:{onChanged:signal(),async download(options){const id=++downloadId;downloadItems.set(id,{id,state:'in_progress',filename:`C:\\Downloads\\${id}.pdf`,bytesReceived:3,totalBytes:8,url:options.url});return id;},
      async search(query){if(query.id!==undefined)return downloadItems.has(query.id)?[downloadItems.get(query.id)]:[];return [...downloadItems.values()];},
      async cancel(id){const item=downloadItems.get(id);if(item)item.state='interrupted';}}
  };return {api,commands,downloadItems,auditTickets,set stallNextKeyDown(value){stallNextKeyDown=value;},set failControlKeyUps(value){failControlKeyUps=value;}};
}
function nativePort(){const posts=[],onPost=signal();return {posts,onPost,onMessage:signal(),onDisconnect:signal(),postMessage(message){posts.push(message);onPost.emit(message);},disconnect(){onDisconnect.emit();}};}

test('service worker dispatches only validated typed requests through injected Chrome APIs',async()=>{
  let randomSequence=0;const fixture=chromeFixture(),backend=await initializeCompanionServiceWorker({chromeApi:fixture.api,storage:storage(),axeSource:'/* pinned axe fixture */'.padEnd(1200,'x'),randomBytes:size=>Buffer.alloc(size,++randomSequence)});
  const port=nativePort();backend.attachNativePort(port);
  assert.equal(backend.identity.extensionId,COMPANION_EXTENSION_ID);assert.equal(port.posts[0].type,'hello');assert.equal(port.posts[0].capabilities.axeCoreVersion,'4.14.0');
  backend.handleHostMessage({protocol:1,type:'epoch',connectionEpoch:12});
  const identity=backend.identity;
  const sender={id:PINNED_UIPATH_EXTENSION_ID,origin:'https://shop.example.test',frameId:0,documentId:'chrome-doc-1',tab:{id:21,windowId:8}};
  const nonce=Buffer.alloc(32,23).toString('base64url'),documentToken='doc-token-1';
  assert.equal(backend.acceptPairMessage({nonce,documentToken},sender,()=>{}),true);
  const attestation=port.posts.find(x=>x.type==='pair.attestation');
  assert.equal(attestation.attestation.sender.origin,'https://shop.example.test');
  assert.equal(attestation.attestation.sender.id,PINNED_UIPATH_EXTENSION_ID);
  assert.equal(Object.hasOwn(attestation.attestation,'tabRef'),false,'broker must add private refs and epoch bindings');
  const pairRef=`pair_${nonce}`,tabRef='tab-ref-1',ownerRef='owner-1',contextRef='context-1';let requestNumber=0;
  const call=async(operation,payload,{leaseRef=null,pair=pairRef,tab=tabRef,deadlineOffsetMs=4000}={})=>{
    const request={protocol:1,requestId:`request-${++requestNumber}`,connectionEpoch:identity.connectionEpoch,profileSessionRef:identity.profileSessionRef,
      pairRef:pair,operation,leaseRef,tabRef:tab,deadline:Date.now()+deadlineOffsetMs,payload};
    assert.equal(validateCompanionRequest(request),true,`${operation}: ${JSON.stringify(request)}`);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`timed out waiting for ${operation}`)),4500);
      const onReply=message=>{if(message.type==='reply'&&message.reply?.requestId===request.requestId){clearTimeout(timer);port.onPost.removeListener(onReply);resolve(message.reply);}};
      port.onPost.addListener(onReply);backend.handleHostMessage({type:'request',protocol:1,profileSessionRef:identity.profileSessionRef,companionEpoch:identity.companionEpoch,request});
    });
  };
  const acquired=await call('debugger.acquire',{ownerRef,contextRef,documentToken,generation:2,ttlMs:10000},{leaseRef:null});
  assert.equal(acquired.ok,true,JSON.stringify(acquired));const leaseRef=acquired.data?.leaseRef;assert.ok(leaseRef);
  assert.ok(fixture.commands.some(([name])=>name==='attach'));
  const keyResult=await call('keys.dispatch',{ownerRef,keys:[{key:'ENTER',modifiers:['CTRL']}]},{leaseRef});
  assert.equal(keyResult.ok,true);assert.deepEqual(keyResult.data.releasedKeys,['ENTER','CTRL']);
  fixture.stallNextKeyDown=true;
  const timedKey=await call('keys.dispatch',{ownerRef,keys:[{key:'ENTER'}]},{leaseRef,deadlineOffsetMs:100});
  assert.equal(timedKey.error,'UNKNOWN_OUTCOME');
  assert.ok(fixture.commands.some(([method,params])=>method==='Input.dispatchKeyEvent'&&params.type==='keyUp'&&params.key==='Enter'),
    'timed out key-down attempt must receive an independent key-up cleanup attempt');

  const fileArm=await call('file.arm',{ownerRef,contextRef,documentToken,generation:2,triggerRequestKey:'write-1',releasePolicy:'cancel',ttlMs:5000},{leaseRef});
  assert.equal(fileArm.ok,true);const pickerWatchRef=fileArm.data.pickerWatchRef;
  assert.equal((await call('file.trigger',{ownerRef,contextRef,pickerWatchRef,triggerRequestKey:'wrong-key'},{leaseRef})).ok,false);
  const pendingFile=call('file.wait',{ownerRef,contextRef,pickerWatchRef,timeoutMs:3000},{leaseRef});
  assert.equal((await call('file.trigger',{ownerRef,contextRef,pickerWatchRef,triggerRequestKey:'write-1'},{leaseRef})).ok,true);
  fixture.api.debugger.onEvent.emit({tabId:21},'Page.fileChooserOpened',{backendNodeId:9001,frameId:'frame-main'});
  const opened=await pendingFile;assert.equal(opened.ok,true);const pickerRef=opened.data.pickerRef;assert.ok(pickerRef);
  const hash='a'.repeat(64),provided=await call('file.provide',{ownerRef,contextRef,pickerRef,files:[{path:'C:\\managed\\staged.txt',sha256:hash,bytes:12,name:'staged.txt'}]},{leaseRef});
  assert.equal(provided.ok,true);assert.equal(provided.data.hashes[0],hash);assert.equal(JSON.stringify(provided).includes('C:\\managed'),false);
  assert.equal((await call('file.provide',{ownerRef,contextRef,pickerRef,files:[{path:'C:\\managed\\staged.txt',sha256:hash,bytes:12,name:'staged.txt'}]},{leaseRef})).error,'STALE_DOCUMENT','backendNode proof is one-shot');
  assert.ok(validateCompanionEvent(port.posts.find(x=>x.type==='event')?.event));

  const mismatchArm=await call('dialog.arm',{ownerRef,contextRef,documentToken,generation:2,triggerRequestKey:'confirm-write',mode:'manual',expectedType:'confirm',
    mismatchPolicy:'dismiss',expiryPolicy:'leaveOpen',releasePolicy:'detach',ttlMs:5000},{leaseRef});
  const mismatchWait=call('dialog.wait',{ownerRef,contextRef,dialogWatchRef:mismatchArm.data.dialogWatchRef,timeoutMs:3000},{leaseRef});
  fixture.api.debugger.onEvent.emit({tabId:21},'Page.javascriptDialogOpening',{type:'alert',message:'Unexpected prompt'});
  const mismatch=await mismatchWait;assert.equal(mismatch.data.state,'dismissed-by-policy');assert.equal(mismatch.data.dialogRef,null);
  assert.ok(fixture.commands.some(([method,params])=>method==='Page.handleJavaScriptDialog'&&params.accept===false));

  const dialogArm=await call('dialog.arm',{ownerRef,contextRef,documentToken,generation:2,triggerRequestKey:'confirm-write-2',mode:'manual',expectedType:'confirm',
    expectedMessage:'Continue?',mismatchPolicy:'leaveOpen',expiryPolicy:'leaveOpen',releasePolicy:'detach',ttlMs:5000},{leaseRef});
  const dialogWatchRef=dialogArm.data.dialogWatchRef,dialogWait=call('dialog.wait',{ownerRef,contextRef,dialogWatchRef,timeoutMs:3000},{leaseRef});
  assert.equal((await call('dialog.trigger',{ownerRef,contextRef,dialogWatchRef,triggerRequestKey:'confirm-write-2'},{leaseRef})).ok,true);
  fixture.api.debugger.onEvent.emit({tabId:21},'Page.javascriptDialogOpening',{type:'confirm',message:'Continue?'});
  const openedDialog=await dialogWait;assert.equal(openedDialog.data.state,'open-manual');assert.ok(openedDialog.data.dialogRef);
  const response=await call('dialog.respond',{ownerRef,contextRef,dialogRef:openedDialog.data.dialogRef,accept:true},{leaseRef});
  assert.equal(response.ok,true);assert.equal(response.data.dispatchState,'acknowledged');

  const candidates=await call('ax.candidates',{ownerRef,contextRef,documentToken,generation:2,limit:10},{leaseRef});
  assert.equal(candidates.ok,true);assert.deepEqual(candidates.data.matches.map(x=>x.name),['Continue','Email address','Password']);
  assert.equal(JSON.stringify(candidates.data).includes('PRIVATE_VALUE'),false);assert.equal(JSON.stringify(candidates.data).includes('PASSWORD_SECRET'),false);
  assert.ok(candidates.data.matches.every(x=>x.candidateId&&Number.isSafeInteger(x.backendNodeId)));
  const exactQuery=await call('ax.query',{ownerRef,contextRef,documentToken,generation:2,role:'button',accessibleName:'Continue',includeDisabled:false,limit:5},{leaseRef});
  assert.equal(exactQuery.ok,true);assert.ok(fixture.commands.some(([method,params])=>method==='Accessibility.queryAXTree'&&params.backendNodeId===2));

  const auditStart=await call('ax.audit.start',{ownerRef,contextRef,documentToken,generation:2,standard:'WCAG21AA',includeIncomplete:false,limit:5},{leaseRef});
  assert.equal(auditStart.ok,true);const auditRef=auditStart.data.auditRef;
  const auditCancel=await call('ax.audit.cancel',{ownerRef,contextRef,auditRef},{leaseRef});
  assert.equal(auditCancel.data.cleanupState,'computation-pending');
  const busyAudit=await call('ax.audit.start',{ownerRef,contextRef,documentToken,generation:2,standard:'WCAG21AA',includeIncomplete:false,limit:5},{leaseRef});
  assert.equal(busyAudit.error,'BACKEND_BUSY','cancellation alone must not clear a running axe scan lock');
  fixture.auditTickets.get(auditRef).computationSettled=true;
  const settled=await call('ax.audit.status',{ownerRef,contextRef,auditRef},{leaseRef});
  assert.deepEqual(settled.data,{auditRef,state:'cancelled',cleanupState:'settled'});
  const nextAudit=await call('ax.audit.start',{ownerRef,contextRef,documentToken,generation:2,standard:'WCAG21AA',includeIncomplete:false,limit:5},{leaseRef});
  assert.equal(nextAudit.ok,true);assert.notEqual(nextAudit.data.auditRef,auditRef);

  fixture.failControlKeyUps=2;
  const modifierFailure=await call('keys.dispatch',{ownerRef,keys:[{key:'ENTER',modifiers:['CTRL']},{key:'TAB'}]},{leaseRef});
  assert.equal(modifierFailure.error,'UNKNOWN_OUTCOME');
  assert.equal(fixture.commands.some(([method,params])=>method==='Input.dispatchKeyEvent'&&params.type==='rawKeyDown'&&params.key==='Tab'),false,
    'a later sequence cannot dispatch while a prior modifier remains uncertain');
  const cleanupLease=await call('debugger.release',{ownerRef,contextRef,reason:'release'},{leaseRef});
  assert.equal(cleanupLease.ok,true);assert.equal(cleanupLease.data.cleanupState,'unknown');

  const download=await call('download.start',{ownerRef,url:'https://shop.example.test/report.pdf'},{leaseRef:null});
  assert.equal(download.ok,true);assert.ok(download.data.downloadRef);
  fixture.api.tabs.onUpdated.emit(21,{status:'loading'});
  const downloadRead={protocol:1,requestId:`request-${++requestNumber}`,connectionEpoch:identity.connectionEpoch,profileSessionRef:identity.profileSessionRef,
    pairRef:null,operation:'download.get',leaseRef:null,tabRef:null,deadline:Date.now()+3000,payload:{ownerRef,downloadRef:download.data.downloadRef}};
  assert.equal(validateCompanionRequest(downloadRead),true);
  const downloadResult=await new Promise(resolve=>{const onReply=m=>{if(m.type==='reply'&&m.reply?.requestId===downloadRead.requestId){port.onPost.removeListener(onReply);resolve(m.reply);}};port.onPost.addListener(onReply);
    backend.handleHostMessage({type:'request',protocol:1,profileSessionRef:identity.profileSessionRef,companionEpoch:identity.companionEpoch,request:downloadRead});});
  assert.equal(downloadResult.ok,true);assert.equal(downloadResult.data.downloadRef,download.data.downloadRef);

  assert.ok(fixture.commands.some(([name])=>name==='detach'),'navigation releases the companion-owned debugger attachment');
  await backend.dispose();
});
