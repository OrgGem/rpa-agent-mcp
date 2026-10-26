import test from 'node:test';
import assert from 'node:assert/strict';
import {startBrowserFixture} from '../scripts/browser-runtime-fixture.mjs';
test('public runtime fixture serves owned nonce pages, two origins and a pinned React bundle',async t=>{
  const fixture=await startBrowserFixture();t.after(()=>fixture.close());
  const html=await (await fetch(fixture.url)).text();assert.ok(html.includes('MCP owned fixture'));assert.ok(html.includes('id="controlled"')===false,'Controlled input comes from the real React bundle, not fake static HTML');
  const frames=[...html.matchAll(/<iframe id="(?:same|cross)" src="([^"]+)"/g)].map(m=>m[1]);assert.equal(frames.length,2);assert.notEqual(new URL(frames[0]).origin,new URL(frames[1]).origin);
  for(const url of frames){const r=await fetch(url);assert.equal(r.status,200);assert.ok((await r.text()).includes('id="frame-input"'));}
  assert.equal((await fetch(new URL('/unowned',fixture.url))).status,404);
  const bundle=await fetch(new URL('bundle.js',fixture.url));assert.equal(bundle.headers.get('Content-Type'),'application/javascript');assert.ok((await bundle.text()).length>1000);assert.match(fixture.bundleSha256,/^[a-f0-9]{64}$/);
});
