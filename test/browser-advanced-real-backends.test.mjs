import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { harness } from './browser-harness.mjs';
import { validateCompanionReply, validateCompanionRequest } from '../src/companion-protocol.mjs';
import { validateToolOutput } from '../src/browser-tools.mjs';
import { createAccessibilityAuditTickets } from '../src/browser-accessibility.mjs';
import { createBrowserSemanticClient } from '../src/browser-semantic.mjs';
import { createBrowserVisualMatcher } from '../src/browser-visual.mjs';

const profile = Object.freeze({ profileSessionRef: 'profile_real_backend_test', companionEpoch: 1,
  connectionEpoch: 1, keys: false, dialogs: false, filePicker: false, downloads: false,
  axQuery: false, axAudit: true });

const axeResult = Object.freeze({ engine: 'axe-core', engineVersion: '4.14.0', standard: 'WCAG21AA',
  summary: { violations: 1, incomplete: 0, passes: 8 },
  violations: [{ id: 'image-alt', impact: 'serious', description: 'Images need text alternatives',
    help: 'Add an alternative', helpUrl: 'https://dequeuniversity.com/rules/axe/4.14/image-alt',
    tags: ['wcag2a', 'wcag21a'], nodes: [{ targetPath: ['img#hero'], htmlExcerpt: '<img id="hero">',
      failureSummary: 'The image has no text alternative' }] }],
  incomplete: [], truncated: false });

function buildScenePng() {
  const width = 48;
  const height = 40;
  const image = new PNG({ width, height });
  let state = 0x6d2b79f5;
  for (let index = 0; index < width * height; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    image.data[index * 4] = state & 0xff;
    image.data[index * 4 + 1] = (state >>> 8) & 0xff;
    image.data[index * 4 + 2] = (state >>> 16) & 0xff;
    image.data[index * 4 + 3] = 255;
  }
  const patchWidth = 10;
  const patchHeight = 8;
  const patch = Buffer.alloc(patchWidth * patchHeight * 4);
  for (let y = 0; y < patchHeight; y++) {
    for (let x = 0; x < patchWidth; x++) {
      const offset = (y * patchWidth + x) * 4;
      patch[offset] = (x * 37 + y * 17 + ((x ^ y) * 11)) & 0xff;
      patch[offset + 1] = (x * 13 + y * 41 + ((x * y) * 3)) & 0xff;
      patch[offset + 2] = (x * 29 + y * 7 + ((x + y) * 19)) & 0xff;
      patch[offset + 3] = 255;
    }
  }
  for (const [left, top] of [[5, 4], [30, 20]]) {
    for (let y = 0; y < patchHeight; y++) {
      patch.copy(image.data, ((top + y) * width + left) * 4, y * patchWidth * 4, (y + 1) * patchWidth * 4);
    }
  }
  return PNG.sync.write(image);
}

