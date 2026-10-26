import { Worker as NodeWorker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WORKER = fileURLToPath(new URL('./browser-visual-worker.mjs', import.meta.url));
const MAX_ENCODED_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 2_200_000;
const MAX_COMBINED_IMAGE_PIXELS = 2_200_000;
const MAX_MATCH_CELLS = 2_200_000;
const MAX_TEMPLATE_DIMENSION = 512;
const MAX_MATCHES = 50;
const MAX_WORKER_TIME_MS = 5000;
const CLEANUP_TIME_MS = 2000;

const MESSAGES = Object.freeze({
  INVALID_ARGUMENT: 'The visual match request is invalid',
  INVALID_IMAGE: 'A visual match image is invalid',
  RESULT_TOO_LARGE: 'The visual match images exceed their pixel or size limit',
  WORKSPACE_LIMIT: 'The OpenCV worker exceeded its bounded workspace',
  BACKEND_UNAVAILABLE: 'The local OpenCV worker is unavailable',
  OPERATION_FAILED: 'The local visual matcher failed',
  TIMEOUT: 'The visual match deadline expired',
  CANCELLED: 'The visual match was cancelled',
  WORKER_CLEANUP_UNCONFIRMED: 'The OpenCV worker did not confirm termination',
});

function failure(code, dispatchState = 'notSent') {
  const error = new Error(MESSAGES[code] ?? MESSAGES.OPERATION_FAILED);
  error.name = 'BrowserVisualError';
  error.code = code;
  error.dispatchState = dispatchState;
  return error;
}

function validateObject(value, allowed, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw failure('INVALID_ARGUMENT');
  }
}

function validateSignal(signal) {
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw failure('INVALID_ARGUMENT');
  }
  if (signal?.aborted) throw failure('CANCELLED');
}

function inspectPng(value) {
  if (!Buffer.isBuffer(value) || value.length < 33 || value.length > MAX_ENCODED_BYTES ||
      value.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      value.readUInt32BE(8) !== 13 || value.toString('ascii', 12, 16) !== 'IHDR') {
    throw failure(value?.length > MAX_ENCODED_BYTES ? 'RESULT_TOO_LARGE' : 'INVALID_IMAGE');
  }
  const width = value.readUInt32BE(16);
  const height = value.readUInt32BE(20);
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw failure('RESULT_TOO_LARGE');
  if (![1, 2, 4, 8, 16].includes(value[24]) || ![0, 2, 3, 4, 6].includes(value[25]) ||
      value[26] !== 0 || value[27] !== 0 || ![0, 1].includes(value[28])) throw failure('INVALID_IMAGE');
  return { width, height };
}

