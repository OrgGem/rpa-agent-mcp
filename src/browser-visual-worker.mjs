import { parentPort } from 'node:worker_threads';
import cvModule from '@techstark/opencv-js';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const MAX_CV_HEAP_BYTES = 64 * 1024 * 1024;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

async function loadCv() {
  let cv = cvModule;
  if (cv && typeof cv.then === 'function') cv = await cv;
  if (cv?.Mat && cv?.matchTemplate) return cv;
  if (!cv || typeof cv !== 'object') fail('BACKEND_UNAVAILABLE');
  if (cv.ready && typeof cv.ready.then === 'function') {
    await cv.ready;
    if (cv.Mat && cv.matchTemplate) return cv;
  }
  await new Promise((resolve, reject) => {
    const previous = cv.onRuntimeInitialized;
    const previousAbort = cv.onAbort;
    const timer = setTimeout(() => reject(new Error('OPEN_CV_INIT_TIMEOUT')), 5000);
    cv.onRuntimeInitialized = () => {
      clearTimeout(timer);
      try { previous?.(); } catch { /* Ignore package callback failures. */ }
      resolve();
    };
    cv.onAbort = () => {
      clearTimeout(timer);
      try { previousAbort?.(); } catch { /* Ignore package callback failures. */ }
      reject(new Error('OPEN_CV_ABORT'));
    };
  });
  if (!cv.Mat || !cv.matchTemplate) fail('BACKEND_UNAVAILABLE');
  return cv;
}

function cvHeapBytes(cv) {
  const heap = cv.HEAPU8 ?? cv.HEAP8;
  const bytes = heap?.buffer?.byteLength;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

function checkCvHeap(cv) {
  const bytes = cvHeapBytes(cv);
  // Some OpenCV.js distributions intentionally hide their Emscripten heap.
  // Enforce the configured ceiling when the pinned build exposes it, while
  // relying on pre-decode input/output estimates for builds that do not.
  if (bytes !== null && bytes > MAX_CV_HEAP_BYTES) fail('WORKSPACE_LIMIT');
}

function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > 4 * 1024 * 1024 ||
      buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') fail('INVALID_IMAGE');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) fail('INVALID_IMAGE');
  if (width * height > 2_200_000 || width * height * 4 > 64 * 1024 * 1024) fail('RESULT_TOO_LARGE');
  if (![1, 2, 4, 8, 16].includes(buffer[24]) || ![0, 2, 3, 4, 6].includes(buffer[25]) ||
      buffer[26] !== 0 || buffer[27] !== 0 || ![0, 1].includes(buffer[28])) fail('INVALID_IMAGE');
  return { width, height };
}

function createGrayMat(cv, rgba, dimensions, crop) {
  const mat = new cv.Mat(crop.height, crop.width, cv.CV_8UC1);
  try {
    const source = rgba.data;
    const destination = mat.data;
    for (let y = 0; y < crop.height; y++) {
      let src = ((crop.y + y) * dimensions.width + crop.x) * 4;
      let dst = y * crop.width;
      for (let x = 0; x < crop.width; x++, src += 4, dst++) {
        const alpha = source[src + 3] / 255;
        const red = source[src] * alpha + 255 * (1 - alpha);
        const green = source[src + 1] * alpha + 255 * (1 - alpha);
        const blue = source[src + 2] * alpha + 255 * (1 - alpha);
        destination[dst] = (77 * red + 150 * green + 29 * blue + 128) >>> 8;
      }
    }
    return mat;
  } catch (error) {
    mat.delete();
    throw error;
  }
}

function decodeGray(cv, buffer, crop) {
  const header = inspectPng(buffer);
  if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
      crop.x + crop.width > header.width || crop.y + crop.height > header.height) fail('INVALID_ARGUMENT');
  let decoded;
  try { decoded = PNG.sync.read(buffer); }
  catch { fail('INVALID_IMAGE'); }
  if (decoded.width !== header.width || decoded.height !== header.height ||
      !Buffer.isBuffer(decoded.data) || decoded.data.length !== header.width * header.height * 4) fail('INVALID_IMAGE');
  let mat;
  try {
    mat = createGrayMat(cv, decoded, header, crop);
    checkCvHeap(cv);
    return { mat, dimensions: header };
  } catch (error) {
    mat?.delete();
    throw error;
  } finally {
    decoded.data = null;
    decoded = null;
    if (globalThis.gc) globalThis.gc();
  }
}

function rejectConstantTemplate(mat) {
  const pixels = mat.data;
  let sum = 0;
  let squareSum = 0;
  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index];
    sum += value;
    squareSum += value * value;
  }
  const variance = squareSum / pixels.length - (sum / pixels.length) ** 2;
  if (!Number.isFinite(variance) || variance <= 0) fail('INVALID_ARGUMENT');
}

