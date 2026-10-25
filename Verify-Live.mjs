import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LineDecoder } from './src/transport.mjs';
import { ROOT, EXTENSION_ID } from './src/bridge.mjs';

const child = spawn(process.execPath, [path.join(ROOT, 'src', 'bridge.mjs'), 'mcp'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
const pending = new Map();
const decoder = new LineDecoder();
let nextId = 0;
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
function rejectAll(error) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
}
child.on('error', rejectAll);
child.on('exit', () => rejectAll(new Error('MCP server exited before replying')));
child.stdout.on('data', chunk => {
  try {
    for (const response of decoder.push(chunk)) {
      const item = pending.get(response.id);
      if (!item) continue;
      clearTimeout(item.timer);
      pending.delete(response.id);
      if (response.error) item.reject(new Error(response.error.message));
      else item.resolve(response.result);
    }
  } catch (error) { rejectAll(error); }
});
const notify = (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 45000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
try {
  const initialized = await request('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'uipath-live-verification', version: '0.1.0' }
  });
  assert.equal(initialized.protocolVersion, '2025-06-18');
  notify('notifications/initialized');
  const catalog = await request('tools/list');
  const statusResult = await request('tools/call', { name: 'uipath_bridge_status', arguments: {} });
  assert.equal(statusResult.isError, false);
  let status = JSON.parse(statusResult.content[0].text);
  assert.equal(status.connected, true, 'Chrome must have a live native-host connection');
  const versionResult = await request('tools/call', { name: 'uipath_driver_versions', arguments: {} });
  assert.equal(versionResult.isError, false, versionResult.content?.[0]?.text);
  const drivers = JSON.parse(versionResult.content[0].text);
  assert.equal(drivers.source, 'live-uipath-extension');
  assert.ok(drivers.versions.length > 0);
  let navigation = null;
  const openArgument = process.argv.indexOf('--open-url');
  if (openArgument !== -1) {
    const url = process.argv[openArgument + 1];
    const openedResult = await request('tools/call', { name: 'uipath_open_url', arguments: { url } });
    assert.equal(openedResult.isError, false, openedResult.content?.[0]?.text);
    let observed = JSON.parse(openedResult.content[0].text);
    for (let attempt = 0; observed.status !== 'complete' && attempt < 15; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await request('tools/call', { name: 'uipath_tab_info', arguments: { tabId: observed.tabId } });
      assert.equal(result.isError, false, result.content?.[0]?.text);
      observed = JSON.parse(result.content[0].text);
    }
    navigation = { requestedUrl: url, observedTab: observed,
      verified: observed.status === 'complete' && new URL(observed.url).hostname === new URL(url).hostname };
    assert.equal(navigation.verified, true, 'Navigation was requested, but the requested origin did not finish loading');
    const finalStatus = await request('tools/call', { name: 'uipath_bridge_status', arguments: {} });
    assert.equal(finalStatus.isError, false);
    status = JSON.parse(finalStatus.content[0].text);
  }
  const sourcePath = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'Default',
    'Extensions', EXTENSION_ID, '23.10.1_0', 'BackgroundMain.js');
  const hash = createHash('sha256').update(await readFile(sourcePath)).digest('hex').toUpperCase();
  const initialHash = '144341DA022E66FD8817C837EF7BF6F5D2C923D59E97FBE33CCB92D6221287D4';
  const receipt = {
    verifiedAt: new Date().toISOString(),
    extension: { id: EXTENSION_ID, version: '23.10.1', backgroundMainSha256: hash,
      backgroundMainUnchangedSinceRegistration: hash === initialHash },
    nativeConnectionVerified: true,
    mcpStdioRoundTripVerified: true,
    mcpTools: catalog.tools.map(tool => tool.name),
    connection: status,
    embeddedDriverVersions: drivers.versions,
    chatgptToolDiscoveryVerified: false,
    fullUiPathHandshakeVerified: false,
    driverHandshakeVerified: status.driverLoaded === true || navigation !== null,
    navigation,
    pageAutomationVerified: false,
    scope: navigation ? 'A local MCP client opened the requested URL via UiPath OpenTab and independently read back the tab URL, title and complete load status through the extension. Click and typing were not attempted.' : 'A separate local MCP test client called the real Chrome-launched host and received a driver-version response from the installed extension. No page actions were attempted.',
    stderrWasEmpty: stderr.length === 0
  };
  await writeFile(path.join(ROOT, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
}
