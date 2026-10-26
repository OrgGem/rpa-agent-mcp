import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {harness} from './browser-harness.mjs';
import {LineDecoder} from '../src/transport.mjs';
import {validateToolOutput} from '../src/browser-tools.mjs';
process.env.UIPATH_BRIDGE_INSTANCE=randomUUID();
const {ENDPOINT,DRIVER_VERSION}=await import('../src/bridge.mjs');

test('public MCP calls through owned IPC return validated envelopes and a separate image block',async t=>{
  const h=await harness(t),identities=new Set();
  const server=net.createServer(socket=>{socket.on('error',()=>{});const decoder=new LineDecoder();socket.on('data',chunk=>{for(const call of decoder.push(chunk)){
    const p=call.params;let task;if(call.method==='status')task=Promise.resolve({connected:true,driverLoaded:true,driverVersion:DRIVER_VERSION,browserRuntime:h.runtime.descriptor()});
    else if(call.method==='browser_capabilities')task=Promise.resolve({connected:true,driverLoaded:true,driverVersion:DRIVER_VERSION,browserRuntime:h.runtime.descriptor()});
    else if(call.method==='browser_tool'){identities.add(p.clientRef);task=h.runtime.call(p.clientRef,p.name,p.args);}
    else if(call.method==='browser_artifact_image')task=h.runtime.image(p.clientRef,p.args);
    else if(call.method==='browser_client_release')task=h.runtime.releaseClient(p.clientRef).then(()=>({released:true}));
    else task=Promise.reject(Error('Unexpected IPC method'));
    task.then(result=>socket.end(JSON.stringify({id:call.id,result})+'\n'),e=>socket.end(JSON.stringify({id:call.id,error:e.message})+'\n'));
  }});});
  await new Promise(resolve=>server.listen(ENDPOINT,resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const child=spawn(process.execPath,['src/bridge.mjs','mcp'],{env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());child.stderr.on('data',()=>{});
  const decoder=new LineDecoder(),pending=new Map();let id=0;
  child.stdout.on('data',chunk=>{for(const x of decoder.push(chunk)){const p=pending.get(x.id);if(p){clearTimeout(p.timer);pending.delete(x.id);p.resolve(x);}}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error('MCP timeout')),5000);pending.set(key,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
  await send('initialize');child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=(await send('tools/list')).result.tools;assert.equal(list.length,57);assert.ok(list.some(t=>t.name==='browser_press_keys'));
  const call=async(name,argumentsValue={})=>{const r=(await send('tools/call',{name,arguments:argumentsValue})).result;assert.ok(r);if(name!=='browser_capabilities')assert.equal(validateToolOutput(name,r.structuredContent),true);return r;};
  const cap=await call('browser_capabilities'),tabs=await call('browser_tabs');const attach=await call('browser_attach',{connectionRef:cap.structuredContent.data.connectionRef,tabRef:tabs.structuredContent.data.tabs[0].tabRef});
  const {contextRef,tabRef}=attach.structuredContent.data;
  const bad=await call('browser_type',{contextRef,elementRef:'bad',text:'no'});assert.equal(bad.isError,true);assert.equal(bad.structuredContent.error.code,'STALE_ELEMENT');
  const shot=await call('browser_screenshot',{contextRef,tabRef});assert.equal(shot.isError,false);const artifactRef=shot.structuredContent.data.artifactRef;
  const result=await call('browser_image_artifact',{contextRef,artifactRef,action:'read'});assert.equal(result.isError,false);assert.equal(result.content.length,2);assert.equal(result.content[1].type,'image');assert.equal(result.content[1].mimeType,'image/png');assert.ok(result.content[1].data.startsWith('iVBOR'));
  assert.ok(!JSON.stringify(result.structuredContent).includes('iVBOR'));assert.ok(!result.content[0].text.includes('iVBOR'));assert.equal(identities.size,1);
  const release=await call('browser_attach',{action:'release',contextRef});assert.equal(release.structuredContent.data.cleanupConfirmed,true);
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));
});
