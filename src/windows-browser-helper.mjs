import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HELPER = path.join(ROOT, 'scripts', 'Windows-BrowserHelper.ps1');
const DEFAULT_POWERSHELL = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const MAX_STDIN = 6 * 1024 * 1024;
const MAX_STDOUT = 1024 * 1024;
const MAX_STDERR = 4 * 1024;
const MAX_CLIPBOARD_BYTES = 64 * 1024;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_RGBA_BYTES = 64 * 1024 * 1024;
const MAX_LINES = 500;
const MAX_WORDS = 5000;
const MAX_OCR_TEXT_BYTES = 64 * 1024;
const HELPER_CLEANUP_MS = 2000;

const ERROR_MESSAGES = Object.freeze({
  INVALID_ARGUMENT: 'The Windows helper request is invalid',
  BACKEND_UNAVAILABLE: 'The Windows helper is unavailable',
  CLIPBOARD_UNAVAILABLE: 'Windows text clipboard access is unavailable',
  OCR_LANGUAGE_UNAVAILABLE: 'The requested Windows OCR language is unavailable',
  INVALID_IMAGE: 'The PNG image is invalid',
  RESULT_TOO_LARGE: 'The Windows helper result exceeded its limit',
  OPERATION_FAILED: 'The Windows helper operation failed',
  TIMEOUT: 'The Windows helper deadline expired',
  CANCELLED: 'The Windows helper operation was cancelled',
  HELPER_CLEANUP_UNCONFIRMED: 'The Windows helper process did not confirm termination',
});

const clipboardState = {
  tail: Promise.resolve(),
  quarantined: null,
  queued: new Set(),
};

function makeError(code, dispatchState = 'notSent', message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.OPERATION_FAILED) {
  const error = new Error(message);
  error.name = 'WindowsBrowserHelperError';
  error.code = code;
  error.dispatchState = dispatchState;
  return error;
}

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function validateControl({ deadline, signal }, now) {
  if (!Number.isFinite(deadline)) throw makeError('INVALID_ARGUMENT');
  if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
    throw makeError('INVALID_ARGUMENT');
  }
  if (signal?.aborted) throw makeError('CANCELLED');
  if (deadline <= now()) throw makeError('TIMEOUT');
}

function validateObject(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw makeError('INVALID_ARGUMENT');
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw makeError('INVALID_ARGUMENT');
  }
}

function validateOutputObject(value, allowed, required = []) {
  try { validateObject(value, allowed, required); }
  catch { throw makeError('OPERATION_FAILED'); }
}

function validRegion(region, width, height) {
  if (region === undefined) return undefined;
  validateObject(region, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
  const { x, y, width: w, height: h } = region;
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 ||
      x + w > width || y + h > height) throw makeError('INVALID_ARGUMENT');
  return { x, y, width: w, height: h };
}

function inspectPng(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || png.length > MAX_PNG_BYTES ||
      png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.readUInt32BE(8) !== 13 || png.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw makeError(png?.length > MAX_PNG_BYTES ? 'RESULT_TOO_LARGE' : 'INVALID_IMAGE');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  if (!width || !height || width * height > MAX_PIXELS || width * height * 4 > MAX_RGBA_BYTES ||
      ![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType) ||
      png[26] !== 0 || png[27] !== 0 || ![0, 1].includes(png[28])) {
    throw makeError('INVALID_IMAGE');
  }
  return { width, height };
}

function utf8Text(value, { maxBytes = MAX_CLIPBOARD_BYTES, maxChars = MAX_CLIPBOARD_BYTES } = {}) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes || [...value].length > maxChars) {
    throw makeError(value && typeof value === 'string' && Buffer.byteLength(value, 'utf8') > maxBytes
      ? 'RESULT_TOO_LARGE' : 'INVALID_ARGUMENT');
  }
  return value;
}