function makeStrictCompanion(activeProfile = profile) {
  let runtime = null;
  let nextAuditMode = 'complete';
  let sequence = 0;
  const requests = [];
  const requestIds = new Set();
  const audits = new Map();
  const bindingArguments = [];

  function reply(request, data) {
    const envelope = { protocol: 1, requestId: request.requestId,
      connectionEpoch: request.connectionEpoch, ok: true, data };
    assert.equal(validateCompanionReply(envelope), true, `invalid companion reply for ${request.operation}`);
    assert.equal(envelope.requestId, request.requestId, 'reply must correlate to its exact request');
    assert.equal(envelope.connectionEpoch, request.connectionEpoch, 'reply must retain its connection epoch');
    return envelope;
  }

  const companion = {
    extensionId: 'test-companion-extension',
    readiness() { return { available: true, browser_capabilities: [activeProfile] }; },
    async beginPairing() { assert.fail('a valid current binding must not open a pairing challenge'); },
    async waitForPairing() { assert.fail('a valid current binding must not wait for pairing'); },
    getBinding(...args) {
      bindingArguments.push(args);
      assert.equal(args.length, 1, 'getBinding accepts one target object');
      assert.deepEqual(Object.keys(args[0]).sort(), ['contextRef', 'ownerRef', 'tabRef']);
      const target = args[0];
      const tab = runtime?.tabs.get(target.tabRef);
      if (!tab || tab.clientRef !== target.ownerRef || tab.contextRef !== target.contextRef) return null;
      return { ...target, pairRef: `pair_${target.ownerRef.slice(0, 12)}`,
        profileSessionRef: activeProfile.profileSessionRef, companionEpoch: activeProfile.companionEpoch,
        connectionEpoch: activeProfile.connectionEpoch, hostEpoch: runtime.hostEpoch,
        documentToken: tab.docToken, generation: tab.generation };
    },
    async request(requestEnvelope) {
      assert.equal(validateCompanionRequest(requestEnvelope), true,
        `invalid protocol request for ${requestEnvelope?.operation}`);
      assert.equal(requestIds.has(requestEnvelope.requestId), false,
        `duplicate companion request ID: ${requestEnvelope.requestId}`);
      requestIds.add(requestEnvelope.requestId);
      requests.push(structuredClone(requestEnvelope));

      let data;
      switch (requestEnvelope.operation) {
        case 'debugger.acquire':
          assert.equal(requestEnvelope.leaseRef, null);
          data = { leaseRef: `lease_${requestEnvelope.payload.ownerRef.slice(0, 12)}`,
            expiresAt: new Date(Date.now() + 30_000).toISOString() };
          break;
        case 'ax.audit.start': {
          const auditRef = `audit_server_${++sequence}`;
          audits.set(auditRef, { ownerRef: requestEnvelope.payload.ownerRef,
            contextRef: requestEnvelope.payload.contextRef, mode: nextAuditMode, settle: false });
          nextAuditMode = 'complete';
          data = { auditRef, state: 'running', expiresAt: new Date(Date.now() + 30_000).toISOString() };
          break;
        }
        case 'ax.audit.status': {
          const session = audits.get(requestEnvelope.payload.auditRef);
          assert.ok(session, 'status must refer to a server-owned audit');
          assert.equal(requestEnvelope.payload.ownerRef, session.ownerRef, 'status owner must match audit owner');
          assert.equal(requestEnvelope.payload.contextRef, session.contextRef, 'status context must match audit context');
          if (session.mode === 'pending' && !session.settle) data = { state: 'running' };
          else if (session.mode === 'pending') {
            session.settleObserved = true;
            data = { state: 'unknown' };
          }
          else data = { state: 'complete', result: axeResult };
          break;
        }
        case 'ax.audit.cancel':
          data = { state: 'cancelled', cleanupState: 'result-dropped' };
          break;
        case 'ax.query':
          assert.equal(requestEnvelope.payload.role, 'button');
          assert.equal(requestEnvelope.payload.accessibleName, 'Continue');
          data = { matches: [{ candidateId: 'candidate_continue', role: 'button', name: 'Continue',
            states: { disabled: false, checked: null, expanded: null, selected: null }, backendNodeId: 17 }],
            truncated: false, source: 'chrome-accessibility-tree' };
          break;
        default:
          assert.fail(`unexpected companion operation ${requestEnvelope.operation}`);
      }
      return reply(requestEnvelope, data);
    },
    async cleanupContext() { return { cleanupConfirmed: true, blockedTabRefs: [] }; },
    async cleanupClient() { return { cleanupConfirmed: true }; },
    invalidateTab() {},
  };

  return {
    companion,
    requests,
    audits,
    bindingArguments,
    setRuntime(value) { runtime = value; },
    queueAuditMode(mode) { nextAuditMode = mode; },
    settlePending() { for (const audit of audits.values()) if (audit.mode === 'pending') audit.settle = true; },
    async rejectDuplicateRequestId() {
      assert.ok(requests.length > 0);
      await assert.rejects(companion.request(requests[0]), /duplicate companion request ID/);
    },
    get requestIdCount() { return requestIds.size; },
  };
}

async function callChecked(runtime, clientRef, name, args) {
  const result = await runtime.call(clientRef, name, args);
  assert.equal(result.ok, true, `${name} failed: ${JSON.stringify(result.error)}`);
  assert.equal(validateToolOutput(name, result), true, `${name} returned an invalid public envelope`);
  return result;
}

async function waitFor(predicate, label) {
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function pollAudit(runtime, ownerRef, auditRef) {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const result = await runtime.call(ownerRef, 'browser_accessibility_audit', { action: 'poll', auditRef });
    if (!result.ok) throw new Error(`audit poll failed: ${JSON.stringify(result.error)}`);
    if (result.data.state !== 'running') return result;
    await delay(30);
  }
  assert.fail('audit did not settle before the test deadline');
}