function normalizeRegion(region, width, height, { template = false } = {}) {
  if (region === undefined) {
    if (template) throw failure('INVALID_ARGUMENT');
    return { x: 0, y: 0, width, height };
  }
  validateObject(region, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
  const { x, y, width: cropWidth, height: cropHeight } = region;
  if (![x, y, cropWidth, cropHeight].every(Number.isSafeInteger) || x < 0 || y < 0 ||
      cropWidth <= 0 || cropHeight <= 0 || x + cropWidth > width || y + cropHeight > height) {
    throw failure('INVALID_ARGUMENT');
  }
  if (template && (cropWidth < 8 || cropHeight < 8 || cropWidth > MAX_TEMPLATE_DIMENSION ||
      cropHeight > MAX_TEMPLATE_DIMENSION)) throw failure('INVALID_ARGUMENT');
  return { x, y, width: cropWidth, height: cropHeight };
}

function makeTransferBuffer(buffer) {
  const bytes = new Uint8Array(buffer.length);
  bytes.set(buffer);
  return bytes.buffer;
}

function normalizeWorkerResult(data, { target, template, searchRegion, threshold, maxMatches }) {
  validateObject(data, ['matches', 'truncated'], ['matches', 'truncated']);
  if (!Array.isArray(data.matches) || data.matches.length > maxMatches || typeof data.truncated !== 'boolean') {
    throw failure('OPERATION_FAILED', 'sent');
  }
  let previous = null;
  const matches = data.matches.map(match => {
    validateObject(match, ['rect', 'score'], ['rect', 'score']);
    validateObject(match.rect, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    const { x, y, width, height } = match.rect;
    if (![x, y, width, height].every(Number.isSafeInteger) || x < searchRegion.x || y < searchRegion.y ||
        width !== template.width || height !== template.height ||
        x + width > searchRegion.x + searchRegion.width || y + height > searchRegion.y + searchRegion.height ||
        x + width > target.width || y + height > target.height ||
        !Number.isFinite(match.score) || match.score < threshold || match.score > 1) {
      throw failure('OPERATION_FAILED', 'sent');
    }
    if (previous && (match.score > previous.score ||
        (match.score === previous.score && (y < previous.rect.y ||
          (y === previous.rect.y && x < previous.rect.x))))) {
      throw failure('OPERATION_FAILED', 'sent');
    }
    previous = match;
    return { rect: { x, y, width, height }, score: match.score };
  });
  return { matches, truncated: data.truncated };
}

function startWorker(WorkerCtor, workerPath, workerOptions, message, { deadline, signal, now }) {
  if (deadline <= now()) return Promise.reject(failure('TIMEOUT'));
  let worker;
  try { worker = new WorkerCtor(workerPath, workerOptions); }
  catch { return Promise.reject(failure('BACKEND_UNAVAILABLE')); }
  if (!worker || typeof worker.on !== 'function' || typeof worker.postMessage !== 'function' ||
      typeof worker.terminate !== 'function') return Promise.reject(failure('BACKEND_UNAVAILABLE'));

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let abortHandler;
    const cleanupListeners = () => {
      clearTimeout(timer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      worker.removeListener('message', onMessage);
      worker.removeListener('error', onError);
      worker.removeListener('exit', onExit);
    };
    const stopWorker = async () => {
      let cleanupTimer;
      let terminated = false;
      try {
        terminated = await Promise.race([
          Promise.resolve(worker.terminate()).then(() => true, () => false),
          new Promise(resolveCleanup => { cleanupTimer = setTimeout(() => resolveCleanup(false), CLEANUP_TIME_MS); }),
        ]);
      } catch { terminated = false; }
      clearTimeout(cleanupTimer);
      cleanupListeners();
      return terminated;
    };
    const terminate = async code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      const terminated = await stopWorker();
      reject(failure(terminated ? code : 'WORKER_CLEANUP_UNCONFIRMED', 'sent'));
    };
    const succeed = async data => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      if (await stopWorker()) resolve(data);
      else reject(failure('WORKER_CLEANUP_UNCONFIRMED', 'sent'));
    };
    const onMessage = message => {
      if (settled) return;
      if (!message || message.protocol !== 1 || typeof message.ok !== 'boolean') {
        void terminate('OPERATION_FAILED');
        return;
      }
      const allowedMessageKeys = message.ok ? ['protocol', 'ok', 'data'] : ['protocol', 'ok', 'error'];
      if (Object.keys(message).some(key => !allowedMessageKeys.includes(key)) ||
          (message.ok && !Object.hasOwn(message, 'data')) || (!message.ok && !Object.hasOwn(message, 'error'))) {
        void terminate('OPERATION_FAILED');
        return;
      }
      if (!message.ok) {
        const code = message.error && typeof message.error === 'object' && !Array.isArray(message.error) &&
          Object.keys(message.error).length === 1 && ['INVALID_ARGUMENT', 'INVALID_IMAGE', 'RESULT_TOO_LARGE',
          'WORKSPACE_LIMIT', 'BACKEND_UNAVAILABLE', 'OPERATION_FAILED'].includes(message.error.code)
          ? message.error.code : 'OPERATION_FAILED';
        void terminate(code);
        return;
      }
      void succeed(message.data);
    };
    const onError = () => { void terminate('BACKEND_UNAVAILABLE'); };
    const onExit = code => {
      if (!settled) void terminate(code === 0 ? 'OPERATION_FAILED' : 'BACKEND_UNAVAILABLE');
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    timer = setTimeout(() => { void terminate('TIMEOUT'); }, Math.max(1, Math.min(MAX_WORKER_TIME_MS, deadline - now())));
    if (signal) {
      abortHandler = () => { void terminate('CANCELLED'); };
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) { void terminate('CANCELLED'); return; }
    }
    const transferList = message.transferList ?? [];
    const workerMessage = { ...message };
    delete workerMessage.transferList;
    try { worker.postMessage(workerMessage, transferList); }
    catch { void terminate('BACKEND_UNAVAILABLE'); }
  });
}

