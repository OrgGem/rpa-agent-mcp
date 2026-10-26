import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWindowsBrowserHelper } from '../src/windows-browser-helper.mjs';

const defaultDeadline = () => Date.now() + 5000;

function envelope(data) {
  return { protocol: 1, ok: true, data };
}

function errorEnvelope(code, phase = 'before') {
  return { protocol: 1, ok: false, error: { code, phase } };
}

function capabilityData() {
  return { platform: 'windows', clipboardText: true,
    ocr: { available: true, languages: ['en-US'], maxImageDimension: 4096 } };
}

class FakeChild extends EventEmitter {
  constructor({ onRequest = () => envelope({}), killConfirms = true } = {}) {
    super();
    this.pid = undefined;
    this.killConfirms = killConfirms;
    this.onRequest = onRequest;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = new EventEmitter();
    this.input = null;
    this.killed = false;
    this.stdin.end = (chunk, encoding, callback) => {
      this.input = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk), encoding);
      callback?.();
      const request = JSON.parse(this.input.toString('utf8').replace(/\n$/, ''));
      this.onRequest(request, this);
    };
    process.nextTick(() => {
      this.pid = 4242;
      this.emit('spawn');
    });
  }

  respond(value, exitCode = 0) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
    if (bytes.length) this.stdout.emit('data', bytes);
    this.finish(exitCode);
  }

  finish(exitCode = 0) {
    this.emit('exit', exitCode, null);
    this.emit('close', exitCode, null);
  }

  kill() {
    this.killed = true;
    if (this.killConfirms) process.nextTick(() => this.finish(1));
    return true;
  }
}

function createHarness(onSpawn, options = {}) {
  const spawns = [];
  const helper = createWindowsBrowserHelper({
    spawn(executable, args, spawnOptions) {
      const child = onSpawn(spawns.length, executable, args, spawnOptions);
      spawns.push({ executable, args, spawnOptions, child });
      return child;
    },
    powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    helperPath: 'C:\\repo\\scripts\\Windows-BrowserHelper.ps1',
    ...options,
  });
  return { helper, spawns };
}

function validPngHeader(width = 20, height = 10) {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png[24] = 8;
  png[25] = 6;
  return png;
}

