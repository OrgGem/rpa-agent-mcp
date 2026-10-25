import { EXTENSION_ROOT } from './paths.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parse } from 'acorn';
const path=EXTENSION_ROOT + '/EmbeddedDriversContainer.js';
const source=await readFile(path,'utf8');
const ast=parse(source,{ecmaVersion:'latest'});
function walk(node,fn){
 if(!node?.type)return; fn(node);
 for(const value of Object.values(node)){
  if(Array.isArray(value))for(const item of value)if(item?.type)walk(item,fn);
  else {}
  else if(value?.type)walk(value,fn);
 }
}
const units=new Map();
walk(ast,n=>{if(n.type==='FunctionDeclaration'&&/^Driver_23_4_0_/.test(n.id?.name??''))units.set(n.id.name,n)});
console.log('Units', [...units.keys()]);
const funcs=new Map();
walk(units.get('Driver_23_4_0_BackgroundCode'),n=>{if(n.type==='FunctionDeclaration')funcs.set(n.id.name,n)});
const names=['onFindWebCtrlElements','onGetHtmlElemById','onGenericRequest','onGetHtmlIndex','onMonitorNativeEvents','onTakeScreenshot'];
const evidence=[];
for(const name of names){
 const n=funcs.get(name); if(!n)continue;
 const code=source.slice(n.start,n.end);
 console.log(name,code.length,code.slice(0,950));
 evidence.push({name,start:n.start,end:n.end,bodyStatementTypes:n.body.body.map(x=>x.type),sourceSha256:createHash('sha256').update(code).digest('hex')});
}
const handler=funcs.get('onFindWebCtrlElements');
const context={N_TRUE:1,N_FALSE:0,g_globalContext:{Logger:{Log(){}},SplitCustomIdWithFrame:value=>({customId:value,frameId:0}),AttributeValue:function(value){this.value=value},GetActiveValueString:value=>value.value},callbackCalled:false};
vm.createContext(context);
vm.runInContext(source.slice(handler.start,handler.end)+'\nonFindWebCtrlElements({parentCustomId:"root",tagName:"INPUT",attrMap:{},getAllDescendants:true,maxElems:10},function(){callbackCalled=true});',context,{timeout:1000});
const getNode=funcs.get('onGetHtmlElemById');
context.getCallbackCalled=false;
vm.runInContext(source.slice(getNode.start,getNode.end)+'\nonGetHtmlElemById({tabId:123,parentCustomId:"root",tagName:"INPUT",index:1,attrMap:{}},function(){getCallbackCalled=true});',context,{timeout:1000});
const screenshotNode=funcs.get('onTakeScreenshot');
const screenshotCode=source.slice(screenshotNode.start,screenshotNode.end);
const spec=JSON.parse(await readFile('docs/browser-feature-spec.json','utf8'));
const report={reviewDate:'2026-10-26',scope:'Offline static review and isolated stub execution; no browser or extension action.',sourceFile:path,sourceSha256:createHash('sha256').update(source).digest('hex'),driver:'23.4.55.39317',handlers:evidence,findWebCtrlElementsProbe:{callbackCalled:context.callbackCalled,bodyOnlyDeclaresLocals:handler.body.body.every(n=>n.type==='VariableDeclaration')},getHtmlElemByIdProbe:{tabId:123,index:1,callbackCalled:context.getCallbackCalled},screenshotStaticFacts:{usesCaptureVisibleTabWithWindowId:screenshotCode.includes('chrome.tabs.captureVisibleTab(r.windowId'),callsTabsUpdateInHandler:screenshotCode.includes('chrome.tabs.update'),viewportRoutesToVisibleCapture:screenshotCode.includes('ScreenShotCapture.VIEWPORT:delete r.bounds;e.next(o)'),fullPageUsesSeparateDebuggerPath:true},documentConsistency:{activityNames:spec.activityCoverage.length,uniqueActivityNames:new Set(spec.activityCoverage.map(x=>x.name)).size,featureGroups:spec.features.length,proposedTools:spec.features.flatMap(f=>f.proposedTools).length,p0Tools:spec.features.filter(f=>f.phase==='P0').flatMap(f=>f.proposedTools).length}};
await writeFile('work/browser-plan-review-evidence.json',JSON.stringify(report,null,2)+'\n');
console.log('Probe',JSON.stringify(report.findWebCtrlElementsProbe));

// Read content dispatch assignments and the GenericRequest plumbing for audit.
const content=units.get('Driver_23_4_0_ContentCode_ExtensionWorld');
let matches=0;
walk(content,n=>{
 if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&n.left.computed&&n.right.type==='CallExpression'&&source.slice(n.right.start,n.right.end).startsWith('t(n.')){
  console.log('Content route',source.slice(n.start,n.end).slice(0,800));matches++;
 }
});
console.log('route candidates',matches);
