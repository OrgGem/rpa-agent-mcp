import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PNG} from 'pngjs';
import {harness} from './browser-harness.mjs';
import {validateToolOutput,ADVANCED_BROWSER_TOOL_NAMES} from '../src/browser-tools.mjs';
import {validateCompanionRequest} from '../src/companion-protocol.mjs';
import {createAccessibilityAuditTickets} from '../src/browser-accessibility.mjs';

const profile={profileSessionRef:'profile_test',companionEpoch:1,connectionEpoch:1,keys:true,dialogs:true,filePicker:true,downloads:true,axQuery:true,axAudit:true};
const axeResult={engine:'axe-core',engineVersion:'4.14.0',standard:'WCAG21AA',summary:{violations:0,incomplete:0,passes:1},violations:[],incomplete:[],truncated:false};

function fixtureBackends({failOperation}={}){
  const seen=[],requestIds=new Set();const companion={runtime:null,extensionId:'test-companion',
    readiness:()=>({available:true,browser_capabilities:[profile]}),
    beginPairing:async()=>({nonce:'test-nonce',expiresAt:Date.now()+10000}),waitForPairing:async()=>null,
    getBinding({ownerRef,contextRef,tabRef}){const tab=this.runtime?.tabs.get(tabRef);if(!tab)return null;return {ownerRef,contextRef,tabRef,
      pairRef:'pair_test',profileSessionRef:profile.profileSessionRef,companionEpoch:profile.companionEpoch,connectionEpoch:profile.connectionEpoch,
      hostEpoch:this.runtime.hostEpoch,documentToken:tab.docToken,generation:tab.generation};},
    async request(envelope){
      assert.equal(validateCompanionRequest(envelope),true,`invalid typed companion request: ${envelope.operation}`);seen.push(envelope);
      assert.equal(requestIds.has(envelope.requestId),false,`companion request ID reused for ${envelope.operation}`);requestIds.add(envelope.requestId);
      if(envelope.operation===failOperation)throw Object.assign(new Error('Simulated lost native response'),{code:'UNKNOWN_OUTCOME',dispatchState:'unknown'});
      const p=envelope.payload;
      switch(envelope.operation){
        case 'debugger.acquire':return {leaseRef:'lease_test',expiresAt:new Date(Date.now()+p.ttlMs).toISOString()};
        case 'keys.dispatch':return {dispatchState:'acknowledged',sentCount:p.keys.length,releasedKeys:p.keys.map(x=>x.key)};
        case 'dialog.arm':return {dialogWatchRef:'dialog_watch_test',expiresAt:new Date(Date.now()+p.ttlMs).toISOString()};
        case 'dialog.trigger':return {triggered:true};
        case 'dialog.wait':return {dialogRef:'dialog_test',type:'prompt',message:'Continue?',state:'open-manual',cleanupState:'retained'};
        case 'dialog.respond':return {state:'responded',dispatchState:'acknowledged',cleanupState:'released'};
        case 'dialog.cancel':return {state:'cancelled',dispatchState:'acknowledged',cleanupState:'released'};
        case 'file.arm':return {pickerWatchRef:'picker_watch_test',expiresAt:new Date(Date.now()+p.ttlMs).toISOString()};
        case 'file.trigger':return {triggered:true};
        case 'file.wait':return {pickerRef:'picker_test',mode:'selectSingle',state:'open'};
        case 'file.provide':return {selectedCount:p.files.length,stagedBytes:p.files.reduce((n,x)=>n+x.bytes,0),hashes:p.files.map(x=>x.sha256),selection:'assigned',verification:'browser-acknowledged',dispatchState:'acknowledged'};
        case 'file.release':return {cleanupState:'released'};
        case 'file.cancel':return {cleanupState:'released'};
        case 'download.start':return {downloadRef:'download_test',state:'in_progress',fileName:p.filename??'file.bin',bytesReceived:0,totalBytes:null,completedAt:null,completionEvidence:'downloads.onChanged',dispatchState:'acknowledged'};
        case 'download.get':return {state:'complete',fileName:'file.bin',bytesReceived:12,totalBytes:12,completedAt:new Date().toISOString(),completionEvidence:'downloads.search',dispatchState:'notSent'};
        case 'download.cancel':return {state:'cancelled',fileName:'file.bin',bytesReceived:0,totalBytes:12,completedAt:null,completionEvidence:'downloads.onChanged',dispatchState:'acknowledged'};
        case 'ax.query':return {matches:[{role:'button',name:'Continue',states:{disabled:false,checked:null,expanded:null,selected:null}}],truncated:false};
        case 'ax.candidates':return {matches:[{candidateId:'candidate_1',role:'button',name:'Continue'}],truncated:false};
        case 'ax.audit.start':return {auditRef:'audit_companion_test',state:'running'};
        case 'ax.audit.status':return {state:'complete',result:axeResult};
        case 'ax.audit.cancel':return {state:'cancelled',cleanupState:'result-dropped'};
        default:throw new Error(`unhandled typed operation ${envelope.operation}`);
      }
    },
    cleanupContext:async()=>({cleanupConfirmed:true,blockedTabRefs:[],cleanedPickerRefs:['picker_watch_test']}),
    cleanupClient:async()=>({cleanupConfirmed:true}),invalidateTab(){},
  };
  const windowsHelper={capabilities:async()=>({clipboardText:true,ocr:{available:true,languages:['en-US']}}),
    readClipboard:async()=>({text:'fixture clipboard'}),writeClipboard:async({text})=>({writtenChars:text.length,dispatchState:'acknowledged'}),
    ocr:async({language='en-US'})=>({engine:'Windows.Media.Ocr',language,width:1,height:1,coordinateSpace:'screenshot-px',lines:[{text:'TEST',rect:{x:0,y:0,width:1,height:1},words:[{text:'TEST',rect:{x:0,y:0,width:1,height:1}}]}],truncated:false})};
  const visualMatcher={readiness:async()=>({available:true}),find:async()=>({matches:[{rect:{x:0,y:0,width:1,height:1},score:0.99}],truncated:false})};
  const semanticClient={readiness:async()=>({available:true,model:'test-model'}),query:async()=>({candidateIds:['candidate_1'],abstained:false,provider:{name:'ollama',model:'test-model'},truncated:false})};
  const launchManager={readiness:async()=>({available:true}),start:async()=>({launchRef:'launch_test',state:'running_unpaired',processOwned:true,reason:'SEPARATE_BRIDGE_ATTACHMENT_REQUIRED',dispatchState:'acknowledged'}),
    status:async()=>({launchRef:'launch_test',state:'running_unpaired',processOwned:true,reason:'SEPARATE_BRIDGE_ATTACHMENT_REQUIRED'}),close:async()=>({launchRef:'launch_test',state:'closed',processOwned:false,dispatchState:'acknowledged'})};
  const auditTickets=createAccessibilityAuditTickets({runIsolated:input=>companion.runtime.advanced.runIsolatedAudit(input),executorReady:async()=>true});
  return {seen,companion,backends:{companion,windowsHelper,visualMatcher,semanticClient,launchManager,auditTickets,uploadRoots:[]}};
}

