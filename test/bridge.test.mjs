import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import Ajv from 'ajv';
import { NativeDecoder, LineDecoder, nativeFrame, MAX_BYTES } from '../src/transport.mjs';
process.env.UIPATH_BRIDGE_INSTANCE = `test-${process.pid}`;
const { ROOT, ORIGIN, ipcCall, DRIVER_VERSION } = await import('../src/bridge.mjs');

test('Native transport survives fragmented headers, UTF-8 splits and coalesced frames', () => {
  const messages = [{ text: 'Tiếng Việt 😀' }, { returnId: 'bridge-1', versions: ['23.10.1.0'] }];
  const wire = Buffer.concat(messages.map(nativeFrame));
  const parser = new NativeDecoder();
  const decoded = [];
  for (const byte of wire) decoded.push(...parser.push(Buffer.from([byte])));
  assert.deepEqual(decoded, messages);
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32LE(MAX_BYTES + 1);
  assert.throws(() => new NativeDecoder().push(oversized), /length/);
});

test('Native process, IPC and MCP complete a round trip with a simulated extension', { timeout: 15000 }, async t => {
  const entry = path.join(ROOT, 'src', 'bridge.mjs');
  const host = spawn(process.execPath, [entry, 'native', ORIGIN], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, UIPATH_G0_PROBE: '' } });
  let hostErrors = '';
  host.stderr.on('data', chunk => { hostErrors += chunk; });
  t.after(() => host.kill());
  const nativeDecoder = new NativeDecoder();
  const observed = [];
  let transientMetadataFailures = 1;
  host.stdout.on('data', chunk => {
    for (const message of nativeDecoder.push(chunk)) {
      observed.push(message);
      if (message.functionCall === 'GetEmbeddedDriverVersions') {
        host.stdin.write(nativeFrame({ returnId: 'unrelated', versions: ['ignored'] }));
        const response = nativeFrame({ returnId: message.requestId, codeVersion: message.codeVersion, versions: ['test-driver-23.10'] });
        host.stdin.write(response.subarray(0, 2));
        host.stdin.write(response.subarray(2));
      } else if (message.functionCall === 'OnProductVersionChanged') {
        host.stdin.write(nativeFrame({ functionCall: 'LoadScripts', requestId: 99 }));
        host.stdin.write(nativeFrame({ returnId: message.requestId, wasDriverLoaded: 1 }));
      } else if (message.functionCall === 'Handshake') {
        host.stdin.write(nativeFrame({ returnId: message.requestId, retCode: true }));
      } else if (message.functionCall === 'GetActiveTabId') {
        host.stdin.write(nativeFrame({ returnId: message.requestId, retCode: true, tabId: '8' }));
      } else if (message.functionCall === 'OpenTab') {
        host.stdin.write(nativeFrame({ returnId: message.requestId, retCode: !message.url.endsWith('/fail'), newTabId: 42 }));
      } else if (message.functionCall === 'GetHtmlAttribute') {
        if (transientMetadataFailures-- > 0) {
          host.stdin.write(nativeFrame({ returnId: message.requestId, retCode: 0, attrValue: '' }));
        } else {
          const value = { url: 'https://example.test/', title: 'Test page', readystate: '1' }[message.attrName];
          host.stdin.write(nativeFrame({ returnId: message.requestId, retCode: true, attrValue: value }));
        }
      }
    }
  });
  let connected = false;
  for (let i = 0; i < 40; i++) {
    try { await ipcCall('status', 500); connected = true; break; }
    catch { await delay(40); }
  }
  assert.equal(connected, true, hostErrors);
  host.stdin.write(nativeFrame({ functionCall: 'RegisterNewlyCreatedWindowId', requestId: 17, windowId: 8 }));
  for (let i = 0; i < 30 && !observed.some(m => m.returnId === 17); i++) await delay(20);
  assert.ok(observed.some(m => m.returnId === 17), 'The extension registration callback must be acknowledged');
  assert.equal((await ipcCall('status')).registeredWindowCount, 1);
  assert.equal((await ipcCall('status')).g0ProbeProtocol, null);
  assert.equal((await ipcCall('g0_probe', 1000, { action: 'preflight' })).enabled, false);
  await assert.rejects(ipcCall('g0_probe', 1000, { action: 'open', fixtureUrl: 'http://127.0.0.1:123/g0/11111111-2222-3333-4444-555555555555/page' }), /G0_PROBE_DISABLED/);
  assert.deepEqual((await ipcCall('versions')).versions, ['test-driver-23.10']);
  await assert.rejects(ipcCall('arbitrary-operation'), /Unsupported/);

  const mcp = spawn(process.execPath, [entry, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => mcp.kill());
  const replies = new Map();
  const lines = new LineDecoder();
  mcp.stdout.on('data', chunk => {
    for (const message of lines.push(chunk)) {
      const callback = replies.get(message.id);
      if (callback) { replies.delete(message.id); callback(message); }
    }
  });
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => reject(new Error('MCP response timed out')), 3000);
    replies.set(requestId, message => { clearTimeout(timer); resolve(message); });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
  });
  assert.equal((await send('tools/list')).error.code, -32000);
  const init = await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const listed = await send('tools/list');
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['uipath_bridge_status', 'uipath_driver_versions', 'uipath_open_url', 'uipath_tab_info', 'browser_capabilities']);
  const discoveryTool = listed.result.tools.find(tool => tool.name === 'browser_capabilities');
  const validate = new Ajv({ strict: true }).compile(discoveryTool.outputSchema);
  const beforeDiscovery = observed.length;
  const discovery = await send('tools/call', { name: 'browser_capabilities', arguments: {} });
  assert.equal(discovery.result.isError, false);
  assert.equal(validate(discovery.result.structuredContent), true, JSON.stringify(validate.errors));
  assert.deepEqual(JSON.parse(discovery.result.content[0].text), discovery.result.structuredContent);
  assert.equal(discovery.result.structuredContent.data.connection.driverLoaded, false);
  assert.equal(discovery.result.structuredContent.data.capabilities.find(c => c.name === 'tab.open').available, false);
  assert.equal(observed.length, beforeDiscovery, 'Capability discovery must not send extension commands');
  for (const args of [null, [], true, 'string', 1, { functionCall: 'click' }]) {
    const rejected = await send('tools/call', { name: 'browser_capabilities', arguments: args });
    assert.equal(rejected.error.code, -32602);
  }
  assert.equal((await send('tools/call', { name: 'browser_capabilities' })).result.isError, false);
  assert.equal(observed.length, beforeDiscovery, 'Rejected inputs and omitted arguments must not activate the driver');
  const call = await send('tools/call', { name: 'uipath_driver_versions', arguments: {} });
  assert.equal(call.result.isError, false);
  assert.deepEqual(JSON.parse(call.result.content[0].text).versions, ['test-driver-23.10']);
  assert.equal((await send('tools/call', { name: 'uipath_driver_versions', arguments: null })).result.isError, false, 'Keep legacy null argument normalization');
  const badArguments = await send('tools/call', { name: 'uipath_driver_versions', arguments: { functionCall: 'click' } });
  assert.equal(badArguments.error.code, -32602);
  const invalidUrl = await send('tools/call', { name: 'uipath_open_url', arguments: { url: 'javascript:alert(1)' } });
  assert.equal(invalidUrl.result.isError, true);
  assert.equal(observed.filter(m => m.functionCall === 'OpenTab').length, 0);
  const opened = await send('tools/call', { name: 'uipath_open_url', arguments: { url: 'https://example.test/' } });
  assert.equal(opened.result.isError, false);
  const info = JSON.parse(opened.result.content[0].text);
  assert.equal(info.tabId, 42);
  assert.equal(info.status, 'complete');
  assert.equal(info.url, 'https://example.test/');
  assert.equal(observed.filter(m => m.functionCall === 'OpenTab').length, 1, 'A transient metadata failure must not repeat OpenTab');
  const afterOpen = observed.length;
  const ready = (await send('tools/call', { name: 'browser_capabilities', arguments: {} })).result;
  assert.equal(validate(ready.structuredContent), true, JSON.stringify(validate.errors));
  assert.equal(ready.structuredContent.data.capabilities.find(c => c.name === 'tab.open').available, true);
  assert.equal(ready.structuredContent.data.gates.g0.passed, false);
  assert.equal(observed.length, afterOpen, 'Discovery must only read local host status');
  const loadScripts = observed.find(m => m.returnId === 99);
  assert.equal(loadScripts.version, DRIVER_VERSION);
  assert.equal(loadScripts.background, 'return null;', 'Decline an external adapter so the extension selects its embedded package');
  const failedOpen = await send('tools/call', { name: 'uipath_open_url', arguments: { url: 'https://example.test/fail' } });
  assert.equal(failedOpen.result.isError, true);
  assert.equal(observed.filter(m => m.functionCall === 'OpenTab').length, 2, 'Failed navigation must not be automatically repeated');
  const invalidTab = await send('tools/call', { name: 'uipath_tab_info', arguments: { tabId: -1 } });
  assert.equal(invalidTab.error.code, -32602);
  host.stdin.end();
  await new Promise(resolve => host.once('exit', resolve));
  await assert.rejects(ipcCall('status', 500), /unavailable|disconnected/);
  const offline = (await send('tools/call', { name: 'browser_capabilities', arguments: {} })).result;
  assert.equal(offline.isError, false);
  assert.equal(validate(offline.structuredContent), true, JSON.stringify(validate.errors));
  assert.equal(offline.structuredContent.data.connection.reason, 'BRIDGE_DISCONNECTED');
  assert.equal(offline.structuredContent.data.capabilities.find(c => c.name === 'connection.status').available, true);
  assert.deepEqual(JSON.parse(offline.content[0].text), offline.structuredContent);
  mcp.kill();
});

