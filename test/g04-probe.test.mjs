import test from 'node:test';
import assert from 'node:assert/strict';
import {createG0Probe,decodeScopedCustomId,makeFindRequest,isG0PreflightReady} from '../src/g0-probe.mjs';
const nonce='11111111-2222-3333-4444-555555555555',doc1='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',doc2='12345678-abcd-abcd-abcd-123456789abc';
const url=`http://127.0.0.1:12345/g04/${nonce}/page`;
function fixture(){
  const calls=[],state={url,document:doc1,node:doc1,frameDocument:doc2,present:true,value:'initial'};
  const create=()=>createG0Probe({enabled:true,activate:async()=>{},request:async(name,p)=>{
    calls.push({name,p});
    if(name==='GetActiveTabId')return {retCode:1,tabId:'1'};
    if(name==='OpenTab')return {retCode:1,newTabId:42};
    if(name==='FindSelectors'){
      const infos=p.partialRequests[0].m_tagInfosList,child=infos.length===2;
      return {retCode:1,isDocumentReady:true,endedWithId:p.startWithId+1,results:[{m_searchError:state.selectorError,m_resultsCollection:{m_results:state.present?[{m_customId:`42|${child?9:0}|1`}]:[]}}]};
    }
    if(name==='IsHtmlElemValid')return {retCode:state.present?1:0};
    if(name==='GetHtmlAttribute'){
      if(!p.customId)return {retCode:1,attrValue:p.attrName==='url'?state.url:`G04 fixture ${nonce} document ${state.document}`};
      const values={'data-g04-document':`${nonce}:${p.customId.startsWith('9|')?state.frameDocument:state.document}`,'data-g04-node':`${nonce}:${state.node}`,id:p.customId.startsWith('9|')?'g04-same-input':'g04-native'};
      const response={retCode:1,attrValue:values[p.attrName]};state.afterReply?.(name,p);return response;
    }
    if(name==='GenericRequest'){const response={retCode:1,value:state.value};state.afterReply?.(name,p);return response;}
    if(name==='WriteTextHtmlElem'){state.afterReply?.(name,p);return {retCode:1};}
    if(name==='CloseBrowser')return {retCode:1};
    throw Error('Unexpected packet');
  }});
  return {calls,state,create,probe:create()};
}
const open=probe=>probe.call({action:'open_advanced',fixtureUrl:url});
const find=(probe,target='native')=>probe.call({action:'find',sessionRef:nonce,target});
test('Advanced frame find uses iframe selector path and binds only owned safe frame IDs',()=>{
  const p=makeFindRequest(42,'same-frame-input');
  assert.deepEqual(p.partialRequests[0].m_tagInfosList.map(i=>i.m_attributesMap),[{tag:'IFRAME',id:'same-frame'},{tag:'INPUT',id:'g04-same-input'}]);
  assert.deepEqual(decodeScopedCustomId('42|9|1',42,'child'),{customId:'9|1',frameId:9});
  for(const id of ['43|9|1','42|0|1','42|-1|1','42|9999999999|1','42|9|1|extra'])assert.throws(()=>decodeScopedCustomId(id,42,'child'));
});

test('Selector error is rejected even if a result collection is populated',async()=>{
  for(const [present,error] of [[true,{reason:'fixture-error'}],[true,{m_id:0}],[false,{m_id:2}],[false,{m_id:0,extra:true}]]){
    const {probe,state,calls}=fixture();await open(probe);state.present=present;state.selectorError=error;
    await assert.rejects(find(probe),/PROBE_UNSUPPORTED_RESPONSE/);
    const p=await probe.call({action:'preflight'});assert.equal(p.quarantined,true);
    assert.equal(p.lastFailure.reason,'SELECTOR_ERROR');assert.equal(p.lastFailure.selectorErrorPresent,true);
    assert.equal(calls.filter(c=>c.name==='WriteTextHtmlElem').length,0);
  }
});

