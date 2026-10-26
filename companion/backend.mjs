import {createIndexedDbStorage} from './storage.mjs';
import {COMPANION_ERRORS,COMPANION_EXTENSION_ID,COMPANION_HOST_NAME,COMPANION_KEY_CODES,COMPANION_MODIFIERS,COMPANION_PROTOCOL,companionErrorReply,validateCompanionRequest,validDownloadUrl,validFilename} from './protocol.mjs';

const UIPATH_EXTENSION_ID='jfcmnbofjlffnejneillkgbniiidiigd';
const noncePattern=/^[A-Za-z0-9_-]{43}$/;
const ref=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
const pageOrigin=value=>{
  if(typeof value!=='string')return null;
  try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.origin===value?url.origin:null;}
  catch{return null;}
};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));
const resultError=(code,message=code)=>Object.assign(new Error(message),{code});
const stateful=new Set(['debugger.acquire','debugger.release','keys.dispatch','dialog.arm','dialog.trigger','dialog.respond','dialog.cancel','file.arm','file.trigger','file.provide','file.release','file.cancel','download.start','download.cancel','ax.audit.start','ax.audit.cancel']);
const roleValues=new Set(['alert','button','checkbox','combobox','dialog','grid','gridcell','heading','img','link','list','listbox','listitem','menu','menuitem','option','progressbar','radio','row','scrollbar','searchbox','slider','spinbutton','status','switch','tab','table','textbox','toolbar','tooltip','treeitem']);
const makeToken=(prefix,randomBytes)=>`${prefix}_${Array.from(randomBytes(16),b=>b.toString(16).padStart(2,'0')).join('')}`;
const asInt=(value,fallback=0)=>Number.isSafeInteger(value)&&value>=0?value:fallback;
const modifierBits=mods=>mods.reduce((bits,m)=>bits|COMPANION_MODIFIERS[m].bit,0);
const basename=path=>String(path??'').split(/[\\/]/).at(-1)?.slice(0,128)??'';

