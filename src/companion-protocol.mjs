export const COMPANION_PROTOCOL=1;
export const COMPANION_EXTENSION_ID='dppcppnipbmolajgbbackncmhgejpena';
export const COMPANION_HOST_NAME='com.uipath.companion_v1';
export const COMPANION_OPERATIONS=Object.freeze([
  'debugger.acquire','debugger.release','keys.dispatch',
  'dialog.arm','dialog.trigger','dialog.wait','dialog.respond','dialog.cancel',
  'file.arm','file.trigger','file.wait','file.provide','file.release','file.cancel',
    'download.start','download.get','download.cancel','ax.query','ax.candidates','ax.audit.start','ax.audit.status','ax.audit.cancel'
]);
export const COMPANION_ERRORS=Object.freeze([
  'INVALID_REQUEST','BACKEND_UNAVAILABLE','BACKEND_BUSY','STALE_PROFILE','STALE_TAB','STALE_DOCUMENT',
  'POLICY_RESTRICTED','TARGET_UNSUPPORTED','TIMEOUT','UNKNOWN_OUTCOME'
]);
export const MAX_COMPANION_REQUEST_BYTES=256*1024;
export const MAX_COMPANION_REPLY_BYTES=256*1024;
export const MAX_COMPANION_EVENT_BYTES=16*1024;
export const COMPANION_KEY_CODES=Object.freeze({
  ENTER:{key:'Enter',code:'Enter',virtualKeyCode:13},TAB:{key:'Tab',code:'Tab',virtualKeyCode:9},
  ESCAPE:{key:'Escape',code:'Escape',virtualKeyCode:27},BACKSPACE:{key:'Backspace',code:'Backspace',virtualKeyCode:8},
  DELETE:{key:'Delete',code:'Delete',virtualKeyCode:46},SPACE:{key:' ',code:'Space',virtualKeyCode:32},
  ARROWUP:{key:'ArrowUp',code:'ArrowUp',virtualKeyCode:38},ARROWDOWN:{key:'ArrowDown',code:'ArrowDown',virtualKeyCode:40},
  ARROWLEFT:{key:'ArrowLeft',code:'ArrowLeft',virtualKeyCode:37},ARROWRIGHT:{key:'ArrowRight',code:'ArrowRight',virtualKeyCode:39},
  HOME:{key:'Home',code:'Home',virtualKeyCode:36},END:{key:'End',code:'End',virtualKeyCode:35},
  PAGEUP:{key:'PageUp',code:'PageUp',virtualKeyCode:33},PAGEDOWN:{key:'PageDown',code:'PageDown',virtualKeyCode:34},
  F1:{key:'F1',code:'F1',virtualKeyCode:112},F2:{key:'F2',code:'F2',virtualKeyCode:113},
  F3:{key:'F3',code:'F3',virtualKeyCode:114},F4:{key:'F4',code:'F4',virtualKeyCode:115},
  F5:{key:'F5',code:'F5',virtualKeyCode:116},F6:{key:'F6',code:'F6',virtualKeyCode:117},
  F7:{key:'F7',code:'F7',virtualKeyCode:118},F8:{key:'F8',code:'F8',virtualKeyCode:119},
  F9:{key:'F9',code:'F9',virtualKeyCode:120},F10:{key:'F10',code:'F10',virtualKeyCode:121},
  F11:{key:'F11',code:'F11',virtualKeyCode:122},F12:{key:'F12',code:'F12',virtualKeyCode:123}
});
export const COMPANION_MODIFIERS=Object.freeze({CTRL:{key:'Control',code:'ControlLeft',virtualKeyCode:17,bit:2},ALT:{key:'Alt',code:'AltLeft',virtualKeyCode:18,bit:1},SHIFT:{key:'Shift',code:'ShiftLeft',virtualKeyCode:16,bit:8},META:{key:'Meta',code:'MetaLeft',virtualKeyCode:91,bit:4}});
const ref=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!/[\u0000-\u001f\u007f]/.test(value);
const exact=(value,required,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)&&
  required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const safeInt=value=>Number.isSafeInteger(value)&&value>=0;