export function createBrowserVisualMatcher({ Worker = NodeWorker, workerPath = DEFAULT_WORKER, now = Date.now } = {}) {
  if (typeof Worker !== 'function' || typeof workerPath !== 'string' || !workerPath || typeof now !== 'function') {
    throw failure('INVALID_ARGUMENT');
  }
  const workerOptions = Object.freeze({
    workerData: undefined,
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
  });

  const run = async ({ action, payload = {}, deadline, signal } = {}) => {
    validateSignal(signal);
    if (!Number.isFinite(deadline)) throw failure('INVALID_ARGUMENT');
    if (deadline <= now()) throw failure('TIMEOUT');
    const result = await startWorker(Worker, workerPath, workerOptions, { action, ...payload }, { deadline, signal, now });
    return result;
  };

  return Object.freeze({
    async readiness({ deadline = now() + MAX_WORKER_TIME_MS, signal } = {}) {
      try {
        const result = await run({ action: 'readiness', deadline, signal });
        if (!result || result.available !== true || result.engine !== 'opencv.js' ||
            result.cvHeapLimitBytes !== 64 * 1024 * 1024 || result.maxImagePixels !== MAX_IMAGE_PIXELS ||
            result.maxMatchCells !== MAX_MATCH_CELLS || typeof result.cvHeapInspectable !== 'boolean') {
          return { available: false, reason: 'OPENCV_WORKER_UNAVAILABLE' };
        }
        return { available: true, reason: null };
      } catch (error) {
        return { available: false, reason: error.code ?? 'OPENCV_WORKER_UNAVAILABLE' };
      }
    },

    async find(options = {}) {
      validateObject(options, ['targetPng', 'templatePng', 'templateRegion', 'searchRegion', 'threshold',
        'maxMatches', 'deadline', 'signal'], ['targetPng', 'templatePng', 'templateRegion', 'deadline']);
      validateSignal(options.signal);
      if (!Number.isFinite(options.deadline)) throw failure('INVALID_ARGUMENT');
      if (options.deadline <= now()) throw failure('TIMEOUT');
      const target = inspectPng(options.targetPng);
      const templateSource = inspectPng(options.templatePng);
      if (target.width * target.height + templateSource.width * templateSource.height > MAX_COMBINED_IMAGE_PIXELS) {
        throw failure('RESULT_TOO_LARGE');
      }
      const templateRegion = normalizeRegion(options.templateRegion, templateSource.width, templateSource.height, { template: true });
      const searchRegion = normalizeRegion(options.searchRegion, target.width, target.height);
      const threshold = options.threshold ?? 0.9;
      const maxMatches = options.maxMatches ?? MAX_MATCHES;
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
          !Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > MAX_MATCHES) throw failure('INVALID_ARGUMENT');
      if (templateRegion.width > searchRegion.width || templateRegion.height > searchRegion.height ||
          searchRegion.width * searchRegion.height > MAX_MATCH_CELLS) throw failure('RESULT_TOO_LARGE');
      const targetBuffer = makeTransferBuffer(options.targetPng);
      const templateBuffer = makeTransferBuffer(options.templatePng);
      const data = await run({
        action: 'find',
        payload: {
          targetPng: targetBuffer,
          templatePng: templateBuffer,
          templateRegion,
          searchRegion,
          searchOrigin: { x: searchRegion.x, y: searchRegion.y },
          threshold,
          maxMatches,
          transferList: [targetBuffer, templateBuffer],
        },
        deadline: options.deadline,
        signal: options.signal,
      });
      try { return normalizeWorkerResult(data, { target, template: templateRegion, searchRegion, threshold, maxMatches }); }
      catch (error) {
        if (error.code === 'INVALID_ARGUMENT') throw failure('OPERATION_FAILED', 'sent');
        throw error;
      }
    },
  });
}

export const browserVisualLimits = Object.freeze({
  maxEncodedPngBytes: MAX_ENCODED_BYTES,
  maxImagePixels: MAX_IMAGE_PIXELS,
  maxCombinedImagePixels: MAX_COMBINED_IMAGE_PIXELS,
  maxMatchCells: MAX_MATCH_CELLS,
  maxTemplateDimension: MAX_TEMPLATE_DIMENSION,
  maxMatches: MAX_MATCHES,
  maxWorkerTimeMs: MAX_WORKER_TIME_MS,
  cvHeapMonitoringLimitBytes: 64 * 1024 * 1024,
  workerV8OldGenerationLimitMb: 64,
  workerV8YoungGenerationLimitMb: 16,
});
