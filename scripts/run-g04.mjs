import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {ipcCall,DRIVER_VERSION} from '../src/bridge.mjs';
import {G0_TEXT,G0_APPEND,isG0PreflightReady} from '../src/g0-probe.mjs';
import {startG04Fixture} from './g04-fixture.mjs';

const args=process.argv.slice(2);if(args.length>1||args.some(a=>a!=='--live'))throw Error('Usage: node scripts/run-g04.mjs [--live]');
const live=args.includes('--live');
const receipt={checkedAt:new Date().toISOString(),driverVersion:DRIVER_VERSION,mode:live?'live':'preflight',
  passed:false,publicG0GateEnabled:false,scope:'Owned two-origin fixture, native reference lifetime and React controlled inputs only',
  steps:[],cleanup:{serversStopped:true,tabLeftOpen:false,tabCloseAcknowledged:false,tabClosureVerified:false,
    privateProbeDisabledInProcess:false,launcherDisableVerified:false,
    postRunRequirement:'Independently verify fixture tab absence; run plain Setup Install; verify launcher opt-in cleared and preflight disabled.'}};
let fixture,sessionRef,tabId,initialHost,openAttempted=false;
const probe=p=>ipcCall('g0_probe',40000,p);
const check=(x,code)=>{if(!x)throw Object.assign(Error(code),{safeCode:code});};
const safeError=e=>e.safeCode??(/^(PROBE_[A-Z_]+|G0_PROBE_DISABLED|ACTION_OUTCOME_UNKNOWN)$/.test(e.message)?e.message:'G04_EXECUTION_FAILED');
const identityValid=s=>s?.connected===true&&Number.isSafeInteger(s.nativePid)&&s.nativePid>0&&typeof s.startedAt==='string'&&Number.isFinite(Date.parse(s.startedAt));
async function waitState(role,predicate){
  const end=Date.now()+8000;
  while(Date.now()<end){const s=fixture.snapshot(role);if(s&&predicate(s))return s;await delay(80);}
  check(false,'FIXTURE_OBSERVATION_TIMEOUT');
}
async function command(action,predicate){const id=fixture.command(action);return waitState('main',s=>s.ack>=id&&(!predicate||predicate(s)));}
async function step(name,fn){
  try{const evidence=await fn();receipt.steps.push({name,passed:true,...evidence});console.log(JSON.stringify({step:name,passed:true}));}
  catch(e){receipt.steps.push({name,passed:false,error:safeError(e)});throw e;}
}
const find=async target=>{
  const found=await probe({action:'find',sessionRef,target});check(found.count===1&&found.refs.length===1&&found.observations?.length===1,'FIND_ONE_REQUIRED');
  return {ref:found.refs[0],...found.observations[0]};
};
const read=ref=>probe({action:'read',sessionRef,elementRef:ref});
const type=(ref,mode='replace')=>probe({action:'type',sessionRef,elementRef:ref,mode});
async function stale(ref,code='PROBE_STALE_ELEMENT'){
  for(const action of ['read','type']){
    let got=null;try{await probe({action,sessionRef,elementRef:ref,...(action==='type'?{mode:'replace'}:{})});}catch(e){got=e.message;}
    check(got===code,'STALE_REJECTION_FAILED');
  }
}
async function parentNavigation(action){
  const before=Object.fromEntries(['main','same','cross'].map(role=>[role,fixture.snapshot(role).generation]));
  fixture.command(action);
  for(const role of ['main','same','cross'])await waitState(role,s=>s.generation!==before[role]&&s.documentReady);
}
try{
  const pf=await probe({action:'preflight'});check(isG0PreflightReady(pf)&&pf.protocolVersion===2,'HOST_G04_PROBE_NOT_READY');
  receipt.preflightPassed=true;
  if(live){
    const extensionRoot=process.env.UIPATH_EXTENSION_DIR||path.join(process.env.LOCALAPPDATA??'','Google/Chrome/User Data/Default/Extensions/jfcmnbofjlffnejneillkgbniiidiigd/23.10.1_0');
    const audit=JSON.parse(await readFile(new URL('../docs/pinned-driver-audit.json',import.meta.url),'utf8'));
    const hash=createHash('sha256').update(await readFile(path.join(extensionRoot,'EmbeddedDriversContainer.js'))).digest('hex');
    check(hash===audit.sourceSha256&&audit.driverVersion===DRIVER_VERSION,'PINNED_SOURCE_MISMATCH');
    receipt.sourceSha256=hash;
    receipt.probeSourceSha256=createHash('sha256').update(await readFile(new URL('../src/g0-probe.mjs',import.meta.url))).digest('hex');
    receipt.runnerSourceSha256=createHash('sha256').update(await readFile(new URL('./run-g04.mjs',import.meta.url))).digest('hex');
    initialHost=await ipcCall('status');check(identityValid(initialHost),'HOST_IDENTITY_INVALID');
    fixture=await startG04Fixture();receipt.fixtureBundleSha256=fixture.bundleSha256;receipt.cleanup.serversStopped=false;
    openAttempted=true;const opened=await probe({action:'open_advanced',fixtureUrl:fixture.url});
    check(opened.sessionRef===fixture.nonce&&Number.isSafeInteger(opened.tabId)&&opened.tabId>=0,'OPEN_RESPONSE_INVALID');
    sessionRef=opened.sessionRef;tabId=opened.tabId;receipt.cleanup.tabLeftOpen=true;
    for(const role of ['main','same','cross'])await waitState(role,s=>s.nodePresent&&s.documentReady);
    receipt.reactVersion=fixture.snapshot('main').frameworkVersion;
    let mainRef;
    await step('remove-ref-read-and-write-stale',async()=>{
      const old=await find('native');await read(old.ref);
      await command('remove',s=>!s.nodePresent);await stale(old.ref);
      const empty=await probe({action:'find',sessionRef,target:'native'});check(empty.count===0,'REMOVED_NODE_FOUND');
      return {readRejected:true,writeRejected:true,matchCount:0};
    });
    await step('cloned-node-ref-stays-stale',async()=>{
      await command('replace',s=>s.nodePresent);const old=await find('native');
      await command('replace',s=>s.nodePresent);await stale(old.ref);
      mainRef=await find('native');await read(mainRef.ref);return {refReplacementRequired:true};
    });
    await step('same-url-reload-ref-stale',async()=>{
      const old=mainRef;await parentNavigation('reload-parent');await stale(old.ref);
      mainRef=await find('native');await read(mainRef.ref);return {sameUrl:true,refReplacementRequired:true,backendHandleReused:old.handleDigest===mainRef.handleDigest};
    });
    await step('owned-navigation-ref-stale',async()=>{
      const old=mainRef;await parentNavigation('navigate-next');await stale(old.ref);
      mainRef=await find('native');await read(mainRef.ref);return {refReplacementRequired:true,backendHandleReused:old.handleDigest===mainRef.handleDigest};
    });
    const frames={};
    for(const [target,role] of [['same-frame-input','same'],['cross-frame-input','cross']]){
      await step(`${role}-origin-frame-read-write`,async()=>{
        const ref=await find(target);check(ref.frameId>0,'FRAME_OWNERSHIP_INVALID');await read(ref.ref);await type(ref.ref);
        check((await read(ref.ref)).value===G0_TEXT,'FRAME_VALUE_MISMATCH');
        const observed=await waitState(role,s=>s.nativeValue===G0_TEXT&&s.inputEvents>0);frames[role]=ref;
        return {nonzeroFrame:true,readbackMatched:true,inputEvents:observed.inputEvents};
      });
    }
    for(const [role,target,sibling] of [['same','same-frame-input','cross'],['cross','cross-frame-input','same']]){
      await step(`${role}-frame-reload-stale-and-sibling-valid`,async()=>{
        const old=frames[role],oldGeneration=fixture.snapshot(role).generation;
        await command(`reload-${role}`);await waitState(role,s=>s.generation!==oldGeneration&&s.documentReady);
        await stale(old.ref);frames[role]=await find(target);await read(frames[role].ref);
        await read(frames[sibling].ref);await read(mainRef.ref);
        return {oldReadWriteRejected:true,siblingValid:true,mainValid:true,backendHandleReused:old.handleDigest===frames[role].handleDigest};
      });
    }
    await step('react-controlled-replace-append-persists-rerender',async()=>{
      const control=await find('controlled');const initial=fixture.snapshot('main').reactChanges;
      for(const [mode,expected] of [['replace',G0_TEXT],['append',G0_TEXT+G0_APPEND]]){
        await type(control.ref,mode);check((await read(control.ref)).value===expected,'CONTROLLED_DOM_MISMATCH');
        await waitState('main',s=>s.controlledDom===expected&&s.controlledModel===expected&&s.reactChanges>initial);
        await command('rerender',s=>s.controlledDom===expected&&s.controlledModel===expected);
        check((await read(control.ref)).value===expected,'CONTROLLED_RERENDER_MISMATCH');
      }
      return {domAndModelMatched:true,persistedRerender:true,reactChanges:fixture.snapshot('main').reactChanges};
    });
    await step('react-rejection-detected-no-retry',async()=>{
      const reject=await find('rejecting'),before=fixture.snapshot('main').rejectChanges;
      await type(reject.ref);
      await waitState('main',s=>s.rejectChanges>before&&s.rejectingDom==='reject-initial'&&s.rejectingModel==='reject-initial');
      check((await read(reject.ref)).value==='reject-initial','REJECTION_NOT_OBSERVED');
      return {outcome:'postcondition-mismatch-detected',writeCalls:1,retries:0};
    });
    await step('real-native-reconnect-old-session-stale',async()=>{
      const old=await ipcCall('status');check(identityValid(old),'HOST_IDENTITY_INVALID');
      const oldRef=await find('native');
      console.log(JSON.stringify({event:'G04_RECONNECT_REQUIRED',instruction:'Refresh UiPath Web Automation background page once; keep fixture open.'}));
      const deadline=Date.now()+300000;let changed=false;
      while(Date.now()<deadline){
        try{const current=await ipcCall('status',800),ready=await probe({action:'preflight'});
          if(identityValid(current)&&current.nativePid!==old.nativePid&&current.startedAt!==old.startedAt&&isG0PreflightReady(ready)&&ready.protocolVersion===2){changed=true;break;}
        }catch{}
        await delay(1200);
      }
      check(changed,'REAL_RECONNECT_TIMEOUT');await stale(oldRef.ref,'PROBE_STALE_SESSION');
      return {nativePidAndStartedAtChanged:true,oldReadWriteRejected:true};
    });
    receipt.passed=true;
  }
}catch(e){receipt.error={code:safeError(e)};
  try{const p=await probe({action:'preflight'});if(p.lastFailure)receipt.error.diagnostic=p.lastFailure;}catch{}
  process.exitCode=1;}
