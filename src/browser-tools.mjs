import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import Ajv from 'ajv';
import {parse} from 'acorn';

export const BROWSER_CONTRACT=JSON.parse(readFileSync(new URL('../docs/browser-tool-contracts.json',import.meta.url),'utf8'));
const ajv=new Ajv({strict:true,strictRequired:false,allErrors:true,allowUnionTypes:true});
export const BROWSER_TOOLS=BROWSER_CONTRACT.tools.filter(t=>!t.unsupportedReason).map(t=>({
  name:t.name,description:t.description??t.result,inputSchema:t.inputSchema,outputSchema:t.outputSchema,annotations:t.annotations
}));
export const UNAVAILABLE_TOOLS=Object.fromEntries(BROWSER_CONTRACT.tools.filter(t=>t.unsupportedReason).map(t=>[t.name,t.unsupportedReason]));
const validators=new Map(BROWSER_TOOLS.map(t=>[t.name,ajv.compile(t.inputSchema)]));
const outputValidators=new Map(BROWSER_TOOLS.map(t=>[t.name,ajv.compile(t.outputSchema)]));
const recoveryFor=code=>code==='INVALID_ARGUMENT'?'fix-arguments':code.includes('STALE')||code==='REF_SCOPE_MISMATCH'?'rediscover':
  code==='ACTION_OUTCOME_UNKNOWN'||code==='WRITE_BLOCKED'?'observe-do-not-retry':code==='BRIDGE_DISCONNECTED'?'reconnect':
  code==='UNSUPPORTED_CAPABILITY'?'configure-backend':code.includes('LIMIT')||code==='RESULT_TOO_LARGE'?'reduce-scope':'none';