test('real audit tickets use strict companion envelopes, isolate owners, and keep cancellation locked until settlement', {
  timeout: 12_000,
}, async t => {
  const boundary = makeStrictCompanion();
  let runtime;
  const auditTickets = createAccessibilityAuditTickets({
    executorReady: async ({ engine, version }) => engine === 'axe-core' && version === '4.14.0',
    runIsolated: input => runtime.advanced.runIsolatedAudit(input),
  });
  const h = await harness(t, { backends: { companion: boundary.companion, auditTickets } });
  runtime = h.runtime;
  boundary.setRuntime(runtime);

  const started = await callChecked(runtime, h.client, 'browser_accessibility_audit', {
    action: 'start', ...h.args, standard: 'WCAG21AA', includeIncomplete: false, limit: 10,
    requestKey: 'audit-owner-a-start', timeoutMs: 5000,
  });
  assert.equal(started.data.state, 'running');
  const completed = await pollAudit(runtime, h.client, started.data.auditRef);
  assert.equal(completed.data.state, 'complete');
  assert.equal(completed.data.result.engine, 'axe-core');
  assert.equal(completed.data.result.engineVersion, '4.14.0');
  assert.equal(completed.data.result.violations[0].nodes[0].elementRef, null);

  const secondClient = randomUUID();
  const tabs = await callChecked(runtime, secondClient, 'browser_tabs', {});
  const secondAttach = await callChecked(runtime, secondClient, 'browser_attach', {
    connectionRef: runtime.connectionRef, tabRef: tabs.data.tabs[0].tabRef,
  });
  const requestCountBeforeForeignPoll = boundary.requests.length;
  const foreignPoll = await runtime.call(secondClient, 'browser_accessibility_audit', {
    action: 'poll', auditRef: started.data.auditRef,
  });
  assert.equal(foreignPoll.ok, false);
  assert.equal(foreignPoll.error.code, 'STALE_AUDIT');
  assert.equal(boundary.requests.length, requestCountBeforeForeignPoll,
    'foreign owner must be rejected before reaching the Companion');

  boundary.queueAuditMode('pending');
  const cancelledStart = await callChecked(runtime, h.client, 'browser_accessibility_audit', {
    action: 'start', ...h.args, standard: 'WCAG21AA', includeIncomplete: false, limit: 10,
    requestKey: 'audit-owner-a-cancel-start', timeoutMs: 5000,
  });
  await waitFor(() => [...boundary.audits.values()].some(audit => audit.mode === 'pending'), 'pending Companion audit start');
  const cancelled = await callChecked(runtime, h.client, 'browser_accessibility_audit', {
    action: 'cancel', auditRef: cancelledStart.data.auditRef, requestKey: 'audit-owner-a-cancel',
  });
  assert.equal(cancelled.data.state, 'cancelled');

  const blockedStart = await runtime.call(h.client, 'browser_accessibility_audit', {
    action: 'start', ...h.args, standard: 'WCAG21AA', includeIncomplete: false, limit: 10,
    requestKey: 'audit-owner-a-still-locked', timeoutMs: 5000,
  });
  assert.equal(blockedStart.ok, false);
  assert.equal(blockedStart.error.code, 'BACKEND_BUSY', 'cancel must retain the running-document lock');

  boundary.settlePending();
  await waitFor(() => [...boundary.audits.values()].some(audit => audit.mode === 'pending' && audit.settleObserved),
    'cancelled Companion computation settlement');
  let restarted;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await runtime.call(h.client, 'browser_accessibility_audit', {
      action: 'start', ...h.args, standard: 'WCAG21AA', includeIncomplete: false, limit: 10,
      requestKey: `audit-owner-a-after-settlement-${attempt}`, timeoutMs: 5000,
    });
    if (result.ok) {
      assert.equal(validateToolOutput('browser_accessibility_audit', result), true);
      restarted = result;
      break;
    }
    assert.equal(result.error.code, 'BACKEND_BUSY');
    await delay(20);
  }
  assert.ok(restarted, 'ticket lock should release only after the Companion computation settles');
  assert.equal(restarted.data.state, 'running');
  const restartedResult = await pollAudit(runtime, h.client, restarted.data.auditRef);
  assert.equal(restartedResult.data.state, 'complete');

  const ownAudit = await callChecked(runtime, secondClient, 'browser_accessibility_audit', {
    action: 'start', contextRef: secondAttach.data.contextRef, tabRef: secondAttach.data.tabRef,
    standard: 'WCAG21AA', includeIncomplete: false, limit: 10,
    requestKey: 'audit-owner-b-start', timeoutMs: 5000,
  });
  assert.equal((await pollAudit(runtime, secondClient, ownAudit.data.auditRef)).data.state, 'complete');

  assert.ok(boundary.bindingArguments.length >= 5);
  assert.ok(boundary.bindingArguments.every(args => args.length === 1), 'binding calls must keep the object-argument API');
  assert.equal(boundary.requestIdCount, boundary.requests.length, 'all emitted request IDs must be unique');
  assert.ok(boundary.requests.every(validateCompanionRequest), 'every request uses the actual closed protocol validator');
  await boundary.rejectDuplicateRequestId();
});