export function createCompanionBackend({chromeApi=globalThis.chrome,storage,now=Date.now,randomBytes=size=>crypto.getRandomValues(new Uint8Array(size)),axeSource=null}={}){
  if(!chromeApi||typeof now!=='function'||typeof randomBytes!=='function')throw new TypeError('Chrome APIs, clock, and nonce source are required');
  const store=storage??createIndexedDbStorage();
  const pairs=new Map(),targetsByTab=new Map(),leases=new Map(),dialogs=new Map(),dialogWatchByPair=new Map(),files=new Map(),fileWatchByPair=new Map();
  const downloadsById=new Map(),candidateNodes=new Map(),audits=new Map(),runningAuditByPair=new Map();
  const waiters=new Set(),seenRequests=new Map(),queues=new Map(),listeners=[];
  let profileSessionRef=null,companionEpoch=null,connectionEpoch=null,sequence=0,port=null,started=false,disposed=false;
  const eventSequence=()=>++sequence;
  const add=(api,listener)=>{api?.addListener?.(listener);listeners.push(()=>api?.removeListener?.(listener));};
  const currentSession=(request)=>request.profileSessionRef===profileSessionRef&&request.connectionEpoch===connectionEpoch;
  const postHost=message=>{try{port?.postMessage(message);}catch{}};
  const emit=(kind,target,leaseRef,payload)=>{
    const event={protocol:COMPANION_PROTOCOL,connectionEpoch:connectionEpoch??0,eventId:makeToken('evt',randomBytes),leaseRef:leaseRef??null,
      tabRef:target?.tabRef??null,kind,sequence:eventSequence(),payload};
    postHost({type:'event',profileSessionRef,companionEpoch,event});
    for(const waiter of [...waiters])if(waiter.matches(event)){waiters.delete(waiter);waiter.finish(null,event);}
    return event;
  };
  const sendReply=(request,reply)=>postHost({type:'reply',profileSessionRef,companionEpoch,reply});
  const chromeCall=async(operation,...args)=>{
    const fn=operation.split('.').reduce((obj,key)=>obj?.[key],chromeApi);
    if(typeof fn!=='function')throw resultError('BACKEND_UNAVAILABLE');
    try{return await fn.apply(operation.startsWith('runtime.')?chromeApi.runtime:chromeApi[operation.split('.')[0]],args);}
    catch(error){
      const message=String(error?.message??'').toLowerCase();
      if(message.includes('another debugger')||message.includes('debugger is already attached')||message.includes('cannot attach'))throw resultError('BACKEND_BUSY');
      if(message.includes('permission')||message.includes('not allowed'))throw resultError('POLICY_RESTRICTED');
      if(message.includes('no tab')||message.includes('tab not found'))throw resultError('STALE_TAB');
      throw resultError('BACKEND_UNAVAILABLE');
    }
  };
  const deadlineCheck=request=>{if(now()>=request.deadline)throw resultError('TIMEOUT');};
  const boundedCommand=async(request,target,method,params={})=>{
    deadlineCheck(request);
    if(typeof method!=='string'||!['Input.dispatchKeyEvent','Page.setInterceptFileChooserDialog','Page.handleJavaScriptDialog','DOM.getDocument','DOM.describeNode','DOM.setFileInputFiles','Page.getFrameTree','Page.createIsolatedWorld','Runtime.evaluate','Accessibility.queryAXTree','Accessibility.getFullAXTree'].includes(method))
      throw resultError('INVALID_REQUEST');
    const remaining=request.deadline-now();
    let timer;
    try{
      return await Promise.race([
        chromeCall('debugger.sendCommand',{tabId:target.tabId},method,params),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(resultError('TIMEOUT')),Math.max(1,remaining));})
      ]);
    }finally{clearTimeout(timer);}
  };
  const resolvePair=(request,{allowOldDocument=false}={})=>{
    const pair=pairs.get(request.pairRef);
    if(!pair||pair.profileSessionRef!==profileSessionRef||pair.companionEpoch!==companionEpoch)throw resultError('STALE_PROFILE');
    if(!allowOldDocument&&pair.connectionEpoch!==connectionEpoch)throw resultError('STALE_PROFILE');
    return pair;
  };
  const leaseFor=(request)=>{
    const lease=leases.get(request.leaseRef);
    if(!lease||lease.profileSessionRef!==profileSessionRef||lease.companionEpoch!==companionEpoch||lease.pairRef!==request.pairRef||
      lease.ownerRef!==request.payload.ownerRef||lease.contextRef!==(request.payload.contextRef??lease.contextRef)||now()>=lease.expiresAt){
      if(lease&&now()>=lease.expiresAt)void releaseLease(lease,'timeout');
      throw resultError('STALE_PROFILE');
    }
    return lease;
  };
  const targetForPair=pair=>{
    let target=targetsByTab.get(pair.tabId);
    if(!target){target={tabId:pair.tabId,pairRef:pair.pairRef,leases:new Set(),attached:false,quarantined:false,activeDialog:null,activeFile:null};targetsByTab.set(pair.tabId,target);}
    if(target.pairRef!==pair.pairRef)throw resultError('BACKEND_BUSY');
    return target;
  };
  const command=async(target,method,params={},deadline=now()+2000)=>{
    const fakeRequest={deadline};return boundedCommand(fakeRequest,target,method,params);
  };
  const disarmFile=async(watch,reason)=>{
    if(!watch||watch.ended)return;
    watch.ended=true;clearTimeout(watch.timer);fileWatchByPair.delete(watch.pairRef);
    const pair=pairs.get(watch.pairRef),target=pair&&targetsByTab.get(pair.tabId);
    if(target?.attached){try{await command(target,'Page.setInterceptFileChooserDialog',{enabled:false});}catch{watch.cleanupState='unknown';}}
    watch.state=reason==='cancel'?'cancelled':'expired';watch.cleanupState??='released';
    if(watch.pickerRef){const file=files.get(watch.pickerRef);if(file&&reason!=='provide')files.delete(watch.pickerRef);}
  };
  const answerDialog=async(dialog,accept,promptText,deadline)=>{
    if(dialog.responseSent)throw resultError('UNKNOWN_OUTCOME');
    dialog.responseSent=true;
    try{
      await command(dialog.target,'Page.handleJavaScriptDialog',{accept,...(dialog.type==='prompt'?{promptText:promptText??''}:{})},deadline);
      dialog.state='responded';dialog.cleanupState='released';if(dialog.target.activeDialog===dialog.dialogRef)dialog.target.activeDialog=null;
      emit('dialog.closed',dialog.target,dialog.leaseRef,{ownerRef:dialog.ownerRef,contextRef:dialog.contextRef,dialogWatchRef:dialog.dialogWatchRef,dialogRef:dialog.dialogRef,dispatchState:'acknowledged',cleanupState:'released'});
      return {dialogRef:dialog.dialogRef,state:'responded',dispatchState:'acknowledged',cleanupState:'released'};
    }catch{dialog.state='unknown';dialog.cleanupState='unknown';throw resultError('UNKNOWN_OUTCOME');}
  };
  const expireDialog=async(watch)=>{
    if(!watch||watch.ended)return;watch.ended=true;dialogWatchByPair.delete(watch.pairRef);
    if(watch.dialogRef){
      const dialog=dialogs.get(watch.dialogRef);
      if(watch.expiryPolicy==='dismiss'&&dialog&&!dialog.responseSent){try{await answerDialog(dialog,false,'',now()+2000);watch.state='dismissed-by-policy';}catch{watch.state='unknown';}}
      else{watch.state='expired-open';if(dialog)dialog.state='expired-open';}
    }else watch.state='expired-no-dialog';
    watch.cleanupState??='released';
    resolveWatchWaiters('dialog',watch);
  };
  const releaseLease=async(lease,reason='release')=>{
    if(!lease||lease.released)return {released:false,cleanupState:'released'};
    lease.released=true;clearTimeout(lease.timer);leases.delete(lease.leaseRef);
    const target=targetsByTab.get(lease.tabId);target?.leases.delete(lease.leaseRef);
    if(target?.leases.size){return {released:true,cleanupState:'released'};}
    if(target?.activeFile){const file=target.activeFile;await disarmFile(file,file.releasePolicy==='cancel'?'cancel':reason);target.activeFile=null;}
    if(target?.activeDialog){
      const dialog=dialogs.get(target.activeDialog);
      if(dialog?.releasePolicy==='dismiss'&&!dialog.responseSent){try{await answerDialog(dialog,false,'',now()+2000);}catch{dialog.cleanupState='unknown';}}
    }
    if(target?.attached){
      try{await chromeCall('debugger.detach',{tabId:target.tabId});target.attached=false;}
      catch{target.quarantined=true;return {released:false,cleanupState:'unknown'};}
    }
    if(targetsByTab.get(lease.tabId)===target)targetsByTab.delete(lease.tabId);
    return {released:true,cleanupState:target?.quarantined?'unknown':'released'};
  };
  const cleanupPair=async(pairRef,reason='navigation')=>{
    const pair=pairs.get(pairRef);if(!pair)return;
    const target=targetsByTab.get(pair.tabId);
    const dialogWatch=dialogWatchByPair.get(pairRef);if(dialogWatch){clearTimeout(dialogWatch.timer);dialogWatch.ended=true;dialogWatch.state='cancelled';dialogWatchByPair.delete(pairRef);}
    const fileWatch=fileWatchByPair.get(pairRef);if(fileWatch)await disarmFile(fileWatch,fileWatch.releasePolicy==='cancel'?'cancel':reason);
    if(target){
      for(const ref of [...target.leases]){const lease=leases.get(ref);if(lease)await releaseLease(lease,reason);}
      if(target.attached){try{await chromeCall('debugger.detach',{tabId:target.tabId});target.attached=false;}catch{target.quarantined=true;}}
    }
    pairs.delete(pairRef);for(const [candidateRef,candidate] of candidateNodes)if(candidate.pairRef===pairRef)candidateNodes.delete(candidateRef);
    for(const [auditRef,audit] of audits)if(audit.pairRef===pairRef){audit.documentGone=true;audits.delete(auditRef);runningAuditByPair.delete(pairRef);}
  };
  const updateDialogEvent=async(source,method,params)=>{
    const target=targetsByTab.get(source?.tabId);if(!target)return;
    if(method==='Page.javascriptDialogClosed'){
      const dialog=target.activeDialog&&dialogs.get(target.activeDialog);if(!dialog)return;
      dialog.state='responded';dialog.cleanupState='released';target.activeDialog=null;
      emit('dialog.closed',target,dialog.leaseRef,{ownerRef:dialog.ownerRef,contextRef:dialog.contextRef,dialogWatchRef:dialog.dialogWatchRef,dialogRef:dialog.dialogRef,dispatchState:'acknowledged',cleanupState:'released'});
      resolveWatchWaiters('dialog',dialog.watch);return;
    }
    if(method!=='Page.javascriptDialogOpening')return;
    const watch=dialogWatchByPair.get(target.pairRef);if(!watch||watch.ended)return;
    const mismatch=!watch.triggered||params.type!==watch.expectedType||watch.expectedMessage!==undefined&&params.message!==watch.expectedMessage;
    if(mismatch&&watch.mismatchPolicy==='dismiss'){
      try{await command(target,'Page.handleJavaScriptDialog',{accept:false},now()+2000);watch.state='dismissed-by-policy';watch.cleanupState='released';}
      catch{watch.state='unknown';watch.cleanupState='unknown';}
      watch.ended=true;dialogWatchByPair.delete(target.pairRef);resolveWatchWaiters('dialog',watch);return;
    }
    const dialogRef=makeToken('dlg',randomBytes),dialog={dialogRef,dialogWatchRef:watch.dialogWatchRef,ownerRef:watch.ownerRef,contextRef:watch.contextRef,
      pairRef:watch.pairRef,leaseRef:watch.leaseRef,target,type:params.type,message:String(params.message??'').slice(0,1024),releasePolicy:watch.releasePolicy,
      state:mismatch?'open-mismatch':'open-manual',responseSent:false,watch};
    dialogs.set(dialogRef,dialog);target.activeDialog=dialogRef;watch.dialogRef=dialogRef;watch.state=dialog.state;
    if(!mismatch&&watch.mode==='auto'){
      try{await answerDialog(dialog,watch.autoResponse.accept,watch.autoResponse.promptText,now()+2000);watch.state='responded';}
      catch{watch.state='unknown';}
    }else emit('dialog.opened',target,watch.leaseRef,{ownerRef:watch.ownerRef,contextRef:watch.contextRef,dialogWatchRef:watch.dialogWatchRef,
      dialogRef,type:dialog.type,message:dialog.message,state:dialog.state,handledBy:mismatch?'mismatch-policy':'manual'});
    resolveWatchWaiters('dialog',watch);
  };
  const updateFileEvent=async(source,method,params)=>{
    if(method!=='Page.fileChooserOpened')return;
    const target=targetsByTab.get(source?.tabId);if(!target)return;
    const watch=fileWatchByPair.get(target.pairRef);if(!watch||watch.ended)return;
    if(!watch.triggered){watch.state='unexpected-before-trigger';watch.error='TARGET_UNSUPPORTED';resolveWatchWaiters('file',watch);return;}
    try{
      const detail=await command(target,'DOM.describeNode',{backendNodeId:params.backendNodeId,depth:1},now()+2000);
      const node=detail?.node,attrs=Array.isArray(node?.attributes)?node.attributes:[];
      const values=new Map();for(let i=0;i+1<attrs.length;i+=2)values.set(String(attrs[i]).toLowerCase(),String(attrs[i+1]));
      if(!node||String(node.nodeName).toUpperCase()!=='INPUT'||String(values.get('type')??'').toLowerCase()!=='file'||!Number.isSafeInteger(params.backendNodeId))
        throw resultError('TARGET_UNSUPPORTED');
      const pickerRef=makeToken('pick',randomBytes),mode=params.mode==='selectMultiple'?'selectMultiple':'selectSingle';
      watch.pickerRef=pickerRef;watch.backendNodeId=params.backendNodeId;watch.frameId=params.frameId;watch.mode=mode;watch.state='open';
      files.set(pickerRef,{pickerRef,watch,backendNodeId:params.backendNodeId,frameId:params.frameId,mode});target.activeFile=watch;
      emit('file.opened',target,watch.leaseRef,{ownerRef:watch.ownerRef,contextRef:watch.contextRef,pickerWatchRef:watch.pickerWatchRef,pickerRef,mode});
    }catch(error){watch.state='unsupported';watch.error=error?.code==='TARGET_UNSUPPORTED'?'TARGET_UNSUPPORTED':'BACKEND_UNAVAILABLE';}
    resolveWatchWaiters('file',watch);
  };
  const onDebuggerEvent=(source,method,params)=>{
    void updateDialogEvent(source,method,params??{}).catch(()=>{});
    void updateFileEvent(source,method,params??{}).catch(()=>{});
  };
  const onDebuggerDetach=(source,reason)=>{
    const target=targetsByTab.get(source?.tabId);if(!target)return;
    target.attached=false;target.quarantined=true;
    for(const leaseRef of [...target.leases]){const lease=leases.get(leaseRef);if(lease){clearTimeout(lease.timer);leases.delete(leaseRef);}}
    target.leases.clear();
    emit('debugger.detached',target,null,{reason:String(reason??'detached').slice(0,64)});
  };
  const normalizeDownload=(record,item)=>{
    const state=record.cancelRequested&&item.state==='interrupted'?'cancelled':item.state==='complete'?'complete':item.state==='interrupted'?'interrupted':'in_progress';
    record.state=state;record.fileName=basename(item.filename)||record.fileName;record.bytesReceived=asInt(item.bytesReceived);
    record.totalBytes=Number.isSafeInteger(item.totalBytes)&&item.totalBytes>=0?item.totalBytes:null;
    if(['complete','interrupted','cancelled'].includes(state))record.completedAt=record.completedAt??(item.endTime??new Date(now()).toISOString());
    return record;
  };
  const publishDownload=async record=>{
    const target=null;
    emit('download.changed',target,null,{ownerRef:record.ownerRef,downloadRef:record.downloadRef,state:record.state,fileName:record.fileName,
      bytesReceived:record.bytesReceived,totalBytes:record.totalBytes,completedAt:record.completedAt});
  };
  const onDownloadChanged=delta=>{
    if(!delta||!Number.isSafeInteger(delta.id))return;
    void (async()=>{
      const records=await store.values('download:');
      for(const record of records){
        if(record.downloadId!==delta.id)continue;
        const query=await chromeCall('downloads.search',{id:delta.id}),item=query?.[0];if(!item)continue;
        normalizeDownload(record,item);await store.set(`download:${record.downloadRef}`,record);downloadsById.set(record.downloadId,record);await publishDownload(record);
      }
    })().catch(()=>{});
  };
  const resolveWatchWaiters=(kind,watch)=>{
    for(const waiter of [...waiters])if(waiter.kind===kind&&waiter.ref===(kind==='dialog'?watch.dialogWatchRef:watch.pickerWatchRef)&&waiter.ownerRef===watch.ownerRef&&waiter.contextRef===watch.contextRef){
      waiters.delete(waiter);waiter.finish(watch.error?resultError(watch.error):null,watch);
    }
  };
  const waitForWatch=(kind,watch,request)=>{
    const terminal=['open','open-manual','open-mismatch','responded','dismissed-by-policy','cancelled','expired-no-dialog','expired-open','unexpected-before-trigger','unsupported','provided','released'].includes(watch.state);
    if(terminal)return Promise.resolve(watch.error?Promise.reject(resultError(watch.error)):watch);
    deadlineCheck(request);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{waiters.delete(entry);reject(resultError('TIMEOUT'));},Math.max(1,request.deadline-now()));
      const entry={kind,ownerRef:request.payload.ownerRef,contextRef:request.payload.contextRef,
        ref:kind==='dialog'?request.payload.dialogWatchRef:request.payload.pickerWatchRef,
        matches:event=>event.kind===(kind==='dialog'?'dialog.opened':'file.opened')&&event.payload?.[kind==='dialog'?'dialogWatchRef':'pickerWatchRef']===entry.ref,
        finish:(error,value)=>{clearTimeout(timer);error?reject(error):resolve(value);}};
      waiters.add(entry);
    });
  };
  const withPairQueue=(pairRef,fn)=>{
    const prior=queues.get(pairRef)??Promise.resolve(),job=prior.then(fn);queues.set(pairRef,job.catch(()=>{}));return job;
  };
  const ensureNoModal=target=>{if(target.activeDialog)throw resultError('BACKEND_BUSY');};
  const getDownload=async(request)=>{
    const {ownerRef,downloadRef}=request.payload;let record=await store.get(`download:${downloadRef}`);
    if(!record||record.ownerRef!==ownerRef||record.profileSessionRef!==profileSessionRef)throw resultError('STALE_PROFILE');
    const hits=await chromeCall('downloads.search',{id:record.downloadId}),item=hits?.[0];if(!item)throw resultError('STALE_PROFILE');
    if(record.companionEpoch!==companionEpoch){record.companionEpoch=companionEpoch;record.connectionEpoch=connectionEpoch;}
    normalizeDownload(record,item);await store.set(`download:${downloadRef}`,record);downloadsById.set(record.downloadId,record);return {record,item};
  };
  const dispatchKeys=async(request,lease,target)=>{
    ensureNoModal(target);if(target.quarantined)throw resultError('BACKEND_BUSY');const held=[],released=[];
    const removeHeld=item=>{const index=held.indexOf(item);if(index>=0)held.splice(index,1);};
    const releaseHeld=async()=>{
      for(let i=held.length-1;i>=0;i--){
        const item=held[i];try{
          const bits=modifierBits(held.filter(x=>x.kind==='modifier'&&x!==item).map(x=>x.name));
          await command(target,'Input.dispatchKeyEvent',{type:'keyUp',key:item.spec.key,code:item.spec.code,windowsVirtualKeyCode:item.spec.virtualKeyCode,modifiers:bits},now()+2000);
          released.push(item.name);removeHeld(item);
        }catch{target.quarantined=true;}
      }
    };
    let sentCount=0,primary;
    try{
      for(const step of request.payload.keys){deadlineCheck(request);
        const activeMods=[];
        for(const name of step.modifiers??[]){
          const spec=COMPANION_MODIFIERS[name];if(!held.some(x=>x.kind==='modifier'&&x.name===name)){
            const bits=modifierBits([...held.filter(x=>x.kind==='modifier').map(x=>x.name),name]);
            deadlineCheck(request);const item={kind:'modifier',name,spec};held.push(item);
            await boundedCommand(request,target,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:spec.key,code:spec.code,windowsVirtualKeyCode:spec.virtualKeyCode,modifiers:bits});
          }activeMods.push(name);
        }
        const key=COMPANION_KEY_CODES[step.key],bits=modifierBits(activeMods);
        try{
          deadlineCheck(request);const keyItem={kind:'key',name:step.key,spec:key};held.push(keyItem);
          await boundedCommand(request,target,'Input.dispatchKeyEvent',{type:'rawKeyDown',key:key.key,code:key.code,windowsVirtualKeyCode:key.virtualKeyCode,modifiers:bits});
          sentCount++;
          await boundedCommand(request,target,'Input.dispatchKeyEvent',{type:'keyUp',key:key.key,code:key.code,windowsVirtualKeyCode:key.virtualKeyCode,modifiers:bits});
          removeHeld(keyItem);released.push(step.key);
        }finally{
          for(const name of [...activeMods].reverse()){
            const index=held.findIndex(x=>x.kind==='modifier'&&x.name===name);if(index<0)continue;
            const item=held[index],before=modifierBits(held.filter(x=>x.kind==='modifier').map(x=>x.name));
            try{await boundedCommand(request,target,'Input.dispatchKeyEvent',{type:'keyUp',key:item.spec.key,code:item.spec.code,windowsVirtualKeyCode:item.spec.virtualKeyCode,modifiers:before&~COMPANION_MODIFIERS[name].bit});removeHeld(item);released.push(name);}
            catch{if(!primary)primary=resultError('UNKNOWN_OUTCOME');}
          }
        }
        if(held.length)await releaseHeld();
        if(primary)throw primary;
        if(held.length||target.quarantined)throw resultError('UNKNOWN_OUTCOME');
      }
    }catch(error){primary=error;}
    if(held.length)await releaseHeld();
    if(held.length||target.quarantined)throw resultError('UNKNOWN_OUTCOME');
    if(primary){if(held.length||target.quarantined)throw resultError('UNKNOWN_OUTCOME');throw primary;}
    return {inputMethod:'cdp-key-events',dispatchState:'acknowledged',sentCount,releasedKeys:released,verified:false};
  };
  const startDialogWatch=async(request,pair,lease,target)=>{
    if(dialogWatchByPair.has(pair.pairRef)||target.activeDialog)throw resultError('BACKEND_BUSY');
    const p=request.payload,watch={dialogWatchRef:makeToken('dlgwatch',randomBytes),ownerRef:p.ownerRef,contextRef:p.contextRef,pairRef:pair.pairRef,leaseRef:lease.leaseRef,
      documentToken:p.documentToken,generation:p.generation,triggerRequestKey:p.triggerRequestKey,mode:p.mode,expectedType:p.expectedType,expectedMessage:p.expectedMessage,
      autoResponse:p.autoResponse,mismatchPolicy:p.mismatchPolicy,expiryPolicy:p.expiryPolicy,releasePolicy:p.releasePolicy,expiresAt:now()+p.ttlMs,triggered:false,state:'armed',ended:false};
    watch.timer=setTimeout(()=>void expireDialog(watch),p.ttlMs);dialogWatchByPair.set(pair.pairRef,watch);return {dialogWatchRef:watch.dialogWatchRef,state:'armed',expiresAt:new Date(watch.expiresAt).toISOString()};
  };
  const triggerDialog=async(request,pair)=>{
    const p=request.payload,w=dialogWatchByPair.get(pair.pairRef);
    if(!w||w.dialogWatchRef!==p.dialogWatchRef||w.ownerRef!==p.ownerRef||w.contextRef!==p.contextRef||w.triggerRequestKey!==p.triggerRequestKey||w.ended||now()>=w.expiresAt)
      throw resultError('STALE_DOCUMENT');
    w.triggered=true;return {dialogWatchRef:w.dialogWatchRef,triggered:true};
  };
  const startFileWatch=async(request,pair,lease,target)=>{
    if(fileWatchByPair.has(pair.pairRef)||target.activeFile)throw resultError('BACKEND_BUSY');
    const p=request.payload,watch={pickerWatchRef:makeToken('pickwatch',randomBytes),ownerRef:p.ownerRef,contextRef:p.contextRef,pairRef:pair.pairRef,leaseRef:lease.leaseRef,
      documentToken:p.documentToken,generation:p.generation,triggerRequestKey:p.triggerRequestKey,releasePolicy:p.releasePolicy,expiresAt:now()+p.ttlMs,
      triggered:false,state:'armed',ended:false};
    try{await boundedCommand(request,target,'Page.setInterceptFileChooserDialog',{enabled:true});}
    catch(error){throw error?.code==='TIMEOUT'?resultError('UNKNOWN_OUTCOME'):error;}
    watch.timer=setTimeout(()=>void disarmFile(watch,watch.releasePolicy==='cancel'?'cancel':'timeout'),p.ttlMs);
    fileWatchByPair.set(pair.pairRef,watch);return {pickerWatchRef:watch.pickerWatchRef,state:'armed',expiresAt:new Date(watch.expiresAt).toISOString()};
  };
  const triggerFile=async(request,pair)=>{
    const p=request.payload,w=fileWatchByPair.get(pair.pairRef);
    if(!w||w.pickerWatchRef!==p.pickerWatchRef||w.ownerRef!==p.ownerRef||w.contextRef!==p.contextRef||w.triggerRequestKey!==p.triggerRequestKey||w.ended||now()>=w.expiresAt)
      throw resultError('STALE_DOCUMENT');
    w.triggered=true;return {pickerWatchRef:w.pickerWatchRef,triggered:true};
  };
  const runAudit=async(request,pair,lease,target)=>{
    if(!axeSource||typeof axeSource!=='string'||axeSource.length<1000)throw resultError('BACKEND_UNAVAILABLE');
    const priorRef=runningAuditByPair.get(pair.pairRef),priorAudit=priorRef&&audits.get(priorRef);
    if(priorAudit){
      let ticket;try{ticket=await readAuditTicket(request,priorAudit,target);}catch{throw resultError('BACKEND_BUSY');}
      if(ticket?.computationSettled){runningAuditByPair.delete(pair.pairRef);priorAudit.settledAt=now();}
      else throw resultError('BACKEND_BUSY');
    }
    if(runningAuditByPair.has(pair.pairRef))throw resultError('BACKEND_BUSY');
    const p=request.payload,auditRef=makeToken('audit',randomBytes),frameTree=await boundedCommand(request,target,'Page.getFrameTree',{}),frameId=frameTree?.frameTree?.frame?.id;
    if(typeof frameId!=='string')throw resultError('STALE_DOCUMENT');
    const world=await boundedCommand(request,target,'Page.createIsolatedWorld',{frameId,worldName:'uipath-axe-v1',grantUniveralAccess:false});
    const contextId=world?.executionContextId;if(!Number.isSafeInteger(contextId))throw resultError('BACKEND_UNAVAILABLE');
    const tags=p.standard==='WCAG21AA'?['wcag2a','wcag2aa','wcag21a','wcag21aa']:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
    const id=JSON.stringify(auditRef),selected=JSON.stringify(tags),include=Boolean(p.includeIncomplete),limit=p.limit;
    const bootstrap=`${axeSource}\n;globalThis.__uipathAxeTickets??=Object.create(null);globalThis.__uipathAxeTickets[${id}]={state:'running',cancelled:false,computationSettled:false};globalThis.__uipathAxeTickets[${id}].promise=axe.run(document,{runOnly:{type:'tag',values:${selected}}}).then(r=>{const t=globalThis.__uipathAxeTickets[${id}];if(!t||t.cancelled)return;const safeText=x=>String(x??'').slice(0,1024);const safeNodes=xs=>(xs||[]).slice(0,100).map(n=>({targetPath:(n.target||[]).filter(x=>typeof x==='string').slice(0,16).map(x=>x.slice(0,256)),htmlExcerpt:safeText(n.html).slice(0,256),failureSummary:n.failureSummary?safeText(n.failureSummary).slice(0,1024):null}));const violations=(r.violations||[]).slice(0,${limit}).map(v=>({id:safeText(v.id).slice(0,128),impact:v.impact||null,description:safeText(v.description),help:safeText(v.help),helpUrl:safeText(v.helpUrl).slice(0,2048),tags:(v.tags||[]).slice(0,32).map(x=>safeText(x).slice(0,64)),nodes:safeNodes(v.nodes)}));const incomplete=${include}?(r.incomplete||[]).slice(0,${limit}).map(v=>({id:safeText(v.id).slice(0,128),targetPath:(v.nodes?.[0]?.target||[]).slice(0,16).map(x=>String(x).slice(0,256)),reason:safeText(v.nodes?.[0]?.failureSummary||'incomplete').slice(0,1024)})):[];t.result={engine:'axe-core',engineVersion:'4.14.0',standard:${JSON.stringify(p.standard)},summary:{violations:(r.violations||[]).length,incomplete:(r.incomplete||[]).length,passes:(r.passes||[]).length},violations,incomplete,truncated:(r.violations||[]).length>${limit}||${include}&&(r.incomplete||[]).length>${limit}};t.state='complete';}).catch(()=>{const t=globalThis.__uipathAxeTickets[${id}];if(t&&!t.cancelled)t.state='failed';}).finally(()=>{const t=globalThis.__uipathAxeTickets[${id}];if(t)t.computationSettled=true;});`;
    await boundedCommand(request,target,'Runtime.evaluate',{contextId,expression:bootstrap,awaitPromise:false,returnByValue:true});
    const audit={auditRef,pairRef:pair.pairRef,leaseRef:lease.leaseRef,ownerRef:p.ownerRef,contextRef:p.contextRef,contextId,documentToken:p.documentToken,generation:p.generation,
      standard:p.standard,includeIncomplete:p.includeIncomplete,state:'running',cancelled:false,startedAt:now()};
    audits.set(auditRef,audit);runningAuditByPair.set(pair.pairRef,auditRef);
    return {auditRef,state:'running',expiresAt:new Date(now()+30000).toISOString()};
  };
  const readAuditTicket=async(request,audit,target)=>{
    const expression=`(()=>{const t=globalThis.__uipathAxeTickets?.[${JSON.stringify(audit.auditRef)}];return t?{state:t.state,computationSettled:Boolean(t.computationSettled),result:t.result??null}:null})()`;
    const result=await boundedCommand(request,target,'Runtime.evaluate',{contextId:audit.contextId,expression,returnByValue:true,awaitPromise:false});
    return result?.result?.value??null;
  };
  const auditStatus=async(request,pair,lease,target)=>{
    const p=request.payload,audit=audits.get(p.auditRef);
    if(!audit||audit.ownerRef!==p.ownerRef||audit.contextRef!==p.contextRef||audit.pairRef!==pair.pairRef)throw resultError('STALE_DOCUMENT');
    if(audit.state==='complete')return {auditRef:audit.auditRef,state:'complete',result:audit.result};
    const ticket=await readAuditTicket(request,audit,target);
    if(audit.cancelled){if(ticket?.computationSettled){audit.state='cancelled-settled';if(runningAuditByPair.get(pair.pairRef)===audit.auditRef)runningAuditByPair.delete(pair.pairRef);return {auditRef:audit.auditRef,state:'cancelled',cleanupState:'settled'};}
      return {auditRef:audit.auditRef,state:'cancelled',cleanupState:'computation-pending'};}
    if(now()-audit.startedAt>10_000){audit.state='unknown';if(ticket?.computationSettled&&runningAuditByPair.get(pair.pairRef)===audit.auditRef)runningAuditByPair.delete(pair.pairRef);return {auditRef:audit.auditRef,state:'unknown',cleanupState:ticket?.computationSettled?'settled':'ticket-retained'};}
    if(ticket?.state==='complete'&&ticket.result){audit.state='complete';audit.result=ticket.result;if(ticket.computationSettled)runningAuditByPair.delete(pair.pairRef);return {auditRef:audit.auditRef,state:'complete',result:audit.result};}
    if(ticket?.state==='failed'){audit.state='unknown';if(ticket.computationSettled)runningAuditByPair.delete(pair.pairRef);return {auditRef:audit.auditRef,state:'unknown',cleanupState:ticket.computationSettled?'settled':'computation-pending'};}
    return {auditRef:audit.auditRef,state:'running',expiresAt:new Date(audit.startedAt+30000).toISOString()};
  };
  const cancelAudit=async(request,pair)=>{
    const p=request.payload,audit=audits.get(p.auditRef);
    if(!audit||audit.ownerRef!==p.ownerRef||audit.contextRef!==p.contextRef||audit.pairRef!==pair.pairRef)throw resultError('STALE_DOCUMENT');
    audit.cancelled=true;audit.result=null;
    const expression=`(()=>{const t=globalThis.__uipathAxeTickets?.[${JSON.stringify(audit.auditRef)}];if(t)t.cancelled=true;return true})()`;
    try{await command(targetsByTab.get(pair.tabId),'Runtime.evaluate',{contextId:audit.contextId,expression,returnByValue:true,awaitPromise:false},now()+2000);}
    catch{throw resultError('UNKNOWN_OUTCOME');}
    // Keep the running lock until the page promise settles; an immediate new audit is rejected.
    audit.state='cancelled-running';return {auditRef:audit.auditRef,state:'cancelled',cleanupState:'computation-pending'};
  };
  const execute=async request=>{
    deadlineCheck(request);
    if(!currentSession(request))throw resultError('STALE_PROFILE');
    const isDownloadRead=['download.get','download.cancel'].includes(request.operation);
    let pair=null,target=null,lease=null;
    if(!isDownloadRead){pair=resolvePair(request,{allowOldDocument:request.operation==='download.start'});target=targetForPair(pair);}
    if(!['debugger.acquire','download.start','download.get','download.cancel','dialog.wait','file.wait'].includes(request.operation))lease=leaseFor(request);
    switch(request.operation){
      case 'debugger.acquire':{
        const p=request.payload,tabTarget=targetForPair(pair);
        if(tabTarget.quarantined)throw resultError('BACKEND_BUSY');
        if(!tabTarget.attached){try{await chromeCall('debugger.attach',{tabId:tabTarget.tabId},'1.3');tabTarget.attached=true;}catch(error){throw error?.code==='BACKEND_BUSY'?error:resultError('BACKEND_BUSY');}}
        const leaseRef=makeToken('lease',randomBytes),record={leaseRef,pairRef:pair.pairRef,tabId:pair.tabId,ownerRef:p.ownerRef,contextRef:p.contextRef,
          profileSessionRef,companionEpoch,documentToken:p.documentToken,generation:p.generation,expiresAt:now()+p.ttlMs,released:false};
        record.timer=setTimeout(()=>void releaseLease(record,'timeout'),p.ttlMs);leases.set(leaseRef,record);tabTarget.leases.add(leaseRef);
        return {leaseRef,expiresAt:new Date(record.expiresAt).toISOString()};
      }
      case 'debugger.release':{
        const p=request.payload,record=leases.get(request.leaseRef);if(!record||record.ownerRef!==p.ownerRef||record.contextRef!==p.contextRef)throw resultError('STALE_PROFILE');
        const result=await releaseLease(record,p.reason);if(!result.released)throw resultError('UNKNOWN_OUTCOME');return result;
      }
      case 'keys.dispatch':return withPairQueue(pair.pairRef,()=>dispatchKeys(request,lease,target));
      case 'dialog.arm':return withPairQueue(pair.pairRef,()=>startDialogWatch(request,pair,lease,target));
      case 'dialog.trigger':return triggerDialog(request,pair);
      case 'dialog.wait':{
        const p=request.payload,w=[...dialogs.values()].find(d=>d.dialogWatchRef===p.dialogWatchRef&&d.ownerRef===p.ownerRef&&d.contextRef===p.contextRef)?.watch??
          [...dialogWatchByPair.values()].find(d=>d.dialogWatchRef===p.dialogWatchRef&&d.ownerRef===p.ownerRef&&d.contextRef===p.contextRef);
        if(!w)throw resultError('STALE_DOCUMENT');const value=await waitForWatch('dialog',w,request);
        return {dialogWatchRef:w.dialogWatchRef,dialogRef:w.dialogRef??null,type:w.dialogRef?dialogs.get(w.dialogRef)?.type??null:null,
          message:w.dialogRef?dialogs.get(w.dialogRef)?.message??null:null,state:w.state,cleanupState:w.cleanupState??'retained'};
      }
      case 'dialog.respond':case 'dialog.cancel':{
        const p=request.payload,d=dialogs.get(p.dialogRef);if(!d||d.ownerRef!==p.ownerRef||d.contextRef!==p.contextRef||d.pairRef!==pair.pairRef||d.leaseRef!==lease.leaseRef)throw resultError('STALE_DOCUMENT');
        return answerDialog(d,request.operation==='dialog.respond'?p.accept:false,p.promptText,request.deadline);
      }
      case 'file.arm':return withPairQueue(pair.pairRef,()=>startFileWatch(request,pair,lease,target));
      case 'file.trigger':return triggerFile(request,pair);
      case 'file.wait':{
        const p=request.payload,w=fileWatchByPair.get(pair.pairRef);if(!w||w.pickerWatchRef!==p.pickerWatchRef||w.ownerRef!==p.ownerRef||w.contextRef!==p.contextRef)throw resultError('STALE_DOCUMENT');
        const value=await waitForWatch('file',w,request);if(w.error)throw resultError(w.error);
        return {pickerRef:w.pickerRef??null,mode:w.mode??null,state:w.state};
      }
      case 'file.provide':return withPairQueue(pair.pairRef,async()=>{
        const p=request.payload,file=files.get(p.pickerRef);if(!file||file.consumed||file.watch.ownerRef!==p.ownerRef||file.watch.contextRef!==p.contextRef||file.watch.pairRef!==pair.pairRef||file.watch.ended)throw resultError('STALE_DOCUMENT');
        if(file.mode==='selectSingle'&&p.files.length!==1)throw resultError('INVALID_REQUEST');
        file.consumed=true;files.delete(file.pickerRef);
        const data=await boundedCommand(request,target,'DOM.setFileInputFiles',{files:p.files.map(f=>f.path),backendNodeId:file.backendNodeId});
        file.watch.state='provided';file.watch.selectedCount=p.files.length;file.watch.stagedBytes=p.files.reduce((n,x)=>n+x.bytes,0);file.watch.hashes=p.files.map(x=>x.sha256);file.watch.cleanupState='retained';
        return {pickerRef:file.pickerRef,mode:file.mode,selectedCount:p.files.length,selection:'assigned',verification:'browser-acknowledged',
          stagedBytes:file.watch.stagedBytes,hashes:file.watch.hashes,expiresAt:new Date(file.watch.expiresAt).toISOString(),dispatchState:'acknowledged'};
      });
      case 'file.release':case 'file.cancel':{
        const p=request.payload,file=files.get(p.pickerRef??p.pickerWatchRef),watch=file?.watch??fileWatchByPair.get(pair.pairRef);
        if(!watch||watch.ownerRef!==p.ownerRef||watch.contextRef!==p.contextRef)throw resultError('STALE_DOCUMENT');
        await disarmFile(watch,request.operation==='file.cancel'?'cancel':'release');return {state:request.operation==='file.cancel'?'cancelled':'released',cleanupState:watch.cleanupState??'released'};
      }
      case 'download.start':{
        const p=request.payload;if(!validDownloadUrl(p.url)||p.filename!==undefined&&!validFilename(p.filename))throw resultError('INVALID_REQUEST');
        deadlineCheck(request);
        const downloadId=await chromeCall('downloads.download',{url:p.url,...(p.filename?{filename:p.filename}:{}),conflictAction:'uniquify',saveAs:false});
        if(!Number.isSafeInteger(downloadId)||downloadId<0)throw resultError('UNKNOWN_OUTCOME');
        const downloadRef=makeToken('dl',randomBytes),hits=await chromeCall('downloads.search',{id:downloadId}),item=hits?.[0]??{};
        const record={downloadRef,downloadId,ownerRef:p.ownerRef,profileSessionRef,companionEpoch,connectionEpoch,state:'in_progress',fileName:basename(item.filename)||(p.filename??null),
          bytesReceived:asInt(item.bytesReceived),totalBytes:Number.isSafeInteger(item.totalBytes)&&item.totalBytes>=0?item.totalBytes:null,completedAt:null,cancelRequested:false};
        normalizeDownload(record,item);await store.set(`download:${downloadRef}`,record);downloadsById.set(downloadId,record);
        return {downloadRef,state:record.state,fileName:record.fileName,bytesReceived:record.bytesReceived,totalBytes:record.totalBytes,completedAt:record.completedAt,
          completionEvidence:record.state==='complete'?'downloads.search':'none'};
      }
      case 'download.get':{
        const {record}=await getDownload(request);return {downloadRef:record.downloadRef,state:record.state,fileName:record.fileName,bytesReceived:record.bytesReceived,
          totalBytes:record.totalBytes,completedAt:record.completedAt,completionEvidence:record.state==='complete'?'downloads.search':'none'};
      }
      case 'download.cancel':{
        const {record}=await getDownload(request);if(record.state==='in_progress'){
          deadlineCheck(request);record.cancelRequested=true;
          try{await chromeCall('downloads.cancel',record.downloadId);}catch{throw resultError('UNKNOWN_OUTCOME');}
          const {record:updated}=await getDownload(request);updated.cancelRequested=true;if(updated.state==='in_progress')updated.state='cancelled';await store.set(`download:${updated.downloadRef}`,updated);
          return {downloadRef:updated.downloadRef,state:updated.state,fileName:updated.fileName,bytesReceived:updated.bytesReceived,totalBytes:updated.totalBytes,
            completedAt:updated.completedAt,completionEvidence:'downloads.search',dispatchState:'acknowledged'};
        }
        return {downloadRef:record.downloadRef,state:record.state,fileName:record.fileName,bytesReceived:record.bytesReceived,totalBytes:record.totalBytes,
          completedAt:record.completedAt,completionEvidence:'downloads.search',dispatchState:'notSent'};
      }
      case 'ax.query':return withPairQueue(pair.pairRef,async()=>{
        ensureNoModal(target);const p=request.payload;
        const document=await boundedCommand(request,target,'DOM.getDocument',{depth:0,pierce:false}),rootBackendNodeId=document?.root?.backendNodeId;
        if(!Number.isSafeInteger(rootBackendNodeId))throw resultError('BACKEND_UNAVAILABLE');
        const result=await boundedCommand(request,target,'Accessibility.queryAXTree',{backendNodeId:rootBackendNodeId,accessibleName:p.accessibleName,role:p.role});
        const nodes=Array.isArray(result?.nodes)?result.nodes:[],matches=[];let truncated=nodes.length>2000;
        for(const node of nodes.slice(0,2000)){
          const role=String(node.role?.value??''),name=String(node.name?.value??'');if(role!==p.role||name!==p.accessibleName||!Number.isSafeInteger(node.backendDOMNodeId))continue;
          const props=new Map((node.properties??[]).map(x=>[x.name,x.value?.value]));const disabled=props.get('disabled')===true;if(disabled&&!p.includeDisabled)continue;
          if(matches.length>=p.limit){truncated=true;break;}
          const candidateId=makeToken('cand',randomBytes),state={disabled,checked:props.get('checked')??null,expanded:props.get('expanded')??null,selected:props.get('selected')??null};
          candidateNodes.set(candidateId,{pairRef:pair.pairRef,documentToken:p.documentToken,generation:p.generation,backendNodeId:node.backendDOMNodeId});
          matches.push({candidateId,role,name,states:state,backendNodeId:node.backendDOMNodeId});
        }
        return {matches,truncated,source:'chrome-accessibility-tree'};
      });
      case 'ax.candidates':return withPairQueue(pair.pairRef,async()=>{
        ensureNoModal(target);const p=request.payload;
        const result=await boundedCommand(request,target,'Accessibility.getFullAXTree',{});
        const nodes=Array.isArray(result?.nodes)?result.nodes:[],matches=[];let truncated=nodes.length>2000;
        for(const node of nodes.slice(0,2000)){
          const role=String(node.role?.value??''),name=String(node.name?.value??'').trim();
          if(!roleValues.has(role)||!name||name.length>256||!Number.isSafeInteger(node.backendDOMNodeId))continue;
          const props=new Map((node.properties??[]).map(x=>[x.name,x.value?.value]));
          if(props.get('disabled')===true)continue;
          if(matches.length>=p.limit){truncated=true;break;}
          const candidateId=makeToken('cand',randomBytes),states={disabled:false,checked:props.get('checked')??null,
            expanded:props.get('expanded')??null,selected:props.get('selected')??null};
          candidateNodes.set(candidateId,{pairRef:pair.pairRef,documentToken:p.documentToken,generation:p.generation,backendNodeId:node.backendDOMNodeId});
          matches.push({candidateId,role,name,states,backendNodeId:node.backendDOMNodeId});
        }
        return {matches,truncated,source:'chrome-accessibility-tree'};
      });
      case 'ax.audit.start':return withPairQueue(pair.pairRef,()=>runAudit(request,pair,lease,target));
      case 'ax.audit.status':return auditStatus(request,pair,lease,target);
      case 'ax.audit.cancel':return cancelAudit(request,pair);
      default:throw resultError('INVALID_REQUEST');
    }
  };
  const requestFingerprint=request=>JSON.stringify(request);
  const mapFailure=(request,error)=>{
    let code=error?.code;
    if(code==='TIMEOUT'&&stateful.has(request.operation))code='UNKNOWN_OUTCOME';
    if(!COMPANION_ERRORS.includes(code))code='BACKEND_UNAVAILABLE';
    return companionErrorReply(request,code);
  };
  const handleRequest=async request=>{
    if(!validateCompanionRequest(request))return {protocol:COMPANION_PROTOCOL,requestId:String(request?.requestId??'invalid'),connectionEpoch:asInt(request?.connectionEpoch),ok:false,error:'INVALID_REQUEST'};
    const fingerprint=requestFingerprint(request),previous=seenRequests.get(request.requestId);
    if(previous){if(previous.fingerprint!==fingerprint)return companionErrorReply(request,'INVALID_REQUEST');return previous.promise;}
    const job=execute(request).then(data=>({protocol:COMPANION_PROTOCOL,requestId:request.requestId,connectionEpoch:request.connectionEpoch,ok:true,data}),error=>mapFailure(request,error));
    seenRequests.set(request.requestId,{fingerprint,promise:job});
    if(seenRequests.size>256)seenRequests.delete(seenRequests.keys().next().value);
    const reply=await job;seenRequests.set(request.requestId,{fingerprint,promise:Promise.resolve(reply)});return reply;
  };
  const handleHostMessage=message=>{
    if(!message||typeof message!=='object'||Array.isArray(message)||message.protocol!==COMPANION_PROTOCOL)return;
    if(message.type==='request')void handleRequest(message.request).then(reply=>sendReply(message.request,reply));
    else if(message.type==='epoch'&&Number.isSafeInteger(message.connectionEpoch)&&message.connectionEpoch>=0){
      if(connectionEpoch!==message.connectionEpoch){
        for(const pair of [...pairs.values()])void cleanupPair(pair.pairRef,'disconnect');
        connectionEpoch=message.connectionEpoch;
      }
    }
  };
  const attachNativePort=nativePort=>{
    port=nativePort;
    port.onMessage?.addListener?.(handleHostMessage);
    port.onDisconnect?.addListener?.(()=>{if(port===nativePort){port=null;void cleanupAll('disconnect');}});
    if(profileSessionRef&&companionEpoch!==null)postHost({type:'hello',protocol:COMPANION_PROTOCOL,profileSessionRef,companionEpoch,extensionId:chromeApi.runtime.id,
      extensionVersion:chromeApi.runtime.getManifest?.().version??'unknown',browserVersion:String(globalThis.navigator?.userAgent??'').slice(0,256),
      capabilities:{keys:true,dialogs:true,filePicker:true,downloads:true,axQuery:true,axAudit:Boolean(axeSource),axeCoreVersion:axeSource?'4.14.0':null}});
    return true;
  };
  const acceptPairMessage=(message,sender)=>{
    if(disposed||!profileSessionRef||!port||!exact(message,['nonce','documentToken'])||typeof message.nonce!=='string'||!noncePattern.test(message.nonce)||!ref(message.documentToken))return false;
    const tabId=sender?.tab?.id,windowId=sender?.tab?.windowId,documentId=sender?.documentId,origin=pageOrigin(sender?.origin);
    if(sender?.id!==UIPATH_EXTENSION_ID||sender?.frameId!==0||!Number.isSafeInteger(tabId)||tabId<0||!Number.isSafeInteger(windowId)||windowId<0||!ref(documentId)||!origin)return false;
    const pairRef=`pair_${message.nonce}`;
    for(const pair of [...pairs.values()])if(pair.tabId===tabId||pair.pairRef===pairRef)void cleanupPair(pair.pairRef,'navigation');
    const pair={pairRef,nonce:message.nonce,tabId,windowId,documentId,frameId:0,origin,documentToken:message.documentToken,
      profileSessionRef,companionEpoch,connectionEpoch};pairs.set(pairRef,pair);targetsByTab.delete(tabId);
    postHost({type:'pair.attestation',protocol:COMPANION_PROTOCOL,profileSessionRef,companionEpoch,attestation:{nonce:message.nonce,documentToken:message.documentToken,
      sender:{id:sender.id,origin,tabId,windowId,frameId:0,documentId}}});
    return true;
  };
  const onExternalMessage=(message,sender,sendResponse)=>{
    const accepted=acceptPairMessage(message,sender);try{sendResponse?.({accepted});}catch{}
    return false;
  };
  const onTabUpdated=(tabId,changeInfo)=>{if(changeInfo?.status==='loading'||Object.hasOwn(changeInfo??{},'url')){
    for(const pair of [...pairs.values()])if(pair.tabId===tabId)void cleanupPair(pair.pairRef,'navigation');
  }};
  const onTabRemoved=tabId=>{for(const pair of [...pairs.values()])if(pair.tabId===tabId)void cleanupPair(pair.pairRef,'navigation');};
  async function initialize(){
    if(started)return {profileSessionRef,companionEpoch};
    if(chromeApi.runtime?.id&&chromeApi.runtime.id!==COMPANION_EXTENSION_ID)throw resultError('POLICY_RESTRICTED');
    const prior=await store.get('profile-meta');
    profileSessionRef=prior?.profileSessionRef??makeToken('profile',randomBytes);
    companionEpoch=asInt(prior?.companionEpoch)+1;if(companionEpoch<1)companionEpoch=1;
    await store.set('profile-meta',{profileSessionRef,companionEpoch});
    add(chromeApi.runtime?.onMessageExternal,onExternalMessage);add(chromeApi.debugger?.onEvent,onDebuggerEvent);add(chromeApi.debugger?.onDetach,onDebuggerDetach);
    add(chromeApi.tabs?.onUpdated,onTabUpdated);add(chromeApi.tabs?.onRemoved,onTabRemoved);add(chromeApi.downloads?.onChanged,onDownloadChanged);
    started=true;return {profileSessionRef,companionEpoch};
  }
  async function start({connectNative=true}={}){
    await initialize();
    if(connectNative){try{attachNativePort(chromeApi.runtime.connectNative(COMPANION_HOST_NAME));}catch{port=null;}}
    return {profileSessionRef,companionEpoch,connected:Boolean(port)};
  }
  async function waitForEvent({kind,ref:watchRef,ownerRef,contextRef,deadline}){
    if(now()>=deadline)throw resultError('TIMEOUT');
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{waiters.delete(entry);reject(resultError('TIMEOUT'));},Math.max(1,deadline-now()));
      const entry={kind,ref:watchRef,ownerRef,contextRef,
        matches:event=>event.kind===kind&&(event.payload?.dialogWatchRef===watchRef||event.payload?.pickerWatchRef===watchRef),
        finish:(error,event)=>{clearTimeout(timer);error?reject(error):resolve(event);}};
      waiters.add(entry);
    });
  }
  async function cleanupAll(reason='dispose'){
    for(const pair of [...pairs.values()])await cleanupPair(pair.pairRef,reason);
  }
  const api={
    start,initialize,attachNativePort,handleHostMessage,handleRequest,acceptPairMessage,waitForEvent,cleanupAll,
    get identity(){return {profileSessionRef,companionEpoch,connectionEpoch,extensionId:COMPANION_EXTENSION_ID};},
    async dispose(){if(disposed)return;disposed=true;await cleanupAll('dispose');for(const remove of listeners.splice(0))try{remove();}catch{}try{port?.disconnect?.();}catch{}port=null;store.close?.();},
    get state(){return {pairs:pairs.size,leases:leases.size,dialogs:dialogs.size,files:files.size,downloads:downloadsById.size,disposed};}
  };
  return api;
}
