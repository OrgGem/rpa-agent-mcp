import {createHash, randomUUID} from 'node:crypto';
import {chmod, lstat, mkdir, readFile, realpath, stat, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {BrowserError, opaque} from './browser-tools.mjs';

const DAY=24*60*60*1000;
const MAX_UPLOAD_FILE=25*1024*1024;
const MAX_UPLOAD_TOTAL=50*1024*1024;
const MAX_UPLOADS=10;
const MAX_STAGED_AGE=30*60*1000;
const ADVANCED_NAMES=[
  'browser_press_keys','browser_download','browser_dialog','browser_file_picker','browser_launch',
  'system_clipboard','browser_visual_find','browser_ocr','browser_semantic_query','browser_accessibility_audit'
];
const LOCAL_ONLY=new Set(['system_clipboard','browser_visual_find','browser_ocr','browser_launch']);
const refError=(kind='reference')=>new BrowserError(`STALE_${kind.toUpperCase()}`,`${kind} ref is stale or belongs to another owner`);
const boundedString=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const noEvidence=(data,backend='local')=>({data,evidence:{kind:'event-observation',backend,dispatchState:'notSent',outcome:'observed',verified:true}});
const acknowledged=(op,data,backend='companion')=>{
  op.dispatchState='acknowledged';
  return {data,evidence:{kind:'native-ack',backend,method:backend,dispatchState:'acknowledged',outcome:'acknowledged',verified:false}};
};

function translated(error){
  if(error instanceof BrowserError)return error;
  const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'BACKEND_FAILURE';
  const dispatchState=['notSent','sent','acknowledged','unknown'].includes(error?.dispatchState)?error.dispatchState:
    code==='UNKNOWN_OUTCOME'?'unknown':'notSent';
  return new BrowserError(code,typeof error?.message==='string'?error.message:'Backend operation failed',{
    dispatchState,retryableRead:dispatchState==='notSent'&&['TIMEOUT','CANCELLED'].includes(code),
    details:object(error?.details)?error.details:{}});
}

function responseData(reply){
  if(!object(reply))throw new BrowserError('BACKEND_FAILURE','Companion returned a malformed response');
  if(reply.ok===false){
    const code=typeof reply.error==='string'?reply.error:'BACKEND_FAILURE';
    throw new BrowserError(code,code,{dispatchState:code==='UNKNOWN_OUTCOME'?'unknown':'notSent'});
  }
  if(reply.ok===true&&object(reply.data))return reply.data;
  if(Object.hasOwn(reply,'data')&&object(reply.data))return reply.data;
  // The authenticated local companion client resolves to its validated data
  // object directly; keep accepting the envelope form for injected test clients.
  return reply;
}

const MUTATING_COMPANION_OPS=new Set(['keys.dispatch','dialog.arm','dialog.respond','dialog.cancel',
  'file.arm','file.provide','file.release','file.cancel','download.start','download.cancel']);

function fileInside(root,file){
  const rel=path.relative(root,file);
  return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${path.sep}`));
}

export function createBrowserAdvancedHandlers(runtime,backends={}){
  const companion=backends.companion??null;
  const windows=backends.windowsHelper??null;
  const visual=backends.visualMatcher??null;
  const semantic=backends.semanticClient??null;
  let audits=backends.auditTickets??null;
  const launch=backends.launchManager??null;
  const uploadRoots=Array.isArray(backends.uploadRoots)?backends.uploadRoots:[];
  const state={dialogs:new Map(),pickers:new Map(),downloads:new Map(),launches:new Map(),staged:new Map(),leases:new Map(),roots:null};

  const owned=(map,ref,ownerRef,contextRef,kind)=>{
    const value=map.get(ref);
    if(!value||value.ownerRef!==ownerRef||contextRef&&value.contextRef!==contextRef)throw refError(kind);
    return value;
  };
  const contextFor=(ownerRef,name,args)=>{
    if(args?.contextRef)return args.contextRef;
    if(name==='browser_dialog'){
      const item=args.dialogWatchRef?state.dialogs.get(args.dialogWatchRef):args.dialogRef?[...state.dialogs.values()].find(x=>x.dialogRef===args.dialogRef):null;
      return item?.ownerRef===ownerRef?item.contextRef:null;
    }
    if(name==='browser_file_picker'){
      const item=args.pickerWatchRef?state.pickers.get(args.pickerWatchRef):args.pickerRef?[...state.pickers.values()].find(x=>x.pickerRef===args.pickerRef):null;
      return item?.ownerRef===ownerRef?item.contextRef:null;
    }
    if(name==='browser_accessibility_audit'&&args.auditRef){
      const item=runtime.auditOwners?.get(args.auditRef);return item?.ownerRef===ownerRef?item.contextRef:null;
    }
    return null;
  };
  const controlLane=(name,args)=>
    name==='browser_dialog'&&args.action!=='arm'||
    name==='browser_file_picker'&&args.action!=='arm'||
    name==='browser_download'&&args.action!=='start'||
    name==='browser_accessibility_audit'&&args.action!=='start'||
    name==='browser_launch'&&args.action!=='start';
  const localOnly=name=>LOCAL_ONLY.has(name);
  const localCompute=(name,args)=>name==='browser_visual_find'||name==='browser_ocr'||
    name==='browser_semantic_query'&&args.mode==='natural-language';

  function status(result,reason='BACKEND_UNAVAILABLE'){
    const value=object(result)?result:{};
    return {available:value.available===true,reason:value.available===true?null:
      (typeof value.reason==='string'?value.reason:reason),...(Array.isArray(value.languages)?{languages:[...new Set(value.languages.filter(x=>typeof x==='string').slice(0,64))]}:{}),
      ...(Array.isArray(value.profiles)?{profiles:value.profiles.filter(x=>typeof x==='string').slice(0,64)}:{}),
      ...(typeof value.model==='string'?{model:value.model.slice(0,128)}:{}),
      ...(Number.isSafeInteger(value.connectedProfiles)?{connectedProfiles:Math.max(0,Math.min(64,value.connectedProfiles))}:{}),
      ...(object(value.features)?{features:Object.fromEntries(Object.entries(value.features).filter(([k,v])=>/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(k)&&typeof v==='boolean').slice(0,16))}:{})};
  }
  async function safeProbe(label,fn,deadline,signal){
    if(typeof fn!=='function')return {available:false,reason:`${label}_NOT_CONFIGURED`};
    try{return await fn({deadline,signal});}
    catch(error){return {available:false,reason:typeof error?.code==='string'?error.code:`${label}_UNAVAILABLE`};}
  }
  async function probe({deadline=runtime.now()+1500,signal}={}){
    const [companionRaw,windowsInfo,visualRaw,semanticRaw,auditRaw,launchRaw]=await Promise.all([
      safeProbe('COMPANION',companion?.readiness?.bind(companion),deadline,signal),
      safeProbe('WINDOWS_HELPER',windows?.capabilities?.bind(windows),deadline,signal),
      safeProbe('VISUAL_MATCHER',visual?.readiness?.bind(visual),deadline,signal),
      safeProbe('SEMANTIC_MODEL',semantic?.readiness?.bind(semantic),deadline,signal),
      safeProbe('AXE_AUDIT',audits?.readiness?.bind(audits),deadline,signal),
      safeProbe('BROWSER_LAUNCH',launch?.readiness?.bind(launch),deadline,signal)
    ]);
    const companionProfiles=Array.isArray(companionRaw?.browser_capabilities)?companionRaw.browser_capabilities.slice(0,64):[];
    const featureNames=['keys','dialogs','filePicker','downloads','axQuery','axAudit'];
    const features=Object.fromEntries(featureNames.map(name=>[name,companionProfiles.some(profile=>profile?.[name]===true)]));
    const companionReady={...status(companionRaw,'COMPANION_UNAVAILABLE'),connectedProfiles:companionProfiles.length,features};
    const featureReady=name=>companionReady.available&&features[name]===true;
    const visualReady=status(visualRaw,'VISUAL_MATCHER_UNAVAILABLE');
    const semanticReady=status(semanticRaw,'SEMANTIC_MODEL_UNAVAILABLE');
    const auditReady=status(auditRaw,'AXE_AUDIT_UNAVAILABLE');
    const launchReady=status(launchRaw,'BROWSER_LAUNCH_UNAVAILABLE');
    const helper=windowsInfo??{};
    const clipboard={available:helper?.clipboardText===true,reason:helper?.clipboardText===true?null:'CLIPBOARD_UNAVAILABLE'};
    const ocrInfo=object(helper?.ocr)?helper.ocr:{};
    const ocr={available:ocrInfo.available===true,languages:Array.isArray(ocrInfo.languages)?ocrInfo.languages:[],reason:ocrInfo.available===true?null:'OCR_BACKEND_UNAVAILABLE'};
    const companionStatus=companionReady;
    const visualStatus=visualReady;
    const semanticStatus={available:semanticReady.available,reason:semanticReady.reason,model:semanticReady.model??null};
    const auditStatus=auditReady;
    const launchStatus=launchReady;
    const filePicker={available:featureReady('filePicker')&&uploadRoots.length>0,
      reason:!companionStatus.available?companionStatus.reason:!features.filePicker?'FILE_CHOOSER_BACKEND_UNAVAILABLE':uploadRoots.length?'UPLOAD_ROOTS_CONFIGURED':'UPLOAD_ROOTS_NOT_CONFIGURED'};
    const availability={
      browser_press_keys:{available:featureReady('keys'),reason:!companionStatus.available?companionStatus.reason:features.keys?null:'KEY_BACKEND_UNAVAILABLE'},
      browser_dialog:{available:featureReady('dialogs'),reason:!companionStatus.available?companionStatus.reason:features.dialogs?null:'DIALOG_BACKEND_UNAVAILABLE'},
      browser_file_picker:filePicker,
      browser_download:{available:featureReady('downloads'),reason:!companionStatus.available?companionStatus.reason:features.downloads?null:'DOWNLOAD_BACKEND_UNAVAILABLE'},
      browser_semantic_query:{available:featureReady('axQuery'),
        reason:!companionStatus.available?companionStatus.reason:features.axQuery?null:'ACCESSIBILITY_TREE_UNAVAILABLE',
        modes:{'natural-language':{available:featureReady('axQuery')&&semanticStatus.available,reason:!companionStatus.available?companionStatus.reason:!features.axQuery?'ACCESSIBILITY_TREE_UNAVAILABLE':semanticStatus.reason,backend:'ollama+chrome-accessibility-tree'},
          ax:{available:featureReady('axQuery'),reason:!companionStatus.available?companionStatus.reason:features.axQuery?null:'ACCESSIBILITY_TREE_UNAVAILABLE',backend:'chrome-accessibility-tree'}}},
      browser_launch:launchStatus,
      system_clipboard:clipboard,
      browser_visual_find:visualStatus,
      browser_ocr:ocr,
      browser_accessibility_audit:{available:featureReady('axAudit')&&auditStatus.available,
        reason:!companionStatus.available?companionStatus.reason:!features.axAudit?'AXE_BUNDLE_UNAVAILABLE':auditStatus.reason}
    };
    return {backends:{companion:companionStatus,clipboard,ocr,visual:visualStatus,semantic:semanticStatus,audit:auditStatus,launch:launchStatus,filePicker},tools:availability,checkedAt:runtime.now()};
  }

  function readinessFor(name,args){
    const snapshot=runtime.readinessSnapshot??{};
    const item=snapshot.tools?.[name];
    if(!item)return {available:false,backend:'unknown',reason:'BACKEND_NOT_CONFIGURED'};
    if(name==='browser_semantic_query'&&item.modes)return {...item.modes[args.mode],backend:args.mode==='natural-language'?'ollama+companion':'companion'};
    return {...item,backend:name==='system_clipboard'||name==='browser_ocr'?'windows':name==='browser_visual_find'?'local-image':name==='browser_launch'?'local-process':'companion'};
  }

  function getBinding(op,tab){
    const binding=companion?.getBinding?.({ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref});
    if(!binding||binding.hostEpoch!==runtime.hostEpoch||binding.documentToken!==tab.docToken||binding.generation!==tab.generation)
      throw new BrowserError('BACKEND_UNAVAILABLE','This tab has no current companion pairing',{details:{reason:'PROFILE_UNPAIRED'}});
    return binding;
  }
  function requireProfileFeature(binding,feature){
    const profiles=companion?.readiness?.()?.browser_capabilities;
    const profile=Array.isArray(profiles)?profiles.find(item=>item?.profileSessionRef===binding.profileSessionRef&&item?.companionEpoch===binding.companionEpoch):null;
    if(profile?.[feature]!==true)throw new BrowserError('BACKEND_UNAVAILABLE',`The paired profile does not provide ${feature}`,{details:{reason:`${feature.toUpperCase()}_BACKEND_UNAVAILABLE`}});
  }
  async function companionData(op,envelope){
    try{
      const data=responseData(await companion.request(envelope,{signal:op?.signal}));
      if(op&&MUTATING_COMPANION_OPS.has(envelope.operation))op.dispatchState='acknowledged';
      return data;
    }catch(error){
      const mapped=translated(error);
      if(op&&['sent','acknowledged','unknown'].includes(mapped.dispatchState))op.dispatchState=mapped.dispatchState;
      throw mapped;
    }
  }
  async function pair(op,tab){
    if(!companion||typeof companion.beginPairing!=='function'||typeof companion.waitForPairing!=='function'||!companion.extensionId)
      throw new BrowserError('BACKEND_UNAVAILABLE','Companion pairing is not configured');
    const frame=runtime.mainFrame(op,tab),doc=await runtime.doc(op,tab,frame);
    const binding=companion.getBinding?.({ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref});
    if(binding&&binding.hostEpoch===runtime.hostEpoch&&binding.documentToken===doc.documentToken&&binding.generation===doc.generation)return binding;
    const target={ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref,nativeTabId:tab.nativeId,windowId:tab.windowId,
      documentToken:doc.documentToken,generation:doc.generation,hostEpoch:runtime.hostEpoch,permittedOrigin:new URL(tab.url).origin};
    const challenge=await companion.beginPairing(target);
    if(!challenge||typeof challenge.nonce!=='string'||challenge.expiresAt<=runtime.now())throw new BrowserError('BACKEND_UNAVAILABLE','Companion pairing challenge could not be created');
    const sent=await runtime.page(op,tab,frame,'companionPairing',{nonce:challenge.nonce,companionId:companion.extensionId});
    if(sent.data?.sent!==true)throw new BrowserError('BACKEND_UNAVAILABLE','Pairing message was not accepted by the isolated extension world');
    const paired=await companion.waitForPairing(target,{deadline:Math.min(op.deadline,challenge.expiresAt),signal:op.signal});
    const result=paired??companion.getBinding?.({ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref});
    if(!result||result.hostEpoch!==runtime.hostEpoch||result.documentToken!==doc.documentToken||result.generation!==doc.generation)
      throw new BrowserError('BACKEND_UNAVAILABLE','Companion did not attest this exact tab and document',{details:{reason:'PAIRING_TIMEOUT'}});
    return result;
  }
  async function lease(op,tab,binding,requestedTtlMs){
    const key=`${op.client.id}|${op.ctx.ref}|${tab.ref}`;
    const existing=state.leases.get(key);
    const remainingMs=Math.max(100,op.deadline-runtime.now());
    const neededMs=Math.min(30000,Math.max(100,remainingMs,Number.isSafeInteger(requestedTtlMs)?requestedTtlMs:100));
    if(existing&&existing.pairRef===binding.pairRef&&existing.companionEpoch===binding.companionEpoch&&existing.connectionEpoch===binding.connectionEpoch&&
      Number.isFinite(existing.expiresAt)&&runtime.now()+neededMs<existing.expiresAt)return existing.leaseRef;
    if(existing)state.leases.delete(key);
    const ttlMs=neededMs;
    const data=await companionData(op,{protocol:1,requestId:opaque('cmp'),connectionEpoch:binding.connectionEpoch,
      profileSessionRef:binding.profileSessionRef,pairRef:binding.pairRef,operation:'debugger.acquire',leaseRef:null,tabRef:tab.ref,
      deadline:op.deadline,payload:{ownerRef:op.client.id,contextRef:op.ctx.ref,documentToken:tab.docToken,generation:tab.generation,ttlMs}});
    const expiresAt=typeof data.expiresAt==='string'?Date.parse(data.expiresAt):NaN;
    if(typeof data.leaseRef!=='string'||data.leaseRef.length>64||!Number.isFinite(expiresAt)||expiresAt<=runtime.now())
      throw new BrowserError('BACKEND_FAILURE','Companion did not return a valid time-bounded debugger lease',{dispatchState:'unknown'});
    state.leases.set(key,{ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref,pairRef:binding.pairRef,companionEpoch:binding.companionEpoch,
      connectionEpoch:binding.connectionEpoch,leaseRef:data.leaseRef,expiresAt});
    return data.leaseRef;
  }
  async function companionCall(op,tab,operation,payload,{needsLease=true,control=false}={}){
    const binding=await pair(op,tab),feature=operation==='keys.dispatch'?'keys':operation.startsWith('dialog.')?'dialogs':operation.startsWith('file.')?'filePicker':operation.startsWith('download.')?'downloads':operation.startsWith('ax.')?'axQuery':null;
    if(feature)requireProfileFeature(binding,feature);
    const requestedTtlMs=['dialog.arm','file.arm'].includes(operation)?payload.ttlMs:undefined;
    const leaseRef=needsLease?await lease(op,tab,binding,requestedTtlMs):null;
    const data=await companionData(op,{protocol:1,requestId:opaque('cmp'),connectionEpoch:binding.connectionEpoch,
      profileSessionRef:binding.profileSessionRef,pairRef:binding.pairRef,operation,leaseRef,tabRef:tab.ref,
      deadline:op.deadline,payload});
    return {binding,leaseRef,data};
  }

  async function canonicalUploadRoots(){
    if(state.roots)return state.roots;
    const roots=[];
    for(const root of uploadRoots){
      if(typeof root!=='string'||!path.isAbsolute(root))continue;
      try{const canonical=await realpath(root),info=await stat(canonical);if(info.isDirectory())roots.push(canonical);}catch{}
    }
    state.roots=roots;return roots;
  }
  async function stageFiles(op,pickerRef,inputPaths){
    if(inputPaths.length<1||inputPaths.length>MAX_UPLOADS)throw new BrowserError('INVALID_ARGUMENT','Choose between one and ten files');
    const roots=await canonicalUploadRoots();if(!roots.length)throw new BrowserError('BACKEND_UNAVAILABLE','No upload roots are configured',{details:{reason:'UPLOAD_ROOTS_NOT_CONFIGURED'}});
    const base=path.join(runtime.root,'work','browser-staged-uploads');await mkdir(base,{recursive:true});
    const baseStat=await lstat(base);if(baseStat.isSymbolicLink()||!baseStat.isDirectory())throw new BrowserError('ARTIFACT_IO_ERROR','Staging root is not a private directory');
    const canonicalBase=await realpath(base),files=[];let total=0;
    for(const input of inputPaths){
      if(typeof input!=='string'||!path.isAbsolute(input))throw new BrowserError('INVALID_ARGUMENT','Upload paths must be absolute files under a configured root');
      let resolved;try{resolved=await realpath(input);}catch{throw new BrowserError('INVALID_ARGUMENT','Upload file does not exist');}
      if(!roots.some(root=>fileInside(root,resolved)))throw new BrowserError('POLICY_RESTRICTED','Upload file is outside configured roots');
      const before=await stat(resolved);if(!before.isFile()||before.size>MAX_UPLOAD_FILE)throw new BrowserError('RESULT_TOO_LARGE','Upload file exceeds 25 MiB or is not a regular file');
      total+=before.size;if(total>MAX_UPLOAD_TOTAL)throw new BrowserError('RESULT_TOO_LARGE','Combined uploads exceed 50 MiB');
      let bytes;try{bytes=await readFile(resolved);}catch{throw new BrowserError('INVALID_ARGUMENT','Upload file could not be read');}
      const after=await stat(resolved);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)throw new BrowserError('INVALID_ARGUMENT','Upload file changed while being staged');
      const hash=createHash('sha256').update(bytes).digest('hex'),name=path.basename(resolved).replace(/[^A-Za-z0-9_. -]/g,'_').replace(/\.\./g,'_').slice(0,128)||'upload.bin',file=path.join(canonicalBase,`${randomUUID()}.upload`);
      try{await writeFile(file,bytes,{flag:'wx',mode:0o400});await chmod(file,0o400).catch(()=>{});}
      catch{try{await unlink(file);}catch{}throw new BrowserError('BACKEND_FAILURE','Staged upload could not be created');}
      const staged={path:file,sha256:hash,bytes:bytes.length,name,createdAt:runtime.now(),pickerRef,ownerRef:op.client.id,contextRef:op.ctx.ref};
      state.staged.set(file,staged);files.push(staged);
    }
    return files;
  }
  async function removeStaged(pickerRef,ownerRef,contextRef){
    let success=true;
    for(const [file,entry] of [...state.staged])if(entry.pickerRef===pickerRef&&entry.ownerRef===ownerRef&&(!contextRef||entry.contextRef===contextRef)){
      try{await unlink(file);state.staged.delete(file);}catch(error){if(error.code==='ENOENT')state.staged.delete(file);else success=false;}
    }
    return success;
  }

  async function requestForRecord(op,record,operation,payload,{tabRef=record.tabRef,leaseRef=record.leaseRef??null,control=true}={}){
    if(!companion)throw new BrowserError('BACKEND_UNAVAILABLE','Companion is unavailable');
    const binding=record.binding;
    if(!binding||binding.hostEpoch!==runtime.hostEpoch)throw new BrowserError('STALE_PROFILE','Companion profile epoch changed');
    return companionData(op,{protocol:1,requestId:opaque('cmp'),connectionEpoch:binding.connectionEpoch,
      profileSessionRef:binding.profileSessionRef,pairRef:binding.pairRef,operation,leaseRef,tabRef,
      deadline:op.deadline,payload});
  }
  async function eventFor(op,record,kind){
    if(!companion||typeof companion.waitForEvent!=='function')throw new BrowserError('BACKEND_UNAVAILABLE','Companion event lane is unavailable');
    const deadline=Math.min(op.deadline-50,runtime.now()+(op.args.timeoutMs??10000));
    if(deadline<=runtime.now())return null;
    try{return await companion.waitForEvent({ownerRef:record.ownerRef,contextRef:record.contextRef,watchRef:record.watchRef,
      kind,deadline,signal:op.signal});}
    catch(error){if(['TIMEOUT','EVENT_TIMEOUT'].includes(error?.code))return null;throw translated(error);}
  }
  function eventPayload(event){
    if(!object(event))return null;
    if(object(event.payload))return event.payload;
    if(object(event.data))return event.data;
    return event;
  }
  async function removePicker(picker,reason='release'){
    let cleanupConfirmed=true;
    try{
      const cancel=reason==='cancel'||!picker.pickerRef;
      const result=await requestForRecord({client:{id:picker.ownerRef},requestId:opaque('req'),deadline:runtime.now()+2000,signal:undefined},picker,
        cancel?'file.cancel':'file.release',cancel?{ownerRef:picker.ownerRef,contextRef:picker.contextRef,pickerWatchRef:picker.watchRef}
          :{ownerRef:picker.ownerRef,contextRef:picker.contextRef,pickerRef:picker.pickerRef});
      if(result.cleanupState==='unknown')cleanupConfirmed=false;
    }catch{cleanupConfirmed=false;}
    if(cleanupConfirmed){if(!await removeStaged(picker.pickerRef??picker.watchRef,picker.ownerRef,picker.contextRef))cleanupConfirmed=false;}
    picker.state=cleanupConfirmed?(reason==='cancel'?'cancelled':'released'):'unknown';
    return cleanupConfirmed;
  }
  function assertCurrentContext(op,record){
    if(!record||record.ownerRef!==op.client.id||record.contextRef!==op.ctx?.ref)throw refError('context');
    if(record.state==='unknown')throw new BrowserError('UNKNOWN_OUTCOME','The prior companion operation has an unknown outcome',{dispatchState:'unknown'});
  }
  function publicType(value){return ['alert','confirm','prompt','beforeunload'].includes(value)?value:null;}
  function publicMode(value){return ['selectSingle','selectMultiple'].includes(value)?value:null;}

  const handlers={
    async browser_press_keys(op,args){
      const tab=await runtime.tab(op,args.tabRef);runtime.assertWrite(op,tab);
      op.tab=tab;
      await beforeWrite(op,'keys.dispatch',args);
      const {data}=await companionCall(op,tab,'keys.dispatch',{ownerRef:op.client.id,keys:args.keys});
      if(!['notSent','sent','acknowledged','unknown'].includes(data.dispatchState))throw new BrowserError('BACKEND_FAILURE','Companion key result omitted dispatch state');
      op.dispatchState=data.dispatchState;
      return {data:{inputMethod:'cdp-key-events',dispatchState:data.dispatchState,sentCount:Number.isSafeInteger(data.sentCount)?data.sentCount:0,
        releasedKeys:Array.isArray(data.releasedKeys)?[...new Set(data.releasedKeys.filter(x=>typeof x==='string'))]:[],verified:false},
        evidence:{kind:'native-ack',backend:'chrome-debugger',dispatchState:data.dispatchState,outcome:data.dispatchState==='acknowledged'?'acknowledged':'unknown',verified:false}};
    },

    async browser_dialog(op,args){
      if(args.action==='arm'){
        const tab=await runtime.tab(op,args.tabRef);runtime.assertWrite(op,tab);
        if([...state.dialogs.values()].some(d=>d.ownerRef===op.client.id&&d.contextRef===op.ctx.ref&&d.tabRef===tab.ref&&['armed','open','unknown'].includes(d.state)))
          throw new BrowserError('BACKEND_BUSY','This tab already has an armed or unresolved dialog watch');
        const {binding,leaseRef,data}=await companionCall(op,tab,'dialog.arm',{
          ownerRef:op.client.id,contextRef:op.ctx.ref,triggerRequestKey:args.triggerRequestKey,mode:args.mode,
          expectedType:args.expectedType,...(args.expectedMessage!==undefined?{expectedMessage:args.expectedMessage}:{}),
          ...(args.autoResponse?{autoResponse:args.autoResponse}:{}),mismatchPolicy:args.mismatchPolicy,
          expiryPolicy:args.expiryPolicy,releasePolicy:args.releasePolicy,ttlMs:args.ttlMs,
          documentToken:tab.docToken,generation:tab.generation
        });
        const watchRef=data.dialogWatchRef;
        if(typeof watchRef!=='string'||watchRef.length>64)throw new BrowserError('BACKEND_FAILURE','Companion dialog arm omitted its watch ref',{dispatchState:'unknown'});
        const expiresAt=typeof data.expiresAt==='string'?data.expiresAt:new Date(runtime.now()+args.ttlMs).toISOString();
        const record={watchRef,ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref,tab,binding,leaseRef,
          triggerRequestKey:args.triggerRequestKey,requestKey:args.requestKey,mode:args.mode,expectedType:args.expectedType,
          mismatchPolicy:args.mismatchPolicy,expiryPolicy:args.expiryPolicy,releasePolicy:args.releasePolicy,
          state:'armed',expiresAt,createdAt:runtime.now(),dialogRef:null};
        state.dialogs.set(watchRef,record);
        return acknowledged(op,{action:'arm',dialogWatchRef:watchRef,state:'armed',expiresAt},'chrome-debugger');
      }
      const record=owned(state.dialogs,args.dialogWatchRef??[...state.dialogs.values()].find(x=>x.dialogRef===args.dialogRef)?.watchRef,
        op.client.id,op.ctx?.ref,'dialog');
      assertCurrentContext(op,record);op.tab=record.tab;
      if(args.action==='wait'){
        const p=await requestForRecord(op,record,'dialog.wait',{ownerRef:op.client.id,contextRef:op.ctx.ref,
          dialogWatchRef:record.watchRef,timeoutMs:Math.min(30000,args.timeoutMs??10000)});
        record.dialogRef=p.dialogRef??null;record.state=p.state??'pending';
        return noEvidence({action:'wait',dialogWatchRef:record.watchRef,dialogRef:p.dialogRef??null,type:publicType(p.type),
          message:p.message===null?null:boundedString(p.message,1024),state:record.state,
          cleanupState:p.cleanupState==='unknown'?'unknown':p.cleanupState==='released'?'released':'retained'},'companion-event');
      }
      if(args.dialogRef!==record.dialogRef)throw refError('dialog');
      const action=args.action==='respond'?'dialog.respond':'dialog.cancel';
      const payload=args.action==='respond'?{ownerRef:op.client.id,contextRef:op.ctx.ref,dialogRef:record.dialogRef,accept:args.accept,...(args.promptText!==undefined?{promptText:args.promptText}:{})}
        :{ownerRef:op.client.id,contextRef:op.ctx.ref,dialogRef:record.dialogRef,disposition:'dismiss'};
      const data=await requestForRecord(op,record,action,payload);
      if(data.dispatchState==='unknown')op.dispatchState='unknown';else if(data.dispatchState==='sent')op.dispatchState='sent';else op.dispatchState='acknowledged';
      record.state=data.state??(args.action==='respond'?'responded':'cancelled');
      const cleanupState=data.cleanupState==='unknown'?'unknown':'released';
      if(cleanupState==='released')state.dialogs.delete(record.watchRef);
      return {data:{action:args.action,dialogRef:record.dialogRef,state:record.state,dispatchState:op.dispatchState,cleanupState},
        evidence:{kind:'native-ack',backend:'chrome-debugger',dispatchState:op.dispatchState,outcome:op.dispatchState==='acknowledged'?'acknowledged':'unknown',verified:false}};
    },

    async browser_file_picker(op,args){
      if(args.action==='arm'){
        const tab=await runtime.tab(op,args.tabRef);runtime.assertWrite(op,tab);
        if([...state.pickers.values()].some(x=>x.ownerRef===op.client.id&&x.contextRef===op.ctx.ref&&x.tabRef===tab.ref&&['armed','open','unknown'].includes(x.state)))
          throw new BrowserError('BACKEND_BUSY','This tab already has an armed or unresolved file picker');
        const {binding,leaseRef,data}=await companionCall(op,tab,'file.arm',{
          ownerRef:op.client.id,contextRef:op.ctx.ref,triggerRequestKey:args.triggerRequestKey,releasePolicy:args.releasePolicy,
          ttlMs:args.ttlMs,documentToken:tab.docToken,generation:tab.generation
        });
        const watchRef=data.pickerWatchRef;
        if(typeof watchRef!=='string'||watchRef.length>64)throw new BrowserError('BACKEND_FAILURE','Companion file arm omitted its watch ref',{dispatchState:'unknown'});
        const expiresAt=typeof data.expiresAt==='string'?data.expiresAt:new Date(runtime.now()+args.ttlMs).toISOString();
        state.pickers.set(watchRef,{watchRef,ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref,tab,binding,leaseRef,
          triggerRequestKey:args.triggerRequestKey,requestKey:args.requestKey,releasePolicy:args.releasePolicy,state:'armed',expiresAt,
          createdAt:runtime.now(),pickerRef:null,files:[]});
        return acknowledged(op,{action:'arm',pickerWatchRef:watchRef,state:'armed',expiresAt},'chrome-debugger');
      }
      const record=owned(state.pickers,args.pickerWatchRef??[...state.pickers.values()].find(x=>x.pickerRef===args.pickerRef)?.watchRef,
        op.client.id,op.ctx?.ref,'picker');
      assertCurrentContext(op,record);op.tab=record.tab;
      if(args.action==='wait'){
        const p=await requestForRecord(op,record,'file.wait',{ownerRef:op.client.id,contextRef:op.ctx.ref,
          pickerWatchRef:record.watchRef,timeoutMs:Math.min(30000,args.timeoutMs??10000)});
        if(!p.pickerRef)return noEvidence({action:'wait',pickerRef:null,mode:null,state:p.state==='expired'?'expired':'pending'},'companion-event');
        if(p.pickerRef.length>64||!publicMode(p.mode))throw new BrowserError('BACKEND_FAILURE','Companion file chooser event is malformed');
        record.pickerRef=p.pickerRef;record.mode=p.mode;record.state='open';
        return noEvidence({action:'wait',pickerRef:p.pickerRef,mode:p.mode,state:'open'},'companion-event');
      }
      if(args.action==='provide'){
        if(args.pickerRef!==record.pickerRef||record.state!=='open')throw refError('picker');
        const files=await stageFiles(op,record.pickerRef,args.paths);record.files=files;
        try{
          const result=await requestForRecord(op,record,'file.provide',{ownerRef:op.client.id,contextRef:op.ctx.ref,pickerRef:record.pickerRef,
            files:files.map(({path,sha256,bytes,name})=>({path,sha256,bytes,name}))});
          const expectedHashes=files.map(x=>x.sha256),expectedBytes=files.reduce((n,x)=>n+x.bytes,0);
          if(result.selectedCount!==files.length||result.stagedBytes!==expectedBytes||!Array.isArray(result.hashes)||
             JSON.stringify(result.hashes)!==JSON.stringify(expectedHashes)||result.selection!=='assigned'||result.verification!=='browser-acknowledged'){
            op.dispatchState='unknown';record.state='unknown';throw new BrowserError('ACTION_OUTCOME_UNKNOWN','File assignment acknowledgement did not match the staged manifest',{dispatchState:'unknown'});
          }
          if(result.dispatchState==='unknown')op.dispatchState='unknown';else if(result.dispatchState==='sent')op.dispatchState='sent';else op.dispatchState='acknowledged';
          record.state='provided';
          return {data:{action:'provide',pickerRef:record.pickerRef,selectedCount:files.length,selection:'assigned',
            verification:'browser-acknowledged',stagedBytes:files.reduce((n,x)=>n+x.bytes,0),expiresAt:record.expiresAt,dispatchState:op.dispatchState},
            evidence:{kind:'native-ack',backend:'chrome-debugger',dispatchState:op.dispatchState,outcome:op.dispatchState==='acknowledged'?'acknowledged':'unknown',verified:false}};
        }catch(error){record.state=error?.dispatchState==='unknown'?'unknown':'open';throw error;}
      }
      const ok=await removePicker(record,args.action==='cancel'?'cancel':'release');
      if(ok)state.pickers.delete(record.watchRef);else record.state='unknown';
      const data=args.action==='release'?{action:'release',state:ok?'released':'unknown',cleanupState:ok?'released':'unknown'}
        :{action:'cancel',state:ok?'cancelled':'unknown',cleanupState:ok?'released':'unknown'};
      return {data,evidence:{kind:'native-ack',backend:'chrome-debugger',dispatchState:ok?'acknowledged':'unknown',outcome:ok?'acknowledged':'unknown',verified:false}};
    },

    async browser_download(op,args){
      if(args.action==='start'){
        const tab=await runtime.tab(op,args.tabRef);runtime.assertWrite(op,tab);
        const url=new URL(args.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new BrowserError('INVALID_ARGUMENT','Download URL must be credential-free HTTP(S)');
        const {binding,data}=await companionCall(op,tab,'download.start',{ownerRef:op.client.id,url:url.href,...(args.filename?{filename:args.filename}:{})},
          {needsLease:false});
        if(typeof data.downloadRef!=='string'||data.downloadRef.length>64)throw new BrowserError('BACKEND_FAILURE','Companion did not return an owned download ref',{dispatchState:'unknown'});
        const downloadRef=data.downloadRef;
        const record={downloadRef,ownerRef:op.client.id,contextRef:op.ctx.ref,profileSessionRef:binding.profileSessionRef,
          pairRef:binding.pairRef,companionEpoch:binding.companionEpoch,connectionEpoch:binding.connectionEpoch,tabRef:tab.ref,createdAt:runtime.now()};
        state.downloads.set(downloadRef,record);
        const view=downloadView(data,'start',downloadRef);return acknowledged(op,view,'chrome-downloads');
      }
      const record=owned(state.downloads,args.downloadRef,op.client.id,op.ctx.ref,'download');
      const data=await companionData(op,{protocol:1,requestId:opaque('cmp'),connectionEpoch:record.connectionEpoch,
        profileSessionRef:record.profileSessionRef,pairRef:null,operation:args.action==='get'?'download.get':'download.cancel',
        leaseRef:null,tabRef:null,deadline:op.deadline,payload:{ownerRef:op.client.id,downloadRef:record.downloadRef}});
      if(args.action==='cancel'&&data.dispatchState==='unknown')op.dispatchState='unknown';else if(args.action==='cancel')op.dispatchState='acknowledged';
      return args.action==='get'?noEvidence(downloadView(data,'get',record.downloadRef),'chrome-downloads'):
        acknowledged(op,downloadView(data,'cancel',record.downloadRef),'chrome-downloads');
    },

    async browser_launch(op,args){
      if(!launch)throw new BrowserError('BACKEND_UNAVAILABLE','Owned browser launch is not configured');
      try{
        if(args.action==='start'){
          const result=await launch.start({ownerRef:op.client.id,profileAlias:args.profileAlias,...(args.url?{url:args.url}:{}),requestKey:args.requestKey,deadline:op.deadline,signal:op.signal});
          if(typeof result.launchRef!=='string')throw new BrowserError('BACKEND_FAILURE','Launch manager did not return an owned launch ref');
          state.launches.set(result.launchRef,{ownerRef:op.client.id,launchRef:result.launchRef,createdAt:runtime.now()});
          return acknowledged(op,launchView(result,'start'),'owned-chrome-process');
        }
        const record=owned(state.launches,args.launchRef,op.client.id,null,'launch');
        const result=args.action==='status'?await launch.status({ownerRef:op.client.id,launchRef:record.launchRef,deadline:op.deadline,signal:op.signal})
          :await launch.close({ownerRef:op.client.id,launchRef:record.launchRef,requestKey:args.requestKey,deadline:op.deadline,signal:op.signal});
        if(args.action==='close'&&result.state==='closed')state.launches.delete(record.launchRef);
        if(args.action==='status')return noEvidence(launchView(result,'status'),'owned-chrome-process');
        return acknowledged(op,launchView(result,'close'),'owned-chrome-process');
      }catch(error){throw translated(error);}
    },

    async system_clipboard(op,args){
      if(!windows)throw new BrowserError('BACKEND_UNAVAILABLE','Windows clipboard helper is unavailable');
      try{
        if(args.action==='read'){
          const result=await windows.readClipboard({deadline:op.deadline,signal:op.signal,maxChars:args.maxChars});
          return noEvidence({action:'read',format:'text',text:result.text,observedAt:new Date(runtime.now()).toISOString()},'windows-clipboard');
        }
        const result=await windows.writeClipboard({text:args.text,deadline:op.deadline,signal:op.signal});
        op.dispatchState=result.dispatchState??'acknowledged';
        return {data:{action:'write',format:'text',writtenChars:result.writtenChars,verification:'acknowledged',dispatchState:op.dispatchState},
          evidence:{kind:'native-ack',backend:'windows-clipboard',dispatchState:op.dispatchState,outcome:'acknowledged',verified:false}};
      }catch(error){throw translated(error);}
    },

    async browser_visual_find(op,args){
      if(!visual)throw new BrowserError('BACKEND_UNAVAILABLE','Local template matcher is unavailable');
      const targetMeta=await runtime.artifacts.analysisMetadata(op.client.id,op.ctx.ref,args.targetScreenshotRef);
      const templateMeta=await runtime.artifacts.analysisMetadata(op.client.id,op.ctx.ref,args.templateScreenshotRef);
      const targetPng=await runtime.artifacts.analysisRead(op.client.id,op.ctx.ref,args.targetScreenshotRef,{maxBytes:4*1024*1024,maxPixels:16_000_000});
      const templatePng=await runtime.artifacts.analysisRead(op.client.id,op.ctx.ref,args.templateScreenshotRef,{maxBytes:4*1024*1024,maxPixels:16_000_000});
      for(const meta of [targetMeta,templateMeta])if(meta.provenance?.sourceTool!=='browser_screenshot'||typeof meta.provenance.tabRef!=='string')
        throw new BrowserError('UNSUPPORTED_CAPABILITY','Only owned screenshot artifacts can be analyzed');
      const result=await runtime.withLocalCompute(op,()=>visual.find({targetPng,templatePng,templateRegion:args.templateRegion,
        ...(args.searchRegion?{searchRegion:args.searchRegion}:{}),threshold:args.threshold??0.9,maxMatches:args.maxMatches,deadline:op.deadline,signal:op.signal}));
      return noEvidence({matches:result.matches,sourceScreenshotRef:args.targetScreenshotRef,templateScreenshotRef:args.templateScreenshotRef,
        coordinateSpace:'screenshot-px',viewportGeneration:targetMeta.provenance.viewportGeneration,truncated:result.truncated},'opencv-js');
    },

    async browser_ocr(op,args){
      if(!windows)throw new BrowserError('BACKEND_UNAVAILABLE','Windows OCR helper is unavailable');
      const meta=await runtime.artifacts.analysisMetadata(op.client.id,op.ctx.ref,args.screenshotRef);
      if(meta.provenance?.sourceTool!=='browser_screenshot')throw new BrowserError('UNSUPPORTED_CAPABILITY','Only owned screenshot artifacts can be OCRed');
      const png=await runtime.artifacts.analysisRead(op.client.id,op.ctx.ref,args.screenshotRef,{maxBytes:4*1024*1024,maxPixels:16_000_000});
      try{
        const result=await runtime.withLocalCompute(op,()=>windows.ocr({png,language:args.language??'en-US',region:args.region,
          maxLines:args.maxLines??500,deadline:op.deadline,signal:op.signal}));
        return noEvidence({...result,sourceScreenshotRef:args.screenshotRef},'windows-ocr');
      }catch(error){throw translated(error);}
    },

    async browser_semantic_query(op,args){
      const tab=await runtime.tab(op,args.tabRef),frame=runtime.mainFrame(op,tab),doc=await runtime.doc(op,tab,frame);
      const binding=await pair(op,tab),leaseRef=await lease(op,tab,binding);
      if(args.mode==='ax'){
        const {data}=await companionCall(op,tab,'ax.query',{ownerRef:op.client.id,contextRef:op.ctx.ref,documentToken:doc.documentToken,
          generation:doc.generation,role:args.role,accessibleName:args.accessibleName,includeDisabled:args.includeDisabled,limit:args.limit});
        if(!Array.isArray(data.matches)||data.matches.length>args.limit)throw new BrowserError('BACKEND_FAILURE','Companion AX query result is malformed');
        const matches=data.matches.map(item=>({role:item.role,accessibleName:boundedString(item.name??item.accessibleName,256),disabled:item.states?.disabled===true,
          checked:[true,false,null].includes(item.states?.checked)?item.states.checked:null,expanded:[true,false,null].includes(item.states?.expanded)?item.states.expanded:null,
          selected:[true,false,null].includes(item.states?.selected)?item.states.selected:null,elementRef:null,refAvailable:false}));
        return noEvidence({mode:'ax',matches,source:'chrome-accessibility-tree',truncated:data.truncated===true},'chrome-accessibility-tree');
      }
      if(!semantic)throw new BrowserError('BACKEND_UNAVAILABLE','Local Ollama semantic model is unavailable');
      const {data}=await companionCall(op,tab,'ax.candidates',{ownerRef:op.client.id,contextRef:op.ctx.ref,
        documentToken:doc.documentToken,generation:doc.generation,limit:100});
      if(!Array.isArray(data.matches)||data.matches.length>100||typeof data.truncated!=='boolean')throw new BrowserError('BACKEND_FAILURE','Companion candidate snapshot is malformed');
      const candidates=data.matches.map(item=>({candidateId:boundedString(item.candidateId,64),
        role:boundedString(item.role,64),accessibleName:boundedString(item.name,256),label:boundedString(item.name,256)}));
      if(candidates.some(x=>!x.candidateId||!x.role)||new Set(candidates.map(x=>x.candidateId)).size!==candidates.length)
        throw new BrowserError('BACKEND_FAILURE','Companion semantic candidate IDs are malformed');
      const result=await runtime.withLocalCompute(op,()=>semantic.query({query:args.query,candidates,limit:args.limit,deadline:op.deadline,signal:op.signal}));
      const allowed=new Set(candidates.map(x=>x.candidateId));
      const matches=(result.candidateIds??[]).filter(id=>allowed.has(id)).slice(0,args.limit).map(candidateId=>({candidateId,elementRef:null}));
      const abstained=result.abstained===true||matches.length===0;
      return noEvidence({mode:'natural-language',matches,abstained,provider:{name:'ollama',model:result.provider?.model??'unknown'},truncated:data.truncated===true||result.truncated===true},'ollama+chrome-accessibility-tree');
    },

    async browser_accessibility_audit(op,args){
      if(!audits)throw new BrowserError('BACKEND_UNAVAILABLE','Accessibility audit tickets are unavailable');
      try{
        if(args.action==='start'){
          const tab=await runtime.tab(op,args.tabRef),frame=runtime.mainFrame(op,tab),doc=await runtime.doc(op,tab,frame);
          const binding=await pair(op,tab);requireProfileFeature(binding,'axAudit');await lease(op,tab,binding);
          const result=await audits.start({ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref,documentGeneration:doc.generation,
            standard:args.standard,includeIncomplete:args.includeIncomplete,limit:args.limit,requestKey:args.requestKey,deadline:op.deadline,signal:op.signal});
          runtime.auditOwners.set(result.auditRef,{ownerRef:op.client.id,contextRef:op.ctx.ref,tabRef:tab.ref,documentGeneration:doc.generation});
          return noEvidence({action:'start',...result},'axe-core');
        }
        const audit=owned(runtime.auditOwners,args.auditRef,op.client.id,op.ctx?.ref,'audit');
        const result=args.action==='poll'?await audits.poll({ownerRef:op.client.id,auditRef:args.auditRef})
          :await audits.cancel({ownerRef:op.client.id,auditRef:args.auditRef,requestKey:args.requestKey});
        if(result.state==='complete'&&result.result){
          result.result.violations=result.result.violations.map(v=>({...v,nodes:(v.nodes??[]).map(n=>({...n,elementRef:null}))}));
        }
        if(args.action==='cancel'&&result.state==='cancelled')runtime.auditOwners.delete(args.auditRef);
        return noEvidence({action:args.action,...result},'axe-core-ticket');
      }catch(error){throw translated(error);}
    }
  };

  async function beforeWrite(op,route,params){
    if(!op.ctx||!op.tab||!companion)return;
    for(const record of [...state.dialogs.values(),...state.pickers.values()]){
      if(record.ownerRef!==op.client.id||record.contextRef!==op.ctx.ref||record.tabRef!==op.tab.ref||record.state!=='armed'||record.triggerRequestKey!==op.key)continue;
      const isDialog=state.dialogs.has(record.watchRef),operation=isDialog?'dialog.trigger':'file.trigger';
      const payload=isDialog?{ownerRef:op.client.id,contextRef:op.ctx.ref,dialogWatchRef:record.watchRef,triggerRequestKey:op.key}
        :{ownerRef:op.client.id,contextRef:op.ctx.ref,pickerWatchRef:record.watchRef,triggerRequestKey:op.key};
      try{await requestForRecord(op,record,operation,payload);}
      catch(error){op.dispatchState='unknown';record.state='unknown';throw new BrowserError('ACTION_OUTCOME_UNKNOWN','Exact modal trigger acknowledgement was lost; the page action was not dispatched',{dispatchState:'unknown',details:{cause:translated(error).code,requestKey:op.key}});}
      record.triggeredAt=runtime.now();record.state='triggered';
    }
  }

  async function cleanupContext({ownerRef,contextRef,deadline=runtime.now()+3000}={}){
    let cleanupConfirmed=true;const blockedTabRefs=new Set(),dialogs=[...state.dialogs.values()].filter(x=>x.ownerRef===ownerRef&&x.contextRef===contextRef),
      pickers=[...state.pickers.values()].filter(x=>x.ownerRef===ownerRef&&x.contextRef===contextRef);
    let outcome;
    if(companion?.cleanupContext){try{outcome=await companion.cleanupContext({ownerRef,contextRef,deadline});if(outcome?.cleanupConfirmed===false)cleanupConfirmed=false;}catch{cleanupConfirmed=false;}}
    else if(dialogs.length||pickers.length)cleanupConfirmed=false;
    const blocked=new Set(Array.isArray(outcome?.blockedTabRefs)?outcome.blockedTabRefs:[]);
    for(const record of dialogs){
      if(blocked.has(record.tabRef)||!cleanupConfirmed){record.state='unknown';blockedTabRefs.add(record.tabRef);}
      else state.dialogs.delete(record.watchRef);
    }
    const cleanedPickers=new Set(Array.isArray(outcome?.cleanedPickerRefs)?outcome.cleanedPickerRefs:[]);
    for(const record of pickers){
      const done=cleanupConfirmed&&(cleanedPickers.has(record.watchRef)||!record.files.length);
      if(done){if(record.files.length&&!await removeStaged(record.pickerRef??record.watchRef,ownerRef,contextRef))cleanupConfirmed=false;else state.pickers.delete(record.watchRef);}
      else record.state='unknown';
    }
    for(const [key,leaseRecord] of [...state.leases])if(leaseRecord.ownerRef===ownerRef&&leaseRecord.contextRef===contextRef){
      state.leases.delete(key); // Companion cleanup owns detach; do not reattach/replay here.
    }
    for(const [auditRef,record] of [...(runtime.auditOwners??new Map())])if(record.ownerRef===ownerRef&&record.contextRef===contextRef){
      audits?.documentGone?.({ownerRef,contextRef,tabRef:record.tabRef,documentGeneration:record.documentGeneration});
      runtime.auditOwners.delete(auditRef);
    }
    for(const ref of blocked)blockedTabRefs.add(ref);
    return {cleanupConfirmed,blockedTabRefs:[...blockedTabRefs]};
  }
  async function cleanupClient({ownerRef,deadline=runtime.now()+3000}={}){
    let cleanupConfirmed=true;
    for(const ctx of [...runtime.contexts.values()].filter(x=>x.clientRef===ownerRef&&x.alive)){
      const result=await cleanupContext({ownerRef,contextRef:ctx.ref,deadline});if(!result.cleanupConfirmed)cleanupConfirmed=false;
    }
    try{const result=await companion?.cleanupClient?.({ownerRef,deadline});if(result?.cleanupConfirmed===false)cleanupConfirmed=false;}catch{cleanupConfirmed=false;}
    try{audits?.disposeOwner?.({ownerRef});}catch{}
    for(const [ref,download] of state.downloads)if(download.ownerRef===ownerRef)state.downloads.delete(ref); // Chrome download itself may finish.
    for(const [ref,launchRecord] of state.launches)if(launchRecord.ownerRef===ownerRef)state.launches.delete(ref); // Does not close the owned launch.
    return {cleanupConfirmed};
  }
  async function sweep(){
    const now=runtime.now();
    for(const record of [...state.dialogs.values()])if(now>=Date.parse(record.expiresAt)){
      record.state=record.dialogRef?'expired-open':'expired-no-dialog';
    }
    for(const record of [...state.pickers.values()])if(now>=Date.parse(record.expiresAt)){
      if(record.releasePolicy==='cancel'&&record.state==='open'){const ok=await removePicker(record,'cancel');if(ok)state.pickers.delete(record.watchRef);}
      else if(record.state!=='provided'){record.state='expired';}
    }
    for(const [file,entry] of [...state.staged])if(now-entry.createdAt>MAX_STAGED_AGE){try{await unlink(file);state.staged.delete(file);}catch{}}
    for(const [ref,record] of state.downloads)if(now-record.createdAt>DAY)state.downloads.delete(ref);
    return true;
  }

    return {handlers,contextFor,controlLane,localOnly,localCompute,probe,readinessFor,beforeWrite,cleanupContext,cleanupClient,sweep,state,
      documentGone({ownerRef,contextRef,tabRef,documentGeneration}){
        audits?.documentGone?.({ownerRef,contextRef,tabRef,documentGeneration});
        companion?.invalidateTab?.(ownerRef,contextRef,tabRef);
      },
      setAuditTickets(value){audits=value;return true;},
      async runIsolatedAudit(input){
        if(!companion)throw new BrowserError('BACKEND_UNAVAILABLE','Companion audit backend is unavailable');
        const tab=runtime.tabs.get(input.tabRef),ctx=runtime.contexts.get(input.contextRef);
        if(!tab||tab.retired||tab.clientRef!==input.ownerRef||tab.contextRef!==input.contextRef||!ctx?.alive||tab.generation!==input.documentGeneration)
          throw new BrowserError('STALE_DOCUMENT','The audited tab document changed before dispatch');
        const binding=getBinding({client:{id:input.ownerRef},ctx},tab);
        const auditOp={client:{id:input.ownerRef},ctx,requestId:opaque('req'),deadline:input.deadline,signal:input.signal,dispatchState:'notSent'};
        const leaseRef=await lease(auditOp,tab,binding);
        const base={protocol:1,requestId:opaque('req'),connectionEpoch:binding.connectionEpoch,profileSessionRef:binding.profileSessionRef,
          pairRef:binding.pairRef,leaseRef,tabRef:tab.ref,deadline:input.deadline};
        const started=await companionData(auditOp,{...base,requestId:opaque('cmp'),operation:'ax.audit.start',payload:{ownerRef:input.ownerRef,contextRef:input.contextRef,
          documentToken:tab.docToken,generation:input.documentGeneration,standard:input.standard,includeIncomplete:input.includeIncomplete,limit:input.limit}});
        if(typeof started.auditRef!=='string'||started.state!=='running')throw new BrowserError('BACKEND_FAILURE','Companion did not start the axe audit');
        let result=null;
        while(runtime.now()<input.deadline){
          await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(1,input.deadline-runtime.now()))));
          const polled=await companionData(auditOp,{...base,requestId:opaque('cmp'),operation:'ax.audit.status',payload:{ownerRef:input.ownerRef,contextRef:input.contextRef,auditRef:started.auditRef}});
          if(polled.state==='complete'&&object(polled.result)){result=polled.result;break;}
          if(polled.state==='unknown'||polled.state==='cancelled')throw new BrowserError('BACKEND_FAILURE','Companion axe ticket became unavailable');
        }
        if(!result)throw new BrowserError('TIMEOUT','Companion axe ticket did not complete before its deadline');
        return result;
      }};
}

function downloadView(data,action,downloadRef){
  const states=['in_progress','complete','interrupted','cancelled','unknown'];
  return {action,downloadRef,state:states.includes(data.state)?data.state:'unknown',fileName:typeof data.fileName==='string'?data.fileName.slice(0,512):null,
    bytesReceived:Number.isSafeInteger(data.bytesReceived)&&data.bytesReceived>=0?data.bytesReceived:0,
    totalBytes:Number.isSafeInteger(data.totalBytes)&&data.totalBytes>=0?data.totalBytes:null,
    completedAt:typeof data.completedAt==='string'?data.completedAt:null,
    completionEvidence:['downloads.onChanged','downloads.search'].includes(data.completionEvidence)?data.completionEvidence:'none',
    dispatchState:['notSent','sent','acknowledged','unknown'].includes(data.dispatchState)?data.dispatchState:action==='get'?'notSent':'acknowledged'};
}
function launchView(data,action){
  const states=['starting','running_unpaired','closed','failed','unknown'];
  return {action,launchRef:data.launchRef,state:states.includes(data.state)?data.state:'unknown',processOwned:data.processOwned===true,
    browserVersion:typeof data.browserVersion==='string'?data.browserVersion:null,connectionRef:null,tabRef:null,automationReady:false,
    reason:['SEPARATE_BRIDGE_ATTACHMENT_REQUIRED','PROFILE_BUSY','OWNERSHIP_UNPROVEN'].includes(data.reason)?data.reason:
      data.state==='running_unpaired'?'SEPARATE_BRIDGE_ATTACHMENT_REQUIRED':null,
    dispatchState:['notSent','sent','acknowledged','unknown'].includes(data.dispatchState)?data.dispatchState:'acknowledged'};
}
