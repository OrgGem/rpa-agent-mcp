import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { deflateSync } from 'node:zlib';
import test from 'node:test';
import { createBrowserVisualMatcher, browserVisualLimits } from '../src/browser-visual.mjs';

const require = createRequire(import.meta.url);
let hasPinnedDependencies = true;
try {
  require.resolve('@techstark/opencv-js');
  require.resolve('pngjs');
} catch { hasPinnedDependencies = false; }

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngHeader(width, height) {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png[24] = 8;
  png[25] = 6;
  return png;
}

function syntheticMatchImages() {
  const width = 48;
  const height = 40;
  const data = new Uint8Array(width * height * 4);
  let state = 0x6d2b79f5;
  for (let index = 0; index < width * height; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index * 4] = state & 0xff;
    data[index * 4 + 1] = (state >>> 8) & 0xff;
    data[index * 4 + 2] = (state >>> 16) & 0xff;
    data[index * 4 + 3] = 255;
  }
  const patchWidth = 10;
  const patchHeight = 8;
  const patch = new Uint8Array(patchWidth * patchHeight * 4);
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
      const source = patch.subarray(y * patchWidth * 4, (y + 1) * patchWidth * 4);
      data.set(source, ((top + y) * width + left) * 4);
    }
  }
  return { png: encodePng(width, height, data), width, height };
}

function fakeWorkerClass(responseFor) {
  class FakeWorker extends EventEmitter {
    constructor(workerPath, options) {
      super();
      this.workerPath = workerPath;
      this.options = options;
      this.terminated = false;
      this.message = null;
      this.transferList = null;
      FakeWorker.instances.push(this);
    }

    postMessage(message, transferList) {
      this.message = message;
      this.transferList = transferList;
      const response = responseFor(message, this);
      if (response !== undefined) queueMicrotask(() => this.emit('message', response));
    }

    terminate() {
      this.terminated = true;
      return Promise.resolve(0);
    }
  }
  FakeWorker.instances = [];
  return FakeWorker;
}

test('visual matcher preflights artifact bytes and transfers only worker-owned copies', async () => {
  const image = pngHeader(40, 30);
  const Worker = fakeWorkerClass(message => ({ protocol: 1, ok: true, data: {
    matches: [{ rect: { x: 5, y: 6, width: 8, height: 9 }, score: 0.95 }], truncated: false,
  } }));
  const matcher = createBrowserVisualMatcher({ Worker, workerPath: 'test-worker.mjs' });
  const result = await matcher.find({ targetPng: image, templatePng: image,
    templateRegion: { x: 0, y: 0, width: 8, height: 9 }, threshold: 0.9, maxMatches: 5,
    deadline: Date.now() + 2000 });
  assert.deepEqual(result, { matches: [{ rect: { x: 5, y: 6, width: 8, height: 9 }, score: 0.95 }], truncated: false });
  const worker = Worker.instances[0];
  assert.equal(worker.workerPath, 'test-worker.mjs');
  assert.deepEqual(worker.options.resourceLimits, { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 });
  assert.equal(worker.transferList.length, 2);
  assert.equal(worker.message.transferList, undefined);
  assert.equal(worker.message.targetPng.byteLength, image.length);
  assert.equal(worker.terminated, true);

  await assert.rejects(matcher.find({ targetPng: pngHeader(2000, 2000), templatePng: image,
    templateRegion: { x: 0, y: 0, width: 8, height: 9 }, deadline: Date.now() + 2000 }),
  { code: 'RESULT_TOO_LARGE' });
  assert.equal(Worker.instances.length, 1);
});

test('worker cancellation is bounded and terminates only the owned worker', async () => {
  const image = pngHeader(40, 30);
  const Worker = fakeWorkerClass(() => undefined);
  const matcher = createBrowserVisualMatcher({ Worker });
  await assert.rejects(matcher.find({ targetPng: image, templatePng: image,
    templateRegion: { x: 0, y: 0, width: 8, height: 8 }, deadline: Date.now() + 35 }), { code: 'TIMEOUT' });
  assert.equal(Worker.instances[0].terminated, true);
});

test('readiness runs an image-free worker probe and returns a bounded reason', async () => {
  const Worker = fakeWorkerClass(message => message.action === 'readiness'
    ? { protocol: 1, ok: true, data: { available: true, reason: null, engine: 'opencv.js',
      maxImagePixels: browserVisualLimits.maxImagePixels, cvHeapInspectable: false,
      cvHeapLimitBytes: browserVisualLimits.cvHeapMonitoringLimitBytes,
      maxMatchCells: browserVisualLimits.maxMatchCells } }
    : undefined);
  const matcher = createBrowserVisualMatcher({ Worker });
  assert.deepEqual(await matcher.readiness({ deadline: Date.now() + 1000 }), { available: true, reason: null });
  assert.equal(Worker.instances[0].message.targetPng, undefined);
});

test('non-finite worker scores are rejected before they can become match results', async () => {
  const image = pngHeader(40, 30);
  const Worker = fakeWorkerClass(() => ({ protocol: 1, ok: true, data: {
    matches: [{ rect: { x: 2, y: 3, width: 8, height: 8 }, score: Number.NaN }], truncated: false,
  } }));
  const matcher = createBrowserVisualMatcher({ Worker });
  await assert.rejects(matcher.find({ targetPng: image, templatePng: image,
    templateRegion: { x: 0, y: 0, width: 8, height: 8 }, deadline: Date.now() + 2000 }),
  { code: 'OPERATION_FAILED', dispatchState: 'sent' });
});

test('real pinned OpenCV finds same-scale templates in deterministic score/y/x order', {
  skip: !hasPinnedDependencies,
  timeout: 15000,
}, async () => {
  const { png } = syntheticMatchImages();
  const matcher = createBrowserVisualMatcher();
  const result = await matcher.find({ targetPng: png, templatePng: png,
    templateRegion: { x: 5, y: 4, width: 10, height: 8 }, threshold: 0.99999,
    maxMatches: 10, deadline: Date.now() + 5000 });
  assert.deepEqual(result.matches.map(match => match.rect), [
    { x: 5, y: 4, width: 10, height: 8 },
    { x: 30, y: 20, width: 10, height: 8 },
  ]);
  assert.equal(result.matches.every(match => match.score === 1), true);
  assert.equal(result.truncated, false);

  const cropped = await matcher.find({ targetPng: png, templatePng: png,
    templateRegion: { x: 5, y: 4, width: 10, height: 8 },
    searchRegion: { x: 20, y: 15, width: 28, height: 25 }, threshold: 0.99999,
    maxMatches: 1, deadline: Date.now() + 5000 });
  assert.deepEqual(cropped.matches.map(match => match.rect), [{ x: 30, y: 20, width: 10, height: 8 }]);
  assert.equal(cropped.truncated, false);
});

test('real OpenCV rejects a zero-variance template before publishing matches', {
  skip: !hasPinnedDependencies,
  timeout: 15000,
}, async () => {
  const target = syntheticMatchImages().png;
  const width = 20;
  const height = 20;
  const solid = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    solid[index * 4] = 120;
    solid[index * 4 + 1] = 120;
    solid[index * 4 + 2] = 120;
    solid[index * 4 + 3] = 255;
  }
  const solidPng = encodePng(width, height, solid);
  const matcher = createBrowserVisualMatcher();
  await assert.rejects(matcher.find({ targetPng: target, templatePng: solidPng,
    templateRegion: { x: 2, y: 2, width: 8, height: 8 }, deadline: Date.now() + 5000 }),
  { code: 'INVALID_ARGUMENT' });
});
