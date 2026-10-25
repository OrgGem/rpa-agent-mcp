import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMatrix, REPO, qualifiesG04Evidence } from '../scripts/build-function-matrix.mjs';
import { validateMatrix, checkArtifacts } from '../scripts/validate-function-matrix.mjs';
import path from 'node:path';

test('Matrix covers every named/loader/callback/generic/content row and every roadmap tool', async()=>{
  const result=await checkArtifacts();
  assert.equal(result.passed,true);
  assert.equal(result.counts.rows,188);
  assert.equal(result.counts.proposedTools,53);
});

test('G0.4 live evidence requires independent closure and current probe/runner/fixture fingerprints',async()=>{
  const json=async p=>JSON.parse(await readFile(path.join(REPO,p),'utf8'));
  const [receipt,audit]=await Promise.all([json('docs/G0-4-LIVE-VERIFICATION.json'),json('docs/pinned-driver-audit.json')]);
  const files=['src/g0-probe.mjs','scripts/run-g04.mjs','scripts/g04-fixture.mjs','scripts/fixtures/g04-app.jsx','package-lock.json'];
  const hashes=Object.fromEntries(files.map(f=>[f,receipt.sourceHashes[f]]));
  assert.equal(qualifiesG04Evidence(receipt,audit,hashes),true);
  for(const file of files)assert.equal(qualifiesG04Evidence(receipt,audit,{...hashes,[file]:'changed'}),false,file);
  for(const mutate of [r=>r.cleanup.tabClosureVerified=false,r=>r.cleanup.launcherDisableVerified=false,
    r=>r.latestLiveAttempt.probeSourceSha256='old',r=>r.latestLiveAttempt.runnerSourceSha256='old',
    r=>r.latestLiveAttempt.steps[0].name='wrong-case',r=>r.latestLiveAttempt.steps[0].passed=false]){
    const changed=structuredClone(receipt);mutate(changed);assert.equal(qualifiesG04Evidence(changed,audit,hashes),false);
  }
});
test('Matrix validator rejects omitted functions, missing unsupported reasons and invalid task/tool links',async()=>{
  const json=async p=>JSON.parse(await readFile(path.join(REPO,p),'utf8'));
  const [catalog,audit,spec,plan]=await Promise.all([json('docs/uipath-function-catalog.json'),json('docs/pinned-driver-audit.json'),json('docs/browser-feature-spec.json'),readFile(path.join(REPO,'docs/DEVELOPMENT-PHASES.vi.md'),'utf8')]);
  const context={catalog,audit,spec,plan};
  const base=await buildMatrix();
  for(const mutate of [m=>m.rows.pop(),m=>m.rows.find(r=>r.decision==='unsupported').unsupportedReason=null,
    m=>m.rows[0].taskIds=['F99.1'],m=>m.rows[0].mcpTools=['invented_tool'],m=>m.featureCoverage.pop(),
    m=>m.rows[0].tests[0].status='passed']){
    const changed=structuredClone(base);mutate(changed);await assert.rejects(validateMatrix(changed,context));
  }
});
