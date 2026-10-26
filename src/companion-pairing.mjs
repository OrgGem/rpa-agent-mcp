import {randomBytes as cryptoRandomBytes} from 'node:crypto';
import {reject} from './browser-tools.mjs';

export const PINNED_UIPATH_EXTENSION_ID='jfcmnbofjlffnejneillkgbniiidiigd';
const PAIRING_TTL_MS=30_000;
const noncePattern=/^[A-Za-z0-9_-]{43}$/;
const isRef=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
const isEpoch=value=>Number.isSafeInteger(value)&&value>=0;
const isPageOrigin=value=>{
  if(typeof value!=='string'||!value||value.length>512)return false;
  try{const parsed=new URL(value);return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password&&parsed.origin===value;}
  catch{return false;}
};
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
const logicalKey=({ownerRef,contextRef,tabRef})=>JSON.stringify([ownerRef,contextRef,tabRef]);
const sameBinding=(record,ownerRef,contextRef,tabRef)=>record.ownerRef===ownerRef&&record.contextRef===contextRef&&record.tabRef===tabRef;
const profileSessions=record=>record.profileSessionRef?[record.profileSessionRef]:[...(record.profileEpochs?.keys?.()??[])];
const sameBrowserTarget=(a,b,session)=>a.nativeTabId===b.nativeTabId&&a.windowId===b.windowId&&profileSessions(a).includes(session)&&profileSessions(b).includes(session);

function validAttestation(value){
  if(!exactKeys(value,['nonce','ownerRef','contextRef','tabRef','documentToken','generation','hostEpoch','companionEpoch','profileSessionRef','sender'])||
    typeof value.nonce!=='string'||!noncePattern.test(value.nonce)||!isRef(value.ownerRef)||!isRef(value.contextRef)||!isRef(value.tabRef)||
    !isRef(value.documentToken)||!Number.isSafeInteger(value.generation)||value.generation<0||!isEpoch(value.hostEpoch)||!isEpoch(value.companionEpoch)||
    !isRef(value.profileSessionRef)||!exactKeys(value.sender,['id','origin','tabId','windowId','frameId','documentId']))return false;
  const sender=value.sender;
  return sender.id===PINNED_UIPATH_EXTENSION_ID&&isPageOrigin(sender.origin)&&
    Number.isSafeInteger(sender.tabId)&&sender.tabId>=0&&Number.isSafeInteger(sender.windowId)&&sender.windowId>=0&&sender.frameId===0&&isRef(sender.documentId);
}

