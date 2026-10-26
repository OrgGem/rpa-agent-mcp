import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildRuntimeCoverage,renderRuntimeCoverage,qualifiesPublicLive,liveSourceFiles} from '../scripts/build-runtime-coverage.mjs';
import {BROWSER_TOOLS,CORE_BROWSER_TOOLS,ADVANCED_BROWSER_TOOL_NAMES,UNAVAILABLE_TOOLS} from '../src/browser-tools.mjs';
test('runtime coverage dispositions every protocol row and all 53 public browser/capability names',async()=>{
  const built=await buildRuntimeCoverage(),stored=JSON.parse(await readFile(new URL('../docs/runtime-function-coverage.json',import.meta.url),'utf8'));
  assert.deepEqual(stored,built,'Run npm run runtime:coverage after source/contract changes');
  assert.equal(await readFile(new URL('../docs/RUNTIME-FUNCTION-COVERAGE.vi.md',import.meta.url),'utf8'),renderRuntimeCoverage(built));
  assert.equal(built.rows.length,188);assert.equal(new Set(built.rows.map(r=>r.key)).size,188);
  assert.equal(built.tools.length+1,53);assert.equal(built.tools.filter(t=>t.status==='unsupported').length,0);
  assert.equal(CORE_BROWSER_TOOLS.length,42);assert.equal(ADVANCED_BROWSER_TOOL_NAMES.length,10);
  for(const r of built.rows){assert.ok(r.reason.length>10);for(const name of r.consumers)assert.ok(CORE_BROWSER_TOOLS.some(t=>t.name===name)||name==='uipath_driver_versions');}
  for(const name of ADVANCED_BROWSER_TOOL_NAMES){const item=built.tools.find(t=>t.name===name);assert.equal(item.status,'implemented-source');assert.equal(item.adapter,'src/browser-advanced.mjs');assert.equal(item.routes.length,0);assert.equal(item.live.status,'not-run');assert.ok(item.backend);}
  assert.deepEqual(Object.keys(UNAVAILABLE_TOOLS),[]);
  assert.equal(built.rows.find(r=>r.key==='named:GetBrowserData').disposition,'not-wired');
  assert.equal(built.rows.find(r=>r.key==='generic:map:5').disposition,'not-wired');
  assert.equal(built.rows.find(r=>r.key==='generic:special:6').disposition,'wired');
  assert.equal(built.liveSummary.totalCoreToolNames,42);assert.equal(built.liveSummary.totalAdvancedTools,10);assert.equal(built.liveSummary.advancedLiveVerified,0);
});
test('partial public live evidence requires current loaded host/runner hashes and explicit cleanup',async()=>{
  const load=async f=>JSON.parse(await readFile(new URL('../'+f,import.meta.url),'utf8'));
  const [stored,audit,coverage]=await Promise.all([load('docs/BROWSER-LIVE-VERIFICATION.json'),load('docs/pinned-driver-audit.json'),buildRuntimeCoverage()]);
  const receipt=structuredClone(stored);receipt.sourceHashes={...coverage.sourceHashes};receipt.loadedHostSourceHashes={...coverage.sourceHashes};receipt.passed=false;receipt.steps[6]={name:'screenshot-image-artifact',passed:false};receipt.lastFailure={tool:'browser_screenshot',code:'CAPTURE_FAILED'};receipt.toolsExercised=receipt.toolsExercised.filter(n=>!['browser_screenshot','browser_image_artifact'].includes(n));
  assert.equal(qualifiesPublicLive(receipt,coverage.sourceHashes,audit),true);
  const full=structuredClone(receipt);full.passed=true;full.steps[6].passed=true;full.toolsExercised.push('browser_screenshot','browser_image_artifact');delete full.lastFailure;assert.equal(qualifiesPublicLive(full,coverage.sourceHashes,audit),true);
  assert.equal(coverage.liveSummary.eligibleForScopedEvidence,qualifiesPublicLive(stored,coverage.sourceHashes,audit));
  for(const file of liveSourceFiles)assert.equal(qualifiesPublicLive(receipt,{...coverage.sourceHashes,[file]:'changed'},audit),false,file);
  for(const mutate of [r=>r.suite='capture-only',r=>r.cleanup.contextReleased=false,r=>r.cleanup.tabsClosed=false,r=>r.loadedHostSourceHashes['src/bridge.mjs']='old',r=>r.steps.pop(),r=>r.steps[0].name='unknown',r=>r.steps[0].passed=false,r=>r.passed=true,r=>r.steps[6].passed=true,r=>r.toolsExercised.push('invented_tool'),r=>r.toolsExercised.splice(r.toolsExercised.indexOf('browser_type'),1)]){const r=structuredClone(receipt);mutate(r);assert.equal(qualifiesPublicLive(r,coverage.sourceHashes,audit),false);}
  if(!qualifiesPublicLive(stored,coverage.sourceHashes,audit))assert.equal(coverage.liveSummary.successfulCoreToolNames,0);
});