async function checked(h,name,args){
  const result=await h.call(name,args);assert.equal(result.ok,true,`${name} failed: ${JSON.stringify(result.error)}`);
  assert.equal(validateToolOutput(name,result),true,`${name} output failed strict schema: ${JSON.stringify(result)}`);return result;
}

test('all ten advanced handlers return strict output and use closed companion request envelopes',async t=>{
  const fixture=fixtureBackends(),h=await harness(t,{backends:fixture.backends});fixture.companion.runtime=h.runtime;
  assert.equal(ADVANCED_BROWSER_TOOL_NAMES.length,10);
  const rendered=new PNG({width:1,height:1});rendered.data[0]=255;rendered.data[1]=20;rendered.data[2]=10;rendered.data[3]=255;
  const pngBytes=PNG.sync.write(rendered);h.setHook(name=>name==='TakeScreenshot'?{retCode:1,data:pngBytes.toString('base64')}:undefined);
  const a=h.args,button=await h.find('button');

  await checked(h,'browser_press_keys',{...a,keys:[{key:'ENTER',modifiers:['CTRL']}],requestKey:'key_req'});

  const armedDialog=await checked(h,'browser_dialog',{action:'arm',contextRef:a.contextRef,tabRef:a.tabRef,triggerRequestKey:'dialog_key_trigger',requestKey:'dialog_arm',mode:'manual',expectedType:'prompt',mismatchPolicy:'leaveOpen',expiryPolicy:'leaveOpen',releasePolicy:'detach',ttlMs:5000});
  await checked(h,'browser_press_keys',{...a,keys:[{key:'ENTER',modifiers:[]}],requestKey:'dialog_key_trigger'});
  const dialogTrigger=fixture.seen.findIndex(x=>x.operation==='dialog.trigger'&&x.payload.triggerRequestKey==='dialog_key_trigger');
  const dialogKey=fixture.seen.findIndex((x,index)=>index>dialogTrigger&&x.operation==='keys.dispatch'&&x.payload.ownerRef===h.runtime.clients.values().next().value.id);
  assert.ok(dialogTrigger>=0&&dialogKey>dialogTrigger,'keyboard trigger must be recorded before the matching key dispatch');
  const waitedDialog=await checked(h,'browser_dialog',{action:'wait',dialogWatchRef:armedDialog.data.dialogWatchRef});
  await checked(h,'browser_dialog',{action:'respond',dialogRef:waitedDialog.data.dialogRef,accept:true,promptText:'yes',requestKey:'dialog_respond'});

  const fileRoot=h.root,filePath=path.join(fileRoot,'upload-fixture.txt');await writeFile(filePath,'upload fixture');fixture.backends.uploadRoots.push(fileRoot);await h.runtime.refreshReadiness({force:true});
  const armedPicker=await checked(h,'browser_file_picker',{action:'arm',contextRef:a.contextRef,tabRef:a.tabRef,triggerRequestKey:'picker_click',requestKey:'picker_arm',releasePolicy:'cancel',ttlMs:30000,timeoutMs:1000});
  const pickerLeaseRequest=fixture.seen.filter(x=>x.operation==='debugger.acquire').at(-1);
  assert.equal(pickerLeaseRequest.payload.ttlMs,30000,'the helper lease must cover the armed picker TTL, not the shorter MCP operation timeout');
  await checked(h,'browser_click',{contextRef:a.contextRef,elementRef:button,requestKey:'picker_click'});
  const waitedPicker=await checked(h,'browser_file_picker',{action:'wait',pickerWatchRef:armedPicker.data.pickerWatchRef});
  await checked(h,'browser_file_picker',{action:'provide',pickerRef:waitedPicker.data.pickerRef,paths:[filePath],requestKey:'picker_provide'});
  await checked(h,'browser_file_picker',{action:'release',pickerRef:waitedPicker.data.pickerRef,requestKey:'picker_release'});

  const startedDownload=await checked(h,'browser_download',{action:'start',...a,url:'https://fixture.test/file.bin',requestKey:'download_start'});
  const navigated=await checked(h,'browser_navigate',{...a,url:'https://fixture.test/after-download'});a.tabRef=navigated.data.tabRef;
  await checked(h,'browser_download',{action:'get',contextRef:a.contextRef,downloadRef:startedDownload.data.downloadRef});

  const localActivationCount=h.activations;
  await checked(h,'browser_launch',{action:'start',profileAlias:'fixture_profile',requestKey:'launch_start'});
  await checked(h,'system_clipboard',{action:'write',text:'fixture write',requestKey:'clipboard_write'});
  const readClipboard=await checked(h,'system_clipboard',{action:'read',maxChars:100});assert.equal(readClipboard.data.text,'fixture clipboard');
  assert.equal(h.activations,localActivationCount,'launch and clipboard must bypass UiPath activation');

  const shot1=await checked(h,'browser_screenshot',{...a,format:'png'}),shot2=await checked(h,'browser_screenshot',{...a,format:'png'});
  const analysisActivationCount=h.activations;
  await checked(h,'browser_visual_find',{contextRef:a.contextRef,targetScreenshotRef:shot1.data.artifactRef,templateScreenshotRef:shot2.data.artifactRef,
    templateRegion:{x:0,y:0,width:1,height:1},threshold:0.9,maxMatches:10});
  await checked(h,'browser_ocr',{contextRef:a.contextRef,screenshotRef:shot1.data.artifactRef,maxLines:10});
  assert.equal(h.activations,analysisActivationCount,'visual matching and OCR must bypass UiPath activation');

  await checked(h,'browser_semantic_query',{mode:'ax',...a,role:'button',accessibleName:'Continue',limit:10,includeDisabled:false});
  await checked(h,'browser_semantic_query',{mode:'natural-language',...a,query:'the Continue button',limit:5});
  const audit=await checked(h,'browser_accessibility_audit',{action:'start',...a,standard:'WCAG21AA',includeIncomplete:false,limit:10,requestKey:'audit_start'});
  let auditResult;
  for(let i=0;i<10;i++){await delay(40);auditResult=await checked(h,'browser_accessibility_audit',{action:'poll',auditRef:audit.data.auditRef});if(auditResult.data.state!=='running')break;}
  assert.equal(auditResult.data.state,'complete');assert.equal(auditResult.data.result.engine,'axe-core');

  assert.ok(fixture.seen.length>=10);
  assert.ok(fixture.seen.every(validateCompanionRequest));
  assert.ok(fixture.seen.some(x=>x.operation==='dialog.trigger'));
  assert.ok(fixture.seen.some(x=>x.operation==='file.trigger'));
  assert.ok(fixture.seen.some(x=>x.operation==='download.get'&&x.pairRef===null&&x.tabRef===null));
  await h.must('browser_attach',{action:'release',contextRef:a.contextRef});
});

