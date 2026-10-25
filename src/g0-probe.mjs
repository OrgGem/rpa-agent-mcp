import { randomUUID, createHash } from 'node:crypto';

export const G0_TEXT = 'G0 Việt 😀';
export const G0_APPEND = ' + append';
export const G0_PROTOCOL_VERSION = 2;
const success = v => v === true || v === 1;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const targets = { input:{tag:'INPUT',id:'g0-input'}, missing:{tag:'INPUT',id:'g0-missing'},
  duplicates:{tag:'INPUT',name:'g0-duplicate'}, button:{tag:'BUTTON',id:'g0-button'},
  native:{tag:'INPUT',id:'g04-native'},controlled:{tag:'INPUT',id:'g04-controlled'},rejecting:{tag:'INPUT',id:'g04-rejecting'},
  'same-frame-input':{tag:'INPUT',id:'g04-same-input'},'cross-frame-input':{tag:'INPUT',id:'g04-cross-input'} };
const advancedTargets=['native','controlled','rejecting','same-frame-input','cross-frame-input'];
const fields = { preflight:[], open:['fixtureUrl'], find:['sessionRef','target'], read:['sessionRef','elementRef'],
  type:['sessionRef','elementRef','mode'], click:['sessionRef','elementRef'], close:['sessionRef'],
  open_advanced:['fixtureUrl'],close_orphan:['fixtureUrl','tabId'],finish:[] };
const fail = code => { throw Object.assign(new Error(code), { code }); };
export const isG0PreflightReady = p => p!==null&&typeof p==='object'&&!Array.isArray(p)
  &&p.enabled===true&&p.quarantined===false&&((p.protocolVersion===1&&p.scope==='main-frame-fixture-only')
    ||(p.protocolVersion===2&&p.scope==='owned-fixture-only'));
export function decodeScopedCustomId(value,tabId,frameClass='main'){
  if(typeof value!=='string'||value.length>180)fail('PROBE_UNSUPPORTED_RESPONSE');
  const parts=value.split('|'),frameId=Number(parts[1]);
  if(parts.length!==3||parts[0]!==String(tabId)||! /^\d{1,10}$/.test(parts[1])||!Number.isSafeInteger(frameId)
    ||frameId<0||frameId>2147483647||String(frameId)!==parts[1]||! /^[A-Za-z0-9._:-]{1,128}$/.test(parts[2])
    ||(frameClass==='main'&&frameId!==0)||(frameClass==='child'&&frameId===0))fail('PROBE_UNSUPPORTED_RESPONSE');
  return {customId:`${frameId}|${parts[2]}`,frameId};
}
export function decodeMainFrameCustomId(value,tabId){
  return decodeScopedCustomId(value,tabId).customId;
}
function parseLoopbackFixture(value,segment) {
  if(typeof value!=='string')fail('PROBE_INVALID_ARGUMENT');
  let url;try{url=new URL(value);}catch{fail('PROBE_INVALID_ARGUMENT');}
  const match=url.pathname.match(new RegExp(`^/${segment}/(${uuid})/page$`));
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||!match)fail('PROBE_INVALID_ARGUMENT');
  return {url:url.href,nonce:match[1]};
}
export const parseFixtureUrl=value=>parseLoopbackFixture(value,'g0');
export const parseAdvancedFixtureUrl=value=>parseLoopbackFixture(value,'g04');
export function makeFindRequest(tabId,target,startWithId=1){
  if(!Object.hasOwn(targets,target))fail('PROBE_INVALID_ARGUMENT');
  const selectorPath=target.endsWith('-frame-input')?[{tag:'IFRAME',id:target==='same-frame-input'?'same-frame':'cross-frame'},targets[target]]:[targets[target]];
  return {tabId,parentCustomId:'',partialRequests:[{m_tagInfosList:selectorPath.map(attributes=>({m_attributesMap:{...attributes},m_isGreedySearch:false,m_hasFuzzyAttributes:false})),
    m_searchOption:{m_maxResults:10,m_searchType:1,m_scope:1,m_minSelectorScore:0,m_requestedLocation:false,m_requestedAncestors:false,m_requestedAncestorsForError:false,m_searchInvisibleChildren:false},
    m_parentScore:{max:0,min:Number.MAX_VALUE,average:0,sum:0,count:0},m_futureAttributeCount:0}],
    startWithId,timeoutMs:2000,windowLeft:0,windowTop:0,pageRenderOfsX:0,pageRenderOfsY:0};
}