function suppressNearDuplicates(scores, rows, columns, x, y, width, height) {
  const area = width * height;
  const maxDx = Math.min(width - 1, Math.ceil(width / 3));
  const maxDy = Math.min(height - 1, Math.ceil(height / 3));
  for (let dy = -maxDy; dy <= maxDy; dy++) {
    const otherY = y + dy;
    if (otherY < 0 || otherY >= rows) continue;
    const overlapHeight = height - Math.abs(dy);
    for (let dx = -maxDx; dx <= maxDx; dx++) {
      const otherX = x + dx;
      if (otherX < 0 || otherX >= columns) continue;
      const overlapWidth = width - Math.abs(dx);
      if (overlapWidth > 0 && overlapHeight > 0 && 3 * overlapWidth * overlapHeight > 2 * area) {
        scores[otherY * columns + otherX] = Number.NEGATIVE_INFINITY;
      }
    }
  }
}

function findMatches(cv, source, template, searchOrigin, templateSize, threshold, maxMatches) {
  const result = new cv.Mat();
  try {
    cv.matchTemplate(source, template, result, cv.TM_CCOEFF_NORMED);
    checkCvHeap(cv);
    const rows = result.rows;
    const columns = result.cols;
    if (!rows || !columns || rows * columns > 2_200_000) fail('WORKSPACE_LIMIT');
    const scores = result.data32F;
    if (!scores || scores.length !== rows * columns) fail('OPERATION_FAILED');
    const matches = [];
    let truncated = false;
    while (true) {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestIndex = -1;
      for (let index = 0; index < scores.length; index++) {
        const score = scores[index];
        if (!Number.isFinite(score)) {
          scores[index] = Number.NEGATIVE_INFINITY;
          continue;
        }
        if (score < -1.00001 || score > 1.00001) fail('OPERATION_FAILED');
        const normalized = Math.max(-1, Math.min(1, score));
        if (normalized > bestScore) {
          bestScore = normalized;
          bestIndex = index;
        }
      }
      if (bestIndex < 0 || bestScore < threshold) break;
      const y = Math.floor(bestIndex / columns);
      const x = bestIndex - y * columns;
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      matches.push({
        rect: { x: searchOrigin.x + x, y: searchOrigin.y + y, width: templateSize.width, height: templateSize.height },
        score: bestScore,
      });
      suppressNearDuplicates(scores, rows, columns, x, y, templateSize.width, templateSize.height);
    }
    return { matches, truncated };
  } finally {
    result.delete();
  }
}

async function executeCv(message) {
  let cv;
  try { cv = await loadCv(); }
  catch { fail('BACKEND_UNAVAILABLE'); }
  try { checkCvHeap(cv); } catch { fail('WORKSPACE_LIMIT'); }
  if (message.action === 'readiness') {
    return { available: true, reason: null, engine: 'opencv.js', maxImagePixels: 2_200_000,
      cvHeapInspectable: cvHeapBytes(cv) !== null, cvHeapLimitBytes: MAX_CV_HEAP_BYTES,
      maxMatchCells: 2_200_000 };
  }

  let template;
  let source;
  let targetPng = Buffer.from(message.targetPng);
  let templatePng = Buffer.from(message.templatePng);
  try {
    const templateDecoded = decodeGray(cv, templatePng, message.templateRegion);
    template = templateDecoded.mat;
    const templateSize = { width: template.cols, height: template.rows };
    rejectConstantTemplate(template);
    templatePng = null;
    message.templatePng = null;
    if (globalThis.gc) globalThis.gc();

    const targetDecoded = decodeGray(cv, targetPng, message.searchRegion);
    source = targetDecoded.mat;
    targetPng = null;
    message.targetPng = null;
    if (globalThis.gc) globalThis.gc();
    if (templateSize.width > source.cols || templateSize.height > source.rows) fail('INVALID_ARGUMENT');
    const result = findMatches(cv, source, template, message.searchOrigin, templateSize,
      message.threshold, message.maxMatches);
    return result;
  } finally {
    source?.delete();
    template?.delete();
  }
}

parentPort.once('message', async message => {
  try {
    const data = await executeCv(message);
    parentPort.postMessage({ protocol: 1, ok: true, data });
  } catch (error) {
    const code = ['INVALID_ARGUMENT', 'INVALID_IMAGE', 'RESULT_TOO_LARGE', 'WORKSPACE_LIMIT', 'BACKEND_UNAVAILABLE', 'OPERATION_FAILED']
      .includes(error?.code) ? error.code : 'OPERATION_FAILED';
    parentPort.postMessage({ protocol: 1, ok: false, error: { code } });
  } finally {
    parentPort.close();
  }
});