export function createCompanionPairingRegistry({now=Date.now,randomBytes=cryptoRandomBytes,maxPending=64,maxBindings=128}={}){
  if(typeof now!=='function'||typeof randomBytes!=='function'||!Number.isSafeInteger(maxPending)||maxPending<1||!Number.isSafeInteger(maxBindings)||maxBindings<1)
    reject('INVALID_ARGUMENT','Invalid pairing registry configuration');
  const pending=new Map(),bindings=new Map(),issuedNonces=new Set();
  const activeCompanionEpochs=new Map();let transportDetach=null,disposed=false;
  const checkLive=()=>{if(disposed)reject('REGISTRY_DISPOSED','Pairing registry has been disposed');};
  const prune=()=>{const time=now();for(const [nonce,p] of pending)if(time>=p.expiresAt)pending.delete(nonce);};
  const allTargets=()=>[...pending.values(),...bindings.values()];
  const clearWhere=predicate=>{
    let count=0;
    for(const [nonce,p] of pending)if(predicate(p)){pending.delete(nonce);count++;}
    for(const [ref,b] of bindings)if(predicate(b)){bindings.delete(ref);count++;}
    return count;
  };
  const acceptAttestation=value=>{
    if(disposed)return false;
    prune();
    if(!validAttestation(value))return false;
    const p=pending.get(value.nonce);if(!p)return false;
    const expectedEpoch=p.profileEpochs.get(value.profileSessionRef),activeEpoch=activeCompanionEpochs.get(value.profileSessionRef);
    if(now()>=p.expiresAt||expectedEpoch===undefined||expectedEpoch!==activeEpoch||value.companionEpoch!==activeEpoch)return false;
    if(value.ownerRef!==p.ownerRef||value.contextRef!==p.contextRef||value.tabRef!==p.tabRef||value.documentToken!==p.documentToken||
      value.generation!==p.generation||value.hostEpoch!==p.hostEpoch||value.companionEpoch!==expectedEpoch||
      value.sender.tabId!==p.nativeTabId||value.sender.windowId!==p.windowId||p.permittedOrigin&&value.sender.origin!==p.permittedOrigin)return false;
    if(allTargets().some(record=>record!==p&&(record.logicalKey===p.logicalKey||sameBrowserTarget(record,p,value.profileSessionRef))))return false;
    pending.delete(value.nonce); // A well-formed, matching challenge is single-use even if capacity was exhausted.
    if(bindings.size>=maxBindings)return false;
    const bindingRef=`pair_${p.nonce}`;
    const {profileEpochs,...boundTarget}=p;
    bindings.set(bindingRef,{...boundTarget,bindingRef,profileSessionRef:value.profileSessionRef,companionEpoch:value.companionEpoch,documentId:value.sender.documentId,pairedAt:now()});
    return true;
  };
  const removePendingProfile=(profileSessionRef,companionEpoch)=>{
    for(const [nonce,record] of pending){
      if(record.profileEpochs.get(profileSessionRef)!==companionEpoch)continue;
      record.profileEpochs.delete(profileSessionRef);if(!record.profileEpochs.size)pending.delete(nonce);
    }
  };
  const onEpoch=identity=>{
    if(disposed||!identity||!isRef(identity.profileSessionRef)||!isEpoch(identity.companionEpoch))return false;
    const {profileSessionRef,companionEpoch}=identity,previous=activeCompanionEpochs.get(profileSessionRef);
    if(previous!==undefined&&previous!==companionEpoch){
      clearWhere(record=>record.profileSessionRef===profileSessionRef&&record.companionEpoch===previous);
      removePendingProfile(profileSessionRef,previous);
    }
    activeCompanionEpochs.set(profileSessionRef,companionEpoch);
    return true;
  };
  const onDisconnect=identity=>{
    if(disposed||!identity||!isRef(identity.profileSessionRef)||!isEpoch(identity.companionEpoch)||activeCompanionEpochs.get(identity.profileSessionRef)!==identity.companionEpoch)return false;
    const {profileSessionRef,companionEpoch}=identity;activeCompanionEpochs.delete(profileSessionRef);
    clearWhere(record=>record.profileSessionRef===profileSessionRef&&record.companionEpoch===companionEpoch);
    removePendingProfile(profileSessionRef,companionEpoch);return true;
  };
  const api={
    attachTransport(transport){
      checkLive();
      if(transportDetach)reject('PAIRING_TRANSPORT_BUSY','A companion transport is already attached');
      if(!transport||typeof transport.subscribePairingEvents!=='function')reject('INVALID_ARGUMENT','A validated companion transport is required');
      let detach;
      try{detach=transport.subscribePairingEvents({onEpoch,onDisconnect,onAttestation:acceptAttestation});}
      catch{reject('BACKEND_FAILURE','Could not attach the validated companion transport');}
      if(typeof detach!=='function')reject('BACKEND_FAILURE','Companion transport did not provide an unsubscribe function');
      transportDetach=detach;return true;
    },
    begin({ownerRef,contextRef,tabRef,nativeTabId,windowId,documentToken,generation,hostEpoch,permittedOrigin}={}){
      checkLive();prune();
      if(!isRef(ownerRef)||!isRef(contextRef)||!isRef(tabRef)||!Number.isSafeInteger(nativeTabId)||nativeTabId<0||
        !Number.isSafeInteger(windowId)||windowId<0||!isRef(documentToken)||!Number.isSafeInteger(generation)||generation<0||!isEpoch(hostEpoch)||
        permittedOrigin!==undefined&&!isPageOrigin(permittedOrigin))
        reject('INVALID_ARGUMENT','Pairing target identity is invalid');
      if(activeCompanionEpochs.size===0)reject('BACKEND_UNAVAILABLE','No validated companion epoch is connected');
      const target={ownerRef,contextRef,tabRef,nativeTabId,windowId,documentToken,generation,hostEpoch,profileEpochs:new Map(activeCompanionEpochs),permittedOrigin:permittedOrigin??null};
      target.logicalKey=logicalKey(target);
      if(allTargets().some(record=>record.logicalKey===target.logicalKey||profileSessions(target).some(session=>sameBrowserTarget(record,target,session)&&record.documentToken===target.documentToken)))
        reject('PAIRING_DUPLICATE','A pairing already owns this tab or scoped reference');
      if(pending.size>=maxPending)reject('LIMIT_EXCEEDED','Pending pairing limit exceeded');
      let nonce;
      for(let attempt=0;attempt<8;attempt++){
        let bytes;try{bytes=randomBytes(32);}catch{reject('BACKEND_FAILURE','Could not generate a pairing nonce');}
        if(!Buffer.isBuffer(bytes)||bytes.length!==32)reject('BACKEND_FAILURE','Pairing nonce source must return 32 random bytes');
        nonce=bytes.toString('base64url');if(!issuedNonces.has(nonce))break;nonce=null;
      }
      if(!nonce)reject('BACKEND_FAILURE','Pairing nonce source repeated a previously issued value');
      issuedNonces.add(nonce);
      const expiresAt=now()+PAIRING_TTL_MS;
      pending.set(nonce,{...target,nonce,expiresAt});
      return {nonce,expiresAt};
    },
    getBinding({ownerRef,contextRef,tabRef}={}){
      checkLive();prune();
      const b=[...bindings.values()].find(record=>sameBinding(record,ownerRef,contextRef,tabRef));
      if(!b)return null;
      return {pairRef:b.bindingRef,ownerRef:b.ownerRef,contextRef:b.contextRef,tabRef:b.tabRef,
        documentToken:b.documentToken,generation:b.generation,hostEpoch:b.hostEpoch,
        companionEpoch:b.companionEpoch,profileSessionRef:b.profileSessionRef,pairedAt:b.pairedAt};
    },
    getBindingByPairRef(pairRef){
      checkLive();prune();const b=bindings.get(pairRef);if(!b)return null;
      return {pairRef:b.bindingRef,ownerRef:b.ownerRef,contextRef:b.contextRef,tabRef:b.tabRef,
        documentToken:b.documentToken,generation:b.generation,hostEpoch:b.hostEpoch,
        companionEpoch:b.companionEpoch,profileSessionRef:b.profileSessionRef,pairedAt:b.pairedAt};
    },
    invalidateContext(ownerRef,contextRef){
      checkLive();return clearWhere(record=>record.ownerRef===ownerRef&&record.contextRef===contextRef);
    },
    invalidateTab(ownerRef,contextRef,tabRef){
      checkLive();return clearWhere(record=>sameBinding(record,ownerRef,contextRef,tabRef));
    },
    invalidateHostEpoch(ownerRef,hostEpoch){
      checkLive();return clearWhere(record=>record.ownerRef===ownerRef&&record.hostEpoch===hostEpoch);
    },
    invalidateCompanionEpoch(companionEpoch,profileSessionRef){
      checkLive();
      let count=clearWhere(record=>record.companionEpoch===companionEpoch&&(!profileSessionRef||record.profileSessionRef===profileSessionRef));
      for(const [session,epoch] of activeCompanionEpochs)if(epoch===companionEpoch&&(!profileSessionRef||session===profileSessionRef))activeCompanionEpochs.delete(session);
      for(const [nonce,record] of pending){let removed=false;for(const [session,epoch] of record.profileEpochs)if(epoch===companionEpoch&&(!profileSessionRef||session===profileSessionRef)){record.profileEpochs.delete(session);removed=true;}if(removed)count++;if(!record.profileEpochs.size)pending.delete(nonce);}
      return count;
    },
    dispose(){
      if(disposed)return;
      disposed=true;
      try{transportDetach?.();}catch{}
      transportDetach=null;pending.clear();bindings.clear();issuedNonces.clear();activeCompanionEpochs.clear();
    },
    get size(){return {pending:pending.size,bindings:bindings.size};}
  };
  return api;
}