test('Pinned ElementNotFoundError translates only a valid empty collection to zero matches',async()=>{
  const {probe,state}=fixture();await open(probe);state.present=false;state.selectorError={m_id:0};
  const result=await find(probe);assert.equal(result.count,0);assert.deepEqual(result.refs,[]);
  assert.equal((await probe.call({action:'preflight'})).quarantined,false);
});
test('Advanced remove, replacement and same-URL document reuse reject old refs before writes',async()=>{
  for(const mutation of [s=>s.present=false,s=>s.node=doc2,s=>s.document=doc2,s=>{s.document=doc2;s.url=url.replace('/page','/next');}]){
    const {probe,state,calls}=fixture();await open(probe);const ref=(await find(probe)).refs[0];
    mutation(state);
    await assert.rejects(probe.call({action:'read',sessionRef:nonce,elementRef:ref}),/PROBE_STALE_ELEMENT/);
    await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:ref,mode:'replace'}),/PROBE_STALE_ELEMENT/);
    assert.equal(calls.filter(c=>c.name==='WriteTextHtmlElem').length,0);
  }
});
test('Child document token changes reject only the old frame ref; parent ref stays valid',async()=>{
  const {probe,state,calls}=fixture();await open(probe);
  const parent=(await find(probe)).refs[0],child=(await find(probe,'same-frame-input')).refs[0];
  state.frameDocument='fedcba98-abcd-abcd-abcd-123456789abc';
  await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:child,mode:'replace'}),/PROBE_STALE_ELEMENT/);
  assert.equal((await probe.call({action:'read',sessionRef:nonce,elementRef:parent})).id,'g04-native');
  const next=(await find(probe,'same-frame-input')).refs[0];
  await probe.call({action:'type',sessionRef:nonce,elementRef:next,mode:'replace'});
  assert.equal(calls.find(c=>c.name==='WriteTextHtmlElem').p.customId,'9|1');
});

test('Interleaved replacement after value read rejects the raced result',async()=>{
  const {probe,state}=fixture();await open(probe);const ref=(await find(probe)).refs[0];
  state.afterReply=name=>{if(name==='GenericRequest')state.node=doc2;};
  await assert.rejects(probe.call({action:'read',sessionRef:nonce,elementRef:ref}),/PROBE_STALE_ELEMENT/);
});

test('Interleaved replacement during ID check is rejected at the final pre-write guard',async()=>{
  const {probe,state,calls}=fixture();await open(probe);const ref=(await find(probe)).refs[0];
  state.afterReply=(name,p)=>{if(name==='GetHtmlAttribute'&&p.attrName==='id')state.node=doc2;};
  await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:ref,mode:'replace'}),/PROBE_STALE_ELEMENT/);
  assert.equal(calls.filter(c=>c.name==='WriteTextHtmlElem').length,0);
});

test('Post-write identity change is uncertain and quarantined with no retry',async()=>{
  const {probe,state,calls}=fixture();await open(probe);const ref=(await find(probe)).refs[0];
  state.afterReply=name=>{if(name==='WriteTextHtmlElem')state.node=doc2;};
  await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:ref,mode:'replace'}),/ACTION_OUTCOME_UNKNOWN/);
  await assert.rejects(probe.call({action:'type',sessionRef:nonce,elementRef:ref,mode:'replace'}),/PROBE_QUARANTINED/);
  assert.equal(calls.filter(c=>c.name==='WriteTextHtmlElem').length,1);
  assert.equal((await probe.call({action:'preflight'})).quarantined,true);
});
test('New host loses session; cleanup-only adoption is scoped and finish disables without reenable',async()=>{
  const {probe,create,state,calls}=fixture();await open(probe);const old=(await find(probe)).refs[0];
  const fresh=create(),before=calls.length;
  assert.equal(isG0PreflightReady(await fresh.call({action:'preflight'})),true);
  await assert.rejects(fresh.call({action:'read',sessionRef:nonce,elementRef:old}),/PROBE_STALE_SESSION/);
  assert.equal(calls.length,before,'Unknown session must not dispatch');
  assert.equal((await fresh.call({action:'close_orphan',fixtureUrl:url,tabId:42})).closed,true);
  await fresh.call({action:'close_orphan',fixtureUrl:url,tabId:42});assert.equal(calls.filter(c=>c.name==='CloseBrowser').length,1);
  assert.deepEqual(await fresh.call({action:'finish'}),{enabled:false,abandonedSession:false});
  assert.equal(fresh.isEnabled(),false);assert.equal(isG0PreflightReady(await fresh.call({action:'preflight'})),false);
  await assert.rejects(open(fresh),/G0_PROBE_DISABLED/);
  const other=create();state.url='https://unowned.test/';
  await assert.rejects(other.call({action:'close_orphan',fixtureUrl:url,tabId:42}),/PROBE_SCOPE_CHANGED/);
  assert.equal(calls.filter(c=>c.name==='CloseBrowser').length,1);
});
