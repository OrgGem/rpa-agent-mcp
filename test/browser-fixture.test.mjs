import test from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserFixture} from '../scripts/browser-runtime-fixture.mjs';
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
test('public runtime fixture serves owned nonce pages, two origins and a pinned React bundle',async t=>{
  const fixture=await startBrowserFixture();t.after(()=>fixture.close());
  const html=await (await fetch(fixture.url)).text();assert.ok(html.includes('MCP owned fixture'));assert.ok(html.includes('id="controlled"')===false,'Controlled input comes from the real React bundle, not fake static HTML');
  const frames=[...html.matchAll(/<iframe id="(?:same|cross)" src="([^"]+)"/g)].map(m=>m[1]);assert.equal(frames.length,2);assert.notEqual(new URL(frames[0]).origin,new URL(frames[1]).origin);
  for(const url of frames){const r=await fetch(url);assert.equal(r.status,200);assert.ok((await r.text()).includes('id="frame-input"'));}
  assert.equal((await fetch(new URL('/unowned',fixture.url))).status,404);
  const bundle=await fetch(new URL('bundle.js',fixture.url));assert.equal(bundle.headers.get('Content-Type'),'application/javascript');assert.ok((await bundle.text()).length>1000);assert.match(fixture.bundleSha256,/^[a-f0-9]{64}$/);
});

test('public fixture builds from a checkout path containing spaces and Unicode',async t=>{
  const work=fileURLToPath(new URL('../work/',import.meta.url));await mkdir(work,{recursive:true});
  const folder=await mkdtemp(path.join(work,'fixture Tiếng Việt '));
  t.after(async()=>{assert.equal(path.dirname(folder),path.resolve(work));assert.ok(path.basename(folder).startsWith('fixture Tiếng Việt '));await rm(folder,{recursive:true,force:true});});
  await mkdir(path.join(folder,'fixtures'));
  await copyFile(new URL('../scripts/browser-runtime-fixture.mjs',import.meta.url),path.join(folder,'fixture.mjs'));
  await copyFile(new URL('../scripts/fixtures/browser-runtime.jsx',import.meta.url),path.join(folder,'fixtures/browser-runtime.jsx'));
  const {startBrowserFixture:startCopiedFixture}=await import(pathToFileURL(path.join(folder,'fixture.mjs')).href);
  const fixture=await startCopiedFixture();
  try{assert.equal((await fetch(new URL('bundle.js',fixture.url))).status,200);assert.match(fixture.bundleSha256,/^[a-f0-9]{64}$/);}
  finally{await fixture.close();}
});
