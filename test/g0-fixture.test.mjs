import test from 'node:test';
import assert from 'node:assert/strict';
import { startG0Fixture } from '../scripts/g0-fixture.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('G0 fixture is loopback-only and reports require nonce, Origin, strict shape and increasing sequence',async t=>{
  const fixture=await startG0Fixture();t.after(()=>fixture.close());
  assert.equal(new URL(fixture.url).hostname,'127.0.0.1');
  const page=await fetch(fixture.url);assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);
  const html=await page.text();assert.match(html,/id="g0-input" value="initial"/);
  assert.equal((html.match(/name="g0-duplicate"/g)||[]).length,2);
  assert.equal((await fetch(new URL('/wrong',fixture.url))).status,404);
  assert.equal(fixture.snapshot(),null);
  const report={seq:0,value:'initial',inputEvents:0,changeEvents:0,clicks:0};
  const send=(data,headers={})=>fetch(fixture.reportUrl,{method:'POST',headers:{Origin:fixture.origin,'Content-Type':'application/json',...headers},body:typeof data==='string'?data:JSON.stringify(data)});
  assert.equal((await send(report,{Origin:'http://foreign.test'})).status,403);
  assert.equal((await send(report,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await send({...report,extra:'no'})).status,400);
  assert.equal((await send(report)).status,204);
  assert.equal((await send(report)).status,400);
  assert.equal((await send({...report,seq:1,value:'G0 Việt 😀',inputEvents:1})).status,204);
  const snapshot=fixture.snapshot();snapshot.value='mutated';
  assert.equal(fixture.snapshot().value,'G0 Việt 😀');
  assert.equal((await send({...report,seq:2,value:'x'.repeat(129)})).status,400);
  assert.equal((await send(' '.repeat(1025))).status,413);
});

test('Default G0 runner fails closed without a host and writes a sanitized preflight-only receipt',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'rpa-g0-test-'));
  try{
    const runner=path.resolve('scripts/run-g0.mjs');
    const child=spawn(process.execPath,[runner],{cwd:folder,env:{...process.env,UIPATH_BRIDGE_INSTANCE:`absent-${process.pid}-${Date.now()}`},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.equal(code,1);
    const receipt=JSON.parse(await readFile(path.join(folder,'work/g0-preflight.json'),'utf8'));
    assert.equal(receipt.evidenceLevel,'preflight-only');assert.equal(receipt.smokePassed,false);assert.equal(receipt.g0GatePassed,false);
    assert.equal(receipt.error.code,'HOST_PROBE_UNAVAILABLE');
    assert.deepEqual(receipt.cleanup,{serverStopped:true,tabLeftOpen:false,passed:true});
    assert.doesNotMatch(output,/ENOENT|Users|nativePid|secret|pipe\\/);
  }finally{
    assert.equal(path.dirname(folder),path.resolve(tmpdir()));
    assert.match(path.basename(folder),/^rpa-g0-test-/);
    await rm(folder,{recursive:true,force:true});
  }
});
