import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {BrowserError,BROWSER_TOOLS,UNAVAILABLE_TOOLS,validateToolInput,validateToolOutput,opaque,fingerprint,assertJsonBound,publicFailure} from './browser-tools.mjs';
import {PAGE_FUNCTION} from './browser-page.mjs';
import {createArtifactStore} from './browser-artifacts.mjs';
import {createBrowserHandlers,findPacket,parseFind,decodeId} from './browser-operations.mjs';

const good=v=>v===1||v===true;
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const numberId=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&/^\d+$/.test(String(value))?Number(value):null;
// Snapshot when this module loads, so editing disk files cannot masquerade as a
// newly loaded native process in a live receipt. These are relative code paths.
const sourceFiles=['src/bridge.mjs','src/transport.mjs','src/capabilities.mjs','src/browser-runtime.mjs','src/browser-operations.mjs','src/browser-page.mjs','src/browser-observers.mjs','src/browser-composites.mjs','src/browser-artifacts.mjs','src/browser-tools.mjs','docs/browser-tool-contracts.json','package-lock.json'];
const loadedSourceHashes=Object.freeze(Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')])));
export class BrowserRuntime{
  constructor({request,activate,root,driverVersion,now=Date.now}){
    this.request=request;this.activate=activate;this.root=root;this.driverVersion=driverVersion;this.now=now;
    this.connectionRef=opaque('con');this.namespace=opaque('rpa');this.clients=new Map();this.releasedClients=new Set();this.contexts=new Map();
    this.tabs=new Map();this.frames=new Map();this.elements=new Map();this.watches=new Map();this.network=new Map();this.temporaryBlocks=new Map();
    this.unknownTabs=new Map();this.knownTabs=new Map();this.allocations=new Map();this.generations=new Map();this.tabQueues=new Map();this.windowQueue=Promise.resolve();this.pending=0;this.identityInitialized=false;this.cleanupUnconfirmed=0;
    this.artifacts=createArtifactStore(path.join(root,'work','browser-artifacts'),{now});this.handlers=createBrowserHandlers(this);
    this.sweeper=setInterval(()=>this.sweep().catch(()=>{}),15000);this.sweeper.unref();
  }
  descriptor(){return {protocolVersion:1,runtimeVersion:'0.3.0',sourceHashes:{...loadedSourceHashes},connectionRef:this.connectionRef,identityInitialized:this.identityInitialized,
    tools:Object.keys(this.handlers),unavailable:UNAVAILABLE_TOOLS,temporarilyUnavailable:Object.fromEntries(this.temporaryBlocks),limits:{contextsPerClient:16,elementRefsPerContext:2048,maxTimeoutMs:30000,maxResultBytes:245760,
      tabLifetime:'unexpected-document-change-expires-tab-ref',inputDefault:'dom',nativeInputAtomic:false,profileIdentity:'extension-connection-only'},cleanupUnconfirmed:this.cleanupUnconfirmed};}
  client(id){
    if(typeof id!=='string'||!uuid.test(id))throw new BrowserError('INVALID_ARGUMENT','Invalid internal client identity');
    if(this.releasedClients.has(id))throw new BrowserError('STALE_CONTEXT','Client identity was released');
    if(!this.clients.has(id)&&this.releasedClients.size>=8192)throw new BrowserError('LIMIT_EXCEEDED','Connection client history is full; reconnect the native host');
    let c=this.clients.get(id);if(c?.releasing)throw new BrowserError('STALE_CONTEXT','Client is closing');if(!c){if(this.clients.size>=64)throw new BrowserError('LIMIT_EXCEEDED','Client limit exceeded');c={id,contexts:new Set(),keys:new Map(),jobs:new Map()};this.clients.set(id,c);}c.usedAt=this.now();return c;
  }
  context(client,ref){
    const c=this.contexts.get(ref);
    if(!c||!c.alive||c.clientRef!==client.id||this.now()-c.usedAt>1800000)throw new BrowserError('STALE_CONTEXT','Context is expired or belongs to another client');
    c.usedAt=this.now();return c;
  }
  lookup(map,ref,op,kind){
    const r=map.get(ref);
    if(!r||r.retired)throw new BrowserError(`STALE_${kind}`,`${kind.toLowerCase()} ref is stale`);
    if(r.clientRef!==op.client.id||r.contextRef!==op.ctx?.ref)throw new BrowserError('REF_SCOPE_MISMATCH',`${kind.toLowerCase()} ref is outside the context`);
    return r;
  }
  budget(op){
    if(op.client.releasing||this.clients.get(op.client.id)!==op.client)throw new BrowserError('STALE_CONTEXT','Client was released');
    if(op.ctx&&!op.ctx.alive)throw new BrowserError('STALE_CONTEXT','Context was released');
    const remaining=op.deadline-this.now();if(remaining<=0)throw new BrowserError('TIMEOUT','Operation deadline expired',{dispatchState:op.dispatchState,retryableRead:op.dispatchState==='notSent'});
    return remaining;
  }
  async sleep(op,ms){await delay(Math.min(this.budget(op),ms));this.budget(op);}
  async activation(op){
    let timer;try{await Promise.race([this.activate(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new BrowserError('TIMEOUT','Driver activation exceeded the deadline')),this.budget(op));})]);}
    finally{clearTimeout(timer);}this.budget(op);
  }
  async native(name,params,op,{write=false,allowFailure=false}={}){
    const timeout=Math.min(7000,this.budget(op));if(write)op.dispatchState='sent';
    let result;
    try{result=await this.request(name,params,timeout);}catch(error){
      const reported=error?.code==='NATIVE_REPORTED_ERROR';
      throw new BrowserError(write?'ACTION_OUTCOME_UNKNOWN':reported?'BACKEND_FAILURE':'TIMEOUT',write?'Native action acknowledgement was lost':reported?'Extension reported a request failure':'Native read did not complete',
        {dispatchState:write?'unknown':op.dispatchState,retryableRead:!write&&op.dispatchState==='notSent',details:{route:name,...(typeof error?.code==='string'?{nativeCode:error.code.slice(0,64)}:{})}});
    }
    if(write)op.dispatchState='acknowledged';
    if(!result||typeof result!=='object')throw new BrowserError(write?'ACTION_OUTCOME_UNKNOWN':'BACKEND_FAILURE','Malformed extension response',{dispatchState:write?'unknown':op.dispatchState});
    if(!allowFailure&&!good(result.retCode))throw new BrowserError(write?'ACTION_OUTCOME_UNKNOWN':'BACKEND_FAILURE','Extension rejected the operation',{dispatchState:write?'unknown':op.dispatchState,details:{route:name}});
    return result;
  }
  async page(op,tab,frame,operation,payload={},mutates=false){
    const prior=op.dispatchState;
    const request={namespace:this.namespace,owner:op.ctx?.ref??op.client.id,op:operation,expectedDocument:frame?.docToken??null,...payload};
    const response=await this.native('InjectAndRunJs',{tabId:tab.nativeId,customId:`${frame?.nativeId??0}|`,executionWorld:0,jsCode:PAGE_FUNCTION,input:JSON.stringify(request)},op,{write:mutates});
    if(good(response.isScriptErr))throw new BrowserError(mutates?'ACTION_OUTCOME_UNKNOWN':'SCRIPT_ERROR','Extension isolated script failed',{dispatchState:mutates?'unknown':prior});
    let result;try{result=JSON.parse(response.result);}catch{throw new BrowserError(mutates?'ACTION_OUTCOME_UNKNOWN':'BACKEND_FAILURE','Invalid isolated result',{dispatchState:mutates?'unknown':prior});}
    if(!result?.ok){
      const state=result?.mutated?'unknown':prior;op.dispatchState=state;
      throw new BrowserError(result?.mutated?'ACTION_OUTCOME_UNKNOWN':result?.error?.code??'PAGE_OPERATION_FAILED',result?.error?.message??'Page operation failed',
        {dispatchState:state,details:result?.mutated?{cause:result.error?.code??'PAGE_OPERATION_FAILED'}:{}});
    }
    if(mutates)op.dispatchState='acknowledged';
    if(typeof result.documentToken!=='string'||!uuid.test(result.documentToken))throw new BrowserError('BACKEND_FAILURE','Invalid document identity',{dispatchState:op.dispatchState});
    this.identityInitialized=true;return result;
  }
  async doc(op,tab,frame=null){
    const result=await this.page(op,tab,frame,'document'),key=`${tab.nativeId}|${frame?.nativeId??0}`,old=this.generations.get(key);
    const generation=old?old.generation+Number(old.token!==result.documentToken):0;this.generations.set(key,{token:result.documentToken,generation});
    return {...result,generation};
  }
  retireTab(tab){
    tab.retired=true;
    for(const f of this.frames.values())if(f.tabRef===tab.ref)f.retired=true;
    for(const e of this.elements.values())if(e.tabRef===tab.ref)e.retired=true;
  }
  retireNativeTab(nativeId){for(const tab of this.tabs.values())if(tab.nativeId===nativeId)this.retireTab(tab);}
  transferWatches(oldTab,newTab){
    for(const w of this.watches.values())if(w.nativeId===oldTab.nativeId&&w.contextRef===oldTab.contextRef&&!w.ended&&w.kind==='network'){w.tabRef=newTab.ref;w.docToken=newTab.docToken;w.windowId=newTab.windowId;}
  }
  retireFrame(frame){
    frame.retired=true;
    for(const f of this.frames.values())if(f.parentRef===frame.ref)this.retireFrame(f);
    for(const e of this.elements.values())if(e.frameRef===frame.ref)e.retired=true;
  }
  async meta(op,id){
    const values={};
    for(const [key,attrName] of [['url','url'],['title','title'],['status','readystate']]){
      const r=await this.native('GetHtmlAttribute',{tabId:id,customId:'',attrName},op);
      if(typeof r.attrValue!=='string'&&typeof r.attrValue!=='number')throw new BrowserError('BACKEND_FAILURE','Malformed tab metadata');
      values[key]=key==='status'?good(Number(r.attrValue))?'complete':'loading':String(r.attrValue).slice(0,key==='url'?2048:512);
    }
    const w=await this.native('GetWindowIdForTabId',{tabId:id},op);const windowId=numberId(w.windowId);
    if(windowId===null)throw new BrowserError('BACKEND_FAILURE','Invalid owning window');
    const active=await this.native('GetActiveTabId',{windowId},op,{allowFailure:true});
    return {...values,windowId,active:good(active.retCode)&&Number(active.tabId)===id};
  }
  async enumeration(op){
    const r=await this.native('FindBrowserTabs',{attrMap:{},maxElems:512},op,{allowFailure:true});
    if(Object.hasOwn(r,'retCode')&&!good(r.retCode))throw new BrowserError('BACKEND_FAILURE','Tab enumeration returned an explicit failure');
    if(!Array.isArray(r.results)||r.results.length>512||!Number.isSafeInteger(r.openTabsCount)||r.openTabsCount<r.results.length)throw new BrowserError('BACKEND_FAILURE','Malformed tab enumeration');
    const ids=r.results.map(v=>numberId(v.m_customId));
    if(ids.some(v=>v===null)||new Set(ids).size!==ids.length)throw new BrowserError('BACKEND_FAILURE','Invalid tab identities');
    const count=await this.native('GetTabCount',{},op);
    if(!Number.isSafeInteger(count.tabCount)||count.tabCount<0)throw new BrowserError('BACKEND_FAILURE','Invalid independent tab count');
    const complete=ids.length===r.openTabsCount&&count.tabCount===r.openTabsCount;
    if(complete){for(const ctx of this.contexts.values())for(const {tab} of ctx.cleanupFrames?.values()??[])if(!ids.includes(tab.nativeId))tab.closedConfirmed=true;
      for(const tab of this.tabs.values())if(!ids.includes(tab.nativeId)){tab.closedConfirmed=true;this.retireTab(tab);}for(const id of this.knownTabs.keys())if(!ids.includes(id)){this.knownTabs.delete(id);this.unknownTabs.delete(id);this.allocations.delete(id);for(const key of this.generations.keys())if(key.startsWith(`${id}|`))this.generations.delete(key);}}
    return {ids,complete,count:r.openTabsCount};
  }
  async adopt(op,id,{contextRef=op.ctx?.ref??null,forceNew=false}={}){
    const meta=await this.meta(op,id);
    let url;try{url=new URL(meta.url);}catch{throw new BrowserError('UNSUPPORTED_CAPABILITY','Tab has no supported URL');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new BrowserError('UNSUPPORTED_CAPABILITY','Only HTTP(S) page tabs without URL credentials are supported');
    const observed=await this.doc(op,{nativeId:id});
    if(this.knownTabs.has(id)&&this.knownTabs.get(id).docToken!==observed.documentToken){for(const t of this.tabs.values())if(t.nativeId===id)this.retireTab(t);this.allocations.delete(id);}
    this.knownTabs.set(id,{docToken:observed.documentToken,windowId:meta.windowId});
    const existing=!forceNew&&[...this.tabs.values()].find(t=>!t.retired&&t.nativeId===id&&t.clientRef===op.client.id&&t.contextRef===contextRef&&t.docToken===observed.documentToken&&t.windowId===meta.windowId);
    const visibility=['visible','hidden'].includes(observed.data.visibility)?observed.data.visibility:'unknown';
    if(existing){Object.assign(existing,meta,{visibility});return existing;}
    if([...this.tabs.values()].filter(t=>!t.retired).length>=8192)throw new BrowserError('LIMIT_EXCEEDED','Tab ref registry is full');
    const tab={ref:opaque('tab'),nativeId:id,clientRef:op.client.id,contextRef,docToken:observed.documentToken,generation:observed.generation,retired:false,...meta,visibility};this.tabs.set(tab.ref,tab);return tab;
  }
  tabData(t){return {tabRef:t.ref,url:t.url,title:t.title,windowRef:`win_${t.windowId}_${this.connectionRef.slice(-8)}`,active:t.active,status:t.status,visibility:t.visibility??'unknown',documentGeneration:t.generation};}
  mainFrame(op,tab){
    let frame=[...this.frames.values()].find(f=>!f.retired&&f.tabRef===tab.ref&&f.nativeId===0);
    if(!frame){frame={ref:opaque('frm'),tabRef:tab.ref,contextRef:op.ctx.ref,clientRef:op.client.id,nativeId:0,docToken:tab.docToken,generation:tab.generation,parentRef:null,retired:false};this.frames.set(frame.ref,frame);}
    return frame;
  }
  async tab(op,ref,{allowRetired=false}={}){
    const tab=this.tabs.get(ref);
    if(!tab||tab.clientRef!==op.client.id||tab.contextRef!==op.ctx?.ref||(!allowRetired&&tab.retired))throw new BrowserError('STALE_TAB','Tab ref is stale or outside context');
    op.tab=tab;
    if(allowRetired)return tab;
    if(tab.pending)throw new BrowserError('STALE_TAB','Pending tab needs explicit tab_get initialization');
    const d=await this.doc(op,tab);
    const w=await this.native('GetWindowIdForTabId',{tabId:tab.nativeId},op);
    if(d.documentToken!==tab.docToken||w.windowId!==tab.windowId){this.retireTab(tab);throw new BrowserError('STALE_TAB','Unexpected document/tab incarnation changed; rediscover tabs');}
    tab.url=d.data.url.slice(0,2048);tab.title=d.data.title.slice(0,512);tab.status=d.data.ready?'complete':'loading';
    tab.visibility=['visible','hidden'].includes(d.data.visibility)?d.data.visibility:'unknown';
    return tab;
  }
  async frame(op,tab,ref){
    const frame=ref?this.lookup(this.frames,ref,op,'FRAME'):this.mainFrame(op,tab);
    if(frame.tabRef!==tab.ref)throw new BrowserError('REF_SCOPE_MISMATCH','Frame belongs to another tab');
    if(frame.parentRef){
      const parent=await this.frame(op,tab,frame.parentRef),parentElement=this.lookup(this.elements,frame.parentElementRef,op,'ELEMENT');
      const p=await this.page(op,tab,parent,'probe',{targetToken:parentElement.token,allowDetached:true});
      if(!p.data.connected){this.retireFrame(frame);throw new BrowserError('STALE_FRAME','Parent iframe was removed');}
    }
    let d;try{d=await this.doc(op,tab,frame);}catch(e){if(e.code==='STALE_FRAME')this.retireFrame(frame);throw e;}
    if(d.documentToken!==frame.docToken){this.retireFrame(frame);throw new BrowserError('STALE_FRAME','Frame document changed');}
    op.frame=frame;return frame;
  }
  async element(op,ref,{allowDetached=false}={}){
    const entry=this.lookup(this.elements,ref,op,'ELEMENT');
    if(this.now()-entry.usedAt>600000){entry.retired=true;throw new BrowserError('STALE_ELEMENT','Element ref expired');}
    const tab=await this.tab(op,entry.tabRef),frame=await this.frame(op,tab,entry.frameRef);
    const observed=await this.page(op,tab,frame,'probe',{targetToken:entry.token,allowDetached:true});
    if(!allowDetached&&!observed.data.connected){entry.retired=true;throw new BrowserError('STALE_ELEMENT','Node was detached');}
    entry.usedAt=this.now();op.element=entry;return {entry,tab,frame,observation:observed.data};
  }
  bind(op,tab,frame,node){
    if(typeof node?.token!=='string'||!uuid.test(node.token))throw new BrowserError('BACKEND_FAILURE','Invalid node identity');
    const local=node.nativeLocalId;
    if(local!==null&&local!==undefined&&(typeof local!=='string'||! /^[A-Za-z0-9._:-]{1,128}$/.test(local)))throw new BrowserError('BACKEND_FAILURE','Invalid native node handle');
    let entry=[...this.elements.values()].find(e=>!e.retired&&e.contextRef===op.ctx.ref&&e.frameRef===frame.ref&&e.token===node.token);
    if(!entry){
      if([...this.elements.values()].filter(e=>!e.retired&&e.contextRef===op.ctx.ref).length>=2048)throw new BrowserError('LIMIT_EXCEEDED','Context element ref limit exceeded');
      entry={ref:opaque('el'),contextRef:op.ctx.ref,clientRef:op.client.id,tabRef:tab.ref,frameRef:frame.ref,token:node.token,nativeLocalId:local??null,tag:node.tag,usedAt:this.now(),retired:false};this.elements.set(entry.ref,entry);
    }else{entry.usedAt=this.now();if(local)entry.nativeLocalId=local;}
    return entry;
  }
  publicNode(op,tab,frame,node){
    const entry=this.bind(op,tab,frame,node),{token,nativeLocalId,...rest}=node;
    return {...rest,elementRef:entry.ref};
  }
  async scope(op,args){
    const tab=await this.tab(op,args.tabRef),frame=await this.frame(op,tab,args.frameRef);
    let root=null;
    if(args.rootRef){const r=await this.element(op,args.rootRef);if(r.frame.ref!==frame.ref)throw new BrowserError('REF_SCOPE_MISMATCH','Root belongs to another frame');root=r.entry;}
    return {tab,frame,root};
  }
  async find(op,args,{single=false}={}){
    const {tab,frame,root}=await this.scope(op,args);
    const result=await this.page(op,tab,frame,'find',{rootToken:root?.token,locator:args.locator,limit:single?2:args.limit??50});
    const d=result.data;
    if(single&&(d.entries.length>1||d.matchCount>1))throw new BrowserError('AMBIGUOUS_TARGET','Locator matches more than one element');
    if(single&&(d.truncated||d.matchCount===null))throw new BrowserError('LIMIT_EXCEEDED','Strict uniqueness is not proven by a truncated search');
    if(single&&d.matchCount!==1)throw new BrowserError(d.matchCount?'AMBIGUOUS_TARGET':'NOT_FOUND','Locator must match exactly one element');
    const attrs=args.locator.attributes??{},eligible=args.locator.kind==='attributes'&&(!root||root.nativeLocalId)
      &&Object.entries(attrs).every(([k,v])=>/^(id|name|type|title|role|aria-label|data-[A-Za-z0-9_-]+)$/.test(k)&&v.length<=64&&!/[?*]/.test(v));
    if(eligible){
      const native=await this.nativeQuery(op,tab,root?`${frame.nativeId}|${root.nativeLocalId}`:`${frame.nativeId}|`,{tag:(args.locator.tag??'*').toUpperCase(),...attrs},{limit:single?2:args.limit??50});
      if(d.matchCount!==null&&d.matchCount<=(single?2:args.limit??50)&&native.length!==d.matchCount)throw new BrowserError('DISCOVERY_UNCONFIRMED','Native and DOM literal matches differ');
      const wanted=new Map(d.entries.map(n=>[n.token,n]));
      for(const id of native){if(id.frameId!==frame.nativeId)throw new BrowserError('FRAME_UNAVAILABLE','Implicit frame crossing is not permitted');const node=await this.bindNative(op,tab,frame,id.local);if(wanted.has(node.token))wanted.get(node.token).nativeLocalId=id.local;}
    }
    const elements=d.entries.map(n=>this.publicNode(op,tab,frame,n));
    await this.frame(op,tab,frame.ref);
    return single?{elementRef:elements[0].elementRef,frameRef:frame.ref,matchCount:1,truncated:false}:{elements,matchCount:d.matchCount,observedMatchCount:d.observedMatchCount,truncated:d.truncated};
  }
  async nativeElement(op,entry,tab,frame){
    if(!entry.nativeLocalId){
      const candidates=await this.nativeQuery(op,tab,`${frame.nativeId}|`,{tag:entry.tag.toUpperCase()});
      for(const id of candidates){if(id.frameId!==frame.nativeId)continue;const n=await this.bindNative(op,tab,frame,id.local);if(n.token===entry.token){entry.nativeLocalId=id.local;break;}}
      if(!entry.nativeLocalId)throw new BrowserError('UNSUPPORTED_CAPABILITY','No exact native handle could be bound; choose method=dom');
    }
    const customId=`${frame.nativeId}|${entry.nativeLocalId}`;
    const valid=await this.native('IsHtmlElemValid',{tabId:tab.nativeId,customId,checkVirtualId:false,bringIntoViewVirtualId:false},op,{allowFailure:true});
    if(!good(valid.retCode)){entry.retired=true;throw new BrowserError('STALE_ELEMENT','Native node handle is invalid');}
    const bound=await this.native('InjectAndRunJs',{tabId:tab.nativeId,customId,executionWorld:0,jsCode:PAGE_FUNCTION,input:JSON.stringify({namespace:this.namespace,owner:op.ctx.ref,op:'probe',expectedDocument:frame.docToken,targetToken:entry.token,allowDetached:false})},op);
    let checked;try{checked=JSON.parse(bound.result);}catch{}
    if(good(bound.isScriptErr)||!checked?.ok||!checked.data.connected)throw new BrowserError('STALE_ELEMENT','Native and bridge node identities differ');
    return {tabId:tab.nativeId,customId};
  }
  allocate(tab){const a=this.allocations.get(tab.nativeId);if(a?.blocked)throw new BrowserError('DISCOVERY_UNCONFIRMED','Discovery allocation is unconfirmed; reload the document before native discovery');return a?.next??1;}
  commitAllocation(tab,end){this.allocations.set(tab.nativeId,{next:end+1,blocked:false});}
  async nativeQuery(op,tab,parentCustomId,attributes,{limit=100,allowChild=false}={}){
    const start=this.allocate(tab),packet=findPacket(tab.nativeId,parentCustomId,attributes,start,Math.min(100,limit),Math.min(2000,this.budget(op)));
    try{const result=await this.native('FindSelectors',packet,op);const matches=parseFind(result,start);this.commitAllocation(tab,result.endedWithId);
      const decoded=matches.map(m=>decodeId(m.m_customId,tab.nativeId));if(new Set(matches.map(m=>m.m_customId)).size!==matches.length)throw new BrowserError('DISCOVERY_UNCONFIRMED','Duplicate native handles');
      if(!allowChild&&decoded.some(d=>d.frameId!==Number(parentCustomId.split('|')[0])))throw new BrowserError('FRAME_UNAVAILABLE','Unexpected native frame');return decoded;
    }catch(e){this.allocations.set(tab.nativeId,{blocked:true});throw e;}
  }
  async bindNative(op,tab,frame,local){
    const result=await this.native('InjectAndRunJs',{tabId:tab.nativeId,customId:`${frame.nativeId}|${local}`,executionWorld:0,jsCode:PAGE_FUNCTION,input:JSON.stringify({namespace:this.namespace,owner:op.ctx.ref,expectedDocument:frame.docToken,op:'bind'})},op);
    let response;try{response=JSON.parse(result.result);}catch{}
    if(good(result.isScriptErr)||!response?.ok||response.documentToken!==frame.docToken)throw new BrowserError('STALE_ELEMENT','Native binding identity was not confirmed');
    return response.data.entry;
  }
  async postElement(op,entry,tab,frame){
    try{const p=await this.page(op,tab,frame,'probe',{targetToken:entry.token,allowDetached:true});if(!p.data.connected)throw new Error();return p.data.entry;}
    catch{throw new BrowserError('ACTION_OUTCOME_UNKNOWN','Identity was lost after the action',{dispatchState:'unknown'});}
  }
  watch(op,ref,kind){
    const w=this.watches.get(ref);
    if(!w||w.clientRef!==op.client.id||w.contextRef!==op.ctx?.ref||(kind&&w.kind!==kind))throw new BrowserError('STALE_WATCH','Watcher is stale or outside context');
    return w;
  }
  makeWatch(op,kind,data,ttl=30000){
    if([...this.watches.values()].filter(w=>w.contextRef===op.ctx.ref&&!w.ended).length>=64)throw new BrowserError('LIMIT_EXCEEDED','Watcher limit exceeded');
    const w={ref:opaque('watch'),kind,clientRef:op.client.id,contextRef:op.ctx.ref,expiresAt:this.now()+ttl,ttlMs:ttl,ended:false,...data};this.watches.set(w.ref,w);
    w.timer=setTimeout(()=>this.expireWatch(w).catch(()=>{w.cleanupUnconfirmed=true;}),ttl);w.timer.unref();return w;
  }
  touchFrame(op,tab,frame){op.ctx.touchedFrames.add(frame.ref);op.ctx.cleanupFrames??=new Map();op.ctx.cleanupFrames.set(frame.ref,{tab,frame});}
  cleanupTarget(contextRef,frameRef){return this.contexts.get(contextRef)?.cleanupFrames?.get(frameRef)??{frame:this.frames.get(frameRef)};}
  async cleanupPage(frame,contextRef,operation='release',extra={},savedTab=null){
    const tab=savedTab??this.tabs.get(frame?.tabRef);if(!tab||!frame)return false;if(tab.closedConfirmed)return true;
    try{const response=await this.request('InjectAndRunJs',{tabId:tab.nativeId,customId:`${frame.nativeId}|`,executionWorld:0,jsCode:PAGE_FUNCTION,input:JSON.stringify({namespace:this.namespace,owner:contextRef,expectedDocument:frame.docToken,op:operation,...extra})},3000);
      const value=JSON.parse(response?.result);return good(response?.retCode)&&!good(response?.isScriptErr)&&value?.ok===true;
    }catch{return false;}
  }
  async expireWatch(w){
    if(w.ended)return;w.expired=true;w.ended=true;w.endedAt=this.now();
    if(w.kind==='network')await this.stopNetwork(w);
    if(w.kind==='dom'){const target=this.cleanupTarget(w.contextRef,w.frameRef);if(!await this.cleanupPage(target.frame,w.contextRef,'events',{action:'unsubscribe',watchId:w.ref},target.tab)){w.cleanupUnconfirmed=true;this.cleanupUnconfirmed++;}}
  }
  async stopNetwork(w){
    if(w.stopped)return true;if(w.stopping)return w.stopping;
    w.ended=true;clearTimeout(w.timer);
    w.stopping=(async()=>{
      try{const r=await this.request('StopWebRequestMonitoring',{tabId:w.nativeId},3000);if(!good(r?.retCode))throw new Error();w.stopped=true;if(this.network.get(w.nativeId)===w)this.network.delete(w.nativeId);return true;}
      catch{w.cleanupUnconfirmed=true;return false;}finally{w.endedAt=this.now();w.stopping=null;}
    })();return w.stopping;
  }
  async sweep(){
    for(const w of this.watches.values())if(!w.ended&&this.now()>=w.expiresAt)await this.expireWatch(w);else if(w.kind==='network'&&w.cleanupUnconfirmed&&!w.stopped)await this.stopNetwork(w);
    for(const [id,w] of this.watches)if(w.ended&&!(w.kind==='network'&&!w.stopped)&&this.now()-(w.endedAt??w.expiresAt)>60000){clearTimeout(w.timer);this.watches.delete(id);}
    for(const c of this.contexts.values())if(c.alive&&this.now()-c.usedAt>1800000)await this.releaseContext(c);
    for(const [id,e] of this.elements)if(e.retired||this.now()-e.usedAt>600000)this.elements.delete(id);
    for(const [id,f] of this.frames)if(f.retired)this.frames.delete(id);
    for(const [id,t] of this.tabs)if(t.retired&&!this.unknownTabs.has(t.nativeId))this.tabs.delete(id);
    for(const [id,c] of this.contexts)if(!c.alive)this.contexts.delete(id);
    for(const [id,c] of this.clients)if(c.contexts.size===0&&this.now()-c.usedAt>1800000)await this.releaseClient(id);
    await this.artifacts.sweep();
  }
  async releaseContext(ctx,excludeRequestId=null){
    if(ctx.releasePromise)return ctx.releasePromise;
    ctx.alive=false;
    ctx.releasePromise=(async()=>{
    await Promise.allSettled([...(ctx.jobs??new Map())].filter(([id])=>id!==excludeRequestId).map(([,job])=>job));
    const targets=[...ctx.touchedFrames].map(id=>ctx.cleanupFrames?.get(id)??{frame:this.frames.get(id)}),results=await Promise.allSettled(targets.map(x=>this.cleanupPage(x.frame,ctx.ref,'release',{},x.tab)));
    const pageFailures=results.filter(x=>x.status==='rejected'||x.value!==true).length;this.cleanupUnconfirmed+=pageFailures;
    let networkFailures=0;
    for(const w of this.watches.values())if(w.contextRef===ctx.ref){clearTimeout(w.timer);w.ended=true;w.endedAt=this.now();if(w.kind==='network'&&!await this.stopNetwork(w)){this.cleanupUnconfirmed++;networkFailures++;}}
    for(const t of this.tabs.values())if(t.contextRef===ctx.ref)this.retireTab(t);
    await this.artifacts.release(ctx.clientRef,ctx.ref);this.clients.get(ctx.clientRef)?.contexts.delete(ctx.ref);return {cleanupConfirmed:pageFailures===0&&networkFailures===0};
    })();return ctx.releasePromise;
  }
  async releaseClient(clientRef){
    const c=this.clients.get(clientRef);if(!c)return;
    if(c.releasePromise)return c.releasePromise;c.releasing=true;this.releasedClients.add(clientRef);
    c.releasePromise=(async()=>{await Promise.allSettled(c.jobs.values());for(const id of c.contexts){const ctx=this.contexts.get(id);if(ctx)await this.releaseContext(ctx);}
      for(const tab of this.tabs.values())if(tab.clientRef===clientRef)this.retireTab(tab);this.clients.delete(clientRef);
    })();return c.releasePromise;
  }
  async dispose(){clearInterval(this.sweeper);for(const c of [...this.clients.keys()])await this.releaseClient(c);}
  async image(clientRef,args){const c=this.client(clientRef),ctx=this.context(c,args.contextRef);return this.artifacts.image(c.id,ctx.ref,args.artifactRef);}
  preflight(op,args){
    let target;
    const take=(map,ref,kind)=>{if(!ref)return;const v=this.lookup(map,ref,op,kind);const tab=kind==='TAB'?v:this.tabs.get(v.tabRef);if(target&&target.nativeId!==tab?.nativeId)throw new BrowserError('REF_SCOPE_MISMATCH','Targets belong to different tabs');target=tab;return v;};
    if(op.name!=='browser_attach'){
      if(args.tabRef){const t=this.tabs.get(args.tabRef);if(!t||t.clientRef!==op.client.id||t.contextRef!==(op.ctx?.ref??null))throw new BrowserError('REF_SCOPE_MISMATCH','Tab is outside requested context');if(t.retired&&!(op.name==='browser_tab_get'&&args.resolve))throw new BrowserError('STALE_TAB');target=t;}
      const f=take(this.frames,args.frameRef,'FRAME');
      for(const ref of [args.elementRef,args.rootRef,args.sourceRef,args.targetRef,...(args.fields??[]).map(x=>x.elementRef)]){
        const e=take(this.elements,ref,'ELEMENT');if(e&&f&&e.frameRef!==f.ref)throw new BrowserError('REF_SCOPE_MISMATCH','Target is outside requested frame');
      }
    }
    return target?.nativeId;
  }
  isRead(name,a){return BROWSER_TOOLS.find(t=>t.name===name)?.annotations.readOnlyHint||
    name==='browser_tab_get'&&!a.resolve||name==='browser_tree'&&a.action==='read'||name==='browser_events'&&a.action==='poll'||
    name==='browser_cookies'&&a.action==='list'||name==='browser_window'&&a.action==='get'||name==='browser_text_selection'&&a.action==='get'||
    name==='browser_image_artifact'&&a.action!=='save'||name==='browser_extract_table'&&!a.pagination||['browser_network_wait','browser_wait_new_tab'].includes(name)&&a.action==='wait';}
  async call(clientRef,name,args){
    const started=this.now(),requestId=opaque('req');let op;
    try{
      validateToolInput(name,args);const client=this.client(clientRef),ctx=args.contextRef?this.context(client,args.contextRef):null;
      op={client,ctx,name,args,requestId,started,deadline:started+(args.timeoutMs??10000),dispatchState:'notSent',key:args.requestKey??requestId};
      const records=ctx?.keys??client.keys,releasing=name==='browser_attach'&&args.action==='release';
      // A wait is queue-read-only, but failed monitor cleanup can need explicit
      // unknown-outcome recovery. Reserve its key before starting the wait.
      // Context release has its own shared cleanup promise and must not depend
      // on capacity in the action history, even when several callers release.
      const useKey=!releasing&&(!this.isRead(name,args)||Object.hasOwn(args,'requestKey')||name==='browser_network_wait'&&args.action==='wait');
      if(useKey){
        const hash=fingerprint(name,args),existing=records.get(op.key);
        if(existing){if(existing.hash!==hash)throw new BrowserError('REQUEST_KEY_CONFLICT','Request key was used with different arguments');return existing.promise;}
        if(records.size>=256){
          const tab=this.tabs.get(args.tabRef),unknown=tab&&this.unknownTabs.get(tab.nativeId);
          const resolving=name==='browser_tab_get'&&args.resolve&&tab?.contextRef===ctx?.ref&&tab?.clientRef===client.id
            &&unknown?.contextRef===ctx?.ref&&unknown?.requestKey===args.resolve.requestKey&&records.get(args.resolve.requestKey)?.status==='unknown';
          // Keep a bounded reserve for explicit recovery, including attempts
          // that expire in queue. Neither ordinary nor invalid calls can use it.
          if(!resolving||records.size>=512)throw new BrowserError('LIMIT_EXCEEDED','Write request key cache is full');
        }
        let resolve;const promise=new Promise(r=>{resolve=r;});const reservation={hash,promise,resolve,status:'pending'};records.set(op.key,reservation);op.reservation=reservation;
      }
      if(this.pending>=128)throw new BrowserError('LIMIT_EXCEEDED','Browser operation queue is full');this.pending++;op.queueAccounted=true;
      // Cancellation is a control path: mark it before a queued waiter can keep polling.
      if(['browser_network_wait','browser_wait_new_tab','browser_events'].includes(name)&&['cancel','unsubscribe'].includes(args.action)&&args.watchRef){const w=this.watch(op,args.watchRef);w.cancelRequested=true;}
      const finish=()=>{if(op.queueAccounted){this.pending--;op.queueAccounted=false;}ctx?.jobs?.delete(requestId);client.jobs.delete(requestId);};
      const run=async()=>{
        try{
          this.budget(op);this.preflight(op,args);
          if(this.temporaryBlocks.has(name))throw new BrowserError('UNSUPPORTED_CAPABILITY','Backend is unavailable on this native connection; diagnose it before reconnecting',{details:{reason:this.temporaryBlocks.get(name)}});
          await this.activation(op);
          const handler=this.handlers[name];if(!handler)throw new BrowserError('UNSUPPORTED_CAPABILITY','No browser adapter is installed');
          const outcome=await handler(op,args);
          if(!(name==='browser_attach'&&args.action==='release'))this.budget(op);
          const context=op.ctx?{contextRef:op.ctx.ref,...(op.tab&&!op.tab.retired?{tabRef:op.tab.ref}:{}),...(op.frame&&!op.frame.retired?{frameRef:op.frame.ref,documentGeneration:op.frame.generation}:{})}:null;
          const evidence={kind:op.dispatchState==='acknowledged'?'native-ack':'readback',backend:'bridge',dispatchState:op.dispatchState,outcome:op.dispatchState==='acknowledged'?'acknowledged':'observed',verified:op.dispatchState!=='acknowledged',...outcome.evidence};
          const result={ok:true,requestId,context,data:outcome.data,evidence,timing:{elapsedMs:this.now()-started},error:null};assertJsonBound(result);
          if(!validateToolOutput(name,result))throw new BrowserError('CONTRACT_VIOLATION','Adapter output did not match its public schema',{dispatchState:op.dispatchState});
          if(op.reservation){op.reservation.status='complete';op.reservation.resolve(result);}return result;
        }catch(e){return this.failure(op,e);}finally{finish();}
      };
      const nativeId=this.preflight(op,args),tabTail=nativeId===undefined?Promise.resolve():this.tabQueues.get(nativeId)??Promise.resolve();
      const windowScoped=!releasing&&(!this.isRead(name,args)||name==='browser_screenshot');
      let queueTimer,expiredResult;
      const start=()=>{clearTimeout(queueTimer);return expiredResult??run();};
      // Return a queued timeout promptly, but keep the original predecessor
      // barrier as the queue tail. Later operations must not overtake it.
      const job=Promise.all([tabTail,...(windowScoped?[this.windowQueue]:[])]).then(start,start),tail=job.catch(()=>{});
      const queuedDeadline=new Promise(resolve=>{queueTimer=setTimeout(()=>{
        expiredResult=this.failure(op,new BrowserError('TIMEOUT','Operation deadline expired in queue',{retryableRead:true}));
        finish();resolve(expiredResult);
      },Math.max(0,op.deadline-this.now()));});
      if(nativeId!==undefined){this.tabQueues.set(nativeId,tail);tail.finally(()=>{if(this.tabQueues.get(nativeId)===tail)this.tabQueues.delete(nativeId);});}
      if(ctx&&!releasing){ctx.jobs??=new Map();ctx.jobs.set(requestId,job);}
      client.jobs.set(requestId,job);
      if(windowScoped)this.windowQueue=tail;return Promise.race([job,queuedDeadline]);
    }catch(error){if(op?.queueAccounted){this.pending--;op.queueAccounted=false;}return op?this.failure(op,error):publicFailure(error,{requestId,elapsedMs:this.now()-started});}
  }
  failure(op,error){
    let e=error instanceof BrowserError?error:new BrowserError('BACKEND_FAILURE','Browser operation failed',{dispatchState:op.dispatchState});
    const unknown=e.code==='ACTION_OUTCOME_UNKNOWN'||e.dispatchState==='unknown'||(op.dispatchState==='acknowledged'&&['TIMEOUT','RESULT_TOO_LARGE','BACKEND_FAILURE','CONTRACT_VIOLATION','SCRIPT_ERROR','STALE_FRAME','STALE_TAB','STALE_CONTEXT','STALE_ELEMENT'].includes(e.code));
    if(unknown){
      e=new BrowserError(['RESULT_TOO_LARGE','MONITOR_CLEANUP_UNCONFIRMED'].includes(e.code)?e.code:'ACTION_OUTCOME_UNKNOWN',e.message,{dispatchState:'unknown',recovery:'observe-do-not-retry',details:{...e.details,requestKey:op.key},data:e.data});
      if(op.tab)this.unknownTabs.set(op.tab.nativeId,{contextRef:op.ctx?.ref,clientRef:op.client.id,requestKey:op.key,tool:op.name});
    }
    let result=publicFailure(e,{requestId:op.requestId,context:op.ctx?{contextRef:op.ctx.ref}:null,elapsedMs:this.now()-op.started});
    try{assertJsonBound(result);if(!validateToolOutput(op.name,result))throw Error();}
    catch{result=publicFailure(new BrowserError('CONTRACT_VIOLATION','Adapter error did not match its public schema',{dispatchState:unknown?'unknown':op.dispatchState,recovery:unknown?'observe-do-not-retry':'none'}),{requestId:op.requestId,context:op.ctx?{contextRef:op.ctx.ref}:null,elapsedMs:this.now()-op.started});}
    if(op.reservation){op.reservation.status=unknown?'unknown':'complete';op.reservation.resolve(result);}return result;
  }
  assertWrite(op,tab){if(this.unknownTabs.has(tab.nativeId))throw new BrowserError('WRITE_BLOCKED','An earlier action outcome is unknown; explicitly resolve it before another write',{details:{requestKey:this.unknownTabs.get(tab.nativeId).requestKey}});}
}
export const createBrowserRuntime=options=>new BrowserRuntime(options);