test('unknown file assignment keeps staged copies and marks the picker outcome unknown',async t=>{
  const fixture=fixtureBackends({failOperation:'file.provide'}),h=await harness(t,{backends:fixture.backends});fixture.companion.runtime=h.runtime;
  const filePath=path.join(h.root,'uncertain-upload.txt');await writeFile(filePath,'retain while outcome is unknown');
  fixture.backends.uploadRoots.push(h.root);await h.runtime.refreshReadiness({force:true});
  const button=await h.find('button'),a=h.args;
  const armed=await checked(h,'browser_file_picker',{action:'arm',...a,triggerRequestKey:'unknown_picker_trigger',requestKey:'unknown_picker_arm',releasePolicy:'detach',ttlMs:10000});
  await checked(h,'browser_click',{contextRef:a.contextRef,elementRef:button,requestKey:'unknown_picker_trigger'});
  const opened=await checked(h,'browser_file_picker',{action:'wait',pickerWatchRef:armed.data.pickerWatchRef});
  const result=await h.call('browser_file_picker',{action:'provide',pickerRef:opened.data.pickerRef,paths:[filePath],requestKey:'unknown_picker_provide'});
  assert.equal(result.ok,false);assert.equal(result.error.code,'ACTION_OUTCOME_UNKNOWN',JSON.stringify(result.error));
  const record=h.runtime.advanced.state.pickers.get(armed.data.pickerWatchRef);
  assert.equal(record.state,'unknown');assert.equal(record.files.length,1);
  assert.equal(h.runtime.advanced.state.staged.size,1);
  assert.equal(await readFile(record.files[0].path,'utf8'),'retain while outcome is unknown');
});