finally{
  if(fixture&&sessionRef){
    try{
      const current=await ipcCall('status',1500);
      const restarted=identityValid(current)&&current.startedAt!==initialHost.startedAt;
      const closed=await probe(restarted?{action:'close_orphan',fixtureUrl:fixture.url,tabId}:{action:'close',sessionRef});
      receipt.cleanup.tabCloseAcknowledged=closed?.closed===true&&closed?.tabLeftOpen===false;
      // Native acknowledgement is not independent proof that the tab disappeared.
      receipt.cleanup.tabLeftOpen=receipt.cleanup.tabCloseAcknowledged?null:true;
    }catch{receipt.cleanup.tabLeftOpen=true;}
  }else if(openAttempted)receipt.cleanup.tabLeftOpen=true;
  if(!openAttempted){receipt.cleanup.tabClosureVerified=true;receipt.cleanup.tabLeftOpen=false;}
  if(live){try{const finished=await probe({action:'finish'});receipt.cleanup.privateProbeDisabledInProcess=finished.enabled===false;
    receipt.cleanup.abandonedSession=finished.abandonedSession===true;}catch{receipt.cleanup.privateProbeDisabledInProcess=false;}}
  if(fixture){await fixture.close();receipt.cleanup.serversStopped=true;}
  receipt.cleanup.resourceCleanupAcknowledged=receipt.cleanup.serversStopped&&(!openAttempted||receipt.cleanup.tabCloseAcknowledged)
    &&(!live||receipt.cleanup.privateProbeDisabledInProcess)&&!receipt.cleanup.abandonedSession;
  receipt.cleanup.passed=receipt.cleanup.resourceCleanupAcknowledged&&receipt.cleanup.tabClosureVerified&&receipt.cleanup.tabLeftOpen===false;
  if(!receipt.cleanup.passed)process.exitCode=receipt.passed&&receipt.cleanup.resourceCleanupAcknowledged?2:1;
  await mkdir('work',{recursive:true});const output=live?'work/g04-live.json':'work/g04-preflight.json';
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output,passed:receipt.passed,steps:receipt.steps.length,error:receipt.error??null,cleanup:receipt.cleanup}));
}