export class BrowserError extends Error{
  constructor(code,message=code,{dispatchState='notSent',retryableRead=false,recovery=recoveryFor(code),details={},data=null}={}){
    super(message.slice(0,512));this.code=code;this.dispatchState=dispatchState;this.retryableRead=retryableRead;this.recovery=recovery;this.details=details;this.data=data;
  }
}
export function reject(code,message,options){throw new BrowserError(code,message,options);}
export const opaque=prefix=>`${prefix}_${randomUUID()}`;
export function validateToolInput(name,args){
  const validate=validators.get(name);
  if(!validate)reject('UNSUPPORTED_CAPABILITY',UNAVAILABLE_TOOLS[name]??'Unknown browser tool');
  if(!validate(args))reject('INVALID_ARGUMENT','Arguments do not match the published tool schema');
  if(Buffer.byteLength(JSON.stringify(args),'utf8')>128*1024)reject('INVALID_ARGUMENT','Tool arguments exceed 128 KiB');
  if(args.url){let u;try{u=new URL(args.url);}catch{}if(!u||!['http:','https:'].includes(u.protocol)||u.username||u.password)reject('INVALID_ARGUMENT','An HTTP(S) URL without embedded credentials is required');}
  if(name==='browser_click'&&args.method==='uipath'&&((args.button??'left')!=='left'||(args.clickCount??1)!==1))reject('UNSUPPORTED_CAPABILITY','Native click supports only a single left click');
  if(name==='browser_set_attribute'&&(!/^[A-Za-z_][A-Za-z0-9:_-]*$/.test(args.name)||/^on|^uipath|^data-rpa-|^(srcdoc|nonce|integrity)$/i.test(args.name)))reject('INVALID_ARGUMENT','Reserved or invalid attribute');
  if(args.columns){const names=args.columns.map(c=>c.name);if(new Set(names).size!==names.length||names.some(k=>['__proto__','constructor','prototype'].includes(k)))reject('INVALID_ARGUMENT','Table column names must be unique and unreserved');}
  if(name==='browser_evaluate'){
    assertJsonBound(args.input??null,16384,16,'INVALID_ARGUMENT');
    let expression;try{const ast=parse(`const value=(${args.script});`,{ecmaVersion:'latest'});if(ast.body.length===1)expression=ast.body[0]?.declarations?.[0]?.init;}catch{}
    if(!expression||!['FunctionExpression','ArrowFunctionExpression'].includes(expression.type)||expression.generator)reject('INVALID_ARGUMENT','Script must be one non-generator function expression');
  }
  if(args.locator)validateLocator(args.locator);
  if(args.closeLocator)validateLocator(args.closeLocator);
  if(name==='browser_form_fill')for(const f of args.fields){
    if(Number(Boolean(f.elementRef))+Number(Boolean(f.locator))!==1||['value','checked','selectedValues'].filter(k=>Object.hasOwn(f,k)).length!==1)reject('INVALID_ARGUMENT','Each form field requires one target and one desired value');
    if(f.locator)validateLocator(f.locator);
  }
  if(name==='browser_wait_for'){
    const c=args.condition,hasRef=Boolean(args.elementRef),hasLocator=Boolean(args.locator);
    if(['attached','absent'].includes(c)&&(!hasLocator||hasRef))reject('INVALID_ARGUMENT','Attached/absent conditions require only a locator');
    if(['detached','visible','hidden','enabled','disabled','valueEquals','textIncludes'].includes(c)&&Number(hasRef)+Number(hasLocator)!==1)reject('INVALID_ARGUMENT','Condition requires exactly one element ref or locator');
    if(c==='detached'&&!hasRef)reject('INVALID_ARGUMENT','Detached requires an existing element ref');
    if(['valueEquals','textIncludes','urlEquals'].includes(c)&&typeof args.expected!=='string')reject('INVALID_ARGUMENT','Condition requires expected text');
    if(['urlEquals','ready'].includes(c)&&(hasRef||hasLocator))reject('INVALID_ARGUMENT','Document conditions do not accept an element target');
  }
  if(name==='browser_text_selection'&&args.action==='set'&&args.end<args.start)reject('INVALID_ARGUMENT','Selection end precedes start');
  if(['browser_evaluate','browser_extract_table','browser_form_read'].includes(name)&&args.elementRef&&args.rootRef)reject('INVALID_ARGUMENT','Conflicting element/root targets');
  if(args.pagination){validateLocator(args.pagination.rootLocator);validateLocator(args.pagination.nextLocator);}
  return args;
}
export function validateLocator(l){
  if(l.kind==='attributes'){
    if(!l.tag&&!Object.keys(l.attributes??{}).length)reject('INVALID_ARGUMENT','Attribute locator needs a tag or attribute');
    if(l.tag&&!/^(\*|[A-Za-z][A-Za-z0-9-]*)$/.test(l.tag))reject('INVALID_ARGUMENT','Invalid tag');
    for(const [k] of Object.entries(l.attributes??{}))if(!/^[A-Za-z_][A-Za-z0-9:_-]*$/.test(k)||['__proto__','constructor','prototype'].includes(k)||/^uipath|^data-rpa-/i.test(k))reject('INVALID_ARGUMENT','Reserved or invalid selector attribute');
    if(l.match&&l.match!=='exact')reject('INVALID_ARGUMENT','Attribute locators use exact matching');
  }else if(typeof l.value!=='string'||!l.value.length)reject('INVALID_ARGUMENT','Locator value is required');
}
export function assertJsonBound(value,maxBytes=245760,maxDepth=16,code='RESULT_TOO_LARGE'){
  const seen=new Set();
  const visit=(v,d)=>{if(d>maxDepth)reject(code,'JSON nesting limit exceeded');if(v&&typeof v==='object'){
    if(seen.has(v))reject(code,'Circular JSON value');seen.add(v);for(const x of Object.values(v))visit(x,d+1);seen.delete(v);
  }else if(typeof v==='number'&&!Number.isFinite(v)||['bigint','function','symbol'].includes(typeof v))reject(code,'Value is not JSON serializable');};
  visit(value,0);if(Buffer.byteLength(JSON.stringify(value)??'null','utf8')>maxBytes)reject(code,'Serialized result exceeds the configured bound');
}
export function fingerprint(tool,args){
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const {requestKey,...payload}=args;
  return createHash('sha256').update(JSON.stringify([tool,canonical(payload)])).digest('hex');
}
export function validateToolOutput(name,result){return outputValidators.get(name)?.(result)===true;}
export function publicFailure(error,{requestId=opaque('req'),context=null,elapsedMs=0}={}){
  const e=error instanceof BrowserError?error:new BrowserError('BACKEND_FAILURE','Browser operation failed');
  return {ok:false,requestId,context,data:e.data,evidence:null,timing:{elapsedMs:Math.min(1000000,Math.max(0,elapsedMs))},
    error:{code:e.code,message:e.message,dispatchState:e.dispatchState,retryableRead:e.retryableRead,recovery:e.recovery,details:e.details}};
}
