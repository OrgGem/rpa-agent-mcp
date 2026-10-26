import assert from 'node:assert/strict';
import test from 'node:test';
import { AXE_CORE_VERSION, createAccessibilityAuditTickets } from '../src/browser-accessibility.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const base = Object.freeze({ ownerRef: 'client_A', contextRef: 'ctx_A', tabRef: 'tab_A',
  documentGeneration: 4, standard: 'WCAG21AA', includeIncomplete: true, limit: 10,
  requestKey: 'audit-start-1', deadline: Date.now() + 20_000 });

function rawAudit() {
  return {
    violations: [{
      id: 'image-alt', impact: 'critical', description: 'Images need text alternatives',
      help: 'Add alt text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
      tags: ['wcag2a', 'wcag21a'], nodes: [{ target: ['img#hero'], html: '<img id="hero" src="x" value="secret">',
        failureSummary: 'input value="secret" has no useful text' }],
    }],
    incomplete: [{ id: 'color-contrast', nodes: [{ target: ['.label'], reason: 'Check the text contrast manually' }] }],
    passes: [{ id: 'landmark-one-main' }],
  };
}

async function flushPromises() { await new Promise(resolve => setImmediate(resolve)); }

test('readiness and ticket executor use closed audit metadata and return a bounded redacted result', async () => {
  let execution;
  const manager = createAccessibilityAuditTickets({
    executorReady: async ({ engine, version }) => engine === 'axe-core' && version === AXE_CORE_VERSION,
    runIsolated: options => { execution = options; return Promise.resolve(rawAudit()); },
  });
  assert.deepEqual(await manager.readiness(), { available: true, reason: null });
  const started = manager.start(base);
  assert.equal(started.state, 'running');
  assert.equal(execution.operation, 'ax.audit.start');
  assert.deepEqual(execution.tags, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  assert.equal(execution.engineVersion, '4.14.0');
  assert.equal('axeSource' in execution, false);
  await flushPromises();
  const completed = manager.poll({ ownerRef: base.ownerRef, auditRef: started.auditRef });
  assert.equal(completed.state, 'complete');
  assert.equal(completed.result.engineVersion, '4.14.0');
  assert.equal(completed.result.violations[0].nodes[0].elementRef, null);
  assert.equal(completed.result.violations[0].nodes[0].htmlExcerpt.includes('value="secret"'), false);
  assert.match(completed.result.violations[0].nodes[0].failureSummary, /REDACTED/);
  assert.deepEqual(completed.result.incomplete[0].targetPath, ['.label']);
});

test('cancel drops the result but retains the per-document lock until the scan settles', async () => {
  const work = deferred();
  const manager = createAccessibilityAuditTickets({ runIsolated: () => work.promise });
  const started = manager.start(base);
  assert.deepEqual(manager.cancel({ ownerRef: base.ownerRef, auditRef: started.auditRef, requestKey: 'cancel-1' }),
    { action: 'cancel', auditRef: started.auditRef, state: 'cancelled', cleanupState: 'result-dropped' });
  assert.throws(() => manager.start({ ...base, requestKey: 'second' }), { code: 'BACKEND_BUSY' });
  work.resolve(rawAudit());
  await flushPromises();
  assert.deepEqual(manager.poll({ ownerRef: base.ownerRef, auditRef: started.auditRef }),
    { action: 'poll', auditRef: started.auditRef, state: 'unknown', cleanupState: 'result-dropped' });
  assert.equal(manager.start({ ...base, requestKey: 'second' }).state, 'running');
});

test('documentGone releases only the old document generation lock', async () => {
  const oldWork = deferred();
  const newWork = deferred();
  let calls = 0;
  const manager = createAccessibilityAuditTickets({ runIsolated: () => (++calls === 1 ? oldWork.promise : newWork.promise) });
  const old = manager.start(base);
  assert.equal(manager.documentGone({ ownerRef: base.ownerRef, contextRef: base.contextRef,
    tabRef: base.tabRef, documentGeneration: base.documentGeneration }), true);
  const next = manager.start({ ...base, requestKey: 'new-document-audit', documentGeneration: base.documentGeneration + 1 });
  oldWork.resolve(rawAudit());
  await flushPromises();
  assert.throws(() => manager.start({ ...base, requestKey: 'another-old-doc-audit' }), { code: 'DOCUMENT_GONE' });
  assert.throws(() => manager.start({ ...base, requestKey: 'another-new-doc-audit',
    documentGeneration: base.documentGeneration + 1 }), { code: 'BACKEND_BUSY' });
  assert.equal(manager.poll({ ownerRef: base.ownerRef, auditRef: old.auditRef }).state, 'unknown');
  newWork.resolve(rawAudit());
  await flushPromises();
  assert.equal(manager.poll({ ownerRef: base.ownerRef, auditRef: next.auditRef }).state, 'complete');
});

test('expired work reports unknown while its document lock remains until completion', async () => {
  let current = 1000;
  const work = deferred();
  const manager = createAccessibilityAuditTickets({ now: () => current, runIsolated: () => work.promise });
  const started = manager.start({ ...base, deadline: 20_000 });
  current = 12_000;
  assert.deepEqual(manager.poll({ ownerRef: base.ownerRef, auditRef: started.auditRef }),
    { action: 'poll', auditRef: started.auditRef, state: 'unknown', cleanupState: 'ticket-retained' });
  assert.throws(() => manager.start({ ...base, requestKey: 'still-running' }), { code: 'BACKEND_BUSY' });
  work.resolve(rawAudit());
  await flushPromises();
  assert.equal(manager.start({ ...base, requestKey: 'after-settle' }).state, 'running');
});

test('start request keys are idempotent, conflict on changed arguments, and inputs reject extra fields', () => {
  let calls = 0;
  const manager = createAccessibilityAuditTickets({ runIsolated: () => { calls++; return new Promise(() => {}); } });
  const first = manager.start(base);
  assert.equal(manager.start(base).auditRef, first.auditRef);
  assert.equal(calls, 1);
  assert.throws(() => manager.start({ ...base, standard: 'WCAG22AA' }), { code: 'REQUEST_KEY_CONFLICT' });
  assert.throws(() => manager.poll({ ownerRef: base.ownerRef, auditRef: first.auditRef, extra: true }),
    { code: 'INVALID_ARGUMENT' });
  assert.throws(() => manager.documentGone({ ownerRef: base.ownerRef, contextRef: base.contextRef,
    tabRef: base.tabRef, documentGeneration: base.documentGeneration, extra: true }), { code: 'INVALID_ARGUMENT' });
});