function parseResponse(stdout, exitCode) {
  try {
    if (exitCode !== 0) throw makeError('OPERATION_FAILED');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
    const response = JSON.parse(text);
    validateObject(response, ['protocol', 'ok', 'data', 'error'], ['protocol', 'ok']);
    if (response.protocol !== 1 || typeof response.ok !== 'boolean') throw makeError('OPERATION_FAILED');
    if (response.ok) {
      validateObject(response, ['protocol', 'ok', 'data'], ['data']);
      return { data: response.data };
    }
    validateObject(response, ['protocol', 'ok', 'error'], ['error']);
    validateObject(response.error, ['code', 'phase'], ['code', 'phase']);
    if (!['before', 'after-dispatch'].includes(response.error.phase) ||
        !['INVALID_ARGUMENT', 'BACKEND_UNAVAILABLE', 'CLIPBOARD_UNAVAILABLE',
          'OCR_LANGUAGE_UNAVAILABLE', 'INVALID_IMAGE', 'RESULT_TOO_LARGE', 'OPERATION_FAILED']
          .includes(response.error.code)) throw makeError('OPERATION_FAILED');
    return { error: response.error };
  } catch {
    throw makeError('OPERATION_FAILED');
  }
}

function validateCapabilityResult(data) {
  validateOutputObject(data, ['platform', 'clipboardText', 'ocr'], ['platform', 'clipboardText', 'ocr']);
  validateOutputObject(data.ocr, ['available', 'languages', 'maxImageDimension'], ['available', 'languages', 'maxImageDimension']);
  if (data.platform !== 'windows' || typeof data.clipboardText !== 'boolean' ||
      typeof data.ocr.available !== 'boolean' || !Array.isArray(data.ocr.languages) ||
      data.ocr.languages.length > 100 || data.ocr.languages.some(v => typeof v !== 'string' || v.length > 32) ||
      !Number.isSafeInteger(data.ocr.maxImageDimension) || data.ocr.maxImageDimension < 0 || data.ocr.maxImageDimension > 32768) {
    throw makeError('OPERATION_FAILED');
  }
  return data;
}

function rect(value, width, height) {
  validateOutputObject(value, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
  const { x, y, width: w, height: h } = value;
  if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w < 0 || h < 0 ||
      x + w > width + 1 || y + h > height + 1) throw makeError('OPERATION_FAILED');
  return { x, y, width: w, height: h };
}

function validateOcrResult(data, { width, height, language, maxLines }) {
  validateOutputObject(data, ['engine', 'language', 'width', 'height', 'coordinateSpace', 'lines', 'truncated'],
    ['engine', 'language', 'width', 'height', 'coordinateSpace', 'lines', 'truncated']);
  if (data.engine !== 'Windows.Media.Ocr' || data.language !== language || data.width !== width ||
      data.height !== height || data.coordinateSpace !== 'screenshot-px' || !Array.isArray(data.lines) ||
      data.lines.length > maxLines || data.lines.length > MAX_LINES || typeof data.truncated !== 'boolean') {
    throw makeError('OPERATION_FAILED');
  }
  let wordCount = 0;
  let textBytes = 0;
  const lines = data.lines.map(line => {
    validateOutputObject(line, ['text', 'rect', 'words'], ['text', 'rect', 'words']);
    if (typeof line.text !== 'string' || !Array.isArray(line.words)) throw makeError('OPERATION_FAILED');
    textBytes += Buffer.byteLength(line.text, 'utf8');
    const lineRect = rect(line.rect, width, height);
    const words = line.words.map(word => {
      validateOutputObject(word, ['text', 'rect'], ['text', 'rect']);
      if (typeof word.text !== 'string') throw makeError('OPERATION_FAILED');
      textBytes += Buffer.byteLength(word.text, 'utf8');
      wordCount++;
      return { text: word.text, rect: rect(word.rect, width, height) };
    });
    return { text: line.text, rect: lineRect, words };
  });
  if (wordCount > MAX_WORDS || textBytes > MAX_OCR_TEXT_BYTES) throw makeError('RESULT_TOO_LARGE');
  return { ...data, lines };
}

