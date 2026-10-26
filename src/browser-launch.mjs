import { spawn as nodeSpawn } from 'node:child_process';
import { randomBytes as secureRandomBytes } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HELPER = path.join(ROOT, 'scripts', 'Windows-BrowserLaunch.ps1');
const DEFAULT_POWERSHELL = path.join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const MAX_LAUNCHES = 64;
const MAX_HELPER_BYTES = 64 * 1024;
const HELPER_CLEANUP_MS = 2000;
const CHILD_ENV_KEYS = Object.freeze(['PATH', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE', 'OS']);

const ERROR_MESSAGES = Object.freeze({
  INVALID_ARGUMENT: 'The owned browser launch request is invalid',
  BACKEND_UNAVAILABLE: 'The owned browser launch backend is unavailable',
  PROFILE_NOT_CONFIGURED: 'No configured isolated browser profile is available',
  PROFILE_BUSY: 'The configured browser profile is already in use',
  REQUEST_KEY_CONFLICT: 'The launch request key was used with different arguments',
  LAUNCH_LIMIT: 'The owned browser launch limit was reached',
  TIMEOUT: 'The owned browser launch deadline expired',
  CANCELLED: 'The owned browser launch request was cancelled',
  OWNERSHIP_UNPROVEN: 'The browser process or profile ownership could not be confirmed',
  OPERATION_FAILED: 'The owned browser launch operation failed',
});

function failure(code, dispatchState = 'notSent') {
  const error = new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.OPERATION_FAILED);
  error.name = 'BrowserLaunchError';
  error.code = code;
  error.dispatchState = dispatchState;
  return error;
}

function plainObject(value, allowed, required) {
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

function validateDeadline(deadline, now) {
  if (!Number.isFinite(deadline)) throw failure('INVALID_ARGUMENT');
  if (deadline <= now()) throw failure('TIMEOUT');
}

function validRef(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value); }
function validRequestKey(value) { return typeof value === 'string' && value.length >= 1 && value.length <= 128; }
function validAlias(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value); }

