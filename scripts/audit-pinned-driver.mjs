import { EXTENSION_ROOT } from './paths.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
const root='.';
const src=EXTENSION_ROOT + '/EmbeddedDriversContainer.js';
const text=await readFile(src,'utf8'),ast=parse(text,{ecmaVersion:'latest'});
const cat=JSON.parse(await readFile(root+'/docs/uipath-function-catalog.json','utf8'));
const extracted=JSON.parse(await readFile('work/uipath-extracted.json','utf8'));
const pinned=extracted.drivers.find(d=>d.version==='23.4.55.39317');
function walk(n,fn){if(!n?.type)return;fn(n);for(const v of Object.values(n)){if(Array.isArray(v)){for(const x of v)if(x?.type)walk(x,fn)}else if(v?.type)walk(v,fn)}}
const units={};walk(ast,n=>{if(n.type==='FunctionDeclaration'&&/^Driver_23_4_0_/.test(n.id?.name??''))units[n.id.name]=n});
const funcs=new Map();walk(units.Driver_23_4_0_BackgroundCode,n=>{if(n.type==='FunctionDeclaration')funcs.set(n.id.name,n)});
let dispatch;
walk(units.Driver_23_4_0_ContentCode_ExtensionWorld,n=>{
 if(n.type==='SequenceExpression'&&n.expressions.some(e=>e.type==='AssignmentExpression'&&e.left.type==='MemberExpression'&&e.left.property.value===0&&text.slice(e.right.start,e.right.end)==='i(n.BrowserMatchesWithAttributes)'))dispatch=n;
});
if(!dispatch)throw Error('Content dispatch not found');
const content={};
for(const e of dispatch.expressions){if(e.type!=='AssignmentExpression'||e.left.type!=='MemberExpression'||!Number.isInteger(e.left.property.value))continue;
 content[e.left.property.value]={contentCommandId:e.left.property.value,handlerBindings:e.right.arguments?.map(a=>text.slice(a.start,a.end))??[],sourceOffset:e.start};}
const overrides={
 FindWebCtrlElements:{status:'stub-no-response',note:'Only local declarations; no callback or content dispatch.'},
 GetHtmlElemById:{status:'partial-tab-only',note:'Valid index with tabId=-1 resolves a browser tab. No DOM reply for ordinary tabId.'},
 RunJS:{status:'source-path-registered-scripts',note:'scriptName resolves g_globalContext.CallableScripts; does not accept arbitrary jsCode.'},
 InjectAndRunJs:{status:'source-path-unverified',note:'Accepts jsCode/input/executionWorld; may inject through debugger. Runtime unverified.'},
 FindSelectors:{status:'source-path-unverified',note:'Routes content command 8 to FindSelectors_OriginalRequest/CrossOriginRequest; partialRequests schema and customId cache lifecycle need live verification.'},
 TakeScreenshot:{status:'source-path-active-tab-constrained',note:'VIEWPORT/ELEMENT/BOUNDS use captureVisibleTab(windowId). FULLPAGE uses debugger. Requires active-tab identity checks and transport design.'},
 NavigationCommand:{status:'source-path-unverified',note:'activate can focus window via activateWindow; home hardcodes http://www.google.com. Only activate/home/reload routing audited, not runtime.'},
 WriteTextHtmlElem:{status:'source-path-unverified',note:'Non-debugger path reaches Content.WriteText; debugger path is separate and uses key tokens/options. No live DOM typing claim.'}
};
const rows=[];
for(const entry of cat.functions){const impl=entry.implementations.find(v=>v.driverVersion===pinned.version);
 if(!impl){rows.push({name:entry.name,entryPresent:false,status:'absent-direct-entry',liveVerified:false});continue}
 const fn=funcs.get(impl.handler);if(!fn)throw Error('Missing '+impl.handler);
 const ids=new Set();walk(fn,n=>{if(n.type==='CallExpression'&&n.callee.name==='ExecuteScript'&&n.arguments[2]?.type==='Literal'&&typeof n.arguments[2].value==='number')ids.add(n.arguments[2].value)});
 const fields={name:entry.name,entryPresent:true,handler:impl.handler,sourceOffset:fn.start,sourceEnd:fn.end,
  status:fn.body.body.every(n=>n.type==='VariableDeclaration')?'stub-no-response':'source-path-unverified',
  liveVerified:false,observedDirectRequestFields:impl.requestFields,contentCommandIds:[...ids],
  contentBindings:[...ids].map(i=>content[i]??{contentCommandId:i,handlerBindings:[]})};
 rows.push({...fields,...overrides[entry.name]});
}
const generic=pinned.genericRoutes.map(r=>({...r,contentBindings:content[r.contentCommandId]?.handlerBindings??[],status:'source-route-unverified',liveVerified:false}));
let liveReceipt=null;
try{liveReceipt=JSON.parse(await readFile(root+'/docs/EXTENSION-LIVE-VERIFICATION.json','utf8'))}catch{}
if(liveReceipt?.passed&&liveReceipt.sourceHashes?.['EmbeddedDriversContainer.js']===createHash('sha256').update(text).digest('hex')){
 for(const [name,scope] of [['OpenTab','HTTP local fixture new tab only'],['GetHtmlAttribute','Tab metadata only: empty customId with url/title/readystate']]){
  const row=rows.find(r=>r.name===name);row.liveVerified=true;row.liveVerifiedScope=scope;row.liveEvidence='EXTENSION-LIVE-VERIFICATION.json';
 }
}
const result={auditedOn:'2026-10-26',driverVersion:pinned.version,extensionVersion:'23.10.1',sourceFile:src,sourceSha256:createHash('sha256').update(text).digest('hex'),
 scope:'Static routing audit with explicitly scoped live evidence for OpenTab and tab metadata. Entry presence is not availability; observed fields are not full schemas. No live DOM primitive claim.',
 namedEntries:rows,genericRoutes:generic,specialRoutes:pinned.specialRoutes,contentDispatch:Object.values(content)};
await writeFile(root+'/docs/pinned-driver-audit.json',JSON.stringify(result,null,2)+'\n');
const chosen=['onGetHtmlIndex','onFindSelectors','onInjectAndRunJs','onRunJS','onTakeScreenshot','onClickHtmlElem'];
let snippets='';for(const n of chosen){const f=funcs.get(n);snippets+='\n'+n+'\n'+text.slice(f.start,f.end)+'\n'}
// Keep proprietary source excerpts in scratch only.
await writeFile('work/pinned-handler-excerpts.txt',snippets);
for(const label of ['WriteText','FindSelectors_OriginalRequest','RunJs']){
 let chosenIife;const unit=units.Driver_23_4_0_ContentCode_ExtensionWorld;
 walk(unit,n=>{if(n.type!=='CallExpression'||n.callee.type!=='FunctionExpression'||!text.slice(n.arguments[0]?.start??0,n.arguments[0]?.end??0).startsWith('Content'))return;let hit=false;
  for(const stmt of n.callee.body.body){if(stmt.type==='ExpressionStatement'&&stmt.expression.type==='AssignmentExpression'&&stmt.expression.left.type==='MemberExpression'&&stmt.expression.left.property.name===label)hit=true}
  if(hit)chosenIife=n.callee;
 });
 if(chosenIife)await writeFile('work/content-'+label+'.txt',text.slice(chosenIife.start,chosenIife.end));
}
console.log(JSON.stringify({named:rows.length,present:rows.filter(r=>r.entryPresent).length,statusCounts:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(k=>[k,rows.filter(r=>r.status===k).length])),generic:generic.length,contentDispatch:Object.keys(content).length},null,2));