function createProcessRunner({ spawn, now, powershellPath, helperPath }) {
  return function run(operation, payload, { deadline, signal, clipboardWrite = false, clipboardOperation = false } = {}) {
    validateControl({ deadline, signal }, now);
    const input = Buffer.from(`${JSON.stringify({ protocol: 1, operation, payload })}\n`, 'utf8');
    if (input.length > MAX_STDIN) throw makeError('RESULT_TOO_LARGE');

    let child;
    try {
      child = spawn(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', helperPath], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw makeError('BACKEND_UNAVAILABLE');
    }
    if (!child || typeof child.on !== 'function' || !child.stdin || !child.stdout || !child.stderr ||
        typeof child.kill !== 'function') throw makeError('BACKEND_UNAVAILABLE');

    const result = defer();
    const barrier = defer();
    const exitObserved = defer();
    let exited = false;
    let closed = false;
    let exitCode = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks = [];
    let sent = false;
    let requestSent = false;
    let settled = false;
    let cancelReason = null;
    let abortHandler;
    let lateSpawnHandler;
    let deadlineTimer;
    let cleanupTimer;

    const dispatchForFailure = () => clipboardWrite && sent ? 'unknown' : sent ? 'sent' : 'notSent';
    const cleanupListeners = () => {
      clearTimeout(deadlineTimer);
      clearTimeout(cleanupTimer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      if (lateSpawnHandler) child.removeListener('spawn', lateSpawnHandler);
      child.stdout.removeListener('data', onStdout);
      child.stderr.removeListener('data', onStderr);
      child.stdin.removeListener('error', onStdinError);
      child.removeListener('error', onChildError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
    };
    const settleSuccess = data => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      result.resolve(data);
      barrier.resolve();
    };
    const settleFailure = (error, { holdBarrier = false } = {}) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadlineTimer);
        clearTimeout(cleanupTimer);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        child.stdin.removeListener('error', onStdinError);
        result.reject(error);
      }
      if (!holdBarrier) {
        cleanupListeners();
        barrier.resolve();
      }
    };
    const observeExit = () => {
      if (!exited) {
        exited = true;
        exitObserved.resolve();
      }
    };
    const onStdout = chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > MAX_STDOUT) {
        requestCancel(makeError('RESULT_TOO_LARGE', dispatchForFailure()));
        return;
      }
      stdoutChunks.push(bytes);
    };
    const onStderr = chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes = Math.min(MAX_STDERR, stderrBytes + bytes.length);
    };
    const onStdinError = () => {
      requestCancel(makeError('BACKEND_UNAVAILABLE', dispatchForFailure()));
    };
    const onChildError = () => {
      if (!child.pid && !sent) {
        observeExit();
        settleFailure(makeError('BACKEND_UNAVAILABLE', 'notSent'));
      } else {
        requestCancel(makeError('BACKEND_UNAVAILABLE', dispatchForFailure()));
      }
    };
    const onExit = code => {
      exitCode = code;
      observeExit();
    };
    const onClose = code => {
      if (code !== null && code !== undefined) exitCode = code;
      closed = true;
      observeExit();
      if (settled) {
        cleanupListeners();
        barrier.resolve();
        if (clipboardOperation) clearClipboardQuarantine(child);
        return;
      }
      if (cancelReason) {
        settleFailure(cancelReason);
        if (clipboardOperation) clearClipboardQuarantine(child);
        return;
      }
      const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
      try {
        const parsed = parseResponse(stdout, exitCode ?? 0);
        if (parsed.error) {
          const dispatchState = parsed.error.phase === 'before' ? 'notSent'
            : clipboardWrite ? 'unknown' : 'sent';
          const code = parsed.error.code;
          settleFailure(makeError(code, dispatchState));
          return;
        }
        settleSuccess(parsed.data);
      } catch (error) {
        settleFailure(makeError(error.code ?? 'OPERATION_FAILED', dispatchForFailure()));
      }
      if (clipboardOperation) clearClipboardQuarantine(child);
    };

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.stdin.on('error', onStdinError);
    child.on('error', onChildError);
    child.on('exit', onExit);
    child.on('close', onClose);

    const waitForCleanup = async error => {
      if (settled && closed) return;
      if (!exited) {
        if (child.pid) {
          try { child.kill(); } catch { /* The exit event is the cleanup evidence. */ }
        } else {
          lateSpawnHandler = () => {
            if (exited) return;
            try { child.kill(); } catch { /* The exit event is the cleanup evidence. */ }
          };
          child.once('spawn', lateSpawnHandler);
        }
      }
      if (exited) {
        settleFailure(error);
        return;
      }
      let confirmationTimer;
      const confirmed = await Promise.race([
        exitObserved.promise.then(() => true),
        new Promise(resolve => { confirmationTimer = setTimeout(() => resolve(false), HELPER_CLEANUP_MS); }),
      ]);
      clearTimeout(confirmationTimer);
      if (confirmed || exited || closed) {
        settleFailure(error);
        if (clipboardOperation) clearClipboardQuarantine(child);
        return;
      }
      const cleanupError = makeError('HELPER_CLEANUP_UNCONFIRMED', dispatchForFailure());
      if (clipboardOperation) quarantineClipboard(child);
      settleFailure(cleanupError, { holdBarrier: true });
      exitObserved.promise.then(() => {
        if (clipboardOperation) clearClipboardQuarantine(child);
        cleanupListeners();
        barrier.resolve();
      });
    };
    const requestCancel = error => {
      if (cancelReason || settled) return;
      cancelReason = error;
      clearTimeout(deadlineTimer);
      waitForCleanup(error).catch(() => {
        settleFailure(makeError('HELPER_CLEANUP_UNCONFIRMED', dispatchForFailure()), { holdBarrier: true });
      });
    };

    deadlineTimer = setTimeout(() => requestCancel(makeError('TIMEOUT', dispatchForFailure())),
      Math.max(1, deadline - now()));
    if (signal) {
      abortHandler = () => requestCancel(makeError('CANCELLED', dispatchForFailure()));
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) abortHandler();
    }

    const onSpawn = () => {
      if (cancelReason || settled || requestSent) return;
      requestSent = true;
      sent = true;
      try {
        child.stdin.end(input, 'utf8', () => {});
      } catch {
        requestCancel(makeError('BACKEND_UNAVAILABLE', dispatchForFailure()));
      }
    };
    child.once('spawn', onSpawn);
    if (child.pid && !closed) queueMicrotask(onSpawn);

    return { result: result.promise, barrier: barrier.promise, cancel: requestCancel, child };
  };
}

