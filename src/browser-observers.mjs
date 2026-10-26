import {BrowserError} from './browser-tools.mjs';

const good=v=>v===1||v===true;
const observation=(data,backend='bridge',dispatchState='notSent')=>({data,evidence:{kind:'event-observation',backend,dispatchState,outcome:'observed',verified:true}});
const url=value=>{let u;try{u=new URL(value);}catch{}if(!u||!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new BrowserError('INVALID_ARGUMENT','An exact HTTP(S) URL is required');return u.href;};

export function createObserverHandlers(r){return {
  async browser_screenshot(op,a){
    const tab=await r.tab(op,a.tabRef),frame=r.mainFrame(op,tab);
    const before=await r.native('GetActiveTabId',{windowId:tab.windowId},op);
    if(Number(before.tabId)!==tab.nativeId)throw new BrowserError('TARGET_NOT_ACTIVE','Viewport capture requires the target tab to be active');
    const doc=await r.doc(op,tab,frame),format=a.format??'png';
    if(doc.data.visibility!=='visible')throw new BrowserError('TARGET_NOT_VISIBLE','Viewport capture requires a visible document');
    r.touchFrame(op,tab,frame);
    let ticket;
    try{
      ticket=(await r.page(op,tab,frame,'render',{action:'arm',ttlMs:2000})).data.ticket;
      while(!(await r.page(op,tab,frame,'render',{action:'poll',ticket})).data.ready)await r.sleep(op,40);
    }catch(error){r.budget(op);throw error;
    }finally{
      if(ticket&&op.ctx.alive&&op.deadline>r.now())try{await r.page(op,tab,frame,'render',{action:'cancel',ticket});}catch{}
    }
    const rendered=await r.doc(op,tab,frame),current=await r.native('GetActiveTabId',{windowId:tab.windowId},op);
    if(rendered.data.visibility!=='visible')throw new BrowserError('TARGET_NOT_VISIBLE','Document became hidden before capture');
    if(rendered.documentToken!==doc.documentToken||Number(current.tabId)!==tab.nativeId)throw new BrowserError('CAPTURE_IDENTITY_UNCONFIRMED','Target changed before capture');
    const result=await r.native('TakeScreenshot',{tabId:tab.nativeId,customId:'',mode:1,format:format==='png'?0:1,waitForPageDelay:0},op,{allowFailure:true});
    if(!good(result.retCode)){
      throw new BrowserError('CAPTURE_FAILED','Extension rejected viewport capture',{details:{vendorCode:Number.isSafeInteger(result.error?.code)?result.error.code:null,reason:typeof result.error?.message==='string'?result.error.message.slice(0,512):'No vendor message'}});
    }
    const active=await r.native('GetActiveTabId',{windowId:tab.windowId},op),window=await r.native('GetWindowIdForTabId',{tabId:tab.nativeId},op),after=await r.doc(op,tab);
    if(Number(active.tabId)!==tab.nativeId||window.windowId!==tab.windowId||after.documentToken!==doc.documentToken)throw new BrowserError('CAPTURE_IDENTITY_UNCONFIRMED','Active tab/window/document changed during capture');
    if(after.data.visibility!=='visible')throw new BrowserError('TARGET_NOT_VISIBLE','Document became hidden during capture');
    if(typeof result.data!=='string'||result.data.length>8*1024*1024-4096||! /^[A-Za-z0-9+/]*={0,2}$/.test(result.data))throw new BrowserError('RESULT_TOO_LARGE','Malformed or oversized screenshot payload');
    const bytes=Buffer.from(result.data,'base64');
    const data=await r.artifacts.put(op.client.id,op.ctx.ref,bytes,format==='png'?'image/png':'image/jpeg');
    return {data,evidence:{kind:'window-guarded-capture',backend:'uipath',dispatchState:'notSent',outcome:'verified',verified:true,
      limitations:['Connection operations are serialized; external user focus races remain possible.','Viewport only; no full-page/debugger capture.']}};
  },
  async browser_network_wait(op,a){
    const tab=await r.tab(op,a.tabRef),action=a.action;
    const base={action,quiet:false,quietMs:0,monitorStopped:false,observationScope:'requests-started-since-arm'};
    if(action==='arm'){
      if(r.network.has(tab.nativeId))throw new BrowserError('WATCH_BUSY','A native network monitor already owns this tab');
      const w=r.makeWatch(op,'network',{tabRef:tab.ref,nativeId:tab.nativeId,docToken:tab.docToken,windowId:tab.windowId},a.ttlMs??30000);r.network.set(tab.nativeId,w);
      try{
        const started=await r.native('StartWebRequestMonitoring',{tabId:tab.nativeId},op,{write:true,allowFailure:true});
        if(!good(started.retCode))throw new BrowserError('UNSUPPORTED_CAPABILITY','The extension cannot start webRequest monitoring');
        if(w.expired||w.ended||r.now()>=w.expiresAt){w.stopped=false;await r.stopNetwork(w);throw new BrowserError('WATCH_EXPIRED','Monitor startup outlived its lease');}
        return observation({...base,watchRef:w.ref,ttlMs:w.ttlMs},'uipath',op.dispatchState);
      }catch(e){const stopped=await r.stopNetwork(w);if(!stopped)throw new BrowserError('MONITOR_CLEANUP_UNCONFIRMED','Failed monitor arm cleanup was not confirmed',{dispatchState:'unknown',details:{watchRef:w.ref}});throw new BrowserError(e.code??'BACKEND_FAILURE',e.message,{dispatchState:e.dispatchState,details:{watchRef:w.ref}});}
    }
    const w=r.watch(op,a.watchRef,'network');
    if(w.nativeId!==tab.nativeId||w.windowId!==tab.windowId||w.docToken!==tab.docToken)throw new BrowserError('STALE_WATCH','Network watcher belongs to an earlier tab incarnation');
    if(action==='cancel'){
      op.dispatchState='sent';const stopped=await r.stopNetwork(w);if(!stopped)throw new BrowserError('MONITOR_CLEANUP_UNCONFIRMED','Native monitor cleanup was not confirmed',{dispatchState:'unknown'});op.dispatchState='acknowledged';
      return observation({...base,watchRef:w.ref,monitorStopped:true},'uipath',op.dispatchState);
    }
    let quietStart=null,quiet=false,primary;
    try{
      while(true){
        if(w.expired||r.now()>=w.expiresAt)throw new BrowserError('WATCH_EXPIRED','Network watcher expired');
        if(w.cancelRequested||w.ended)throw new BrowserError('WATCH_CANCELLED','Network watcher was cancelled');
        const current=await r.native('AnyWebRequestsInFlight',{tabId:tab.nativeId},op);
        if(w.expired||r.now()>=w.expiresAt)throw new BrowserError('WATCH_EXPIRED','Network watcher expired while polling');
        if(w.cancelRequested||w.ended)throw new BrowserError('WATCH_CANCELLED','Network watcher was cancelled while polling');
        if(![true,false,0,1].includes(current.inFlight))throw new BrowserError('BACKEND_FAILURE','Invalid network observation');
        if(good(current.inFlight))quietStart=null;else quietStart??=r.now();
        if(quietStart!==null&&r.now()-quietStart>=(a.quietMs??500)){quiet=true;break;}
        await r.sleep(op,80);
      }
    }catch(e){primary=e;}
    // Stopping this read's monitor is cleanup, not an uncertain page action.
    // Keep the primary observation/deadline state after confirmed cleanup.
    const observationState=op.dispatchState;
    op.dispatchState='sent';const stopped=await r.stopNetwork(w);if(!stopped)throw new BrowserError('MONITOR_CLEANUP_UNCONFIRMED','Native monitor cleanup was not confirmed',{dispatchState:'unknown'});op.dispatchState=observationState;
    if(primary)throw primary;
    return observation({...base,watchRef:w.ref,quiet,quietMs:a.quietMs??500,monitorStopped:true},'uipath','acknowledged');
  },
  async browser_events(op,a){
    if(a.action==='subscribe'){
      if(!a.eventTypes.length)throw new BrowserError('INVALID_ARGUMENT','At least one event type is required');
      let x=a.elementRef?await r.element(op,a.elementRef):await r.scope(op,a);
      if(x.tab.ref!==a.tabRef||(a.frameRef&&x.frame.ref!==a.frameRef))throw new BrowserError('REF_SCOPE_MISMATCH');
      const target=x.entry??x.root;
      const w=r.makeWatch(op,'dom',{tabRef:x.tab.ref,nativeId:x.tab.nativeId,frameRef:x.frame.ref,targetToken:target?.token},a.ttlMs??30000);r.touchFrame(op,x.tab,x.frame);
      try{const data=(await r.page(op,x.tab,x.frame,'events',{targetToken:target?.token,action:'subscribe',eventTypes:[...new Set(a.eventTypes)],watchId:w.ref,ttlMs:w.ttlMs},true)).data;
        return observation({...data,watchRef:w.ref},'isolated-dom',op.dispatchState);}
      catch(e){await r.expireWatch(w);if(w.cleanupUnconfirmed)throw new BrowserError('MONITOR_CLEANUP_UNCONFIRMED','Event listener cleanup was not confirmed',{dispatchState:'unknown',details:{watchRef:w.ref}});throw e;}
    }
    const w=r.watch(op,a.watchRef,'dom');
    if(w.tabRef!==a.tabRef)throw new BrowserError('REF_SCOPE_MISMATCH','Event watcher belongs to another tab');
    if(a.action==='unsubscribe'&&w.ended){
      if(w.cleanupUnconfirmed){op.dispatchState='sent';const target=r.cleanupTarget(w.contextRef,w.frameRef),cleaned=await r.cleanupPage(target.frame,w.contextRef,'events',{action:'unsubscribe',watchId:w.ref},target.tab);if(!cleaned)throw new BrowserError('MONITOR_CLEANUP_UNCONFIRMED','Event listener cleanup remains unconfirmed',{dispatchState:'unknown',details:{watchRef:w.ref}});w.cleanupUnconfirmed=false;op.dispatchState='acknowledged';}
      return observation({action:'unsubscribe',watchRef:w.ref,cancelled:true},'isolated-dom',op.dispatchState);
    }
    const tab=await r.tab(op,a.tabRef),frame=await r.frame(op,tab,w.frameRef);
    let data;try{data=(await r.page(op,tab,frame,'events',{action:a.action,watchId:w.ref,cursor:a.cursor??0},a.action==='unsubscribe')).data;}
    catch(e){if(a.action==='unsubscribe'){await r.expireWatch(w);if(w.cleanupUnconfirmed)throw new BrowserError('MONITOR_CLEANUP_UNCONFIRMED','Event listener cleanup was not confirmed',{dispatchState:'unknown',details:{watchRef:w.ref}});}throw e;}
    if(a.action==='unsubscribe'){w.ended=true;w.endedAt=r.now();}
    return observation({...data,watchRef:w.ref},'isolated-dom',op.dispatchState);
  },
  async browser_wait_new_tab(op,a){
    if(a.action==='arm'){
      const baseline=await r.enumeration(op);if(!baseline.complete)throw new BrowserError('LIMIT_EXCEEDED','A complete baseline is required');
      const w=r.makeWatch(op,'new-tab',{baseline:new Set(baseline.ids),url:url(a.url)},a.ttlMs??30000);
      return observation({action:'arm',watchRef:w.ref,ttlMs:w.ttlMs,correlation:'baseline-and-exact-url-no-opener'});
    }
    const w=r.watch(op,a.watchRef,'new-tab');
    if(a.action==='cancel'){w.ended=true;w.endedAt=r.now();return observation({action:'cancel',watchRef:w.ref,cancelled:true});}
    while(true){
      if(w.expired||r.now()>=w.expiresAt)throw new BrowserError('WATCH_EXPIRED');if(w.ended||w.cancelRequested)throw new BrowserError('WATCH_CANCELLED');
      const current=await r.enumeration(op);if(!current.complete)throw new BrowserError('LIMIT_EXCEEDED','Cannot correlate a truncated tab enumeration');
      if(w.expired||r.now()>=w.expiresAt)throw new BrowserError('WATCH_EXPIRED');if(w.ended||w.cancelRequested)throw new BrowserError('WATCH_CANCELLED');
      const matches=[];
      for(const id of current.ids.filter(id=>!w.baseline.has(id))){try{const t=await r.adopt(op,id);if(t.url===w.url)matches.push(t);}catch(e){if(!['UNSUPPORTED_CAPABILITY','BACKEND_FAILURE'].includes(e.code))throw e;}}
      if(w.expired||r.now()>=w.expiresAt)throw new BrowserError('WATCH_EXPIRED');if(w.ended||w.cancelRequested)throw new BrowserError('WATCH_CANCELLED');
      if(matches.length>1)throw new BrowserError('AMBIGUOUS_TARGET','Multiple new tabs match the exact URL');
      if(matches.length===1){w.ended=true;w.endedAt=r.now();return observation({action:'wait',watchRef:w.ref,tab:r.tabData(matches[0]),correlation:'baseline-and-exact-url-no-opener'});}
      await r.sleep(op,100);
    }
  },
  async browser_cookies(op,a){
    const {tab,frame}=await r.scope(op,a);if(a.action!=='list')r.assertWrite(op,tab);
    const data=(await r.page(op,tab,frame,'cookies',{action:a.action,name:a.name,value:a.value,path:a.path,sameSite:a.sameSite,secure:a.secure,maxAge:a.maxAge},a.action!=='list')).data;
    if(a.action==='set'&&!data.valueMatch||a.action==='delete'&&!data.deleted)throw new BrowserError('POSTCONDITION_FAILED','Visible cookie state did not match',{dispatchState:'acknowledged',recovery:'observe-do-not-retry'});
    return {data,evidence:{kind:'dom-readback',backend:'isolated-dom',dispatchState:a.action==='list'?'notSent':'acknowledged',outcome:a.action==='list'?'observed':'verified',verified:true,
      limitations:['Current origin/path visible cookies only; HttpOnly cookies and profile restore unavailable.']}};
  },
  async browser_window(op,a){
    const tab=await r.tab(op,a.tabRef),data={action:a.action,windowRef:r.tabData(tab).windowRef,tabRef:tab.ref};
    if(a.action==='get'){const active=await r.native('GetActiveTabId',{windowId:tab.windowId},op);return observation({...data,active:Number(active.tabId)===tab.nativeId},'uipath');}
    if(a.action==='activate'){await r.handlers.browser_tab_activate(op,a);return {data:{...data,active:true,acknowledged:true},evidence:{kind:'native-ack',backend:'uipath',dispatchState:'acknowledged',outcome:'verified',verified:true}};}
    r.assertWrite(op,tab);await r.native('MaximizeWindow',{windowId:tab.windowId},op,{write:true});
    return {data:{...data,acknowledged:true},evidence:{kind:'native-ack',backend:'uipath',dispatchState:'acknowledged',outcome:'acknowledged',verified:false}};
  },
  async browser_image_artifact(op,a){
    if(a.action==='save')return observation(await r.artifacts.save(op.client.id,op.ctx.ref,a.artifactRef,a.name),'artifact');
    const data=await r.artifacts.inspect(op.client.id,op.ctx.ref,a.artifactRef);
    if(a.action==='read'){await r.artifacts.image(op.client.id,op.ctx.ref,a.artifactRef);data.imageAvailable=true;}
    return observation(data,'artifact');
  }
};}
