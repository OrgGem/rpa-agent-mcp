import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMatrix, renderMatrix, REPO } from './build-function-matrix.mjs';

export async function validateMatrix(matrix, { catalog, audit, spec, plan }) {
  const actualKeys=matrix.rows.map(r=>r.key);
  assert.equal(new Set(actualKeys).size,actualKeys.length,'Duplicate row keys');
  const expected=[...catalog.functions.map(f=>`named:${f.name}`),...catalog.loaderFunctions.map(n=>`loader:${n}`),
    ...catalog.staticReverseCalls.map(n=>`host-callback:${n}`),...audit.genericRoutes.map(r=>`generic:map:${r.messageId}`),
    ...audit.specialRoutes.map(r=>`generic:special:${r.messageId}`),...audit.contentDispatch.map(r=>`content:${r.contentCommandId}`)];
  assert.deepEqual([...actualKeys].sort(),expected.sort(),'Missing or unexpected protocol rows');
  const tasks=new Set([...plan.matchAll(/^\|[^\n]*?\| (F\d+\.\d+|G0\.\d+) \|/gm)].map(m=>m[1]));
  const tools=new Set([...spec.features.flatMap(f=>f.proposedTools),...spec.existingMcpTools,'browser_capabilities']);
  const testIds=new Set();
  for(const r of matrix.rows){
    assert.ok(r.adapter?.length&&r.scenario?.length,r.key+' needs adapter/scenario');
    assert.ok(r.taskIds.length,r.key+' needs task');
    for(const t of r.taskIds) assert.ok(tasks.has(t),r.key+' unknown task '+t);
    for(const t of r.mcpTools)assert.ok(tools.has(t),r.key+' unknown MCP consumer '+t);
    if(['unsupported','alternative-route','shadowed'].includes(r.decision))assert.ok(r.unsupportedReason?.length,r.key+' needs reason');
    if(r.decision==='unsupported')assert.equal(r.mcpTools.length,0,r.key+' unsupported route cannot be advertised');
    assert.ok(r.tests.length>=2,r.key+' needs contract and fixture/negative tests');
    for(const test of r.tests){assert.ok(!testIds.has(test.id),'Duplicate test ID');testIds.add(test.id);assert.equal(test.status,'planned');assert.ok(test.scenario.length);}
  }
  assert.deepEqual(matrix.featureCoverage.map(f=>f.featureId).sort(),spec.features.map(f=>f.id).sort());
  assert.deepEqual([...new Set(matrix.featureCoverage.flatMap(f=>f.tools))].sort(),[...new Set(spec.features.flatMap(f=>f.proposedTools))].sort());
  for(const f of matrix.featureCoverage){
    for(const t of f.taskIds)assert.ok(tasks.has(t),f.featureId+' unknown task');
    for(const key of f.candidateFunctionKeys)assert.ok(actualKeys.includes(key),f.featureId+' missing candidate');
    assert.ok(f.tests.length&&f.tests.every(t=>t.scenario&&t.status==='planned'));
  }
  const stub=matrix.rows.find(r=>r.key==='named:FindWebCtrlElements');
  assert.equal(stub.decision,'unsupported');
  assert.equal(matrix.rows.find(r=>r.key==='named:GetHtmlElemById').decision,'unsupported');
  assert.equal(matrix.rows.find(r=>r.key==='generic:map:6').decision,'shadowed');
  return {passed:true,counts:matrix.counts,plannedTestCases:testIds.size+matrix.featureCoverage.length};
}
export async function checkArtifacts(){
  const json=async p=>JSON.parse(await readFile(path.join(REPO,p),'utf8'));
  const [matrix,catalog,audit,spec,plan]=await Promise.all([json('docs/extension-function-matrix.json'),json('docs/uipath-function-catalog.json'),json('docs/pinned-driver-audit.json'),json('docs/browser-feature-spec.json'),readFile(path.join(REPO,'docs/DEVELOPMENT-PHASES.vi.md'),'utf8')]);
  const result=await validateMatrix(matrix,{catalog,audit,spec,plan});
  assert.deepEqual(matrix,await buildMatrix(),'JSON matrix/source decisions drift; regenerate after review');
  assert.equal(await readFile(path.join(REPO,'docs/EXTENSION-FUNCTION-MATRIX.vi.md'),'utf8'),renderMatrix(matrix),'Markdown matrix drift');
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkArtifacts()));