function clearClipboardQuarantine(child) {
  if (clipboardState.quarantined !== child) return;
  clipboardState.quarantined = null;
}

function quarantineClipboard(child) {
  if (clipboardState.quarantined) return;
  clipboardState.quarantined = child;
  for (const waiting of clipboardState.queued) {
    waiting.cancelled = true;
    waiting.reject(makeError('CLIPBOARD_UNAVAILABLE', 'notSent'));
  }
  clipboardState.queued.clear();
}

export function createWindowsBrowserHelper({ spawn = nodeSpawn, now = Date.now, powershellPath = DEFAULT_POWERSHELL,
  helperPath = DEFAULT_HELPER } = {}) {
  if (typeof spawn !== 'function' || typeof now !== 'function' || typeof powershellPath !== 'string' ||
      typeof helperPath !== 'string') throw makeError('INVALID_ARGUMENT');
  const run = createProcessRunner({ spawn, now, powershellPath, helperPath });

  async function call(operation, payload, options = {}) {
    const { deadline, signal } = options;
    validateControl({ deadline, signal }, now);
    const processCall = run(operation, payload, options);
    return processCall.result;
  }

  function enqueueClipboard(operation, payload, options = {}) {
    const { deadline, signal } = options;
    validateControl({ deadline, signal }, now);
    if (clipboardState.quarantined) throw makeError('CLIPBOARD_UNAVAILABLE', 'notSent');
    const waiting = { cancelled: false, reject: null };
    const completion = defer();
    waiting.reject = error => completion.reject(error);
    clipboardState.queued.add(waiting);
    const predecessor = clipboardState.tail;
    const barrier = predecessor.then(async () => {
      clipboardState.queued.delete(waiting);
      if (waiting.cancelled) return;
      if (clipboardState.quarantined) {
        completion.reject(makeError('CLIPBOARD_UNAVAILABLE', 'notSent'));
        return;
      }
      let processCall;
      try { processCall = run(operation, payload, { ...options, clipboardOperation: true,
        clipboardWrite: operation === 'clipboard.write' }); }
      catch (error) { completion.reject(error); return; }
      processCall.result.then(completion.resolve, completion.reject);
      await processCall.barrier;
    });
    clipboardState.tail = barrier.catch(() => {});
    let abortListener;
    let timer;
    const cancelQueued = error => {
      if (waiting.cancelled || !clipboardState.queued.has(waiting)) return;
      waiting.cancelled = true;
      clipboardState.queued.delete(waiting);
      completion.reject(error);
    };
    timer = setTimeout(() => cancelQueued(makeError('TIMEOUT', 'notSent')),
      Math.max(1, deadline - now()));
    if (signal) {
      abortListener = () => cancelQueued(makeError('CANCELLED', 'notSent'));
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) abortListener();
    }
    return completion.promise.finally(() => {
      clearTimeout(timer);
      if (signal && abortListener) signal.removeEventListener('abort', abortListener);
    });
  }

  return Object.freeze({
    async capabilities(options = {}) {
      validateObject(options, ['deadline', 'signal'], ['deadline']);
      const { deadline, signal } = options;
      const data = await call('capabilities', {}, { deadline, signal });
      return validateCapabilityResult(data);
    },

    async readClipboard(options = {}) {
      validateObject(options, ['deadline', 'signal', 'maxChars'], ['deadline']);
      const { deadline, signal, maxChars = MAX_CLIPBOARD_BYTES } = options;
      if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > MAX_CLIPBOARD_BYTES) throw makeError('INVALID_ARGUMENT');
      const data = await enqueueClipboard('clipboard.read', { maxChars }, { deadline, signal });
      validateOutputObject(data, ['format', 'text'], ['format', 'text']);
      if (data.format !== 'text' || typeof data.text !== 'string') throw makeError('OPERATION_FAILED');
      utf8Text(data.text, { maxBytes: MAX_CLIPBOARD_BYTES, maxChars });
      return { format: 'text', text: data.text, dispatchState: 'notSent' };
    },

    async writeClipboard(options = {}) {
      validateObject(options, ['text', 'deadline', 'signal'], ['text', 'deadline']);
      const { text, deadline, signal } = options;
      utf8Text(text);
      const data = await enqueueClipboard('clipboard.write', { text }, { deadline, signal });
      try {
        validateOutputObject(data, ['format', 'writtenChars'], ['format', 'writtenChars']);
        if (data.format !== 'text' || data.writtenChars !== [...text].length) throw makeError('OPERATION_FAILED');
      } catch {
        // The helper may already have replaced the global clipboard. Any
        // malformed success acknowledgement after dispatch has an unknown
        // outcome and must never be retried automatically.
        throw makeError('OPERATION_FAILED', 'unknown');
      }
      return { format: 'text', writtenChars: data.writtenChars, dispatchState: 'acknowledged', verification: 'acknowledged' };
    },

    async ocr(options = {}) {
      validateObject(options, ['png', 'language', 'region', 'maxLines', 'deadline', 'signal'], ['png', 'deadline']);
      const { png, language = 'en-US', region, maxLines = MAX_LINES, deadline, signal } = options;
      validateControl({ deadline, signal }, now);
      const dimensions = inspectPng(png);
      const crop = validRegion(region, dimensions.width, dimensions.height);
      if (typeof language !== 'string' || language.length < 2 || language.length > 32 ||
          !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ||
          !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > MAX_LINES) throw makeError('INVALID_ARGUMENT');
      const payload = {
        pngBase64: png.toString('base64'),
        language,
        maxLines,
        ...(crop ? { region: crop } : {}),
      };
      const data = await call('ocr', payload, { deadline, signal });
      return validateOcrResult(data, { ...dimensions, language, maxLines });
    },
  });
}

