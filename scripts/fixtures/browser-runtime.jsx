import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
function App(){const [value,setValue]=useState('initial');window.fixtureModel=value;return <><label>Controlled <input id="controlled" value={value} onChange={e=>setValue(e.target.value)}/></label><input id="rejecting" value="fixed" onChange={()=>{}} readOnly={false}/></>;}
flushSync(()=>createRoot(document.querySelector('#react')).render(<App/>));
document.querySelector('#button').onclick=()=>{document.querySelector('#counter').textContent=String(++window.fixtureClicks);};window.fixtureClicks=0;
document.querySelector('[role=treeitem]').onclick=e=>e.currentTarget.setAttribute('aria-expanded',e.currentTarget.getAttribute('aria-expanded')==='true'?'false':'true');
document.querySelector('#close').onclick=()=>document.querySelector('#popup').remove();
document.querySelector('#drop').addEventListener('dragover',e=>e.preventDefault());document.querySelector('#drop').addEventListener('drop',e=>{e.preventDefault();document.querySelector('#drop').dataset.dropped='yes';});
window.fixtureReady=true;
