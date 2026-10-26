import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {harness} from './browser-harness.mjs';
test('actual React controlled inputs verify retained state and reject restored values after dispatch',async t=>{
  const h=await harness(t),w=h.pages.get(1).w,container=w.document.createElement('div');container.id='app';w.document.body.append(container);
  const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    function App(){const[value,setValue]=useState('initial');window.controlledModel=value;return <><input id="react-accept" value={value} onChange={e=>setValue(e.target.value)}/><input id="react-reject" value="fixed" onChange={()=>{}}/></>}
    flushSync(()=>createRoot(document.querySelector('#app')).render(<App/>));`,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
  w.eval(bundle.outputFiles[0].text);
  const accepted=await h.must('browser_type',{contextRef:h.args.contextRef,elementRef:await h.find('react-accept'),text:'Tiếng Việt'});
  assert.equal(accepted.data.valueMatch,true);assert.equal(w.controlledModel,'Tiếng Việt');
  const rejected=await h.call('browser_type',{contextRef:h.args.contextRef,elementRef:await h.find('react-reject'),text:'must reject'});
  assert.equal(w.document.querySelector('#react-reject').value,'fixed');assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'POSTCONDITION_FAILED');
});
test('text verification reads back after queued input handlers have changed the control',async t=>{
  const h=await harness(t),input=h.pages.get(1).w.document.querySelector('#text');
  input.addEventListener('input',()=>queueMicrotask(()=>{input.value='sanitized';}));
  const result=await h.call('browser_type',{contextRef:h.args.contextRef,elementRef:await h.find('text'),text:'original'});
  assert.equal(input.value,'sanitized');assert.equal(result.ok,false);assert.equal(result.error.code,'POSTCONDITION_FAILED');
});
test('checked, selected and date postconditions reject queued application restorations',async t=>{
  const h=await harness(t),w=h.pages.get(1).w,checkbox=w.document.querySelector('#check'),select=w.document.querySelector('#select'),date=w.document.querySelector('#date');
  checkbox.addEventListener('input',()=>queueMicrotask(()=>{checkbox.checked=false;}));select.addEventListener('change',()=>queueMicrotask(()=>{select.value='a';}));date.addEventListener('input',()=>queueMicrotask(()=>{date.value='2026-01-01';}));
  for(const [name,id,args]of [['browser_set_checked','check',{checked:true}],['browser_select_options','select',{values:['b']}],['browser_calendar_select','date',{date:'2026-10-26'}]]){
    const result=await h.call(name,{contextRef:h.args.contextRef,elementRef:await h.find(id),...args});assert.equal(result.ok,false,name);assert.equal(result.error.code,'POSTCONDITION_FAILED',name);
  }
});
test('desired-state verification accepts final reconciliation after an intermediate mismatch',async t=>{
  const h=await harness(t),w=h.pages.get(1).w,select=w.document.querySelector('#select'),date=w.document.querySelector('#date');
  select.addEventListener('change',()=>{select.value='a';queueMicrotask(()=>{select.value='b';});});
  date.addEventListener('input',()=>{date.value='2026-01-01';queueMicrotask(()=>{date.value='2026-10-26';});});
  assert.equal((await h.must('browser_select_options',{contextRef:h.args.contextRef,elementRef:await h.find('select'),values:['b']})).data.selectedValues[0],'b');
  assert.equal((await h.must('browser_calendar_select',{contextRef:h.args.contextRef,elementRef:await h.find('date'),date:'2026-10-26'})).data.valueMatch,true);
});
