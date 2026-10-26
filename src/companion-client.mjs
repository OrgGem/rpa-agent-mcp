import {randomBytes} from 'node:crypto';
import {existsSync,lstatSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {createCompanionPairingRegistry} from './companion-pairing.mjs';
import {COMPANION_ENDPOINT,computeCompanionEndpoint} from './companion-endpoint.mjs';
import {COMPANION_EXTENSION_ID,COMPANION_PROTOCOL,MAX_COMPANION_EVENT_BYTES,MAX_COMPANION_REQUEST_BYTES,validateCompanionEvent,validateCompanionReply,validateCompanionRequest} from './companion-protocol.mjs';

const ref=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
const isInt=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));
const codeError=(code,message=code,dispatchState='notSent')=>Object.assign(new Error(message),{code,dispatchState});
const unknownOutcome=(message='Companion request outcome is unknown')=>codeError('UNKNOWN_OUTCOME',message,'unknown');
const frame=message=>{const body=Buffer.from(JSON.stringify(message));if(body.length>MAX_COMPANION_REQUEST_BYTES)throw codeError('INVALID_REQUEST');const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);};
const readFrames=(socket,onMessage,onClose,maxBytes=MAX_COMPANION_REQUEST_BYTES)=>{
  let buffer=Buffer.alloc(0),closed=false;
  const fail=()=>{if(closed)return;closed=true;socket.destroy();onClose?.();};
  socket.on('data',chunk=>{
    if(closed)return;buffer=buffer.length?Buffer.concat([buffer,chunk]):chunk;
    while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(size<2||size>maxBytes){fail();return;}if(buffer.length<4+size)return;
      const raw=buffer.subarray(4,4+size);buffer=buffer.subarray(4+size);
      try{const parsed=JSON.parse(raw.toString('utf8'));onMessage(parsed);}catch{fail();return;}
    }
  });
  socket.on('error',()=>fail());socket.on('close',()=>{if(!closed){closed=true;onClose?.();}});
  return {close:fail};
};

