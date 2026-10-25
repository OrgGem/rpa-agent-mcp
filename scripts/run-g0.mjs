import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ipcCall, DRIVER_VERSION } from '../src/bridge.mjs';
import { G0_TEXT, G0_APPEND, isG0PreflightReady } from '../src/g0-probe.mjs';
import { startG0Fixture } from './g0-fixture.mjs';

const args=process.argv.slice(2);
if(args.some(a=>a!=='--live')||args.length>1)throw Error('Usage: node scripts/run-g0.mjs [--live]');
const live=args.includes('--live');
const receipt={checkedAt:new Date().toISOString(),mode:live?'live':'preflight',driverVersion:DRIVER_VERSION,
  evidenceLevel:live?'live-fixture-attempt':'preflight-only',smokePassed:false,g0GatePassed:false,
  unsupportedScopes:['iframe/shadow DOM','stale after navigation/disconnect','controlled inputs','change/blur parity'],steps:[],cleanup:{serverStopped:true,tabLeftOpen:false}};
let fixture,sessionRef,openAttempted=false,reason='PROBE_PREFLIGHT_FAILED';
const probe=params=>ipcCall('g0_probe',40000,params);
const check=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{safeCode:code});};
async function waitReport(predicate){
  const deadline=Date.now()+4000;
  while(Date.now()<deadline){const s=fixture.snapshot();if(s&&predicate(s))return s;await delay(50);}
  check(false,'FIXTURE_READBACK_TIMEOUT');
}
try{
  let preflight;
  try{preflight=await ipcCall('g0_probe',1500,{action:'preflight'});}catch{check(false,'HOST_PROBE_UNAVAILABLE');}
  check(isG0PreflightReady(preflight),'HOST_PROBE_DISABLED_OR_INCOMPATIBLE');
  receipt.preflight={enabled:true,protocolVersion:preflight.protocolVersion,scope:preflight.scope};
  receipt.preflightPassed=true;
  if(live){
    const extensionRoot=process.env.UIPATH_EXTENSION_DIR||(process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Google/Chrome/User Data/Default/Extensions/jfcmnbofjlffnejneillkgbniiidiigd/23.10.1_0'));
    check(Boolean(extensionRoot),'EXTENSION_PATH_UNAVAILABLE');
    let hash;try{hash=createHash('sha256').update(await readFile(path.join(extensionRoot,'EmbeddedDriversContainer.js'))).digest('hex');}catch{check(false,'EXTENSION_SOURCE_UNAVAILABLE');}
    const audit=JSON.parse(await readFile(new URL('../docs/pinned-driver-audit.json',import.meta.url),'utf8'));
    check(hash===audit.sourceSha256&&audit.driverVersion===DRIVER_VERSION,'SOURCE_HASH_MISMATCH');receipt.sourceSha256=hash;
    fixture=await startG0Fixture();receipt.cleanup.serverStopped=false;
    openAttempted=true;
    const opened=await probe({action:'open',fixtureUrl:fixture.url});sessionRef=opened.sessionRef;
    receipt.tabId=opened.tabId;receipt.cleanup.tabLeftOpen=true;
    await waitReport(s=>s.value==='initial'&&s.inputEvents===0&&s.changeEvents===0&&s.clicks===0);
    const refs={};
    for(const [target,count] of [['missing',0],['input',1],['duplicates',2],['button',1]]){
      const found=await probe({action:'find',sessionRef,target});check(found.count===count,'FIND_COUNT_MISMATCH');refs[target]=found.refs;
      receipt.steps.push({step:'find-'+target,count:found.count,passed:true});
    }
    const inputRef=refs.input[0];
    check((await probe({action:'read',sessionRef,elementRef:inputRef})).value==='initial','INITIAL_VALUE_MISMATCH');
    for(const [mode,value,eventMin] of [['replace',G0_TEXT,1],['append',G0_TEXT+G0_APPEND,2]]){
      await probe({action:'type',sessionRef,elementRef:inputRef,mode});
      check((await probe({action:'read',sessionRef,elementRef:inputRef})).value===value,'VALUE_READBACK_MISMATCH');
      const snapshot=await waitReport(s=>s.value===value&&s.inputEvents>=eventMin);
      receipt.steps.push({step:mode,passed:true,inputEvents:snapshot.inputEvents,changeEvents:snapshot.changeEvents});
    }
    await probe({action:'click',sessionRef,elementRef:refs.button[0]});
    const clicked=await waitReport(s=>s.clicks===1);receipt.steps.push({step:'click',passed:true,clicks:clicked.clicks});
    receipt.smokePassed=true;
  }
  receipt.preflightPassed=true;
}catch(error){
  reason=error.safeCode??(/^[A-Z_]+$/.test(error.message)&&['ACTION_OUTCOME_UNKNOWN','PROBE_BUSY','PROBE_STALE_ELEMENT','PROBE_UNSUPPORTED_RESPONSE','PROBE_DISCOVERY_UNCONFIRMED','PROBE_BACKEND_REJECTED','PROBE_SCOPE_CHANGED','PROBE_QUARANTINED','PROBE_BACKEND_FAILURE'].includes(error.message)?error.message:'PROBE_EXECUTION_FAILED');
  receipt.error={code:reason};process.exitCode=1;
  try{
    const state=await ipcCall('g0_probe',1500,{action:'preflight'});
    if(state.lastFailure?.stage==='find'&&['input','missing','duplicates','button'].includes(state.lastFailure.target)
      &&['RESULT_SHAPE_OR_ALLOCATION','CUSTOM_ID_SCOPE_OR_FORMAT','DUPLICATE_CUSTOM_ID'].includes(state.lastFailure.reason))receipt.diagnostic={stage:'find',target:state.lastFailure.target,reason:state.lastFailure.reason};
  }catch{}
  if(openAttempted&&!sessionRef){receipt.cleanup.tabLeftOpen=true;receipt.cleanup.orphanTabIdUnknown=true;}
}finally{
  if(sessionRef){try{
    const closed=await probe({action:'close',sessionRef});
    const confirmed=closed?.closed===true&&closed?.tabLeftOpen===false;
    receipt.cleanup.tab={closed:confirmed,tabLeftOpen:!confirmed};
    if(!confirmed)receipt.cleanup.tab.reason='CLEANUP_UNCONFIRMED';
    receipt.cleanup.tabLeftOpen=!confirmed;
  }catch{receipt.cleanup.tabLeftOpen=true;receipt.cleanup.tab={reason:'CLEANUP_UNCONFIRMED'};}}
  if(fixture){await fixture.close();receipt.cleanup.serverStopped=true;}
  if(receipt.cleanup.tabLeftOpen){receipt.cleanup.passed=false;process.exitCode=1;}else receipt.cleanup.passed=true;
  await mkdir('work',{recursive:true});
  const output=`work/g0-${live?'live':'preflight'}.json`;
  await writeFile(output,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({output,preflightPassed:receipt.preflightPassed??false,smokePassed:receipt.smokePassed,g0GatePassed:false,error:receipt.error??null,cleanup:receipt.cleanup}));
}