test('real visual matcher analyzes only context-owned synthetic screenshot artifacts through runtime', {
  timeout: 15_000,
}, async t => {
  const scene = buildScenePng();
  const visualMatcher = createBrowserVisualMatcher();
  const h = await harness(t, { backends: { visualMatcher } });
  h.setHook(name => name === 'TakeScreenshot' ? { retCode: 1, data: scene.toString('base64') } : undefined);

  const target = await callChecked(h.runtime, h.client, 'browser_screenshot', { ...h.args, format: 'png' });
  const template = await callChecked(h.runtime, h.client, 'browser_screenshot', { ...h.args, format: 'png' });
  const result = await callChecked(h.runtime, h.client, 'browser_visual_find', {
    contextRef: h.args.contextRef, targetScreenshotRef: target.data.artifactRef,
    templateScreenshotRef: template.data.artifactRef,
    templateRegion: { x: 5, y: 4, width: 10, height: 8 }, threshold: 0.99999, maxMatches: 10,
  });
  assert.deepEqual(result.data.matches.map(match => match.rect), [
    { x: 5, y: 4, width: 10, height: 8 },
    { x: 30, y: 20, width: 10, height: 8 },
  ]);
  assert.equal(result.data.matches.every(match => match.score === 1), true);
  assert.equal(result.data.sourceScreenshotRef, target.data.artifactRef);
  assert.equal(result.data.templateScreenshotRef, template.data.artifactRef);
  assert.equal(result.data.coordinateSpace, 'screenshot-px');

  const secondClient = randomUUID();
  const tabs = await callChecked(h.runtime, secondClient, 'browser_tabs', {});
  const attached = await callChecked(h.runtime, secondClient, 'browser_attach', {
    connectionRef: h.runtime.connectionRef, tabRef: tabs.data.tabs[0].tabRef,
  });
  const foreign = await h.runtime.call(secondClient, 'browser_visual_find', {
    contextRef: attached.data.contextRef, targetScreenshotRef: target.data.artifactRef,
    templateScreenshotRef: template.data.artifactRef,
    templateRegion: { x: 5, y: 4, width: 10, height: 8 }, threshold: 0.99999, maxMatches: 10,
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error.code, 'STALE_ARTIFACT');
});

test('core and AX mode stay available without optional Windows OCR or an Ollama model', {
  timeout: 12_000,
}, async t => {
  let modelRequests = 0;
  const server = (await import('node:http')).createServer((_request, response) => {
    modelRequests++;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const activeProfile = Object.freeze({ ...profile, profileSessionRef: 'profile_ax_without_ollama', axQuery: true });
  const boundary = makeStrictCompanion(activeProfile);
  const semanticClient = createBrowserSemanticClient({ model: null, endpoint });
  const h = await harness(t, { backends: { companion: boundary.companion, semanticClient } });
  boundary.setRuntime(h.runtime);

  const descriptor = await h.runtime.capabilities();
  assert.equal(descriptor.toolReadiness.browser_ocr.available, false);
  assert.equal(descriptor.toolReadiness.browser_semantic_query.available, true);
  assert.equal(descriptor.toolReadiness.browser_semantic_query.modes.ax.available, true);
  assert.equal(descriptor.toolReadiness.browser_semantic_query.modes['natural-language'].available, false);
  assert.equal(descriptor.toolReadiness.browser_semantic_query.modes['natural-language'].reason, 'MODEL_NOT_CONFIGURED');
  assert.equal(descriptor.backends.semantic.available, false);
  assert.equal(descriptor.backends.semantic.model, null);

  const coreResult = await callChecked(h.runtime, h.client, 'browser_find_element', {
    ...h.args, locator: { kind: 'css', value: '#button' },
  });
  assert.equal(typeof coreResult.data.elementRef, 'string');

  const axResult = await callChecked(h.runtime, h.client, 'browser_semantic_query', {
    mode: 'ax', ...h.args, role: 'button', accessibleName: 'Continue', limit: 10, includeDisabled: false,
  });
  assert.equal(axResult.data.mode, 'ax');
  assert.equal(axResult.data.matches.length, 1);
  assert.equal(axResult.data.matches[0].accessibleName, 'Continue');
  assert.equal(axResult.data.matches[0].elementRef, null);
  assert.ok(boundary.requests.every(validateCompanionRequest));
  assert.equal(boundary.requests.filter(request => request.operation === 'ax.query').length, 1);
  assert.equal(boundary.requests.some(request => request.operation === 'ax.candidates'), false,
    'AX mode must not fetch candidate snapshots for Ollama');

  const naturalLanguage = await h.runtime.call(h.client, 'browser_semantic_query', {
    mode: 'natural-language', ...h.args, query: 'the Continue button', limit: 5,
  });
  assert.equal(naturalLanguage.ok, false);
  assert.equal(naturalLanguage.error.code, 'BACKEND_UNAVAILABLE');
  assert.equal(naturalLanguage.error.details.reason, 'MODEL_NOT_CONFIGURED');
  assert.equal(modelRequests, 0, 'readiness and AX mode must not call Ollama when no model is configured');
});