export {COMPANION_EXTENSION_ID};
export {COMPANION_ENDPOINT,computeCompanionEndpoint};

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function createCompanionClient({root=ROOT,endpoint=computeCompanionEndpoint({root}),now=Date.now,randomBytes:random=randomBytes,maxConnections=16}={}){
  if(typeof now!=='function'||typeof random!=='function'||!Number.isSafeInteger(maxConnections)||maxConnections<1)throw new TypeError('Invalid companion client configuration');
  const server=net.createServer(),connections=new Map(),requests=new Map(),requestTombstones=new Set(),listeners=new Set(),pairingWaiters=new Set(),eventWaiters=new Set();
  const ownedContexts=new Map(),pendingTargets=new Map(),pendingTimers=new Map();
  const registry=createCompanionPairingRegistry({now,randomBytes:random});
  let pairingCallbacks=null;
  let started=false,disposed=false,connectionSequence=0,listenPromise=null;
  registry.attachTransport({subscribePairingEvents(callbacks){pairingCallbacks=callbacks;return()=>{pairingCallbacks=null;};}});

  const ensureLive=()=>{if(disposed)throw codeError('BACKEND_UNAVAILABLE','Companion client is disposed');};
  const currentConnection=profileSessionRef=>connections.get(profileSessionRef);
  const send=(connection,message)=>{
    if(!connection||connection.closed||connection.socket.destroyed)throw codeError('BACKEND_UNAVAILABLE','Companion transport disconnected');
    try{connection.socket.write(frame(message));}catch{throw codeError('BACKEND_UNAVAILABLE','Companion transport write failed');}
  };
  const tombstoneRequest=key=>{
    requestTombstones.delete(key);requestTombstones.add(key);
    while(requestTombstones.size>4096)requestTombstones.delete(requestTombstones.values().next().value);
  };
  const finishRequest=(key,entry,error,value)=>{
    if(requests.get(key)!==entry)return false;
    requests.delete(key);clearTimeout(entry.timer);entry.signal?.removeEventListener('abort',entry.abort);
    if(entry.dispatched)tombstoneRequest(key);
    if(error)entry.reject(error);else entry.resolve(value);
    return true;
  };
  const rejectWaiters=(connection,error)=>{
    for(const [key,entry] of requests)if(entry.connection===connection)finishRequest(key,entry,entry.dispatched?unknownOutcome('Companion disconnected after request dispatch'):error);
  };
  const disconnect=connection=>{
    if(connection.closed)return;connection.closed=true;
    if(connections.get(connection.profileSessionRef)===connection){connections.delete(connection.profileSessionRef);pairingCallbacks?.onDisconnect({profileSessionRef:connection.profileSessionRef,companionEpoch:connection.companionEpoch});}
    rejectWaiters(connection,codeError('BACKEND_UNAVAILABLE','Companion native transport disconnected'));
  };
  const resolvePairingWaiters=()=>{
    for(const entry of [...pairingWaiters]){
      const binding=getBinding(entry.target);if(binding){pairingWaiters.delete(entry);entry.finish(null,binding);}
    }
  };
  const onHostMessage=(connection,message)=>{
    if(!message||typeof message!=='object'||Array.isArray(message))return;
    if(message.type==='hello'){
      const required=['type','protocol','profileSessionRef','companionEpoch','extensionId','extensionVersion','browserVersion','capabilities'];
      if(!exact(message,required)||message.protocol!==COMPANION_PROTOCOL||!ref(message.profileSessionRef)||!isInt(message.companionEpoch)||
        message.extensionId!==COMPANION_EXTENSION_ID||typeof message.extensionVersion!=='string'||typeof message.browserVersion!=='string'||
        !exact(message.capabilities,['keys','dialogs','filePicker','downloads','axQuery','axAudit','axeCoreVersion'])||
        ['keys','dialogs','filePicker','downloads','axQuery','axAudit'].some(k=>typeof message.capabilities[k]!=='boolean')||
        !(message.capabilities.axeCoreVersion===null||typeof message.capabilities.axeCoreVersion==='string')){connection.socket.destroy();return;}
      const old=connections.get(message.profileSessionRef);
      if(old&&old!==connection)disconnect(old);
      connection.profileSessionRef=message.profileSessionRef;connection.companionEpoch=message.companionEpoch;connection.connectionEpoch=++connectionSequence;connection.capabilities={...message.capabilities};
      connections.set(message.profileSessionRef,connection);
      pairingCallbacks?.onEpoch({profileSessionRef:connection.profileSessionRef,companionEpoch:connection.companionEpoch});
      try{send(connection,{type:'epoch',protocol:COMPANION_PROTOCOL,connectionEpoch:connection.connectionEpoch});}catch{connection.socket.destroy();return;}
      resolvePairingWaiters();return;
    }
    if(!connection.profileSessionRef||message.profileSessionRef!==connection.profileSessionRef||message.companionEpoch!==connection.companionEpoch)return;
    if(message.type==='pair.attestation'){
      if(message.protocol!==COMPANION_PROTOCOL||!exact(message,['type','protocol','profileSessionRef','companionEpoch','attestation']))return;
      const raw=message.attestation;if(!raw||!exact(raw,['nonce','documentToken','sender'])||!ref(raw.nonce)||!ref(raw.documentToken)||!raw.sender||!exact(raw.sender,['id','origin','tabId','windowId','frameId','documentId']))return;
      const pending=pendingTargets.get(raw.nonce);if(!pending||now()>=pending.expiresAt||raw.documentToken!==pending.documentToken)return;
      const normalized={nonce:raw.nonce,ownerRef:pending.ownerRef,contextRef:pending.contextRef,tabRef:pending.tabRef,documentToken:raw.documentToken,
        generation:pending.generation,hostEpoch:pending.hostEpoch,companionEpoch:connection.companionEpoch,profileSessionRef:connection.profileSessionRef,sender:raw.sender};
      if(pairingCallbacks?.onAttestation(normalized)){pendingTargets.delete(raw.nonce);clearTimeout(pendingTimers.get(raw.nonce));pendingTimers.delete(raw.nonce);resolvePairingWaiters();}
      return;
    }
    if(message.type==='reply'){
      if(!exact(message,['type','profileSessionRef','companionEpoch','reply'])||!validateCompanionReply(message.reply))return;
      const key=`${connection.profileSessionRef}:${message.reply.connectionEpoch}:${message.reply.requestId}`,entry=requests.get(key);
      if(!entry||entry.connection!==connection)return;
      if(message.reply.ok){finishRequest(key,entry,null,message.reply.data);recordOwnedResult(entry.request,message.reply.data);}
      else finishRequest(key,entry,message.reply.error==='UNKNOWN_OUTCOME'?unknownOutcome():codeError(message.reply.error));return;
    }
    if(message.type==='event'){
      if(!exact(message,['type','profileSessionRef','companionEpoch','event'])||!validateCompanionEvent(message.event)||message.event.connectionEpoch!==connection.connectionEpoch)return;
      const event={...message.event,profileSessionRef:connection.profileSessionRef,companionEpoch:connection.companionEpoch};
      for(const listener of [...listeners])try{listener(event);}catch{}
      for(const waiter of [...eventWaiters])if(waiter.matches(event)){eventWaiters.delete(waiter);waiter.finish(null,event);}
    }
  };
  const recordOwnedResult=(request,data)=>{
    const p=request.payload;if(!p?.ownerRef||!p?.contextRef)return;
    const key=JSON.stringify([p.ownerRef,p.contextRef]),state=ownedContexts.get(key)??{ownerRef:p.ownerRef,contextRef:p.contextRef,leases:new Map(),watches:new Map(),pairings:new Set()};
    if(request.operation==='debugger.acquire'&&data?.leaseRef)state.leases.set(data.leaseRef,{pairRef:request.pairRef,tabRef:request.tabRef,profileSessionRef:request.profileSessionRef});
    if(request.operation==='debugger.release'&&request.leaseRef)state.leases.delete(request.leaseRef);
    if(request.operation==='dialog.arm'&&data?.dialogWatchRef)state.watches.set(data.dialogWatchRef,{kind:'dialog',leaseRef:request.leaseRef,pairRef:request.pairRef,tabRef:request.tabRef,releasePolicy:p.releasePolicy});
    if(request.operation==='dialog.wait'&&state.watches.has(p.dialogWatchRef))Object.assign(state.watches.get(p.dialogWatchRef),{dialogState:data?.state,dialogRef:data?.dialogRef});
    if(request.operation==='file.arm'&&data?.pickerWatchRef)state.watches.set(data.pickerWatchRef,{kind:'file',leaseRef:request.leaseRef,pairRef:request.pairRef,tabRef:request.tabRef,releasePolicy:p.releasePolicy});
    if(request.operation==='file.wait'&&state.watches.has(p.pickerWatchRef))Object.assign(state.watches.get(p.pickerWatchRef),{pickerRef:data?.pickerRef??null});
    if(request.operation==='file.release'&&p.pickerRef){for(const [watchRef,watch] of state.watches)if(watch.pickerRef===p.pickerRef)state.watches.delete(watchRef);}
    if(request.operation==='file.cancel'&&p.pickerWatchRef)state.watches.delete(p.pickerWatchRef);
    ownedContexts.set(key,state);
    const binding=registry.getBinding({ownerRef:p.ownerRef,contextRef:p.contextRef,tabRef:request.tabRef});if(binding)state.pairings.add(request.tabRef);
  };
  const acceptSocket=socket=>{
    if(disposed||connections.size>=maxConnections){socket.destroy();return;}
    const connection={socket,profileSessionRef:null,companionEpoch:null,connectionEpoch:null,closed:false};
    readFrames(socket,message=>onHostMessage(connection,message),()=>disconnect(connection));
  };
  server.on('connection',acceptSocket);
  server.on('error',()=>{});
  const start=()=>{
    ensureLive();if(started)return Promise.resolve(readiness());if(listenPromise)return listenPromise;
    listenPromise=new Promise((resolveStart,rejectStart)=>{
      if(process.platform!=='win32'&&existsSync(endpoint)){
        try{if(!lstatSync(endpoint).isSocket()){rejectStart(codeError('BACKEND_BUSY','Companion endpoint path is occupied'));return;}unlinkSync(endpoint);}catch(error){rejectStart(codeError('BACKEND_BUSY','Companion endpoint path is occupied'));return;}
      }
      server.once('error',rejectStart);server.listen(endpoint,()=>{server.removeListener('error',rejectStart);started=true;resolveStart(readiness());});
    }).catch(error=>{listenPromise=null;throw error;});
    return listenPromise;
  };
  const readiness=()=>({ready:started&&!disposed,available:connections.size>0,connectedProfiles:connections.size,extensionId:COMPANION_EXTENSION_ID,protocol:COMPANION_PROTOCOL,endpoint,
    browser_capabilities:[...connections.values()].slice(0,maxConnections).map(c=>({profileSessionRef:c.profileSessionRef,companionEpoch:c.companionEpoch,connectionEpoch:c.connectionEpoch,...c.capabilities}))});
  const beginPairing=async target=>{
    await start();const challenge=registry.begin(target);pendingTargets.set(challenge.nonce,{...target,expiresAt:challenge.expiresAt});
    const timer=setTimeout(()=>{pendingTargets.delete(challenge.nonce);pendingTimers.delete(challenge.nonce);},Math.max(1,challenge.expiresAt-now()));pendingTimers.set(challenge.nonce,timer);
    return challenge;
  };
  const getBinding=target=>{
    const binding=registry.getBinding(target);if(!binding)return null;
    const connection=currentConnection(binding.profileSessionRef);
    if(!connection||connection.companionEpoch!==binding.companionEpoch)return null;
    return {...binding,connectionEpoch:connection.connectionEpoch};
  };
  const waitForPairing=async(target,{deadline=now()+30_000,signal}={})=>{
    ensureLive();const existing=getBinding(target);if(existing)return existing;
    if(signal?.aborted)throw codeError('CANCELLED');
    return new Promise((resolveWait,rejectWait)=>{
      const entry={target,finish:(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?rejectWait(error):resolveWait(value);}};
      const timer=setTimeout(()=>{pairingWaiters.delete(entry);entry.finish(codeError('TIMEOUT'));},Math.max(1,deadline-now()));
      const abort=()=>{pairingWaiters.delete(entry);entry.finish(codeError('CANCELLED'));};entry.abort=abort;pairingWaiters.add(entry);signal?.addEventListener('abort',abort,{once:true});
    });
  };
  const request=(envelope,{signal}={})=>{
    try{ensureLive();}catch(error){return Promise.reject(error);}
    if(signal?.aborted)return Promise.reject(codeError('CANCELLED'));
    let valid=false;try{valid=validateCompanionRequest(envelope);}catch{}
    if(!valid)return Promise.reject(codeError('INVALID_REQUEST'));
    const connection=currentConnection(envelope.profileSessionRef);
    if(!connection||connection.connectionEpoch!==envelope.connectionEpoch||connection.companionEpoch===null)return Promise.reject(codeError('BACKEND_UNAVAILABLE'));
    const downloadRead=['download.get','download.cancel'].includes(envelope.operation);
    if(!downloadRead){const binding=registry.getBindingByPairRef(envelope.pairRef);
      if(!binding||binding.ownerRef!==envelope.payload.ownerRef||envelope.payload.contextRef&&binding.contextRef!==envelope.payload.contextRef||
        binding.tabRef!==envelope.tabRef||binding.profileSessionRef!==envelope.profileSessionRef||binding.companionEpoch!==connection.companionEpoch)return Promise.reject(codeError('STALE_DOCUMENT'));}
    const key=`${envelope.profileSessionRef}:${envelope.connectionEpoch}:${envelope.requestId}`,fingerprint=JSON.stringify(envelope),previous=requests.get(key);
    if(previous)return previous.fingerprint===fingerprint?previous.promise:Promise.reject(codeError('INVALID_REQUEST'));
    if(requestTombstones.has(key))return Promise.reject(unknownOutcome('Request ID was already dispatched; refusing replay'));
    if(now()>=envelope.deadline)return Promise.reject(codeError('TIMEOUT'));
    if(connection.closed||connection.socket.destroyed)return Promise.reject(codeError('BACKEND_UNAVAILABLE'));
    let bytes;try{bytes=frame({type:'request',protocol:COMPANION_PROTOCOL,profileSessionRef:connection.profileSessionRef,companionEpoch:connection.companionEpoch,request:envelope});}
    catch(error){return Promise.reject(error?.code?error:codeError('INVALID_REQUEST'));}
    let resolveRequest,rejectRequest;const promise=new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;});
    const entry={connection,request:envelope,fingerprint,promise,resolve:resolveRequest,reject:rejectRequest,signal,dispatched:false};
    entry.timer=setTimeout(()=>finishRequest(key,entry,entry.dispatched?unknownOutcome():codeError('TIMEOUT')),Math.max(1,envelope.deadline-now()));
    entry.abort=()=>{if(requests.get(key)!==entry)return;finishRequest(key,entry,entry.dispatched?unknownOutcome():codeError('CANCELLED'));};
    requests.set(key,entry);signal?.addEventListener('abort',entry.abort,{once:true});
    // Recheck all local gates immediately before the write. A pre-dispatch failure is safe to retry.
    if(signal?.aborted){finishRequest(key,entry,codeError('CANCELLED'));return promise;}
    if(now()>=envelope.deadline){finishRequest(key,entry,codeError('TIMEOUT'));return promise;}
    if(connection.closed||connection.socket.destroyed){finishRequest(key,entry,codeError('BACKEND_UNAVAILABLE'));return promise;}
    entry.dispatched=true;
    try{connection.socket.write(bytes);}
    catch{finishRequest(key,entry,unknownOutcome('Companion socket failed during request dispatch'));}
    return promise;
  };
  const subscribeEvents=listener=>{if(typeof listener!=='function')throw new TypeError('Event listener must be a function');listeners.add(listener);return()=>listeners.delete(listener);};
  const waitForEvent=({ownerRef,contextRef,watchRef,kind,deadline=now()+30_000,signal}={})=>{
    const allowed=new Set(['dialog.opened','dialog.closed','file.opened','download.changed','debugger.detached']);
    if(!ref(ownerRef)||!ref(contextRef)||!ref(watchRef)||!allowed.has(kind))return Promise.reject(codeError('INVALID_REQUEST'));
    if(signal?.aborted)return Promise.reject(codeError('CANCELLED'));
    return new Promise((resolveWait,rejectWait)=>{
      const entry={matches:event=>event.payload?.ownerRef===ownerRef&&event.payload?.contextRef===contextRef&&
          (event.payload?.dialogWatchRef===watchRef||event.payload?.pickerWatchRef===watchRef)&&event.kind===kind,
        finish:(error,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?rejectWait(error):resolveWait(value);}};
      const timer=setTimeout(()=>{eventWaiters.delete(entry);entry.finish(codeError('TIMEOUT'));},Math.max(1,deadline-now()));
      const abort=()=>{eventWaiters.delete(entry);entry.finish(codeError('CANCELLED'));};eventWaiters.add(entry);signal?.addEventListener('abort',abort,{once:true});
    });
  };
  const cleanupContext=async({ownerRef,contextRef,deadline=now()+10_000}={})=>{
    const key=JSON.stringify([ownerRef,contextRef]),state=ownedContexts.get(key);if(!state)return {cleanupConfirmed:true,blockedTabRefs:[],cleanedPickerRefs:[]};
    const blockedTabRefs=new Set(),cleanedPickerRefs=[];let cleanupConfirmed=true;
    for(const [leaseRef,lease] of [...state.leases]){
      const connection=currentConnection(lease.profileSessionRef);if(!connection){cleanupConfirmed=false;blockedTabRefs.add(lease.tabRef);continue;}
      const envelope={protocol:COMPANION_PROTOCOL,requestId:`cleanup_${random(12).toString('hex')}`,connectionEpoch:connection.connectionEpoch,
        profileSessionRef:lease.profileSessionRef,pairRef:lease.pairRef,operation:'debugger.release',leaseRef,tabRef:lease.tabRef,deadline,
        payload:{ownerRef,contextRef,reason:'release'}};
      try{await request(envelope);state.leases.delete(leaseRef);}catch{cleanupConfirmed=false;blockedTabRefs.add(lease.tabRef);}
    }
    for(const watch of state.watches.values())if(watch.kind==='dialog'&&watch.dialogState&&String(watch.dialogState).startsWith('open')&&watch.releasePolicy!=='dismiss')blockedTabRefs.add(watch.tabRef);
    for(const [watchRef,watch] of [...state.watches])if(watch.kind==='file'){
      // File watch cleanup follows the owning lease release; paths stay staged until a release is acknowledged.
      if(!state.leases.has(watch.leaseRef)){state.watches.delete(watchRef);if(watch.pickerRef)cleanedPickerRefs.push(watchRef);}
      else{cleanupConfirmed=false;blockedTabRefs.add(watch.tabRef);}
    }
    registry.invalidateContext(ownerRef,contextRef);ownedContexts.delete(key);
    return {cleanupConfirmed,blockedTabRefs:[...blockedTabRefs],cleanedPickerRefs};
  };
  const cleanupClient=async({ownerRef,deadline=now()+15_000}={})=>{
    const results=[];for(const state of [...ownedContexts.values()])if(state.ownerRef===ownerRef)results.push(await cleanupContext({ownerRef,contextRef:state.contextRef,deadline}));
    return {cleanupConfirmed:results.every(x=>x.cleanupConfirmed),blockedTabRefs:[...new Set(results.flatMap(x=>x.blockedTabRefs))],cleanedPickerRefs:results.flatMap(x=>x.cleanedPickerRefs)};
  };
  const dispose=async()=>{
    if(disposed)return;for(const timer of pendingTimers.values())clearTimeout(timer);pendingTimers.clear();pendingTargets.clear();
    for(const entry of [...pairingWaiters])entry.finish(codeError('BACKEND_UNAVAILABLE'));for(const entry of [...eventWaiters])entry.finish(codeError('BACKEND_UNAVAILABLE'));
    for(const connection of connections.values()){connection.socket.destroy();disconnect(connection);}connections.clear();
    for(const [key,entry] of requests)finishRequest(key,entry,entry.dispatched?unknownOutcome('Companion client disposed after request dispatch'):codeError('BACKEND_UNAVAILABLE'));requests.clear();
    registry.dispose();disposed=true;
    if(started)await new Promise(resolveClose=>server.close(()=>resolveClose()));
    if(process.platform!=='win32'){try{if(existsSync(endpoint)&&lstatSync(endpoint).isSocket())unlinkSync(endpoint);}catch{}}
  };
  return {extensionId:COMPANION_EXTENSION_ID,endpoint,start,readiness,beginPairing,getBinding,waitForPairing,request,subscribeEvents,waitForEvent,cleanupContext,cleanupClient,dispose,
    invalidateContext:(ownerRef,contextRef)=>registry.invalidateContext(ownerRef,contextRef),
    invalidateTab:(ownerRef,contextRef,tabRef)=>registry.invalidateTab(ownerRef,contextRef,tabRef),
    invalidateHostEpoch:(ownerRef,hostEpoch)=>registry.invalidateHostEpoch(ownerRef,hostEpoch),
    get state(){return {started,disposed,profiles:connections.size,pendingRequests:requests.size,pendingPairings:pendingTargets.size};}};
}