// Development-only adapter. No public locator, raw native request, arbitrary JS or user text.
export function createG0Probe({enabled=false,request,activate,now=Date.now}){
  let active=enabled===true;
  let session=null,busy=false,quarantined=false,lastClosedNonce=null,lastClosedTabId=null,lastFailure=null;
  const callNative=(name,params)=>request(name,params,3000);
  const assertResponse = response => { if(!response||!success(response.retCode))fail('PROBE_BACKEND_REJECTED');return response; };
  const scope = async s => {
    try {
      if(s.advanced){
        const url=assertResponse(await callNative('GetHtmlAttribute',{tabId:s.tabId,customId:'',attrName:'url'})).attrValue;
        const title=assertResponse(await callNative('GetHtmlAttribute',{tabId:s.tabId,customId:'',attrName:'title'})).attrValue;
        const match=typeof title==='string'&&title.match(new RegExp(`^G04 fixture ${s.nonce} document (${uuid})$`));
        if(![s.url,s.url.replace(/\/page$/,'/next')].includes(url)||!match)fail('PROBE_SCOPE_CHANGED');
        if(s.documentToken&&(s.documentToken!==match[1]||s.currentUrl!==url)){s.refs.clear();s.generation++;}
        s.documentToken=match[1];s.currentUrl=url;return;
      }
      for(const [attrName,expected] of [['url',s.url],['title',`G0 fixture ${s.nonce}`]]){
        const r=assertResponse(await callNative('GetHtmlAttribute',{tabId:s.tabId,customId:'',attrName}));
        if(r.attrValue!==expected)fail('PROBE_SCOPE_CHANGED');
      }
    }catch {s.refs.clear();s.invalid=true;fail('PROBE_SCOPE_CHANGED');}
  };
  const existing = (id,allowExpired=false)=>{
    if(!session||id!==session.nonce)fail('PROBE_STALE_SESSION');
    if(!allowExpired&&(session.invalid||now()-session.createdAt>300000))fail('PROBE_STALE_SESSION');
    return session;
  };
  const validRef=async(s,ref)=>{
    const entry=s.refs.get(ref);if(!entry)fail('PROBE_STALE_ELEMENT');
    const r=await callNative('IsHtmlElemValid',{tabId:s.tabId,customId:entry.customId,checkVirtualId:false,bringIntoViewVirtualId:false});
    if(!r||![true,1,false,0].includes(r.retCode))fail('PROBE_BACKEND_FAILURE');
    if(!success(r.retCode)){s.refs.delete(ref);fail('PROBE_STALE_ELEMENT');}
    if(s.advanced){
      const current=await markers(s,entry.customId);
      if(entry.generation!==s.generation||current.document!==entry.document||current.node!==entry.node){s.refs.delete(ref);fail('PROBE_STALE_ELEMENT');}
    }
    return entry;
  };
  const markers=async(s,customId)=>{
    const out={};
    for(const [key,attrName] of [['document','data-g04-document'],['node','data-g04-node']]){
      const r=await callNative('GetHtmlAttribute',{tabId:s.tabId,customId,attrName});
      if(!r||!success(r.retCode))fail('PROBE_STALE_ELEMENT');
      if(typeof r.attrValue!=='string'||!new RegExp(`^${s.nonce}:${uuid}$`).test(r.attrValue))fail('PROBE_STALE_ELEMENT');
      out[key]=r.attrValue;
    }
    return out;
  };
  const write=async(name,params)=>{
    if(quarantined)fail('PROBE_QUARANTINED');
    let r;try{r=await callNative(name,params);}catch{quarantined=true;fail('ACTION_OUTCOME_UNKNOWN');}
    if(r?.retCode===false||r?.retCode===0)fail('PROBE_BACKEND_REJECTED');
    if(!r||!success(r.retCode)){quarantined=true;fail('ACTION_OUTCOME_UNKNOWN');}
    return {acknowledged:true};
  };
  async function handle(p){
    if(p.action==='preflight')return {enabled:active,protocolVersion:G0_PROTOCOL_VERSION,scope:'owned-fixture-only',quarantined,...(lastFailure?{lastFailure}:{})};
    if(p.action==='finish'){
      const abandonedSession=Boolean(session);session?.refs.clear();session=null;active=false;
      return {enabled:false,abandonedSession};
    }
    if(!active)fail('G0_PROBE_DISABLED');
    if(p.action==='close_orphan'){
      if(quarantined)fail('PROBE_QUARANTINED');if(session)fail('PROBE_SESSION_EXISTS');
      const {url,nonce}=parseAdvancedFixtureUrl(p.fixtureUrl);
      if(lastClosedNonce===nonce&&lastClosedTabId===p.tabId)return {closed:true,tabLeftOpen:false};
      await activate();
      await scope({url,nonce,tabId:p.tabId,advanced:true,refs:new Map(),generation:0});
      await write('CloseBrowser',{tabId:p.tabId});lastClosedNonce=nonce;lastClosedTabId=p.tabId;
      return {closed:true,tabLeftOpen:false};
    }
    if(p.action==='open'||p.action==='open_advanced'){
      if(quarantined)fail('PROBE_QUARANTINED');
      if(session)fail('PROBE_SESSION_EXISTS');
      const advanced=p.action==='open_advanced';
      const {url,nonce}=advanced?parseAdvancedFixtureUrl(p.fixtureUrl):parseFixtureUrl(p.fixtureUrl);
      lastClosedNonce=null;lastClosedTabId=null;
      await activate();
      const active=await callNative('GetActiveTabId',{windowId:-1});
      const activeId=Number(active?.tabId);
      const base=success(active?.retCode)&&/^\d+$/.test(String(active.tabId))&&Number.isSafeInteger(activeId)&&activeId>=0?activeId:-1;
      let opened;try{opened=await callNative('OpenTab',{tabId:base,url});}catch{quarantined=true;fail('ACTION_OUTCOME_UNKNOWN');}
      if(opened?.retCode===0||opened?.retCode===false)fail('PROBE_BACKEND_REJECTED');
      if(!success(opened?.retCode)||!Number.isSafeInteger(opened.newTabId)||opened.newTabId<0){quarantined=true;fail('ACTION_OUTCOME_UNKNOWN');}
      session={url,nonce,tabId:opened.newTabId,createdAt:now(),refs:new Map(),startWithId:1,invalid:false,advanced,generation:0,documentToken:null};
      return {sessionRef:nonce,tabId:session.tabId};
    }
    if(p.action==='close'){
      if(!session)return p.sessionRef===lastClosedNonce?{tabLeftOpen:false,closed:true}:{tabLeftOpen:true,closed:false,reason:'PROBE_UNKNOWN_SESSION'};
      const s=existing(p.sessionRef,true);
      try{
        if(quarantined)return {tabLeftOpen:true,closed:false,reason:'ACTION_OUTCOME_UNKNOWN'};
        await scope(s);
        await write('CloseBrowser',{tabId:s.tabId});
        lastClosedNonce=s.nonce;
        lastClosedTabId=s.tabId;
        return {tabLeftOpen:false,closed:true};
      }catch {quarantined=true;return {tabLeftOpen:true,closed:false,reason:'PROBE_CLEANUP_UNCONFIRMED'};}
      finally {s.refs.clear();session=null;}
    }
    const s=existing(p.sessionRef);
    if(p.action==='find'&&advancedTargets.includes(p.target)!==s.advanced)fail('PROBE_INVALID_ARGUMENT');
    if(quarantined&&['find','type','click'].includes(p.action))fail('PROBE_QUARANTINED');
    await scope(s);
    if(p.action==='find'){
      const packet=makeFindRequest(s.tabId,p.target,s.startWithId);
      let r;
      try {r=assertResponse(await callNative('FindSelectors',packet));}
      catch {quarantined=true;s.refs.clear();fail('PROBE_DISCOVERY_UNCONFIRMED');}
      const selectorError=r.results?.[0]?.m_searchError;
      const notFound=selectorError!==null&&typeof selectorError==='object'&&!Array.isArray(selectorError)
        &&Object.keys(selectorError).length===1&&selectorError.m_id===0;
      const unsupported = reason => {lastFailure={stage:'find',target:p.target,reason,
        documentReady:success(r.isDocumentReady),resultCount:Array.isArray(r.results)?r.results.length:null,
        selectorErrorPresent:r.results?.[0]?.m_searchError!=null,
        selectorErrorKind:selectorError==null?'none':notFound?'element-not-found':'other',
        matchCount:Array.isArray(r.results?.[0]?.m_resultsCollection?.m_results)?r.results[0].m_resultsCollection.m_results.length:null,
        endedWithId:Number.isSafeInteger(r.endedWithId)?r.endedWithId:null,startWithId:s.startWithId};
        quarantined=true;s.refs.clear();fail('PROBE_UNSUPPORTED_RESPONSE');};
      const matches=r.results?.[0]?.m_resultsCollection?.m_results;
      if(!success(r.isDocumentReady)||!Array.isArray(r.results)||r.results.length!==1||!Array.isArray(matches)||matches.length>10
        ||!Number.isSafeInteger(r.endedWithId)||r.endedWithId<s.startWithId||r.endedWithId>=Number.MAX_SAFE_INTEGER)unsupported('RESULT_SHAPE_OR_ALLOCATION');
      // Pinned ElementNotFoundError is exactly {m_id:0}; only an empty, otherwise
      // valid response may translate it to zero matches. Unknown/conflicting errors fail closed.
      if(selectorError!=null&&!(notFound&&matches.length===0))unsupported('SELECTOR_ERROR');
      if(s.advanced&&matches.length>1)unsupported('TARGET_AMBIGUOUS');
      let decoded;
      try{decoded=matches.map(m=>decodeScopedCustomId(m?.m_customId,s.tabId,p.target.endsWith('-frame-input')?'child':'main'));}catch{unsupported('CUSTOM_ID_SCOPE_OR_FORMAT');}
      if(new Set(decoded.map(d=>d.customId)).size!==decoded.length)unsupported('DUPLICATE_CUSTOM_ID');
      s.startWithId=r.endedWithId+1;
      for(const [ref,v] of s.refs)if(v.target===p.target)s.refs.delete(ref);
      const refs=[];
      for(const d of decoded){
        const ref=randomUUID();
        let identity={};
        if(s.advanced){
          identity=await markers(s,d.customId);
          if((d.frameId===0&&identity.document!==`${s.nonce}:${s.documentToken}`)
            ||(d.frameId>0&&identity.document===`${s.nonce}:${s.documentToken}`))unsupported('TARGET_DOCUMENT_MISMATCH');
          const id=assertResponse(await callNative('GetHtmlAttribute',{tabId:s.tabId,customId:d.customId,attrName:'id'}));
          if(id.attrValue!==targets[p.target].id)unsupported('TARGET_ID_MISMATCH');
        }
        s.refs.set(ref,{...d,...identity,target:p.target,generation:s.generation});refs.push(ref);
      }
      return {refs,count:refs.length,...(s.advanced?{observations:refs.map(ref=>{const e=s.refs.get(ref);return {frameId:e.frameId,documentGeneration:e.generation,handleDigest:createHash('sha256').update(e.customId).digest('hex')};})}:{})};
    }
    const entry=await validRef(s,p.elementRef);
    const base={tabId:s.tabId,customId:entry.customId};
    if(p.action==='read'){
      const attr=assertResponse(await callNative('GetHtmlAttribute',{...base,attrName:'id'}));
      const value=assertResponse(await callNative('GenericRequest',{...base,messageId:5,getFullText:false}));
      if(typeof attr.attrValue!=='string'||attr.attrValue.length>128||typeof value.value!=='string'||value.value.length>128)fail('PROBE_UNSUPPORTED_RESPONSE');
      if(s.advanced)await validRef(s,p.elementRef);
      return {id:attr.attrValue,value:value.value};
    }
    if(p.action==='type'?(s.advanced?!advancedTargets.includes(entry.target):entry.target!=='input'):entry.target!=='button')fail('PROBE_WRONG_TARGET');
    const attr=assertResponse(await callNative('GetHtmlAttribute',{...base,attrName:'id'}));
    if(attr.attrValue!==(p.action==='type'?targets[entry.target].id:'g0-button'))fail('PROBE_WRONG_TARGET');
    if(p.action==='type'){
      // Separate native RPCs cannot make identity and dispatch atomic. Check again
      // at the boundary and reject uncertain post-write identity without retrying.
      if(s.advanced)await validRef(s,p.elementRef);
      const result=await write('WriteTextHtmlElem',{...base,inputOptions:p.mode==='append'?4:0,tokens:[{text:p.mode==='append'?G0_APPEND:G0_TEXT}]});
      if(s.advanced){
        try{await validRef(s,p.elementRef);}catch{
          quarantined=true;lastFailure={stage:'type',reason:'POST_WRITE_IDENTITY_UNCONFIRMED'};
          fail('ACTION_OUTCOME_UNKNOWN');
        }
      }
      return result;
    }
    return write('GenericRequest',{...base,messageId:6,flags:0,doClickInPageWorld:false,x:0,y:0,windowLeft:0,windowTop:0,pageRenderOfsX:0,pageRenderOfsY:0});
  }
  return {isEnabled:()=>active,async call(params){
    if(!params||typeof params!=='object'||Array.isArray(params)||typeof params.action!=='string'||!Object.hasOwn(fields,params.action))fail('PROBE_INVALID_ARGUMENT');
    const allowed=['action',...fields[params.action]];
    if(Object.keys(params).some(k=>!allowed.includes(k))||fields[params.action].some(k=>typeof params[k]!==(k==='tabId'?'number':'string'))
      ||(params.action==='close_orphan'&&(!Number.isSafeInteger(params.tabId)||params.tabId<0))
      ||(params.action==='find'&&!Object.hasOwn(targets,params.target))
      ||(params.action==='type'&&!['replace','append'].includes(params.mode)))fail('PROBE_INVALID_ARGUMENT');
    if(busy)fail('PROBE_BUSY');busy=true;
    try{return await handle(params);}catch(error){
      if(['PROBE_INVALID_ARGUMENT','G0_PROBE_DISABLED','PROBE_STALE_SESSION','PROBE_STALE_ELEMENT','PROBE_SCOPE_CHANGED','PROBE_BACKEND_REJECTED','PROBE_UNSUPPORTED_RESPONSE','PROBE_DISCOVERY_UNCONFIRMED','PROBE_WRONG_TARGET','PROBE_BUSY','PROBE_QUARANTINED','PROBE_SESSION_EXISTS','ACTION_OUTCOME_UNKNOWN'].includes(error.code))throw error;
      fail('PROBE_BACKEND_FAILURE');
    }finally{busy=false;}
  }};
}
