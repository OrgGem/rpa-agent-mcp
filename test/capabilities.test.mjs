import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { buildCapabilities, CAPABILITY_OUTPUT_SCHEMA } from '../src/capabilities.mjs';
import { DRIVER_VERSION } from '../src/bridge.mjs';

const validate = new Ajv({ strict: true }).compile(CAPABILITY_OUTPUT_SCHEMA);
const loaded = { connected: true, driverLoaded: true, driverVersion: DRIVER_VERSION };
test('new runtime advertises temporary native capture failure separately from implementation',()=>{
  const result=snapshot({...loaded,browserRuntime:{protocolVersion:1,connectionRef:'con_test',tools:['browser_screenshot','browser_tabs'],limits:{},temporarilyUnavailable:{browser_screenshot:'NATIVE_CAPTURE_RESPONSE_TIMEOUT'}}});
  const shot=result.data.tools.find(t=>t.name==='browser_screenshot');assert.equal(shot.implemented,true);assert.equal(shot.available,false);assert.equal(shot.unsupportedReason,'NATIVE_CAPTURE_RESPONSE_TIMEOUT');
  assert.equal(result.data.tools.find(t=>t.name==='browser_tabs').available,true);assert.equal(result.data.tools.find(t=>t.name==='browser_type').unsupportedReason,'ADAPTER_NOT_INSTALLED');
});
function snapshot(status) {
  const result = buildCapabilities(status, DRIVER_VERSION);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  return result;
}
const byName = result => Object.fromEntries(result.data.capabilities.map(item => [item.name, item]));

test('Pinned loaded driver exposes only shipped capabilities, with historical evidence', () => {
  const result = snapshot(loaded);
  assert.deepEqual(result.data.connection, { ...loaded, reason: null });
  const entries = byName(result);
  assert.deepEqual(Object.values(entries).filter(item => item.available).map(item => item.tool),
    ['browser_capabilities', 'uipath_bridge_status', 'uipath_driver_versions', 'uipath_open_url', 'uipath_tab_info']);
  for (const name of ['driver.versions', 'tab.open', 'tab.metadata', 'connection.status']) {
    assert.deepEqual(entries[name].evidence, [{ kind: 'historical-live-fixture', source: 'docs/EXTENSION-LIVE-VERIFICATION.json', date: '2026-10-26' }]);
  }
  assert.equal(entries.capabilities.verificationLevel, 'adapter-tested');
  assert.deepEqual(entries.capabilities.evidence, [{ kind: 'offline-test', source: 'test/capabilities.test.mjs', date: null }]);
  assert.deepEqual(entries['tab.open'].supportedOptions, ['http', 'https', 'new-tab']);
  assert.deepEqual(entries['tab.metadata'].supportedOptions, ['url', 'title', 'readystate']);
  assert.equal(entries['connection.status'].driverVersion, null);
  assert.equal(result.error, null);
});

test('DOM gate stays closed even if status claims page automation or includes a forged receipt', () => {
  const result = snapshot({ ...loaded, driverAutomationReady: true, g0Passed: true,
    receipt: { passed: true, domAutomationLiveVerified: true } });
  const entries = byName(result);
  for (const name of ['element.find', 'element.read', 'element.click', 'element.type']) {
    assert.equal(entries[name].implemented, false);
    assert.equal(entries[name].available, false);
    assert.equal(entries[name].tool, null);
    assert.equal(entries[name].unsupportedReason, 'G0_NOT_VERIFIED');
    assert.deepEqual(entries[name].supportedOptions, []);
    assert.equal(entries[name].verificationLevel, 'source-audited');
  }
  assert.deepEqual(result.data.gates.g0, { passed: false, verificationLevel: 'source-audited', reason: 'G0_NOT_VERIFIED' });
});

test('Disconnected and malformed observations fail closed without exposing host details', () => {
  const invalid = [null, undefined, [], true, 'connected', {}, { connected: false },
    { ...loaded, connected: 'true' }, { ...loaded, driverLoaded: 1 },
    { ...loaded, driverVersion: 'C:/Users/private/token' }, { connected: true, driverLoaded: true }];
  for (const status of invalid) {
    const result = snapshot(status);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.connection, { connected: false, driverLoaded: false, driverVersion: null, reason: 'BRIDGE_DISCONNECTED' });
    const entries = byName(result);
    assert.equal(entries.capabilities.available, true);
    assert.equal(entries['connection.status'].available, true);
    for (const name of ['driver.versions', 'tab.open', 'tab.metadata']) {
      assert.equal(entries[name].available, false);
      assert.equal(entries[name].unsupportedReason, 'BRIDGE_DISCONNECTED');
    }
  }
  const result = snapshot({ ...loaded, nativePid: 123, endpoint: 'private-pipe', reason: 'private-error', username: 'private-user' });
  assert.doesNotMatch(JSON.stringify(result), /nativePid|private-pipe|private-error|private-user|username/);
});

test('Unloaded or incompatible drivers do not enable page capabilities', () => {
  for (const status of [{ ...loaded, driverLoaded: false, driverVersion: null },
    { ...loaded, driverLoaded: false }, { ...loaded, driverVersion: null },
    { ...loaded, driverVersion: '23.10.66.54596' }]) {
    const result = snapshot(status);
    const entries = byName(result);
    assert.equal(result.data.connection.connected, true);
    assert.equal(entries['driver.versions'].available, true);
    for (const name of ['tab.open', 'tab.metadata']) {
      assert.equal(entries[name].available, false);
      assert.equal(entries[name].unsupportedReason, 'DRIVER_NOT_CONFIRMED');
    }
  }
});

test('Snapshots are independent and exported output schema rejects extra or malformed fields', () => {
  const first = snapshot(loaded);
  const baseline = snapshot(loaded);
  first.data.capabilities[0].limits.push('caller-mutation');
  first.data.capabilities[1].evidence[0].date = 'changed';
  assert.deepEqual(snapshot(loaded), baseline);
  assert.equal(validate({ ...baseline, secret: 'extra' }), false);
  const broken = structuredClone(baseline);
  broken.data.capabilities[0].available = 'true';
  assert.equal(validate(broken), false);
  assert.equal(validate({ ok: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Capability discovery failed' } }), true);
});