test('uses fixed PowerShell argv and UTF-8 JSON framing for Unicode payloads', async () => {
  let received;
  const { helper, spawns } = createHarness((index, executable, args, spawnOptions) => new FakeChild({
    onRequest(request, child) {
      received = request;
      child.respond(envelope({ format: 'text', writtenChars: [...request.payload.text].length }));
    },
  }));

  const result = await helper.writeClipboard({ text: '診断 🧪', deadline: defaultDeadline() });
  assert.deepEqual(result, { format: 'text', writtenChars: 4, dispatchState: 'acknowledged', verification: 'acknowledged' });
  assert.deepEqual(spawns[0].args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', 'C:\\repo\\scripts\\Windows-BrowserHelper.ps1']);
  assert.equal(spawns[0].executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(spawns[0].spawnOptions.windowsHide, true);
  assert.equal(spawns[0].spawnOptions.shell, false);
  assert.deepEqual(spawns[0].spawnOptions.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(received, { protocol: 1, operation: 'clipboard.write', payload: { text: '診断 🧪' } });
  assert.equal(spawns[0].child.input.toString('utf8').endsWith('\n'), true);
  assert.equal(spawns[0].child.input.toString('utf8').includes('診断 🧪'), true);
});

test('validates public input and helper output shapes before returning data', async () => {
  let count = 0;
  const { helper } = createHarness(() => {
    count++;
    return new FakeChild({ onRequest: (_request, child) => child.respond(envelope(capabilityData())) });
  });

  await assert.rejects(helper.capabilities({ deadline: defaultDeadline(), unexpected: true }), { code: 'INVALID_ARGUMENT' });
  assert.equal(count, 0);
  assert.deepEqual(await helper.capabilities({ deadline: defaultDeadline() }), capabilityData());
  assert.equal(count, 1);

  const malformed = createHarness(() => new FakeChild({
    onRequest: (_request, child) => child.respond({ ...envelope(capabilityData()), extra: true }),
  })).helper;
  await assert.rejects(malformed.capabilities({ deadline: defaultDeadline() }), { code: 'OPERATION_FAILED' });
});

test('serializes clipboard calls FIFO across helper instances and waits for close', async () => {
  const observed = [];
  let signalFirstReady;
  const firstReady = new Promise(resolve => { signalFirstReady = resolve; });
  const makeSpawn = (index) => new FakeChild({
    onRequest(request, child) {
      observed.push(request.operation);
      if (index === 0) signalFirstReady(() => child.respond(envelope({ format: 'text', text: 'first' })));
      else if (request.operation === 'clipboard.write') child.respond(envelope({ format: 'text', writtenChars: 1 }));
      else child.respond(envelope({ format: 'text', text: 'third' }));
    },
  });
  let spawnIndex = 0;
  const sharedSpawn = () => makeSpawn(spawnIndex++);
  const first = createWindowsBrowserHelper({ spawn: sharedSpawn });
  const second = createWindowsBrowserHelper({ spawn: sharedSpawn });
  const read = first.readClipboard({ deadline: defaultDeadline() });
  const write = second.writeClipboard({ text: 'x', deadline: defaultDeadline() });
  const third = first.readClipboard({ deadline: defaultDeadline() });

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(observed, ['clipboard.read']);
  const releaseFirst = await firstReady;
  releaseFirst();
  assert.equal((await read).text, 'first');
  await write;
  assert.equal((await third).text, 'third');
  assert.deepEqual(observed, ['clipboard.read', 'clipboard.write', 'clipboard.read']);
});

test('expired queued clipboard calls do not spawn or let later calls overtake', async () => {
  let firstChild;
  let spawnCount = 0;
  const { helper } = createHarness(() => {
    spawnCount++;
    if (spawnCount === 1) {
      firstChild = new FakeChild({ onRequest: () => {} });
      return firstChild;
    }
    return new FakeChild({ onRequest: (_request, child) => child.respond(envelope({ format: 'text', text: 'later' })) });
  });
  const first = helper.readClipboard({ deadline: defaultDeadline() });
  await new Promise(resolve => setTimeout(resolve, 10));
  const expired = helper.readClipboard({ deadline: Date.now() + 40 });
  const later = helper.readClipboard({ deadline: defaultDeadline() });
  await assert.rejects(expired, { code: 'TIMEOUT', dispatchState: 'notSent' });
  assert.equal(spawnCount, 1);
  firstChild.respond(envelope({ format: 'text', text: 'first' }));
  assert.equal((await first).text, 'first');
  assert.equal((await later).text, 'later');
  assert.equal(spawnCount, 2);
});

test('lost write acknowledgement is unknown and the operation is never retried', async () => {
  let spawnCount = 0;
  const { helper } = createHarness(() => {
    spawnCount++;
    return new FakeChild({ onRequest: (_request, child) => child.finish(0) });
  });
  await assert.rejects(helper.writeClipboard({ text: 'one shot', deadline: defaultDeadline() }),
    { code: 'OPERATION_FAILED', dispatchState: 'unknown' });
  assert.equal(spawnCount, 1);
});

test('clipboard inputs and results are byte-bounded without truncation', async () => {
  let spawnCount = 0;
  const oversized = 'é'.repeat(32769);
  const helper = createHarness(() => {
    spawnCount++;
    return new FakeChild({ onRequest: (_request, child) => child.respond(envelope({ format: 'text', text: oversized })) });
  }).helper;
  await assert.rejects(helper.writeClipboard({ text: oversized, deadline: defaultDeadline() }), { code: 'RESULT_TOO_LARGE' });
  assert.equal(spawnCount, 0);
  await assert.rejects(helper.readClipboard({ deadline: defaultDeadline() }), { code: 'RESULT_TOO_LARGE' });
  assert.equal(spawnCount, 1);
});

test('a child error after request dispatch is bounded and does not trigger a retry', async () => {
  let spawnCount = 0;
  const { helper } = createHarness(() => {
    spawnCount++;
    return new FakeChild({ onRequest: (_request, child) => process.nextTick(() => child.emit('error', new Error('private child error'))) });
  });
  await assert.rejects(helper.writeClipboard({ text: 'one attempt', deadline: defaultDeadline() }),
    { code: 'BACKEND_UNAVAILABLE', dispatchState: 'unknown' });
  assert.equal(spawnCount, 1);
});

test('pre-dispatch spawn failure is notSent', async () => {
  const helper = createWindowsBrowserHelper({ spawn: () => { throw new Error('private path must not escape'); } });
  await assert.rejects(helper.writeClipboard({ text: 'never dispatched', deadline: defaultDeadline() }),
    { code: 'BACKEND_UNAVAILABLE', dispatchState: 'notSent' });
});

test('stdout overflow kills the owned helper and fails with a bounded result error', async () => {
  let child;
  const { helper } = createHarness(() => {
    child = new FakeChild({ onRequest: (_request, current) => {
      current.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 0x20));
    } });
    return child;
  });
  await assert.rejects(helper.capabilities({ deadline: defaultDeadline() }), { code: 'RESULT_TOO_LARGE' });
  assert.equal(child.killed, true);
});

test('deadline cancellation kills only the owned process and reports after confirmed close', async () => {
  let child;
  const { helper } = createHarness(() => {
    child = new FakeChild({ onRequest: () => {} });
    return child;
  });
  await assert.rejects(helper.capabilities({ deadline: Date.now() + 30 }), { code: 'TIMEOUT' });
  assert.equal(child.killed, true);
});

test('abort before the child spawn event kills the late-spawned helper without sending input', async () => {
  let child;
  const { helper } = createHarness(() => {
    child = new FakeChild({ onRequest: (_request, current) => current.respond(envelope(capabilityData())) });
    return child;
  });
  const controller = new AbortController();
  const pending = helper.capabilities({ deadline: defaultDeadline(), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(child.killed, true);
  assert.equal(child.input, null);
});

test('unconfirmed cleanup quarantines the FIFO until the original child exits', { timeout: 6000 }, async () => {
  let firstChild;
  let spawnCount = 0;
  const { helper } = createHarness(() => {
    spawnCount++;
    if (spawnCount === 1) {
      firstChild = new FakeChild({ onRequest: () => {}, killConfirms: false });
      return firstChild;
    }
    return new FakeChild({ onRequest: (_request, child) => child.respond(envelope({ format: 'text', text: 'after exit' })) });
  });
  const controller = new AbortController();
  const pending = helper.readClipboard({ deadline: defaultDeadline(), signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(pending, { code: 'HELPER_CLEANUP_UNCONFIRMED' });
  await assert.rejects(helper.readClipboard({ deadline: defaultDeadline() }),
    { code: 'CLIPBOARD_UNAVAILABLE', dispatchState: 'notSent' });
  assert.equal(spawnCount, 1);

  firstChild.emit('exit', 1, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await helper.readClipboard({ deadline: defaultDeadline() })).text, 'after exit');
  assert.equal(spawnCount, 2);
});

test('OCR validates PNG bounds and translates no caller path through the protocol', async () => {
  let received;
  const png = validPngHeader();
  const { helper, spawns } = createHarness(() => new FakeChild({ onRequest(request, child) {
    received = request;
    child.respond(envelope({
      engine: 'Windows.Media.Ocr', language: 'en-US', width: 20, height: 10,
      coordinateSpace: 'screenshot-px',
      lines: [{ text: 'OK', rect: { x: 4, y: 3, width: 8, height: 3 },
        words: [{ text: 'OK', rect: { x: 4, y: 3, width: 8, height: 3 } }] }],
      truncated: false,
    }));
  } }));

  await assert.rejects(helper.ocr({ png, region: { x: 19, y: 0, width: 2, height: 1 }, deadline: defaultDeadline() }),
    { code: 'INVALID_ARGUMENT' });
  assert.equal(spawns.length, 0);
  const result = await helper.ocr({ png, language: 'en-US', region: { x: 2, y: 2, width: 10, height: 5 }, deadline: defaultDeadline() });
  assert.equal(result.lines[0].text, 'OK');
  assert.deepEqual(received, { protocol: 1, operation: 'ocr', payload: {
    pngBase64: png.toString('base64'), language: 'en-US', maxLines: 500,
    region: { x: 2, y: 2, width: 10, height: 5 },
  } });
  assert.equal(JSON.stringify(received).includes('filePath'), false);
});

test('OCR rejects invalid dimensions and malformed helper boxes', async () => {
  let spawnCount = 0;
  const oversized = validPngHeader(5000, 5000);
  const invalid = createHarness(() => { spawnCount++; return new FakeChild(); }).helper;
  await assert.rejects(invalid.ocr({ png: oversized, deadline: defaultDeadline() }), { code: 'INVALID_IMAGE' });
  assert.equal(spawnCount, 0);

  const malformed = createHarness(() => new FakeChild({ onRequest: (_request, child) => child.respond(envelope({
    engine: 'Windows.Media.Ocr', language: 'en-US', width: 20, height: 10,
    coordinateSpace: 'screenshot-px', lines: [{ text: 'x', rect: { x: Number.NaN, y: 0, width: 1, height: 1 }, words: [] }], truncated: false,
  })) })).helper;
  await assert.rejects(malformed.ocr({ png: validPngHeader(), deadline: defaultDeadline() }), { code: 'OPERATION_FAILED' });
});

test('validated helper write failures preserve phase-specific dispatch state', async () => {
  const before = createHarness(() => new FakeChild({
    onRequest: (_request, child) => child.respond(errorEnvelope('CLIPBOARD_UNAVAILABLE', 'before')),
  })).helper;
  await assert.rejects(before.writeClipboard({ text: 'x', deadline: defaultDeadline() }),
    { code: 'CLIPBOARD_UNAVAILABLE', dispatchState: 'notSent' });

  const after = createHarness(() => new FakeChild({
    onRequest: (_request, child) => child.respond(errorEnvelope('CLIPBOARD_UNAVAILABLE', 'after-dispatch')),
  })).helper;
  await assert.rejects(after.writeClipboard({ text: 'x', deadline: defaultDeadline() }),
    { code: 'CLIPBOARD_UNAVAILABLE', dispatchState: 'unknown' });
});

test('malformed successful clipboard acknowledgements after dispatch are unknown and never retried', async () => {
  for (const data of [{}, { format: 'text', writtenChars: 1, unexpected: true }]) {
    let spawnCount = 0;
    const { helper } = createHarness(() => {
      spawnCount++;
      return new FakeChild({ onRequest: (_request, child) => child.respond(envelope(data)) });
    });
    await assert.rejects(helper.writeClipboard({ text: 'x', deadline: defaultDeadline() }),
      { code: 'OPERATION_FAILED', dispatchState: 'unknown' });
    assert.equal(spawnCount, 1);
  }
});

test('real Windows OCR recognizes only a generated temporary image when explicitly enabled', {
  skip: process.platform !== 'win32' || process.env.RUN_WINDOWS_OCR_TEST !== '1',
  timeout: 30000,
}, async (t) => {
  const powershell = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpa-browser-helper-ocr-'));
  const imagePath = path.join(directory, 'synthetic.png');
  try {
    const script = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.Drawing
      $bitmap = New-Object System.Drawing.Bitmap(720, 140)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $font = New-Object System.Drawing.Font('Arial', 40, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
      $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
      $graphics.DrawString('MCP TEST 123', $font, $brush, 16, 32)
      $bitmap.Save($env:RPA_HELPER_OCR_TEST_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
      $brush.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    `;
    const generated = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, RPA_HELPER_OCR_TEST_PATH: imagePath },
    });
    assert.equal(generated.error, undefined, generated.error?.message);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const helper = createWindowsBrowserHelper();
    const png = await readFile(imagePath);
    const result = await helper.ocr({ png, language: 'en-US', deadline: Date.now() + 20000 });
    const recognized = result.lines.map(line => line.text).join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
    t.diagnostic(`Windows.Media.Ocr recognized: ${recognized}`);
    assert.match(recognized, /MCP\s+TEST\s+123/);

    const region = { x: 8, y: 20, width: 700, height: 100 };
    const cropped = await helper.ocr({ png, language: 'en-US', region, deadline: Date.now() + 20000 });
    const croppedText = cropped.lines.map(line => line.text).join(' ').replace(/\s+/g, ' ').trim().toUpperCase();
    t.diagnostic(`Cropped Windows.Media.Ocr recognized: ${croppedText}`);
    assert.match(croppedText, /MCP\s+TEST\s+123/);
    assert.ok(cropped.lines.every(line => line.rect.x >= region.x && line.rect.y >= region.y));
  } finally {
    await rm(imagePath, { force: true });
    await rmdir(directory);
  }
});
