import {BrowserError,opaque} from './browser-tools.mjs';
import {evaluateFunction,EVALUATE_POLL_FUNCTION} from './browser-page.mjs';
import {createObserverHandlers} from './browser-observers.mjs';
import {createCompositeHandlers} from './browser-composites.mjs';

const good=v=>v===1||v===true;
const read=(data,backend='isolated-dom')=>({data,evidence:{kind:'readback',backend,dispatchState:'notSent',outcome:'observed',verified:true}});
const verified=(data,backend='isolated-dom',method)=>({data,evidence:{kind:'dom-readback',backend,method:method??backend,dispatchState:'acknowledged',outcome:'verified',verified:true}});
const ack=(data,backend='isolated-dom',method)=>({data,evidence:{kind:'native-ack',backend,method:method??backend,dispatchState:'acknowledged',outcome:'acknowledged',verified:false}});
const postcondition=(matched,message)=>{if(!matched)throw new BrowserError('POSTCONDITION_FAILED',message,{dispatchState:'acknowledged',recovery:'observe-do-not-retry'});};
function http(value){let u;try{u=new URL(value);}catch{}if(!u||!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new BrowserError('INVALID_ARGUMENT','HTTP(S) URL without embedded credentials required');return u.href;}

export function createBrowserHandlers(r){
  const handlers={
    async browser_attach(op,a){
      if(a.action==='release'){op.dispatchState='sent';const cleanup=await r.releaseContext(op.ctx,op.requestId);op.dispatchState=cleanup.cleanupConfirmed?'acknowledged':'unknown';return {data:{released:true,...cleanup},evidence:{kind:'event-observation',backend:'bridge',dispatchState:op.dispatchState,outcome:cleanup.cleanupConfirmed?'verified':'partial',verified:cleanup.cleanupConfirmed}};}
      if(a.connectionRef!==r.connectionRef)throw new BrowserError('STALE_CONTEXT','Connection was replaced');
      if(op.client.contexts.size>=16||[...r.contexts.values()].filter(c=>c.alive).length>=128)throw new BrowserError('LIMIT_EXCEEDED','Context limit exceeded');
      let selected;
      if(a.tabRef){selected=r.tabs.get(a.tabRef);if(!selected||selected.retired||selected.clientRef!==op.client.id||selected.contextRef!==null)throw new BrowserError('REF_SCOPE_MISMATCH','Attach requires a current discovery tab ref');}
      const ctx={ref:opaque('ctx'),clientRef:op.client.id,alive:true,usedAt:r.now(),keys:new Map(),touchedFrames:new Set()};r.contexts.set(ctx.ref,ctx);op.client.contexts.add(ctx.ref);op.ctx=ctx;
      try{
        let tab=null;
        if(selected){tab=await r.adopt(op,selected.nativeId);if(tab.docToken!==selected.docToken||tab.windowId!==selected.windowId)throw new BrowserError('STALE_TAB','Discovered tab changed before attach');op.tab=tab;r.mainFrame(op,tab);}
        return read({contextRef:ctx.ref,connectionRef:r.connectionRef,tabRef:tab?.ref??null,availableTools:Object.keys(handlers)},'bridge');
      }catch(e){await r.releaseContext(ctx);throw e;}
    },
    async browser_tabs(op,a){
      if(a.connectionRef&&a.connectionRef!==r.connectionRef)throw new BrowserError('STALE_CONTEXT','Connection was replaced');
      const requested=a.url?http(a.url):null;
      const found=await r.enumeration(op),tabs=[];let scanned=0;
      for(const id of found.ids.sort((a,b)=>a-b)){
        if(tabs.length>=(a.limit??100))break;scanned++;
        try{const t=await r.adopt(op,id);if(!requested||t.url===requested)tabs.push(r.tabData(t));}
        catch(e){if(e.code!=='UNSUPPORTED_CAPABILITY'&&e.code!=='BACKEND_FAILURE')throw e;}
      }
      const complete=found.complete&&scanned===found.ids.length;
      return read({tabs,complete,truncated:!complete,observedTabCount:found.count,connectionRef:r.connectionRef},'uipath');
    },
    async browser_tab_open(op,a){
      const url=http(a.url);let base=-1;
      if(a.tabRef){const t=await r.tab(op,a.tabRef);r.assertWrite(op,t);base=t.nativeId;}
      const response=await r.native('OpenTab',{tabId:base,url},op,{write:true});
      if(!Number.isSafeInteger(response.newTabId)||response.newTabId<0)throw new BrowserError('ACTION_OUTCOME_UNKNOWN','OpenTab did not return a safe new tab ID',{dispatchState:'unknown'});
      const pending={ref:opaque('tab'),nativeId:response.newTabId,clientRef:op.client.id,contextRef:op.ctx.ref,docToken:null,windowId:null,pending:true,generation:0,retired:false,url,title:'',active:false,status:'unknown'};
      r.tabs.set(pending.ref,pending);op.tab=pending;
      try{const tab=await r.adopt(op,pending.nativeId);r.retireTab(pending);op.tab=tab;return ack({...r.tabData(tab),navigationRequested:true,acknowledged:true,metadataPending:false},'uipath');}
      catch{return ack({tabRef:pending.ref,visibility:'unknown',navigationRequested:true,acknowledged:true,metadataPending:true},'uipath');}
    },
    async browser_tab_get(op,a){
      let t=r.tabs.get(a.tabRef),resolution=null;
      if(!t||t.clientRef!==op.client.id||t.contextRef!==op.ctx.ref)throw new BrowserError('STALE_TAB');
      if(a.resolve){
        const u=r.unknownTabs.get(t.nativeId),saved=op.ctx.keys.get(a.resolve.requestKey);
        if(!u||u.contextRef!==op.ctx.ref||u.requestKey!==a.resolve.requestKey||saved?.status!=='unknown')throw new BrowserError('INVALID_ARGUMENT','Resolution must identify this context\'s completed unknown action');
        r.retireNativeTab(t.nativeId);r.unknownTabs.delete(t.nativeId);resolution='abandon-unknown';
        t=await r.adopt(op,t.nativeId,{forceNew:true});
      }else if(t.pending){const old=t;t=await r.adopt(op,t.nativeId,{forceNew:true});r.retireTab(old);}
      else t=await r.tab(op,a.tabRef);
      op.tab=t;const u=r.unknownTabs.get(t.nativeId);
      return {data:{...r.tabData(t),unknownWrite:u?{requestKey:u.requestKey,tool:u.tool}:null,resolution},evidence:{kind:'readback',backend:'bridge',dispatchState:'notSent',outcome:resolution?'abandoned-unknown':'observed',verified:!resolution}};
    },
    async browser_tab_activate(op,a){
      const t=await r.tab(op,a.tabRef);r.assertWrite(op,t);
      await r.native('NavigationCommand',{tabId:t.nativeId,command:'activate',activateWindow:1},op,{write:true});
      const active=await r.native('GetActiveTabId',{windowId:t.windowId},op);postcondition(Number(active.tabId)===t.nativeId,'Tab activation was not observed');t.active=true;
      return verified({tabRef:t.ref,active:true},'uipath');
    },
    async browser_tab_close(op,a){
      const t=await r.tab(op,a.tabRef);r.assertWrite(op,t);
      await r.native('CloseBrowser',{tabId:t.nativeId},op,{write:true});let closed=false;
      for(let i=0;i<8;i++){const all=await r.enumeration(op);if(!all.complete)throw new BrowserError('CLEANUP_UNCONFIRMED','Truncated enumeration cannot prove closure',{dispatchState:'acknowledged'});if(!all.ids.includes(t.nativeId)){closed=true;break;}await r.sleep(op,80);}
      postcondition(closed,'Tab still appears after close acknowledgement');r.retireTab(t);
      return verified({acknowledged:true,closed:true,absenceVerified:true},'uipath');
    },
    browser_navigate:(op,a)=>navigate(op,a,'Navigate',{url:http(a.url)}),
    browser_history:(op,a)=>navigate(op,a,'NavigationCommand',{command:a.action}),
    browser_find_element:async(op,a)=>read(await r.find(op,a,{single:true})),
    browser_find_elements:async(op,a)=>read(await r.find(op,a)),
    async browser_snapshot(op,a){
      const {tab,frame,root}=await r.scope(op,a),result=await r.page(op,tab,frame,'snapshot',{rootToken:root?.token,maxNodes:a.maxNodes??100,maxDepth:a.maxDepth??6,includeHidden:a.includeHidden??false});
      const nodes=result.data.entries.map(n=>r.publicNode(op,tab,frame,n));await r.frame(op,tab,frame.ref);
      return read({nodes,truncated:result.data.truncated,frameRef:frame.ref,documentGeneration:frame.generation});
    },
    async browser_get_element(op,a){
      const {entry,tab,frame}=await r.element(op,a.elementRef),fields=a.fields??['text','value','state'],names=a.attributeNames??['id','name','type','role','aria-label'];
      const result=await r.page(op,tab,frame,'read',{targetToken:entry.token,fields,attributeNames:names});
      const {entry:observed,...data}=result.data;r.bind(op,tab,frame,observed);await r.element(op,a.elementRef);
      return read({...data,elementRef:entry.ref,tag:entry.tag});
    },
    async browser_wait_for(op,a){
      const {tab,frame}=await r.scope(op,a);let observations=0;
      while(true){
        r.budget(op);observations++;let matched=false,ref=a.elementRef;
        if(['urlEquals','ready'].includes(a.condition)){const d=await r.doc(op,tab,frame);matched=a.condition==='ready'?d.data.ready:d.data.url===a.expected;}
        else if(a.condition==='detached'){
          const x=await r.element(op,ref,{allowDetached:true});matched=!x.observation.connected;
        }else{
          if(a.locator){const found=await r.find(op,{...a,limit:2});if(found.truncated)throw new BrowserError('LIMIT_EXCEEDED','Wait locator was truncated');
            if(a.condition==='absent')matched=found.matchCount===0;
            else if(a.condition==='attached')matched=found.matchCount>0;
            else if(found.matchCount>1)throw new BrowserError('AMBIGUOUS_TARGET');
            else if(found.matchCount===1)ref=found.elements[0].elementRef;
          }
          if(ref&&!['attached','absent'].includes(a.condition)){
            const x=await r.element(op,ref),d=x.observation.entry;
            matched={visible:d.state.visible,hidden:!d.state.visible,enabled:!d.state.disabled,disabled:d.state.disabled,valueEquals:d.value===a.expected,textIncludes:d.text.includes(a.expected??'')}[a.condition]===true;
          }
        }
        if(matched)return read({matched:true,condition:a.condition,observations,...(ref?{elementRef:ref}:{})});
        await r.sleep(op,a.pollMs??100);
      }
    },
    async browser_click(op,a){
      const x=await r.element(op,a.elementRef),{entry,tab,frame}=x,method=a.method??'dom';r.assertWrite(op,tab);
      if(method==='uipath'){
        if((a.button??'left')!=='left'||(a.clickCount??1)!==1)throw new BrowserError('UNSUPPORTED_CAPABILITY','UiPath method supports only a single left click');
        if(!x.observation.entry.state.visible||x.observation.entry.state.disabled)throw new BrowserError('TARGET_NOT_INTERACTABLE');
        const base=await r.nativeElement(op,entry,tab,frame);
        await r.native('GenericRequest',{...base,messageId:6,flags:0,doClickInPageWorld:false,x:0,y:0,windowLeft:0,windowTop:0,pageRenderOfsX:0,pageRenderOfsY:0},op,{write:true});
      }else await r.page(op,tab,frame,'click',{targetToken:entry.token,button:a.button??'left',clickCount:a.clickCount??1},true);
      let changed=false,newTab=tab;
      try{const after=await r.doc(op,tab);if(after.documentToken!==tab.docToken){changed=true;r.retireTab(tab);newTab=await r.adopt(op,tab.nativeId,{forceNew:true});r.transferWatches(tab,newTab);op.tab=newTab;}}
      catch{changed=true;r.retireTab(tab);newTab=null;}
      const data={elementRef:entry.ref,method,acknowledged:true,documentChanged:changed,rediscoveryRequired:changed,tabRef:newTab?.ref??null};
      if(a.verify){while(true){const m=await r.meta(op,tab.nativeId);if(m.url===a.verify.expected)break;await r.sleep(op,100);}data.valueMatch=true;return verified(data,method==='uipath'?'uipath':'isolated-dom',method);}
      return ack(data,method==='uipath'?'uipath':'isolated-dom',method);
    },
    async browser_type(op,a){
      const {entry,tab,frame}=await r.element(op,a.elementRef),method=a.method??'dom';r.assertWrite(op,tab);let data;
      const prepared=await r.page(op,tab,frame,'prepareType',{targetToken:entry.token,mode:a.mode??'replace',text:a.text});
      if(method==='uipath'){
        const base=await r.nativeElement(op,entry,tab,frame);
        await r.native('WriteTextHtmlElem',{...base,inputOptions:a.mode==='append'?4:0,tokens:[{text:a.text}]},op,{write:true});
      }else await r.page(op,tab,frame,'type',{targetToken:entry.token,text:a.text,mode:a.mode??'replace'},true);
      await r.postElement(op,entry,tab,frame);
      data=(await r.page(op,tab,frame,'verifyType',{targetToken:entry.token,ticket:prepared.data.ticket})).data;
      if(a.verify!==false)postcondition(data.valueMatch,'Control did not retain the requested text');
      const out={...data,elementRef:entry.ref,method};return a.verify===false?ack(out,method==='uipath'?'uipath':'isolated-dom',method):verified(out,method==='uipath'?'uipath':'isolated-dom',method);
    },
    browser_set_text:(op,a)=>handlers.browser_type(op,{...a,method:'dom',mode:'replace'}),
    async browser_set_checked(op,a){
      const x=await r.element(op,a.elementRef),{entry,tab,frame}=x,method=a.method??'dom';r.assertWrite(op,tab);let data;
      if(method==='uipath'){
        const info=(await r.page(op,tab,frame,'controlInfo',{targetToken:entry.token})).data;
        if(info.tag!=='INPUT'||!['checkbox','radio'].includes(info.type)||info.type==='radio'&&!a.checked)throw new BrowserError('UNSUPPORTED_CAPABILITY','Only native checkbox/radio checking is supported');
        if(info.disabled)throw new BrowserError('TARGET_NOT_INTERACTABLE');
        const changed=x.observation.entry.state.checked!==a.checked;
        if(changed){const base=await r.nativeElement(op,entry,tab,frame);await r.native('CheckHtmlElem',{...base,doCheck:a.checked?1:0,windowLeft:0,windowTop:0},op,{write:true});}
        const after=await r.postElement(op,entry,tab,frame);data={checked:after.state.checked,changed};
      }else{data=(await r.page(op,tab,frame,'checked',{targetToken:entry.token,checked:a.checked},true)).data;data.checked=(await r.postElement(op,entry,tab,frame)).state.checked;}
      postcondition(data.checked===a.checked,'Checked state did not match');return verified({...data,method},method==='uipath'?'uipath':'isolated-dom',method);
    },
    async browser_select_options(op,a){
      const {entry,tab,frame}=await r.element(op,a.elementRef),method=a.method??'dom';r.assertWrite(op,tab);
      const info=(await r.page(op,tab,frame,'controlInfo',{targetToken:entry.token})).data;
      if(info.tag!=='SELECT'||info.truncated)throw new BrowserError('UNSUPPORTED_CAPABILITY','Only bounded native HTML selects supported');
      if(method==='uipath'){
        if(info.disabled||!info.visible)throw new BrowserError('TARGET_NOT_INTERACTABLE');
        const wanted=a.values??a.labels;if(!info.multiple&&wanted.length!==1)throw new BrowserError('UNSUPPORTED_CAPABILITY','Native single select requires exactly one option');
        const options=wanted.map(v=>{const matches=info.options.filter(o=>(a.values?o.value:o.label)===v);if(matches.length!==1)throw new BrowserError(matches.length?'AMBIGUOUS_TARGET':'NOT_FOUND');if(matches[0].disabled)throw new BrowserError('TARGET_NOT_INTERACTABLE');return matches[0];});
        for(const o of options)if(info.options.filter(x=>x.label===o.label).length!==1)throw new BrowserError('AMBIGUOUS_TARGET','Native select label is duplicated');
        const base=await r.nativeElement(op,entry,tab,frame);
        await r.native('HtmlSetSelectedItems',{...base,reset:1,selectIfDisabled:0,selectedItems:options.map(o=>o.label),selectState:0,nativeSelectionOnly:1},op,{write:true});
      }else await r.page(op,tab,frame,'select',{targetToken:entry.token,values:a.values,labels:a.labels},true);
      await r.postElement(op,entry,tab,frame);
      const retained=(await r.page(op,tab,frame,'controlInfo',{targetToken:entry.token})).data;
      const actual=a.values?retained.selectedValues:retained.selectedLabels,wanted=a.values??a.labels;
      postcondition(!retained.truncated&&JSON.stringify([...actual].sort())===JSON.stringify([...wanted].sort()),'Selection did not retain the requested state');
      const data={selectedValues:retained.selectedValues,selectedLabels:retained.selectedLabels,changed:JSON.stringify(info.selectedValues)!==JSON.stringify(retained.selectedValues)};
      return verified({...data,method},method==='uipath'?'uipath':'isolated-dom',method);
    },
    async browser_scroll(op,a){
      let x=a.elementRef?await r.element(op,a.elementRef):await r.scope(op,a);r.assertWrite(op,x.tab);
      const data=(await r.page(op,x.tab,x.frame,'scroll',{targetToken:x.entry?.token,action:a.action,x:a.x,y:a.y},true)).data;
      return verified(data);
    },
    async browser_focus(op,a){
      if(a.tabRef){const v=await handlers.browser_tab_activate(op,a);return {...v,data:{focused:true,tabRef:a.tabRef,elementRef:null}};}
      const {entry,tab,frame}=await r.element(op,a.elementRef);r.assertWrite(op,tab);
      const data=(await r.page(op,tab,frame,'focus',{targetToken:entry.token},true)).data;postcondition(data.focused,'Focus was not observed');
      return verified({...data,elementRef:entry.ref,tabRef:tab.ref});
    },
    async browser_set_attribute(op,a){const {entry,tab,frame}=await r.element(op,a.elementRef);r.assertWrite(op,tab);const data=(await r.page(op,tab,frame,'attribute',{targetToken:entry.token,name:a.name,value:a.value},true)).data;postcondition(data.valueMatch,'Attribute did not match');return verified(data);},
    async browser_hover(op,a){const {entry,tab,frame}=await r.element(op,a.elementRef);r.assertWrite(op,tab);const data=(await r.page(op,tab,frame,'hover',{targetToken:entry.token},true)).data;return ack({...data,method:'dom-synthetic',trusted:false},'isolated-dom','dom-synthetic');},
    async browser_drag_and_drop(op,a){
      const source=await r.element(op,a.sourceRef),destination=await r.element(op,a.targetRef);
      if(source.frame.ref!==destination.frame.ref)throw new BrowserError('REF_SCOPE_MISMATCH','Drag targets must share a frame');r.assertWrite(op,source.tab);
      const data=(await r.page(op,source.tab,source.frame,'drag',{targetToken:source.entry.token,destinationToken:destination.entry.token},true)).data;
      return ack({...data,sourceRef:a.sourceRef,targetRef:a.targetRef,method:'dom-synthetic',trusted:false},'isolated-dom','dom-synthetic');
    },
    async browser_text_selection(op,a){const {entry,tab,frame}=await r.element(op,a.elementRef);if(a.action==='set')r.assertWrite(op,tab);const data=(await r.page(op,tab,frame,'selection',{targetToken:entry.token,action:a.action,start:a.start,end:a.end},a.action==='set')).data;return a.action==='set'?verified(data):read(data);},
    async browser_highlight(op,a){const {entry,tab,frame}=await r.element(op,a.elementRef);r.assertWrite(op,tab);r.touchFrame(op,tab,frame);const data=(await r.page(op,tab,frame,'highlight',{targetToken:entry.token,action:a.action,color:a.color,ttlMs:a.ttlMs??30000},true)).data;return ack(data);},
    async browser_frames(op,a){
      const {tab,frame}=await r.scope(op,a),d=(await r.page(op,tab,frame,'frames')).data;
      const frames=[{frameRef:frame.ref,main:frame.nativeId===0,attached:true,documentGeneration:frame.generation},...d.entries.map(n=>{const e=r.bind(op,tab,frame,n);return {elementRef:e.ref,parentFrameRef:frame.ref,name:n.name,main:false,attached:false};})];
      return read({frames:frames.slice(0,64),truncated:d.truncated||frames.length>64});
    },
    async browser_frame_attach(op,a){
      const {entry,tab,frame:parent}=await r.element(op,a.elementRef);if(!['iframe','frame'].includes(entry.tag))throw new BrowserError('INVALID_ARGUMENT','Expected an iframe element ref');
      const base=await r.nativeElement(op,entry,tab,parent),matches=await r.nativeQuery(op,tab,base.customId,{tag:'HTML'},{limit:2,allowChild:true});
      if(matches.length!==1)throw new BrowserError('FRAME_UNAVAILABLE','Expected exactly one child document root');
      const decoded=matches[0];
      if(decoded.frameId===0||decoded.frameId===parent.nativeId)throw new BrowserError('FRAME_UNAVAILABLE','Frame discovery did not cross into a child');
      let depth=0,p=parent;while(p?.parentRef){if(++depth>=8)throw new BrowserError('LIMIT_EXCEEDED','Frame depth limit exceeded');p=r.frames.get(p.parentRef);}
      const candidate={nativeId:decoded.frameId,docToken:null},doc=await r.doc(op,tab,candidate);
      for(const f of r.frames.values())if(!f.retired&&f.tabRef===tab.ref&&f.nativeId===decoded.frameId)r.retireFrame(f);
      const child={ref:opaque('frm'),nativeId:decoded.frameId,docToken:doc.documentToken,tabRef:tab.ref,contextRef:op.ctx.ref,clientRef:op.client.id,parentRef:parent.ref,parentElementRef:entry.ref,generation:doc.generation,retired:false};r.frames.set(child.ref,child);op.frame=child;
      return read({frameRef:child.ref,parentFrameRef:parent.ref,documentGeneration:child.generation});
    },
    async browser_evaluate(op,a){
      let x=a.elementRef?await r.element(op,a.elementRef):await r.scope(op,a);const {tab,frame}=x;r.assertWrite(op,tab);
      let customId=`${frame.nativeId}|`;if(x.entry)customId=(await r.nativeElement(op,x.entry,tab,frame)).customId;
      const job=opaque('job'),raw=await r.native('InjectAndRunJs',{tabId:tab.nativeId,customId,executionWorld:1,jsCode:evaluateFunction(a.script),input:JSON.stringify({job,hasTarget:Boolean(x.entry),value:a.input??null})},op,{write:true});
      const decode=response=>{
        if(good(response.isScriptErr))throw new BrowserError('ACTION_OUTCOME_UNKNOWN','User page script failed after dispatch',{dispatchState:'unknown',details:{cause:'SCRIPT_ERROR'}});
        try{return JSON.parse(response.result);}catch{throw new BrowserError('ACTION_OUTCOME_UNKNOWN','Script result was malformed',{dispatchState:'unknown'});}
      };
      let result=decode(raw);
      while(result.pending){await r.sleep(op,60);await r.frame(op,tab,frame.ref);result=decode(await r.native('InjectAndRunJs',{tabId:tab.nativeId,customId:`${frame.nativeId}|`,executionWorld:1,jsCode:EVALUATE_POLL_FUNCTION,input:JSON.stringify({job})},op));}
      if(result.error)throw new BrowserError(result.error.code==='RESULT_TOO_LARGE'?'RESULT_TOO_LARGE':'ACTION_OUTCOME_UNKNOWN',result.error.message,{dispatchState:'unknown',details:{cause:result.error.code??'SCRIPT_ERROR'},recovery:'observe-do-not-retry'});
      await r.frame(op,tab,frame.ref);
      return ack({value:result.value??null,undefinedResult:result.undefinedResult===true,awaitedPromise:result.awaitedPromise===true},'main-world','main-world');
    }
  };
  async function navigate(op,a,route,params){
    const tab=await r.tab(op,a.tabRef);r.assertWrite(op,tab);
    await r.native(route,{tabId:tab.nativeId,...params},op,{write:true});r.retireTab(tab);
    if((a.waitUntil??'complete')==='none')return ack({tabRef:null,acknowledged:true,documentChanged:true,status:'unknown',rediscoveryRequired:true},'uipath');
    let next;
    while(true){
      try{next=await r.adopt(op,tab.nativeId,{forceNew:true});
        const transitioned=next.docToken!==tab.docToken||next.url!==tab.url||params.command==='stop';
        if(transitioned&&next.status==='complete')break;r.retireTab(next);
      }catch(e){if(e.code==='TIMEOUT')throw e;}
      await r.sleep(op,100);
    }
    r.transferWatches(tab,next);op.tab=next;return verified({tabRef:next.ref,acknowledged:true,documentChanged:next.docToken!==tab.docToken,status:next.status,rediscoveryRequired:true},'uipath');
  }
  return Object.assign(handlers,createObserverHandlers(r),createCompositeHandlers(r,handlers));
}

export function decodeId(value,tabId){
  const p=typeof value==='string'?value.split('|'):[];const frameId=Number(p[1]);
  if(p.length!==3||p[0]!==String(tabId)||!/^\d{1,10}$/.test(p[1])||!Number.isSafeInteger(frameId)||frameId<0||frameId>2147483647||String(frameId)!==p[1]||! /^[A-Za-z0-9._:-]{1,128}$/.test(p[2]))throw new BrowserError('BACKEND_FAILURE','Native handle scope/format mismatch');
  return {frameId,local:p[2]};
}
export function findPacket(tabId,parentCustomId,attributes,startWithId,limit=100,timeoutMs=2000){return {tabId,parentCustomId,partialRequests:[{m_tagInfosList:[{m_attributesMap:attributes,m_isGreedySearch:false,m_hasFuzzyAttributes:false}],m_searchOption:{m_maxResults:limit,m_searchType:1,m_scope:1,m_minSelectorScore:0,m_requestedLocation:false,m_requestedAncestors:false,m_requestedAncestorsForError:false,m_searchInvisibleChildren:true},m_parentScore:{max:0,min:Number.MAX_VALUE,average:0,sum:0,count:0},m_futureAttributeCount:0}],startWithId,timeoutMs,windowLeft:0,windowTop:0,pageRenderOfsX:0,pageRenderOfsY:0};}
export function parseFind(r,start){
  const results=r.results,matches=results?.[0]?.m_resultsCollection?.m_results,error=results?.[0]?.m_searchError;
  if(!Array.isArray(results)||results.length!==1||!Array.isArray(matches)||matches.length>100||!Number.isSafeInteger(r.endedWithId)||r.endedWithId<start||r.endedWithId>=Number.MAX_SAFE_INTEGER)throw new BrowserError('DISCOVERY_UNCONFIRMED','Malformed selector result/allocation');
  if(error!=null&&!(typeof error==='object'&&!Array.isArray(error)&&Object.keys(error).length===1&&error.m_id===0&&matches.length===0))throw new BrowserError('DISCOVERY_UNCONFIRMED','Selector returned an unsupported search error');
  return matches;
}
