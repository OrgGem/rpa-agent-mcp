import React, {useState, useRef, useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';

const config=JSON.parse(document.getElementById('g04-config').textContent);
const {nonce,role,base,sameUrl,crossUrl}=config;
const generation=crypto.randomUUID();
const docMarker=`${nonce}:${generation}`;
let seq=0,ack=0,inputEvents=0,changeEvents=0,reactChanges=0,rejectChanges=0;
let reports=Promise.resolve();
let model=null,rejectModel=null,rerender=()=>{};
document.title=role==='main'?`G04 fixture ${nonce} document ${generation}`:`G04 frame ${role} ${nonce} document ${generation}`;
const nativeId=role==='main'?'g04-native':role==='same'?'g04-same-input':'g04-cross-input';
function mark(node){node.dataset.g04Document=docMarker;node.dataset.g04Node=`${nonce}:${crypto.randomUUID()}`;return node;}
function bind(node){node.addEventListener('input',()=>{inputEvents++;setTimeout(report,0);});node.addEventListener('change',()=>{changeEvents++;setTimeout(report,0);});}
const native=mark(document.createElement('input'));native.id=nativeId;native.value=`${role}-initial`;bind(native);document.getElementById('native-root').append(native);
async function report(){
  const native=document.getElementById(nativeId),controlled=document.getElementById('g04-controlled'),rejecting=document.getElementById('g04-rejecting');
  const value={seq:seq++,generation,ack,documentReady:document.readyState==='complete',nativeValue:native?.value??null,nodePresent:Boolean(native),
    controlledDom:controlled?.value??null,controlledModel:model,rejectingDom:rejecting?.value??null,rejectingModel:rejectModel,
    inputEvents,changeEvents,reactChanges,rejectChanges,frameworkVersion:React.version};
  // Preserve per-document sequence order even when layout/load/event reports overlap.
  reports=reports.then(()=>fetch(`${base}/report/${role}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})).catch(()=>{});
  await reports;
}
function App(){
  const [value,setValue]=useState('controlled-initial'),[,setTick]=useState(0);
  const nodeToken=useRef(`${nonce}:${crypto.randomUUID()}`).current;
  const rejectToken=useRef(`${nonce}:${crypto.randomUUID()}`).current;
  model=value;rejectModel='reject-initial';rerender=()=>setTick(n=>n+1);
  useLayoutEffect(()=>{report();});
  return <section>
    <label>React controlled <input id="g04-controlled" data-g04-document={docMarker} data-g04-node={nodeToken} value={value}
      onInput={()=>{inputEvents++;}} onChange={e=>{reactChanges++;setValue(e.target.value);setTimeout(report,0);}} onBlur={()=>{changeEvents++;setTimeout(report,0);}} /></label>
    <label>React rejecting <input id="g04-rejecting" data-g04-document={docMarker} data-g04-node={rejectToken} value="reject-initial"
      onInput={()=>{inputEvents++;}} onChange={()=>{rejectChanges++;setTimeout(report,0);}} /></label>
  </section>;
}
if(role==='main'){
  flushSync(()=>createRoot(document.getElementById('react-root')).render(<App/>));
  for(const [id,src] of [['same-frame',sameUrl],['cross-frame',crossUrl]]){
    const frame=document.createElement('iframe');frame.id=id;frame.src=src;frame.title=id;document.getElementById('frame-root').append(frame);
  }
  async function commands(){
    try{
      const response=await fetch(`${base}/commands`,{headers:{'X-G04-Nonce':nonce}});
      const command=await response.json();
      if(command){
        const {id,action}=command;
        if(action==='remove')document.getElementById(nativeId)?.remove();
        else if(action==='replace'){
          const old=document.getElementById(nativeId);
          const node=old?old.cloneNode(true):document.createElement('input');
          node.id=nativeId;if(!old)node.value='main-replacement';mark(node);bind(node);
          if(old)old.replaceWith(node);else document.getElementById('native-root').append(node);
        }else if(action==='rerender')flushSync(()=>rerender());
        else if(action==='reload-same'||action==='reload-cross'){
          const id=action==='reload-same'?'same-frame':'cross-frame';
          document.getElementById(id).src=(id==='same-frame'?sameUrl:crossUrl)+`?reload=${crypto.randomUUID()}`;
        }
        ack=id;await report();
        if(action==='reload-parent'){location.reload();return;}
        if(action==='navigate-next'){location.assign(`${base}/next`);return;}
      }
    }catch{}
    setTimeout(commands,120);
  }
  commands();
}
window.addEventListener('load',report);
report();