function parseUrl(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > 2048) throw failure('INVALID_ARGUMENT');
  let url;
  try { url = new URL(value); } catch { throw failure('INVALID_ARGUMENT'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('INVALID_ARGUMENT');
  return url.href;
}

function parseProfiles(value) {
  if (value === undefined) {
    const raw = process.env.UIPATH_BROWSER_PROFILES;
    if (!raw) return {};
    try { value = JSON.parse(raw); } catch { return {}; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const profiles = {};
  for (const [alias, config] of Object.entries(value).slice(0, MAX_LAUNCHES)) {
    if (!validAlias(alias) || !config || typeof config !== 'object' || Array.isArray(config) ||
        Object.keys(config).some(key => !['executablePath', 'userDataDir'].includes(key)) ||
        typeof config.executablePath !== 'string' || typeof config.userDataDir !== 'string' ||
        !path.isAbsolute(config.executablePath) || !path.isAbsolute(config.userDataDir)) continue;
    profiles[alias] = Object.freeze({ executablePath: config.executablePath, userDataDir: config.userDataDir });
  }
  return profiles;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveConfiguredProfile(config) {
  if (process.platform !== 'win32') throw failure('BACKEND_UNAVAILABLE');
  let executablePath;
  let userDataDir;
  try {
    executablePath = realpathSync.native(config.executablePath);
    userDataDir = realpathSync.native(config.userDataDir);
    if (!statSync(executablePath).isFile() || !statSync(userDataDir).isDirectory()) throw new Error('wrong file type');
  } catch { throw failure('PROFILE_NOT_CONFIGURED'); }
  if (!/(?:chrome|msedge)\.exe$/i.test(path.basename(executablePath)) ||
      /(?:^|[\\/])Default$/i.test(userDataDir)) throw failure('PROFILE_NOT_CONFIGURED');
  const localAppData = process.env.LOCALAPPDATA ?? (process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : null);
  if (localAppData) {
    for (const sharedRoot of [
      path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    ]) {
      let canonicalRoot;
      try { canonicalRoot = realpathSync.native(sharedRoot); } catch { continue; }
      if (isWithin(canonicalRoot, userDataDir)) throw failure('PROFILE_NOT_CONFIGURED');
    }
  }
  return Object.freeze({ executablePath, userDataDir });
}

function parseSpawnedChild(child) {
  if (!child || typeof child.once !== 'function' || typeof child.on !== 'function' ||
      (child.pid !== undefined && (!Number.isSafeInteger(child.pid) || child.pid < 1))) {
    throw failure('BACKEND_UNAVAILABLE');
  }
  return child;
}

function decodeHelperResponse(chunks, exitCode) {
  if (exitCode !== 0) throw failure('OPERATION_FAILED', 'unknown');
  let response;
  try { response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw failure('OPERATION_FAILED', 'unknown'); }
  plainObject(response, ['protocol', 'ok', 'data', 'error'], ['protocol', 'ok']);
  if (response.protocol !== 1 || typeof response.ok !== 'boolean') throw failure('OPERATION_FAILED', 'unknown');
  if (!response.ok) throw failure('OPERATION_FAILED', 'unknown');
  plainObject(response, ['protocol', 'ok', 'data'], ['data']);
  return response.data;
}

function runHelperFactory({ spawn, powershellPath, helperPath, now }) {
  return (operation, payload, { deadline, signal } = {}) => new Promise((resolve, reject) => {
    try { validateSignal(signal); validateDeadline(deadline, now); } catch (error) { reject(error); return; }
    let child;
    try {
      child = spawn(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', helperPath], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      parseSpawnedChild(child);
    } catch { reject(failure('BACKEND_UNAVAILABLE')); return; }
    let settled = false;
    let sent = false;
    let stdoutBytes = 0;
    const stdout = [];
    let stderrBytes = 0;
    let timer;
    let abortHandler;
    let exitPromiseResolve;
    const exited = new Promise(resolveExit => { exitPromiseResolve = resolveExit; });
    const clean = () => {
      clearTimeout(timer);
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clean();
      error ? reject(error) : resolve(value);
    };
    const killOwned = async code => {
      if (settled) return;
      const state = operation === 'process.close' && sent ? 'unknown' : (sent ? 'sent' : 'notSent');
      settled = true;
      try { child.kill(); } catch { }
      const exitedWithinBound = await Promise.race([
        exited.then(() => true),
        new Promise(resolveExit => setTimeout(() => resolveExit(false), HELPER_CLEANUP_MS)),
      ]);
      clean();
      reject(failure(exitedWithinBound ? code : 'OWNERSHIP_UNPROVEN', exitedWithinBound ? state : 'unknown'));
    };
    const onStdout = chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_HELPER_BYTES) { void killOwned('OPERATION_FAILED'); return; }
      stdout.push(Buffer.from(chunk));
    };
    const onStderr = chunk => { stderrBytes = Math.min(MAX_HELPER_BYTES, stderrBytes + chunk.length); };
    const onError = () => finish(failure('BACKEND_UNAVAILABLE', sent ? 'unknown' : 'notSent'));
    const onClose = code => {
      exitPromiseResolve(true);
      if (settled) return;
      try { finish(null, decodeHelperResponse(stdout, code)); }
      catch (error) { finish(error); }
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('error', onError);
    child.on('close', onClose);
    const remaining = Math.max(1, Math.min(15_000, deadline - now()));
    timer = setTimeout(() => { void killOwned('TIMEOUT'); }, remaining);
    if (signal) {
      abortHandler = () => { void killOwned('CANCELLED'); };
      signal.addEventListener('abort', abortHandler, { once: true });
      if (signal.aborted) { abortHandler(); return; }
    }
    const document = Buffer.from(`${JSON.stringify({ protocol: 1, operation, payload })}\n`, 'utf8');
    if (document.length > MAX_HELPER_BYTES) { void killOwned('INVALID_ARGUMENT'); return; }
    try { sent = true; child.stdin.end(document); }
    catch { void killOwned('OPERATION_FAILED'); }
  });
}

function checkProfileResult(result) {
  plainObject(result, ['locked', 'processId'], ['locked', 'processId']);
  if (typeof result.locked !== 'boolean' ||
      !(result.processId === null || (Number.isSafeInteger(result.processId) && result.processId > 0))) {
    throw failure('OPERATION_FAILED');
  }
  return result;
}

function checkProcessResult(result) {
  plainObject(result, ['exists', 'identityMatches', 'creationTimeUtcTicks', 'executablePath',
    'commandLineMatches', 'profileLockProcessId', 'profileLockMatches'],
  ['exists', 'identityMatches', 'creationTimeUtcTicks', 'executablePath', 'commandLineMatches',
    'profileLockProcessId', 'profileLockMatches']);
  if (typeof result.exists !== 'boolean' || typeof result.identityMatches !== 'boolean' ||
      typeof result.commandLineMatches !== 'boolean' || typeof result.profileLockMatches !== 'boolean' ||
      !(result.creationTimeUtcTicks === null || (typeof result.creationTimeUtcTicks === 'string' && /^\d{1,19}$/.test(result.creationTimeUtcTicks))) ||
      !(result.executablePath === null || typeof result.executablePath === 'string') ||
      !(result.profileLockProcessId === null || (Number.isSafeInteger(result.profileLockProcessId) && result.profileLockProcessId > 0))) {
    throw failure('OPERATION_FAILED');
  }
  return result;
}

function checkCloseResult(result) {
  plainObject(result, ['closeRequested', 'exited', 'profileUnlocked', 'ownershipConfirmed'],
    ['closeRequested', 'exited', 'profileUnlocked', 'ownershipConfirmed']);
  if (['closeRequested', 'exited', 'profileUnlocked', 'ownershipConfirmed'].some(key => typeof result[key] !== 'boolean')) {
    throw failure('OPERATION_FAILED', 'unknown');
  }
  return result;
}

function makeOpaque(randomBytes, bytes) {
  const value = randomBytes(bytes);
  if (!Buffer.isBuffer(value) || value.length !== bytes) throw failure('BACKEND_UNAVAILABLE');
  return value;
}

function childEnvironment(launchNonce) {
  const environment = {};
  for (const key of CHILD_ENV_KEYS) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key];
  }
  environment.UIPATH_BRIDGE_INSTANCE = launchNonce;
  return environment;
}

function makeView(record, state, { reason = null, dispatchState = 'acknowledged', processOwned = record.processOwned } = {}) {
  return { launchRef: record.launchRef, state, processOwned: processOwned === true, browserVersion: null,
    reason, dispatchState };
}

export function createBrowserLaunchManager({ profiles, spawn = nodeSpawn, inspectProfile, verifyProcess, closeProcess,
  resolveProfile = resolveConfiguredProfile, now = Date.now, randomBytes = secureRandomBytes,
  powershellPath = DEFAULT_POWERSHELL, helperPath = DEFAULT_HELPER } = {}) {
  if (typeof spawn !== 'function' || typeof resolveProfile !== 'function' || typeof now !== 'function' ||
      typeof randomBytes !== 'function' || typeof powershellPath !== 'string' || typeof helperPath !== 'string') {
    throw failure('INVALID_ARGUMENT');
  }
  const configuredProfiles = parseProfiles(profiles);
  const runHelper = runHelperFactory({ spawn, powershellPath, helperPath, now });
  const inspectProfileImpl = inspectProfile ?? (async ({ userDataDir, deadline, signal }) =>
    checkProfileResult(await runHelper('profile.check', { userDataDir }, { deadline, signal })));
  const verifyProcessImpl = verifyProcess ?? (async ({ pid, executablePath, userDataDir, creationTimeUtcTicks, deadline, signal }) =>
    checkProcessResult(await runHelper('process.inspect', { pid, executablePath, userDataDir,
      ...(creationTimeUtcTicks ? { creationTimeUtcTicks } : {}) }, { deadline, signal })));
  const closeProcessImpl = closeProcess ?? (async ({ pid, executablePath, userDataDir, creationTimeUtcTicks, waitMs, deadline, signal }) =>
    checkCloseResult(await runHelper('process.close', { pid, executablePath, userDataDir, creationTimeUtcTicks,
      waitMs }, { deadline, signal })));
  if (typeof inspectProfileImpl !== 'function' || typeof verifyProcessImpl !== 'function' || typeof closeProcessImpl !== 'function') {
    throw failure('INVALID_ARGUMENT');
  }

  const launches = new Map();
  const idempotency = new Map();
  const makeLaunchRef = () => makeOpaque(randomBytes, 24).toString('base64url');

  const validateOwner = ownerRef => {
    if (!validRef(ownerRef)) throw failure('INVALID_ARGUMENT');
  };
  const ownedLaunch = (ownerRef, launchRef) => {
    validateOwner(ownerRef);
    if (!validRef(launchRef)) throw failure('INVALID_ARGUMENT');
    const record = launches.get(launchRef);
    return record?.ownerRef === ownerRef ? record : null;
  };

  const inspectRecord = async (record, { deadline, signal }) => {
    validateSignal(signal);
    validateDeadline(deadline, now);
    if (record.exited) {
      let lock;
      try { lock = checkProfileResult(await inspectProfileImpl({ userDataDir: record.profile.userDataDir, deadline, signal })); }
      catch { return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false }); }
      validateSignal(signal);
      validateDeadline(deadline, now);
      if (lock.locked) return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false });
      record.state = record.everRunning ? 'closed' : 'failed';
      record.processOwned = record.everRunning;
      return makeView(record, record.state, { processOwned: record.processOwned });
    }
    let result;
    try {
      result = checkProcessResult(await verifyProcessImpl({ pid: record.child.pid,
        executablePath: record.profile.executablePath, userDataDir: record.profile.userDataDir,
        ...(record.creationTimeUtcTicks ? { creationTimeUtcTicks: record.creationTimeUtcTicks } : {}), deadline, signal }));
    } catch { return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false }); }
    validateSignal(signal);
    validateDeadline(deadline, now);
    if (!result.exists) {
      let lock;
      try { lock = checkProfileResult(await inspectProfileImpl({ userDataDir: record.profile.userDataDir, deadline, signal })); }
      catch { return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false }); }
      validateSignal(signal);
      validateDeadline(deadline, now);
      if (lock.locked) return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false });
      record.state = record.everRunning ? 'closed' : 'failed';
      record.processOwned = record.everRunning;
      return makeView(record, record.state, { processOwned: record.processOwned });
    }
    if (!result.identityMatches || !result.creationTimeUtcTicks || result.executablePath === null ||
        !result.commandLineMatches) return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false });
    if (record.creationTimeUtcTicks && record.creationTimeUtcTicks !== result.creationTimeUtcTicks) {
      return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false });
    }
    record.creationTimeUtcTicks ??= result.creationTimeUtcTicks;
    record.processOwned = true;
    if (result.profileLockMatches && result.profileLockProcessId === record.child.pid) {
      record.everRunning = true;
      record.state = 'running_unpaired';
      return makeView(record, 'running_unpaired', { processOwned: true });
    }
    if (result.profileLockProcessId !== null && result.profileLockProcessId !== record.child.pid) {
      return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', processOwned: false });
    }
    record.state = 'starting';
    return makeView(record, 'starting', { processOwned: true });
  };

  return Object.freeze({
    async readiness({ deadline = now() + 2000, signal } = {}) {
      try { validateSignal(signal); validateDeadline(deadline, now); }
      catch (error) { return { available: false, reason: error.code ?? 'BACKEND_UNAVAILABLE', profiles: [] }; }
      const ready = [];
      let busy = false;
      for (const [alias, config] of Object.entries(configuredProfiles)) {
        if (deadline <= now() || signal?.aborted) break;
        try {
          const profile = await resolveProfile(config);
          const lock = checkProfileResult(await inspectProfileImpl({ userDataDir: profile.userDataDir, deadline, signal }));
          if (lock.locked) busy = true;
          else ready.push(alias);
        } catch { /* Keep only explicitly resolved, unlocked profile aliases. */ }
      }
      if (ready.length) return { available: true, reason: null, profiles: ready };
      return { available: false, reason: busy ? 'PROFILE_BUSY' : 'PROFILE_NOT_CONFIGURED', profiles: [] };
    },

    async start(options = {}) {
      plainObject(options, ['ownerRef', 'profileAlias', 'url', 'requestKey', 'deadline', 'signal'],
        ['ownerRef', 'profileAlias', 'requestKey', 'deadline']);
      const { ownerRef, profileAlias, requestKey } = options;
      validateOwner(ownerRef);
      validateSignal(options.signal);
      validateDeadline(options.deadline, now);
      if (!validAlias(profileAlias) || !validRequestKey(requestKey)) throw failure('INVALID_ARGUMENT');
      if (!Object.hasOwn(configuredProfiles, profileAlias)) throw failure('PROFILE_NOT_CONFIGURED');
      const url = parseUrl(options.url);
      const signature = JSON.stringify([profileAlias, url ?? null]);
      const idKey = JSON.stringify([ownerRef, requestKey]);
      const previous = idempotency.get(idKey);
      if (previous) {
        if (previous.signature !== signature) throw failure('REQUEST_KEY_CONFLICT');
        return makeView(previous.record, previous.record.state ?? 'starting', { processOwned: previous.record.processOwned });
      }
      if (launches.size >= MAX_LAUNCHES) throw failure('LAUNCH_LIMIT');

      let profile;
      try { profile = await resolveProfile(configuredProfiles[profileAlias]); }
      catch (error) { throw error?.code ? error : failure('PROFILE_NOT_CONFIGURED'); }
      validateSignal(options.signal);
      validateDeadline(options.deadline, now);
      let lock;
      try { lock = checkProfileResult(await inspectProfileImpl({ userDataDir: profile.userDataDir,
        deadline: options.deadline, signal: options.signal })); }
      catch { throw failure('BACKEND_UNAVAILABLE'); }
      validateSignal(options.signal);
      validateDeadline(options.deadline, now);
      if (lock.locked) throw failure('PROFILE_BUSY');

      const launchRef = makeLaunchRef();
      if (!validRef(launchRef) || launches.has(launchRef)) throw failure('BACKEND_UNAVAILABLE');
      const launchNonce = makeOpaque(randomBytes, 16).toString('hex');
      const args = [`--user-data-dir=${profile.userDataDir}`];
      if (url) args.push(url);
      let child;
      try {
        child = parseSpawnedChild(spawn(profile.executablePath, args, {
          shell: false,
          detached: false,
          windowsHide: false,
          stdio: 'ignore',
          env: childEnvironment(launchNonce),
        }));
      } catch { throw failure('BACKEND_UNAVAILABLE'); }
      const record = {
        launchRef, ownerRef, profileAlias, profile, child, launchNonce,
        creationTimeUtcTicks: null, state: 'starting', processOwned: false, everRunning: false, exited: false,
      };
      launches.set(launchRef, record);
      idempotency.set(idKey, { signature, record });
      child.on('error', () => { record.spawnError = true; });
      child.on('exit', () => { record.exited = true; });

      const spawned = await new Promise(resolve => {
        let complete = false;
        let timer;
        let abortHandler;
        const finish = value => {
          if (complete) return;
          complete = true;
          clearTimeout(timer);
          child.removeListener('spawn', onSpawn);
          child.removeListener('error', onFailure);
          if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
          resolve(value);
        };
        const onSpawn = () => finish('spawned');
        const onFailure = () => finish('failed');
        child.once('spawn', onSpawn);
        child.once('error', onFailure);
        timer = setTimeout(() => finish('timeout'), Math.max(1, Math.min(15_000, options.deadline - now())));
        if (options.signal) {
          abortHandler = () => finish('cancelled');
          options.signal.addEventListener('abort', abortHandler, { once: true });
          if (options.signal.aborted) abortHandler();
        }
        if (child.pid > 0 && child.spawnfile) queueMicrotask(onSpawn);
      });
      if (spawned === 'failed' && !(Number.isSafeInteger(child.pid) && child.pid > 0)) {
        launches.delete(launchRef);
        idempotency.delete(idKey);
        throw failure('BACKEND_UNAVAILABLE');
      }
      if (spawned === 'timeout' || spawned === 'cancelled' || spawned === 'failed') {
        record.state = 'unknown';
        return makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', dispatchState: 'unknown', processOwned: false });
      }
      return makeView(record, 'starting', { processOwned: false });
    },

    async status(options = {}) {
      plainObject(options, ['ownerRef', 'launchRef', 'deadline', 'signal'], ['ownerRef', 'launchRef', 'deadline']);
      validateSignal(options.signal);
      validateDeadline(options.deadline, now);
      const record = ownedLaunch(options.ownerRef, options.launchRef);
      if (!record) return { launchRef: options.launchRef, state: 'unknown', processOwned: false,
        browserVersion: null, reason: 'OWNERSHIP_UNPROVEN', dispatchState: 'notSent' };
      return inspectRecord(record, options);
    },

    async close(options = {}) {
      plainObject(options, ['ownerRef', 'launchRef', 'requestKey', 'deadline', 'signal'],
        ['ownerRef', 'launchRef', 'requestKey', 'deadline']);
      validateSignal(options.signal);
      validateDeadline(options.deadline, now);
      if (!validRequestKey(options.requestKey)) throw failure('INVALID_ARGUMENT');
      const record = ownedLaunch(options.ownerRef, options.launchRef);
      if (!record) return { launchRef: options.launchRef, state: 'unknown', processOwned: false,
        browserVersion: null, reason: 'OWNERSHIP_UNPROVEN', dispatchState: 'notSent' };
      if (!record.closeResults) record.closeResults = new Map();
      if (record.closeResults.has(options.requestKey)) return record.closeResults.get(options.requestKey);
      const state = await inspectRecord(record, options);
      validateSignal(options.signal);
      validateDeadline(options.deadline, now);
      if (state.state === 'closed' || state.state === 'failed') {
        record.closeResults.set(options.requestKey, state);
        return state;
      }
      if (state.state !== 'running_unpaired' || !record.creationTimeUtcTicks) {
        const result = makeView(record, 'unknown', { reason: state.reason ?? 'OWNERSHIP_UNPROVEN',
          dispatchState: 'notSent', processOwned: state.processOwned });
        record.closeResults.set(options.requestKey, result);
        return result;
      }
      const waitMs = Math.max(0, Math.min(2000, options.deadline - now()));
      let result;
      try {
        result = checkCloseResult(await closeProcessImpl({ pid: record.child.pid,
          executablePath: record.profile.executablePath, userDataDir: record.profile.userDataDir,
          creationTimeUtcTicks: record.creationTimeUtcTicks, waitMs, deadline: options.deadline, signal: options.signal }));
      } catch {
        const unknown = makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', dispatchState: 'unknown', processOwned: false });
        record.closeResults.set(options.requestKey, unknown);
        return unknown;
      }
      let view;
      if (result.ownershipConfirmed && result.exited && result.profileUnlocked) {
        record.exited = true;
        record.state = 'closed';
        record.processOwned = true;
        view = makeView(record, 'closed', { processOwned: true });
      } else if (!result.ownershipConfirmed) {
        view = makeView(record, 'unknown', { reason: 'OWNERSHIP_UNPROVEN', dispatchState: 'unknown', processOwned: false });
      } else if (result.closeRequested) {
        view = makeView(record, 'running_unpaired', { dispatchState: 'acknowledged', processOwned: true });
      } else {
        view = makeView(record, 'unknown', { dispatchState: 'notSent', processOwned: true });
      }
      record.closeResults.set(options.requestKey, view);
      return view;
    },
  });
}

export const browserLaunchLimits = Object.freeze({ maxLaunches: MAX_LAUNCHES, maxHelperBytes: MAX_HELPER_BYTES,
  helperCleanupMs: HELPER_CLEANUP_MS, profileConfigEnvironment: 'UIPATH_BROWSER_PROFILES' });
