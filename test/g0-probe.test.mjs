import test from 'node:test';
import assert from 'node:assert/strict';
import { createG0Probe, makeFindRequest, parseFixtureUrl, isG0PreflightReady, decodeMainFrameCustomId, G0_TEXT, G0_APPEND } from '../src/g0-probe.mjs';
const nonce='11111111-2222-3333-4444-555555555555';
const url=`http://127.0.0.1:12345/g0/${nonce}/page`;
function setup(){
  const calls=[],state={value:'initial',valid:true,scope:true,now:0,writeTimeout:false,findTimeout:false,malformed:false,clicks:0,activeTab:'8'};
  const request=async(name,p)=>{
    calls.push({name,p});
    if(name==='GetActiveTabId')return {retCode:1,tabId:state.activeTab};
    if(name==='OpenTab')return {retCode:1,newTabId:42};
    if(name==='GetHtmlAttribute')return {retCode:1,attrValue:p.customId?(p.customId==='0|104'?'g0-button':'g0-input'):(p.attrName==='url'?(state.scope?url:'https://elsewhere.test/'):`G0 fixture ${nonce}`)};
    if(name==='FindSelectors'){
      if(state.findTimeout)throw Error('backend error with secret');
      const a=p.partialRequests[0].m_tagInfosList[0].m_attributesMap;
      const ids=a.id==='g0-missing'?[]:a.name?['102','103']:a.tag==='BUTTON'?['104']:['101'];
      return state.malformed?{retCode:1,results:[]}:{retCode:1,isDocumentReady:true,endedWithId:p.startWithId+ids.length,results:[{m_resultsCollection:{m_results:ids.map(id=>({m_customId:`42|0|${id}`}))}}]};
    }
    if(name==='IsHtmlElemValid')return {retCode:state.valid?1:0};
    if(name==='GenericRequest'&&p.messageId===5)return {retCode:1,value:state.value};
    if(name==='WriteTextHtmlElem'){
      if(state.writeTimeout)throw Error('secret raw backend error');
      state.value=p.inputOptions===4?state.value+p.tokens[0].text:p.tokens[0].text;return {retCode:1};
    }
    if(name==='GenericRequest'&&p.messageId===6){state.clicks++;return {retCode:1};}
    if(name==='CloseBrowser')return {retCode:1};
    throw Error('unexpected packet');
  };
  return {probe:createG0Probe({enabled:true,request,activate:async()=>{},now:()=>state.now}),calls,state};
}
const open=probe=>probe.call({action:'open',fixtureUrl:url});
const find=(probe,target)=>probe.call({action:'find',sessionRef:nonce,target});
test('Private G0 probe is opt-in and rejects arbitrary commands, URLs and inputs before dispatch',async()=>{
  let sent=0;const disabled=createG0Probe({request:()=>{sent++;}});
  assert.equal((await disabled.call({action:'preflight'})).enabled,false);
  await assert.rejects(disabled.call({action:'open',fixtureUrl:url}),/G0_PROBE_DISABLED/);
  const {probe,calls}=setup();
  for(const p of [null,[],{action:['read'],sessionRef:nonce,elementRef:'button'},{action:'raw'},{action:'find',sessionRef:nonce,target:'css'},{action:'preflight',functionCall:'InjectAndRunJs'},
    {action:'type',sessionRef:nonce,elementRef:'bad',mode:'replace',text:'arbitrary'}])await assert.rejects(probe.call(p),/PROBE_INVALID_ARGUMENT/);
  for(const value of ['https://example.com/',url+'#x',url+'?x',url.replace('127.0.0.1','localhost'),url.replace('http:','https:'),url.replace('127.0.0.1','user@127.0.0.1')])assert.throws(()=>parseFixtureUrl(value),/PROBE_INVALID_ARGUMENT/);
  assert.equal(calls.length,0);assert.equal(sent,0);
});
test('G0 fixture-only adapter finds 0/1/2 and performs one-token read/write/click without exposing raw IDs',async()=>{
  const {probe,calls,state}=setup();await open(probe);
  assert.equal((await find(probe,'missing')).count,0);
  assert.equal((await find(probe,'duplicates')).count,2);
  const input=(await find(probe,'input')).refs[0];
  const button=(await find(probe,'button')).refs[0];
  assert.notEqual(input,'input');
  assert.equal(decodeMainFrameCustomId('42|0|101',42),'0|101');
  for(const id of ['input','0|input','43|0|input','42|1|input','42|0|','42|0|bad|extra'])assert.throws(()=>decodeMainFrameCustomId(id,42),/PROBE_UNSUPPORTED_RESPONSE/);
  const packet=calls.find(c=>c.name==='FindSelectors').p;
  assert.deepEqual(packet,makeFindRequest(42,'missing',1));
  assert.equal((await probe.call({action:'read',sessionRef:nonce,elementRef:input})).value,'initial');
  await assert.rejects(probe.call({action:'click',sessionRef:nonce,elementRef:input}),/PROBE_WRONG_TARGET/);
  for(const mode of ['replace','append'])await probe.call({action:'type',sessionRef:nonce,elementRef:input,mode});
  assert.equal(state.value,G0_TEXT+G0_APPEND);
  assert.deepEqual(calls.filter(c=>c.name==='WriteTextHtmlElem').map(c=>c.p.tokens),[[{text:G0_TEXT}],[{text:G0_APPEND}]]);
  assert.deepEqual(calls.filter(c=>c.name==='WriteTextHtmlElem').map(c=>c.p.inputOptions),[0,4]);
  await probe.call({action:'click',sessionRef:nonce,elementRef:button});assert.equal(state.clicks,1);
  for(const call of calls.filter(c=>c.p.customId))assert.match(call.p.customId,/^0\|(?:101|102|103|104)$/,'Every native DOM call must use the normalized frame/local form');
  assert.equal(calls.find(c=>c.name==='IsHtmlElemValid').p.customId,'0|101');
  assert.equal(calls.find(c=>c.name==='WriteTextHtmlElem').p.customId,'0|101');
  assert.equal((await probe.call({action:'close',sessionRef:nonce})).tabLeftOpen,false);
  await probe.call({action:'close',sessionRef:nonce});
  assert.equal(calls.filter(c=>c.name==='CloseBrowser').length,1);
});
test('Wrong session, removed node, expiry and malformed search responses fail closed',async()=>{
  const {probe,state}=setup();await open(probe);const input=(await find(probe,'input')).refs[0];
  await assert.rejects(probe.call({action:'read',sessionRef:'wrong',elementRef:input}),/PROBE_STALE_SESSION/);
  state.valid=false;await assert.rejects(probe.call({action:'read',sessionRef:nonce,elementRef:input}),/PROBE_STALE_ELEMENT/);
  state.now=300001;await assert.rejects(find(probe,'input'),/PROBE_STALE_SESSION/);
  assert.equal((await probe.call({action:'close',sessionRef:nonce})).closed,true,'Expired session retains cleanup handle');
});
test('Unconfirmed discovery is quarantined and cannot reuse custom-ID allocation on retry',async()=>{
  for(const kind of ['malformed','findTimeout']){
    const {probe,state,calls}=setup();await open(probe);state[kind]=true;
    await assert.rejects(find(probe,'input'),/PROBE_UNSUPPORTED_RESPONSE|PROBE_DISCOVERY_UNCONFIRMED/);
    await assert.rejects(find(probe,'input'),/PROBE_QUARANTINED/);
    assert.equal(calls.filter(c=>c.name==='FindSelectors').length,1);
    assert.equal((await probe.call({action:'close',sessionRef:nonce})).tabLeftOpen,true);
  }
});
test('Malformed preflight and oversized active tab IDs fail closed',async()=>{
  const good={enabled:true,protocolVersion:1,quarantined:false,scope:'main-frame-fixture-only'};
  assert.equal(isG0PreflightReady(good),true);
  for(const value of [undefined,null,0,'',true])assert.equal(isG0PreflightReady({...good,quarantined:value}),false);
  const {probe,state,calls}=setup();state.activeTab='9'.repeat(400);await open(probe);
  assert.equal(calls.find(c=>c.name==='OpenTab').p.tabId,-1);
});
test('A timed-out write is never retried, quarantines writes and leaves tab cleanup explicit',async()=>{
  const {probe,state,calls}=setup();await open(probe);const input=(await find(probe,'input')).refs[0];
  state.writeTimeout=true;
  await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:input,mode:'append'}),/^Error: ACTION_OUTCOME_UNKNOWN$/);
  await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:input,mode:'append'}),/PROBE_QUARANTINED/);
  assert.equal(calls.filter(c=>c.name==='WriteTextHtmlElem').length,1);
  const cleanup=await probe.call({action:'close',sessionRef:nonce});assert.equal(cleanup.tabLeftOpen,true);
  assert.equal(calls.filter(c=>c.name==='CloseBrowser').length,0);
  await assert.rejects(open(probe),/PROBE_QUARANTINED/);
});
test('Changed fixture scope is never closed and overlapping IPC calls are rejected',async()=>{
  const {probe,state,calls}=setup();await open(probe);state.scope=false;
  assert.equal((await probe.call({action:'close',sessionRef:nonce})).tabLeftOpen,true);
  assert.equal(calls.filter(c=>c.name==='CloseBrowser').length,0);
  let release;const blocked=createG0Probe({enabled:true,activate:()=>new Promise(r=>release=r),request:async()=>({retCode:1,newTabId:1})});
  const active=open(blocked);await assert.rejects(blocked.call({action:'preflight'}),/PROBE_BUSY/);release();await active;
});
test('A restarted host cannot claim an unknown fixture tab was cleaned up',async()=>{
  const {probe,calls}=setup();
  const unknown=await probe.call({action:'close',sessionRef:nonce});
  assert.equal(unknown.closed,false);assert.equal(unknown.tabLeftOpen,true);
  assert.equal(calls.length,0);
  await open(probe);await probe.call({action:'close',sessionRef:nonce});
  assert.equal((await probe.call({action:'close',sessionRef:nonce})).closed,true,'Only remembered confirmed cleanup is idempotent');
  assert.equal(calls.filter(c=>c.name==='CloseBrowser').length,1);
});
