import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildRuntimeCoverage,renderRuntimeCoverage} from '../scripts/build-runtime-coverage.mjs';
import {BROWSER_TOOLS,UNAVAILABLE_TOOLS} from '../src/browser-tools.mjs';
test('runtime coverage dispositions every protocol row and all 53 roadmap names without fake backend tools',async()=>{
  const built=await buildRuntimeCoverage(),stored=JSON.parse(await readFile(new URL('../docs/runtime-function-coverage.json',import.meta.url),'utf8'));
  assert.deepEqual(stored,built,'Run npm run runtime:coverage after source/contract changes');
  assert.equal(await readFile(new URL('../docs/RUNTIME-FUNCTION-COVERAGE.vi.md',import.meta.url),'utf8'),renderRuntimeCoverage(built));
  assert.equal(built.rows.length,188);assert.equal(new Set(built.rows.map(r=>r.key)).size,188);
  assert.equal(built.tools.length+1,53);assert.equal(built.tools.filter(t=>t.status==='unsupported').length,10);
  for(const r of built.rows){assert.ok(r.reason.length>10);for(const name of r.consumers)assert.ok(BROWSER_TOOLS.some(t=>t.name===name)||name==='uipath_driver_versions');}
  for(const name of Object.keys(UNAVAILABLE_TOOLS))assert.equal(built.tools.find(t=>t.name===name).status,'unsupported');
  assert.equal(built.rows.find(r=>r.key==='named:GetBrowserData').disposition,'not-wired');
  assert.equal(built.rows.find(r=>r.key==='generic:map:5').disposition,'not-wired');
  assert.equal(built.rows.find(r=>r.key==='generic:special:6').disposition,'wired');
});
