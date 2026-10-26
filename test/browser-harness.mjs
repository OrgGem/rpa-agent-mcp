import {JSDOM} from 'jsdom';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBrowserRuntime} from '../src/browser-runtime.mjs';

export const HTML=`<!doctype html><title>Runtime fixture</title><body><form id="form"><input id="text"><input id="secret" type="password" value="private"><input id="check" type="checkbox"><input id="date" type="date"><select id="select"><option value="a">Alpha</option><option value="b">Beta</option></select></form><button id="button">Click</button><div id="drop">Drop</div><table id="table"><tr><th>Name</th><th>Count</th></tr><tr><td>One</td><td>1</td></tr></table><div role="tree" id="tree"><div role="treeitem" aria-expanded="false">Branch</div></div><iframe id="frame"></iframe></body>`;
export async function harness(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'rpa-runtime-')),pages=new Map(),calls=[],client=randomUUID();let next=3,active=1,hook=null;
  function page(id,url='https://fixture.test/',html=HTML,child=false){
    if(!child)pages.get(id)?.dom.window.close();const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,nodes=new Map();let sequence=1;
    Object.defineProperty(w.document,'readyState',{get:()=> 'complete',configurable:true});
    w.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[this.getBoundingClientRect()];};
    w.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:100,bottom:30,width:100,height:30});
    w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.scrollBy=()=>{};
    w.document.elementFromPoint=()=>w.__hit??w.document.querySelector('#button');
    const local=node=>{for(const [k,v]of nodes)if(v===node)return k;const k=String(sequence++);nodes.set(k,node);return k;};
    w.g_globalContext={GenerateCustomIdForElement:local};
    const result={id,dom,w,nodes,local,frames:new Map()};if(!child)pages.set(id,result);return result;
  }
  page(1);page(2,'https://other.test/');
  async function request(name,a){calls.push({name,a});const intercept=await hook?.(name,a);if(intercept!==undefined)return intercept;
    const top=pages.get(a.tabId),frameId=Number((a.customId??a.parentCustomId??'0|').split('|')[0]),p=frameId?top?.frames.get(frameId):top,ok={retCode:1};
    if(name==='FindBrowserTabs')return {openTabsCount:pages.size,results:[...pages.keys()].map(id=>({m_customId:String(id)}))};
    if(name==='GetTabCount')return {...ok,tabCount:pages.size};
    if(name==='GetWindowIdForTabId')return {...ok,windowId:10};
    if(name==='GetActiveTabId')return {...ok,tabId:String(active)};
    if(name==='GetHtmlAttribute')return {...ok,attrValue:a.attrName==='url'?p.w.location.href:a.attrName==='title'?p.w.document.title:'1'};
    if(name==='InjectAndRunJs'){
      const [frame,local]=a.customId.split('|');if(!p)throw Error('Mock child frame unavailable');
      const fn=p.w.eval(`(${a.jsCode})`);try{return {...ok,isScriptErr:0,result:String(fn(local?p.nodes.get(local):null,a.input,a.tabId))};}catch{return {...ok,isScriptErr:1,result:''};}
    }
    if(name==='FindSelectors'){
      const parentLocal=a.parentCustomId.split('|')[1];if(p.nodes.get(parentLocal)?.tagName==='IFRAME'){
        if(!top.frames.has(1))top.frames.set(1,page(a.tabId,'https://child.test/','<input id="child" value="initial">',true));
        const f=top.frames.get(1);return {...ok,endedWithId:a.startWithId+1,results:[{m_resultsCollection:{m_results:[{m_customId:`${a.tabId}|1|${f.local(f.w.document.documentElement)}`}]}}]};
      }
      const attrs=a.partialRequests[0].m_tagInfosList[0].m_attributesMap,nodes=[...p.w.document.querySelectorAll(attrs.tag??'*')].filter(n=>Object.entries(attrs).every(([k,v])=>k==='tag'||n.getAttribute(k)===v)).slice(0,a.partialRequests[0].m_searchOption.m_maxResults);
      return {...ok,endedWithId:a.startWithId+nodes.length,results:[{m_resultsCollection:{m_results:nodes.map(n=>({m_customId:`${a.tabId}|0|${p.local(n)}`}))}}]};
    }
    if(name==='IsHtmlElemValid')return {retCode:p.nodes.get(a.customId.split('|')[1])?.isConnected?1:0};
    if(name==='WriteTextHtmlElem'){const n=p.nodes.get(a.customId.split('|')[1]);n.value=(a.inputOptions===4?n.value:'')+a.tokens[0].text;n.dispatchEvent(new p.w.Event('input',{bubbles:true}));return ok;}
    if(name==='GenericRequest'){p.nodes.get(a.customId.split('|')[1]).click();return ok;}
    if(name==='OpenTab'){const id=next++;page(id,a.url);return {...ok,newTabId:id};}
    if(name==='CloseBrowser'){p.dom.window.close();pages.delete(a.tabId);return ok;}
    if(name==='Navigate'){page(a.tabId,a.url);return ok;}
    if(name==='NavigationCommand'){if(a.command==='activate')active=a.tabId;if(a.command==='reload')page(a.tabId,p.w.location.href);return ok;}
    if(name==='StartWebRequestMonitoring'||name==='StopWebRequestMonitoring'||name==='MaximizeWindow')return ok;
    if(name==='AnyWebRequestsInFlight')return {...ok,inFlight:false};
    if(name==='TakeScreenshot')return {...ok,data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII='};
    throw Error(`Unexpected native route ${name}`);
  }
  let activations=0;
  const runtime=createBrowserRuntime({request,activate:async()=>{activations++;},root,driverVersion:'23.4.55.39317'});
  t.after(async()=>{await runtime.dispose();for(const p of pages.values()){for(const f of p.frames.values())f.dom.window.close();p.dom.window.close();}await rm(root,{recursive:true,force:true});});
  const call=(name,args={})=>runtime.call(client,name,args),must=async(name,args)=>{const v=await call(name,args);if(!v.ok)throw Error(`${name}: ${JSON.stringify(v)}`);return v;};
  const found=await must('browser_tabs'),attached=await must('browser_attach',{connectionRef:runtime.connectionRef,tabRef:found.data.tabs[0].tabRef}),contextRef=attached.data.contextRef,tabRef=attached.data.tabRef;
  const args={contextRef,tabRef};
  const find=async id=>(await must('browser_find_element',{...args,locator:{kind:'css',value:`#${id}`}})).data.elementRef;
  return {runtime,call,must,args,find,pages,calls,page,request,client,root,reloadChild:()=>{const top=pages.get(1);top.frames.get(1)?.dom.window.close();top.frames.set(1,page(1,'https://child.test/','<input id="child" value="new">',true));},setHook:f=>{hook=f;},get activations(){return activations;}};
}