const nonEmpty=value=>typeof value==='string'&&value.length>0&&value.length<=4096;
const enumValue=(value,values)=>typeof value==='string'&&values.includes(value);
const jsonBytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const modifiers=['CTRL','ALT','SHIFT','META'];
const keys=Object.keys(COMPANION_KEY_CODES);
function validPayload(operation,p){
  if(!p||typeof p!=='object'||Array.isArray(p))return false;
  switch(operation){
    case 'debugger.acquire':return exact(p,['ownerRef','contextRef','documentToken','generation','ttlMs'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.documentToken)&&safeInt(p.generation)&&Number.isSafeInteger(p.ttlMs)&&p.ttlMs>=100&&p.ttlMs<=30000;
    case 'debugger.release':return exact(p,['ownerRef','contextRef','reason'])&&ref(p.ownerRef)&&ref(p.contextRef)&&enumValue(p.reason,['release','timeout','navigation','disconnect','dispose']);
    case 'keys.dispatch':return exact(p,['ownerRef','keys'])&&ref(p.ownerRef)&&Array.isArray(p.keys)&&p.keys.length>=1&&p.keys.length<=20&&p.keys.every(step=>exact(step,['key'],['modifiers'])&&enumValue(step.key,keys)&&(!Object.hasOwn(step,'modifiers')||Array.isArray(step.modifiers)&&step.modifiers.length<=4&&new Set(step.modifiers).size===step.modifiers.length&&step.modifiers.every(m=>enumValue(m,modifiers))));
    case 'dialog.arm':return exact(p,['ownerRef','contextRef','documentToken','generation','triggerRequestKey','mode','expectedType','mismatchPolicy','expiryPolicy','releasePolicy','ttlMs'],['expectedMessage','autoResponse'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.documentToken)&&safeInt(p.generation)&&ref(p.triggerRequestKey)&&enumValue(p.mode,['manual','auto'])&&enumValue(p.expectedType,['alert','confirm','prompt','beforeunload'])&&(!Object.hasOwn(p,'expectedMessage')||typeof p.expectedMessage==='string'&&p.expectedMessage.length<=1024)&&enumValue(p.mismatchPolicy,['dismiss','leaveOpen'])&&enumValue(p.expiryPolicy,['dismiss','leaveOpen'])&&enumValue(p.releasePolicy,['dismiss','detach'])&&Number.isSafeInteger(p.ttlMs)&&p.ttlMs>=100&&p.ttlMs<=30000&&
      (p.mode==='manual'?!Object.hasOwn(p,'autoResponse'):exact(p.autoResponse,['accept'],['promptText'])&&typeof p.autoResponse.accept==='boolean'&&(!Object.hasOwn(p.autoResponse,'promptText')||typeof p.autoResponse.promptText==='string'&&p.autoResponse.promptText.length<=1024));
    case 'dialog.trigger':return exact(p,['ownerRef','contextRef','dialogWatchRef','triggerRequestKey'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.dialogWatchRef)&&ref(p.triggerRequestKey);
    case 'dialog.wait':return exact(p,['ownerRef','contextRef','dialogWatchRef','timeoutMs'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.dialogWatchRef)&&Number.isSafeInteger(p.timeoutMs)&&p.timeoutMs>=100&&p.timeoutMs<=30000;
    case 'dialog.respond':return exact(p,['ownerRef','contextRef','dialogRef','accept'],['promptText'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.dialogRef)&&typeof p.accept==='boolean'&&(!Object.hasOwn(p,'promptText')||typeof p.promptText==='string'&&p.promptText.length<=1024);
    case 'dialog.cancel':return exact(p,['ownerRef','contextRef','dialogRef','disposition'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.dialogRef)&&p.disposition==='dismiss';
    case 'file.arm':return exact(p,['ownerRef','contextRef','documentToken','generation','triggerRequestKey','releasePolicy','ttlMs'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.documentToken)&&safeInt(p.generation)&&ref(p.triggerRequestKey)&&enumValue(p.releasePolicy,['cancel','detach'])&&Number.isSafeInteger(p.ttlMs)&&p.ttlMs>=100&&p.ttlMs<=30000;
    case 'file.trigger':return exact(p,['ownerRef','contextRef','pickerWatchRef','triggerRequestKey'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.pickerWatchRef)&&ref(p.triggerRequestKey);
    case 'file.wait':return exact(p,['ownerRef','contextRef','pickerWatchRef','timeoutMs'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.pickerWatchRef)&&Number.isSafeInteger(p.timeoutMs)&&p.timeoutMs>=100&&p.timeoutMs<=30000;
    case 'file.provide':return exact(p,['ownerRef','contextRef','pickerRef','files'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.pickerRef)&&Array.isArray(p.files)&&p.files.length>=1&&p.files.length<=10&&p.files.every(file=>exact(file,['path','sha256','bytes','name'])&&nonEmpty(file.path)&&/^[0-9a-f]{64}$/.test(file.sha256)&&Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=25*1024*1024&&/^[A-Za-z0-9_. -]{1,128}$/.test(file.name))&&p.files.reduce((n,file)=>n+file.bytes,0)<=50*1024*1024;
    case 'file.release':return exact(p,['ownerRef','contextRef','pickerRef'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.pickerRef);
    case 'file.cancel':return exact(p,['ownerRef','contextRef','pickerWatchRef'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.pickerWatchRef);
    case 'download.start':return exact(p,['ownerRef','url'],['filename'])&&ref(p.ownerRef)&&validDownloadUrl(p.url)&&(!Object.hasOwn(p,'filename')||validFilename(p.filename));
    case 'download.get':case 'download.cancel':return exact(p,['ownerRef','downloadRef'])&&ref(p.ownerRef)&&ref(p.downloadRef);
    case 'ax.query':return exact(p,['ownerRef','contextRef','documentToken','generation','role','accessibleName','includeDisabled','limit'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.documentToken)&&safeInt(p.generation)&&enumValue(p.role,['alert','button','checkbox','combobox','dialog','grid','gridcell','heading','img','link','list','listbox','listitem','menu','menuitem','option','progressbar','radio','row','scrollbar','searchbox','slider','spinbutton','status','switch','tab','table','textbox','toolbar','tooltip','treeitem'])&&typeof p.accessibleName==='string'&&p.accessibleName.length>=1&&p.accessibleName.length<=256&&typeof p.includeDisabled==='boolean'&&Number.isSafeInteger(p.limit)&&p.limit>=1&&p.limit<=100;
    case 'ax.candidates':return exact(p,['ownerRef','contextRef','documentToken','generation','limit'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.documentToken)&&safeInt(p.generation)&&Number.isSafeInteger(p.limit)&&p.limit>=1&&p.limit<=100;
    case 'ax.audit.start':return exact(p,['ownerRef','contextRef','documentToken','generation','standard','includeIncomplete','limit'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.documentToken)&&safeInt(p.generation)&&enumValue(p.standard,['WCAG21AA','WCAG22AA'])&&typeof p.includeIncomplete==='boolean'&&Number.isSafeInteger(p.limit)&&p.limit>=1&&p.limit<=100;
    case 'ax.audit.status':case 'ax.audit.cancel':return exact(p,['ownerRef','contextRef','auditRef'])&&ref(p.ownerRef)&&ref(p.contextRef)&&ref(p.auditRef);
    default:return false;
  }
}
export function validDownloadUrl(value){let parsed;try{parsed=new URL(value);}catch{return false;}return ['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}
export function validFilename(value){return typeof value==='string'&&value.length<=255&&!/[\\/]/.test(value)&&!value.includes('..')&&/^[A-Za-z0-9_. -]+$/.test(value);}
export function validateCompanionRequest(value){
  if(!exact(value,['protocol','requestId','connectionEpoch','profileSessionRef','pairRef','operation','leaseRef','tabRef','deadline','payload'])||
    value.protocol!==COMPANION_PROTOCOL||!ref(value.requestId)||!safeInt(value.connectionEpoch)||!ref(value.profileSessionRef)||
    !enumValue(value.operation,COMPANION_OPERATIONS)||!Number.isSafeInteger(value.deadline)||value.deadline<1)return false;
  const downloadRead=['download.get','download.cancel'].includes(value.operation);
  if(downloadRead?value.pairRef!==null||value.leaseRef!==null||value.tabRef!==null:
    !ref(value.pairRef)||!ref(value.tabRef)||(value.operation==='debugger.acquire'?value.leaseRef!==null:
      ['download.start'].includes(value.operation)?value.leaseRef!==null:!ref(value.leaseRef)))return false;
  return validPayload(value.operation,value.payload)&&jsonBytes(value)<=MAX_COMPANION_REQUEST_BYTES;
}
export function validateCompanionReply(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.protocol!==COMPANION_PROTOCOL||!ref(value.requestId)||!safeInt(value.connectionEpoch)||typeof value.ok!=='boolean')return false;
  if(value.ok){if(!exact(value,['protocol','requestId','connectionEpoch','ok','data']))return false;}
  else if(!exact(value,['protocol','requestId','connectionEpoch','ok','error'])||!enumValue(value.error,COMPANION_ERRORS))return false;
  return jsonBytes(value)<=MAX_COMPANION_REPLY_BYTES;
}
export function validateCompanionEvent(value){
  if(!exact(value,['protocol','connectionEpoch','eventId','leaseRef','tabRef','kind','sequence','payload'])||
    value.protocol!==COMPANION_PROTOCOL||!safeInt(value.connectionEpoch)||!ref(value.eventId)||
    !(value.leaseRef===null||ref(value.leaseRef))||!(value.tabRef===null||ref(value.tabRef))||!safeInt(value.sequence))return false;
  const allowed={
    'dialog.opened':['ownerRef','contextRef','dialogWatchRef','dialogRef','type','message','state','handledBy'],
    'dialog.closed':['ownerRef','contextRef','dialogWatchRef','dialogRef','dispatchState','cleanupState'],
    'file.opened':['ownerRef','contextRef','pickerWatchRef','pickerRef','mode'],
    'download.changed':['ownerRef','downloadRef','state','fileName','bytesReceived','totalBytes','completedAt'],
    'debugger.detached':['reason']
  };
  const required=allowed[value.kind];if(!required||!exact(value.payload,required))return false;
  const p=value.payload;
  if(value.kind==='dialog.opened'&&(!ref(p.ownerRef)||!ref(p.contextRef)||!ref(p.dialogWatchRef)||!ref(p.dialogRef)||!enumValue(p.type,['alert','confirm','prompt','beforeunload'])||typeof p.message!=='string'||p.message.length>1024||!enumValue(p.state,['open-manual','open-mismatch'])||!enumValue(p.handledBy,['manual','mismatch-policy'])))return false;
  if(value.kind==='dialog.closed'&&(!ref(p.ownerRef)||!ref(p.contextRef)||!ref(p.dialogWatchRef)||!ref(p.dialogRef)||!enumValue(p.dispatchState,['acknowledged','unknown'])||!enumValue(p.cleanupState,['released','unknown','retained'])))return false;
  if(value.kind==='file.opened'&&(!ref(p.ownerRef)||!ref(p.contextRef)||!ref(p.pickerWatchRef)||!ref(p.pickerRef)||!enumValue(p.mode,['selectSingle','selectMultiple'])))return false;
  if(value.kind==='download.changed'&&(!ref(p.ownerRef)||!ref(p.downloadRef)||!enumValue(p.state,['in_progress','complete','interrupted','cancelled'])||!(p.fileName===null||typeof p.fileName==='string'&&p.fileName.length<=128)||!safeInt(p.bytesReceived)||!(p.totalBytes===null||safeInt(p.totalBytes))||!(p.completedAt===null||typeof p.completedAt==='string'&&p.completedAt.length<=64)))return false;
  if(value.kind==='debugger.detached'&&typeof p.reason!=='string')return false;
  if(value.kind==='download.changed'&&(value.leaseRef!==null||value.tabRef!==null))return false;
  return jsonBytes(value)<=MAX_COMPANION_EVENT_BYTES;
}
export function assertCompanionRequest(value){if(!validateCompanionRequest(value))throw Object.assign(new Error('Invalid companion request'),{code:'INVALID_REQUEST'});return value;}
export function companionErrorReply(request,error){
  const allowed=COMPANION_ERRORS.includes(error)?error:'BACKEND_UNAVAILABLE';
  return {protocol:COMPANION_PROTOCOL,requestId:request.requestId,connectionEpoch:request.connectionEpoch,ok:false,error:allowed};
}