test('Opt-in native probe preflight works over IPC without dispatching extension actions', { timeout: 5000 }, async t => {
  const host=spawn(process.execPath,[path.join(ROOT,'src/bridge.mjs'),'native',ORIGIN],
    {stdio:['pipe','pipe','pipe'],env:{...process.env,UIPATH_G0_PROBE:'1'}});
  t.after(()=>host.kill());
  const nativeMessages=[];const decoder=new NativeDecoder();
  host.stdout.on('data',chunk=>nativeMessages.push(...decoder.push(chunk)));
  let connected=false;
  for(let i=0;i<30;i++){
    try{await ipcCall('status',300);connected=true;break;}catch{await delay(30);}
  }
  assert.equal(connected,true);
  assert.equal((await ipcCall('status')).g0ProbeProtocol,2);
  assert.deepEqual(await ipcCall('g0_probe',1000,{action:'preflight'}),
    {enabled:true,protocolVersion:2,scope:'owned-fixture-only',quarantined:false});
  await assert.rejects(ipcCall('g0_probe',1000,{action:['read'],sessionRef:'invalid',elementRef:'invalid'}),/PROBE_INVALID_ARGUMENT/);
  assert.deepEqual(nativeMessages,[],'Preflight/invalid input must not send native commands');
  assert.deepEqual(await ipcCall('g0_probe',1000,{action:'finish'}),{enabled:false,abandonedSession:false});
  assert.equal((await ipcCall('status')).g0ProbeProtocol,null);
  host.stdin.end();await new Promise(resolve=>host.once('exit',resolve));
});
