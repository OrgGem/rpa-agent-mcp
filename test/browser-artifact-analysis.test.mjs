import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {createArtifactStore} from '../src/browser-artifacts.mjs';

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{
  let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;
});
const crc32=data=>{let crc=0xffffffff;for(const b of data)crc=CRC_TABLE[(crc^b)&0xff]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const chunk=(type,data)=>{
  const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);
  const body=Buffer.concat([name,data]);checksum.writeUInt32BE(crc32(body));return Buffer.concat([length,body,checksum]);
};
function png(width=1,height=1){
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=0;
  const raw=Buffer.alloc((width+1)*height);
  return Buffer.concat([PNG_SIGNATURE,chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
async function setup(t,options={}){
  const root=await mkdtemp(path.join(tmpdir(),'rpa-artifact-analysis-'));t.after(()=>rm(root,{recursive:true,force:true}));
  return createArtifactStore(root,options);
}
const provenance={sourceTool:'browser_screenshot',tabRef:'tab_capture-1',documentGeneration:4,viewportGeneration:2};
const putPng=(store,client='client-a',context='context-a',bytes=png(),source=provenance)=>store.put(client,context,bytes,'image/png',source);
const failure=(promise,code)=>assert.rejects(promise,error=>error?.code===code);

test('analysisRead is an in-memory owner-scoped PNG read with optional private screenshot provenance',async t=>{
  const store=await setup(t),bytes=png(),record=await putPng(store,'client-a','context-a',bytes);
  assert.equal(Buffer.isBuffer(await store.analysisRead('client-a','context-a',record.artifactRef,{})),true);
  assert.deepEqual(await store.analysisRead('client-a','context-a',record.artifactRef,{}),bytes);
  assert.equal(Object.hasOwn(record,'provenance'),false);
  assert.equal(Object.hasOwn(await store.inspect('client-a','context-a',record.artifactRef),'provenance'),false);
  await failure(store.analysisRead('client-b','context-a',record.artifactRef,{}),'STALE_ARTIFACT');
  await failure(store.analysisRead('client-a','context-b',record.artifactRef,{}),'STALE_ARTIFACT');
  await failure(store.put('client-a','context-a',bytes,'image/png',{...provenance,sourceTool:'browser_upload'}),'INVALID_ARGUMENT');
});

test('analysisRead rejects expired artifacts at the exact expiry boundary',async t=>{
  let time=1000;const store=await setup(t,{now:()=>time,ttlMs:100}),record=await putPng(store);
  time=1100;
  await failure(store.analysisRead('client-a','context-a',record.artifactRef,{}),'STALE_ARTIFACT');
  assert.equal(store.size,0);
});

test('analysisRead detects same-size replacement by the stored SHA-256',async t=>{
  const store=await setup(t),record=await putPng(store),replacement=Buffer.from(await readFile(record.path));
  replacement[replacement.length-2]^=1;await writeFile(record.path,replacement);
  assert.equal(replacement.length,record.bytes);
  await failure(store.analysisRead('client-a','context-a',record.artifactRef,{}),'ARTIFACT_IO_ERROR');
});

test('analysisRead rejects malformed PNG structure and enforces byte and pixel limits before decoding',async t=>{
  const store=await setup(t),valid=png(),truncated=valid.subarray(0,valid.length-5),broken=await putPng(store,'client-a','context-a',truncated);
  await failure(store.analysisRead('client-a','context-a',broken.artifactRef,{}),'BACKEND_FAILURE');

  const byteBound=await putPng(store),wide=await store.analysisRead('client-a','context-a',byteBound.artifactRef,{maxBytes:valid.length});
  assert.deepEqual(wide,valid);
  await failure(store.analysisRead('client-a','context-a',byteBound.artifactRef,{maxBytes:valid.length-1}),'RESULT_TOO_LARGE');

  const oversized=await putPng(store,'client-a','context-a',png(4000,4001));
  await failure(store.analysisRead('client-a','context-a',oversized.artifactRef,{maxBytes:6*1024*1024,maxPixels:16_000_000}),'RESULT_TOO_LARGE');
  await failure(store.analysisRead('client-a','context-a',byteBound.artifactRef,{maxBytes:6*1024*1024,maxPixels:16_000_001}),'INVALID_ARGUMENT');
});

test('analysisRead accepts only PNG screenshot artifacts',async t=>{
  const store=await setup(t),jpeg=await store.put('client-a','context-a',Buffer.from([0xff,0xd8,0xff,0xd9]),'image/jpeg');
  await failure(store.analysisRead('client-a','context-a',jpeg.artifactRef,{}),'UNSUPPORTED_CAPABILITY');
});

test('analysisRead and release/sweep run in one serialized artifact queue',async t=>{
  const store=await setup(t),first=await putPng(store),read=store.analysisRead('client-a','context-a',first.artifactRef,{}),release=store.release('client-a','context-a');
  assert.deepEqual(await read,png());await release;assert.equal(store.size,0);
  await failure(store.analysisRead('client-a','context-a',first.artifactRef,{}),'STALE_ARTIFACT');

  const second=await putPng(store),releaseFirst=store.release('client-a','context-a'),readAfter=store.analysisRead('client-a','context-a',second.artifactRef,{});
  await releaseFirst;await failure(readAfter,'STALE_ARTIFACT');

  let time=Date.now();
  const expiring=await setup(t,{now:()=>time,ttlMs:1});
  const last=await putPng(expiring);time+=2;
  const sweep=expiring.sweep(),readAfterSweep=expiring.analysisRead('client-a','context-a',last.artifactRef,{});
  await sweep;await failure(readAfterSweep,'STALE_ARTIFACT');
});
