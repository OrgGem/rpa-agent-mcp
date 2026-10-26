import { randomBytes as secureRandomBytes } from 'node:crypto';

export const AXE_CORE_VERSION = '4.14.0';

const MAX_EXECUTION_MS = 10_000;
const MAX_TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 64;
const MAX_RULES = 100;
const MAX_NODES_PER_RULE = 100;
const MAX_TARGET_PATHS = 32;
const MAX_OUTPUT_BYTES = 245_760;

const STANDARD_TAGS = Object.freeze({
  WCAG21AA: Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']),
  WCAG22AA: Object.freeze(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']),
});

const ERROR_MESSAGES = Object.freeze({
  INVALID_ARGUMENT: 'The accessibility audit request is invalid',
  BACKEND_UNAVAILABLE: 'The isolated accessibility audit backend is unavailable',
  BACKEND_BUSY: 'An accessibility audit is still running for this document',
  DOCUMENT_GONE: 'The accessibility audit document is no longer current',
  REQUEST_KEY_CONFLICT: 'The accessibility request key was used with different arguments',
  TIMEOUT: 'The accessibility audit deadline expired',
  CANCELLED: 'The accessibility audit result was cancelled',
  OPERATION_FAILED: 'The accessibility audit returned an invalid result',
  RESULT_TOO_LARGE: 'The accessibility audit result exceeded its limit',
});

function failure(code) {
  const error = new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.OPERATION_FAILED);
  error.name = 'BrowserAccessibilityError';
  error.code = code;
  error.dispatchState = 'notSent';
  return error;
}

function plainObject(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw failure('INVALID_ARGUMENT');
  }
}

function key(parts) { return JSON.stringify(parts); }

function finiteDeadline(deadline, now) {
  if (!Number.isFinite(deadline)) throw failure('INVALID_ARGUMENT');
  if (deadline <= now()) throw failure('TIMEOUT');
}

function safeText(value, maxBytes) {
  if (typeof value !== 'string') throw failure('OPERATION_FAILED');
  let result = value;
  while (Buffer.byteLength(result, 'utf8') > maxBytes) result = result.slice(0, -1);
  return result;
}

function redactSensitiveText(value) {
  return value
    .replace(/\svalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ' value="[REDACTED]"')
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea\s*>)/gi, '$1[REDACTED]$2')
    .replace(/(\bpassword\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]');
}

function boundedString(value, maxBytes, { redact = false } = {}) {
  if (typeof value !== 'string') throw failure('OPERATION_FAILED');
  return safeText(redact ? redactSensitiveText(value) : value, maxBytes);
}

function normalizeTargetPath(value) {
  if (!Array.isArray(value) || value.length > MAX_TARGET_PATHS || value.some(part => typeof part !== 'string')) {
    throw failure('OPERATION_FAILED');
  }
  return value.map(part => boundedString(part, 256, { redact: true }));
}

function normalizeHelpUrl(value) {
  if (typeof value !== 'string' || value.length > 512) throw failure('OPERATION_FAILED');
  let parsed;
  try { parsed = new URL(value); } catch { throw failure('OPERATION_FAILED'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw failure('OPERATION_FAILED');
  return parsed.href;
}

function normalizeImpact(value) {
  if (value === null || ['minor', 'moderate', 'serious', 'critical'].includes(value)) return value;
  throw failure('OPERATION_FAILED');
}

function normalizeId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw failure('OPERATION_FAILED');
  return value;
}

function encodeResult(result) { return Buffer.byteLength(JSON.stringify(result), 'utf8'); }

function normalizeResult(raw, { standard, includeIncomplete, limit }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      !Array.isArray(raw.violations) || !Array.isArray(raw.incomplete) ||
      (!Array.isArray(raw.passes) && (!raw.summary || typeof raw.summary !== 'object' || Array.isArray(raw.summary)))) {
    throw failure('OPERATION_FAILED');
  }
  if ((raw.engine !== undefined && raw.engine !== 'axe-core') ||
      (raw.engineVersion !== undefined && raw.engineVersion !== AXE_CORE_VERSION) ||
      (raw.standard !== undefined && raw.standard !== standard) ||
      (raw.truncated !== undefined && typeof raw.truncated !== 'boolean')) throw failure('OPERATION_FAILED');
  const summary = raw.summary ?? { violations: raw.violations.length, incomplete: raw.incomplete.length, passes: raw.passes.length };
  if (['violations', 'incomplete', 'passes'].some(key => !Number.isSafeInteger(summary[key]) || summary[key] < 0)) {
    throw failure('OPERATION_FAILED');
  }
  const result = {
    engine: 'axe-core',
    engineVersion: AXE_CORE_VERSION,
    standard,
    summary: { violations: summary.violations, incomplete: summary.incomplete, passes: summary.passes },
    violations: [],
    incomplete: [],
    truncated: false,
  };
  let truncated = raw.truncated === true || raw.violations.length > limit || (includeIncomplete && raw.incomplete.length > limit);
  for (const sourceRule of raw.violations.slice(0, Math.min(limit, MAX_RULES))) {
    if (!sourceRule || typeof sourceRule !== 'object' || !Array.isArray(sourceRule.tags) || !Array.isArray(sourceRule.nodes)) {
      throw failure('OPERATION_FAILED');
    }
    const rule = {
      id: normalizeId(sourceRule.id),
      impact: normalizeImpact(sourceRule.impact ?? null),
      description: boundedString(sourceRule.description ?? '', 1024),
      help: boundedString(sourceRule.help ?? '', 1024),
      helpUrl: normalizeHelpUrl(sourceRule.helpUrl),
      tags: sourceRule.tags.slice(0, 32).map(tag => boundedString(tag, 64)),
      nodes: [],
    };
    if (sourceRule.tags.length > 32 || sourceRule.nodes.length > MAX_NODES_PER_RULE) truncated = true;
    result.violations.push(rule);
    for (const sourceNode of sourceRule.nodes.slice(0, MAX_NODES_PER_RULE)) {
      if (!sourceNode || typeof sourceNode !== 'object') throw failure('OPERATION_FAILED');
      const node = {
        targetPath: normalizeTargetPath(sourceNode.targetPath ?? sourceNode.target ?? []),
        elementRef: null,
        htmlExcerpt: boundedString(sourceNode.htmlExcerpt ?? sourceNode.html ?? '', 256, { redact: true }),
        failureSummary: sourceNode.failureSummary == null
          ? null : boundedString(sourceNode.failureSummary, 1024, { redact: true }),
      };
      rule.nodes.push(node);
      if (encodeResult(result) > MAX_OUTPUT_BYTES) {
        rule.nodes.pop();
        truncated = true;
        break;
      }
    }
    if (encodeResult(result) > MAX_OUTPUT_BYTES) {
      result.violations.pop();
      truncated = true;
      break;
    }
    if (rule.nodes.length < sourceRule.nodes.length) truncated = true;
    if (truncated && encodeResult(result) >= MAX_OUTPUT_BYTES - 2) break;
  }
  if (includeIncomplete) {
    let incompleteLimitReached = false;
    for (const sourceRule of raw.incomplete.slice(0, Math.min(limit, MAX_RULES))) {
      if (!sourceRule || typeof sourceRule !== 'object' || !Array.isArray(sourceRule.nodes)) throw failure('OPERATION_FAILED');
      for (const sourceNode of sourceRule.nodes.slice(0, MAX_NODES_PER_RULE)) {
        if (result.incomplete.length >= MAX_RULES) {
          truncated = true;
          incompleteLimitReached = true;
          break;
        }
        const entry = {
          id: normalizeId(sourceRule.id),
          targetPath: normalizeTargetPath(sourceNode?.targetPath ?? sourceNode?.target ?? []),
          reason: boundedString(sourceNode?.reason ?? sourceNode?.failureSummary ?? sourceRule.help ?? '', 1024, { redact: true }),
        };
        result.incomplete.push(entry);
        if (encodeResult(result) > MAX_OUTPUT_BYTES) {
          result.incomplete.pop();
          truncated = true;
          break;
        }
      }
      if (incompleteLimitReached || (truncated && encodeResult(result) >= MAX_OUTPUT_BYTES - 2)) break;
    }
  }
  if (raw.incomplete.length > limit || raw.violations.length > limit) truncated = true;
  result.truncated = truncated;
  if (encodeResult(result) > MAX_OUTPUT_BYTES) throw failure('RESULT_TOO_LARGE');
  return result;
}

function requestSignature(options) {
  return JSON.stringify({
    ownerRef: options.ownerRef,
    contextRef: options.contextRef,
    tabRef: options.tabRef,
    documentGeneration: options.documentGeneration,
    standard: options.standard,
    includeIncomplete: options.includeIncomplete,
    limit: options.limit,
  });
}

function docKey(options) {
  return key([options.ownerRef, options.contextRef, options.tabRef, options.documentGeneration]);
}

function validateStart(options, now) {
  plainObject(options, ['ownerRef', 'contextRef', 'tabRef', 'documentGeneration', 'standard',
    'includeIncomplete', 'limit', 'requestKey', 'deadline', 'signal'],
  ['ownerRef', 'contextRef', 'tabRef', 'documentGeneration', 'standard', 'includeIncomplete', 'limit', 'requestKey', 'deadline']);
  for (const ref of [options.ownerRef, options.contextRef, options.tabRef]) {
    if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ref)) throw failure('INVALID_ARGUMENT');
  }
  if (!Number.isSafeInteger(options.documentGeneration) || options.documentGeneration < 0 ||
      !Object.hasOwn(STANDARD_TAGS, options.standard) || typeof options.includeIncomplete !== 'boolean' ||
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > MAX_RULES ||
      typeof options.requestKey !== 'string' || options.requestKey.length < 1 || options.requestKey.length > 128) {
    throw failure('INVALID_ARGUMENT');
  }
  if (options.signal !== undefined && (!options.signal || typeof options.signal.aborted !== 'boolean' ||
      typeof options.signal.addEventListener !== 'function' || typeof options.signal.removeEventListener !== 'function')) {
    throw failure('INVALID_ARGUMENT');
  }
  if (options.signal?.aborted) throw failure('CANCELLED');
  finiteDeadline(options.deadline, now);
}

function validateOpaqueRef(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function createAccessibilityAuditTickets({ runIsolated, now = Date.now, randomBytes = secureRandomBytes,
  executorReady = async () => true, maxTickets = MAX_TICKETS } = {}) {
  if (typeof runIsolated !== 'function' || typeof now !== 'function' || typeof randomBytes !== 'function' ||
      typeof executorReady !== 'function' || !Number.isSafeInteger(maxTickets) || maxTickets < 1 || maxTickets > MAX_TICKETS) {
    throw failure('INVALID_ARGUMENT');
  }
  const tickets = new Map();
  const idempotency = new Map();
  const runningByDocument = new Map();
  const latestGoneGeneration = new Map();

  const prune = () => {
    const current = now();
    for (const [auditRef, record] of tickets) {
      if (record.expiresAt <= current) tickets.delete(auditRef);
    }
    for (const [idKey, record] of idempotency) {
      if (record.expiresAt <= current) idempotency.delete(idKey);
    }
  };

  const refresh = record => {
    if (record.workPending && !record.cancelled && now() >= record.executionDeadline && record.state === 'running') {
      record.state = 'unknown';
      record.cleanupState = 'ticket-retained';
      record.result = null;
    }
  };

  const releaseDocumentLock = record => {
    const recordKey = docKey(record.options);
    if (runningByDocument.get(recordKey) === record) runningByDocument.delete(recordKey);
  };

  const detachAbortListener = record => {
    if (record.options.signal && record.abortListener) {
      record.options.signal.removeEventListener('abort', record.abortListener);
      record.abortListener = null;
    }
  };

  const makeRef = () => {
    const bytes = randomBytes(24);
    if (!Buffer.isBuffer(bytes) || bytes.length !== 24) throw failure('BACKEND_UNAVAILABLE');
    return bytes.toString('base64url');
  };

  const findOwnedTicket = (ownerRef, auditRef) => {
    if (!validateOpaqueRef(auditRef)) throw failure('INVALID_ARGUMENT');
    const record = tickets.get(auditRef);
    if (!record || record.ownerRef !== ownerRef) return null;
    refresh(record);
    return record;
  };

  return Object.freeze({
    async readiness({ deadline = now() + 1000, signal } = {}) {
      if (!Number.isFinite(deadline) || deadline <= now() || signal?.aborted) {
        return { available: false, reason: signal?.aborted ? 'CANCELLED' : 'TIMEOUT' };
      }
      try {
        const ready = await executorReady({ deadline, signal, engine: 'axe-core', version: AXE_CORE_VERSION });
        if (ready === true || ready?.available === true) return { available: true, reason: null };
        return { available: false, reason: typeof ready?.reason === 'string' ? ready.reason.slice(0, 64) : 'AUDIT_EXECUTOR_UNAVAILABLE' };
      } catch {
        return { available: false, reason: 'AUDIT_EXECUTOR_UNAVAILABLE' };
      }
    },

    start(options = {}) {
      validateStart(options, now);
      prune();
      const signature = requestSignature(options);
      const idKey = key([options.ownerRef, options.requestKey]);
      const prior = idempotency.get(idKey);
      if (prior) {
        if (prior.signature !== signature) throw failure('REQUEST_KEY_CONFLICT');
        refresh(prior);
        if (prior.state === 'running') return { action: 'start', auditRef: prior.auditRef, state: 'running',
          expiresAt: new Date(prior.expiresAt).toISOString() };
        if (prior.state === 'complete') return { action: 'start', auditRef: prior.auditRef, state: 'complete', result: prior.result };
        return { action: 'start', auditRef: prior.auditRef, state: 'unknown',
          cleanupState: prior.cleanupState === 'unknown' ? 'unknown' : 'ticket-retained' };
      }
      if (tickets.size >= maxTickets) throw failure('BACKEND_BUSY');
      const targetKey = docKey(options);
      const tabKey = key([options.ownerRef, options.contextRef, options.tabRef]);
      if (options.documentGeneration <= (latestGoneGeneration.get(tabKey) ?? -1)) throw failure('DOCUMENT_GONE');
      if (runningByDocument.has(targetKey)) throw failure('BACKEND_BUSY');
      const auditRef = makeRef();
      if (!validateOpaqueRef(auditRef) || tickets.has(auditRef)) throw failure('BACKEND_UNAVAILABLE');
      const current = now();
      const executionDeadline = Math.min(options.deadline, current + MAX_EXECUTION_MS);
      const record = {
        auditRef,
        ownerRef: options.ownerRef,
        options: { ...options },
        signature,
        expiresAt: current + MAX_TICKET_TTL_MS,
        executionDeadline,
        state: 'running',
        cleanupState: null,
        result: null,
        workPending: true,
        cancelled: false,
        documentGone: false,
        abortListener: null,
      };
      runningByDocument.set(targetKey, record);
      tickets.set(auditRef, record);
      idempotency.set(idKey, record);

      let work;
      try {
        work = runIsolated({
          operation: 'ax.audit.start',
          ownerRef: options.ownerRef,
          contextRef: options.contextRef,
          tabRef: options.tabRef,
          documentGeneration: options.documentGeneration,
          auditRef,
          standard: options.standard,
          tags: [...STANDARD_TAGS[options.standard]],
          includeIncomplete: options.includeIncomplete,
          limit: options.limit,
          engine: 'axe-core',
          engineVersion: AXE_CORE_VERSION,
          deadline: executionDeadline,
        });
      } catch {
        record.workPending = false;
        record.state = 'unknown';
        record.cleanupState = 'unknown';
        releaseDocumentLock(record);
        throw failure('BACKEND_UNAVAILABLE');
      }

      if (options.signal) {
        record.abortListener = () => {
          record.cancelled = true;
          record.result = null;
          record.state = 'cancelled';
          record.cleanupState = 'result-dropped';
        };
        options.signal.addEventListener('abort', record.abortListener, { once: true });
        if (options.signal.aborted) record.abortListener();
      }

      Promise.resolve(work).then(raw => {
        record.workPending = false;
        releaseDocumentLock(record);
        detachAbortListener(record);
        if (record.cancelled || record.documentGone || now() >= executionDeadline) {
          if (!record.cancelled) {
            record.state = 'unknown';
            record.cleanupState = record.documentGone ? 'unknown' : 'ticket-retained';
          }
          record.result = null;
          return;
        }
        try {
          record.result = normalizeResult(raw, options);
          record.state = 'complete';
          record.cleanupState = null;
        } catch {
          record.state = 'unknown';
          record.cleanupState = 'unknown';
          record.result = null;
        }
      }, () => {
        record.workPending = false;
        releaseDocumentLock(record);
        detachAbortListener(record);
        if (!record.cancelled) {
          record.state = 'unknown';
          record.cleanupState = record.documentGone ? 'unknown' : 'ticket-retained';
        }
        record.result = null;
      });

      return { action: 'start', auditRef, state: 'running', expiresAt: new Date(record.expiresAt).toISOString() };
    },

    poll(options = {}) {
      plainObject(options, ['ownerRef', 'auditRef'], ['ownerRef', 'auditRef']);
      const { ownerRef, auditRef } = options;
      if (typeof ownerRef !== 'string' || !validateOpaqueRef(auditRef)) throw failure('INVALID_ARGUMENT');
      prune();
      const record = findOwnedTicket(ownerRef, auditRef);
      if (!record) return { action: 'poll', auditRef, state: 'unknown', cleanupState: 'unknown' };
      if (record.state === 'running') return { action: 'poll', auditRef, state: 'running', expiresAt: new Date(record.expiresAt).toISOString() };
      if (record.state === 'complete') return { action: 'poll', auditRef, state: 'complete', result: record.result };
      return { action: 'poll', auditRef, state: 'unknown', cleanupState: record.cleanupState ?? 'unknown' };
    },

    cancel(options = {}) {
      plainObject(options, ['ownerRef', 'auditRef', 'requestKey'], ['ownerRef', 'auditRef', 'requestKey']);
      const { ownerRef, auditRef, requestKey } = options;
      if (typeof ownerRef !== 'string' || !validateOpaqueRef(auditRef) ||
          typeof requestKey !== 'string' || requestKey.length < 1 || requestKey.length > 128) throw failure('INVALID_ARGUMENT');
      prune();
      const record = findOwnedTicket(ownerRef, auditRef);
      if (!record) return { action: 'cancel', auditRef, state: 'unknown', cleanupState: 'unknown' };
      record.cancelled = true;
      record.result = null;
      record.state = 'cancelled';
      record.cleanupState = 'result-dropped';
      detachAbortListener(record);
      return { action: 'cancel', auditRef, state: 'cancelled', cleanupState: 'result-dropped' };
    },

    documentGone(options = {}) {
      plainObject(options,
        ['ownerRef', 'contextRef', 'tabRef', 'documentGeneration'], ['ownerRef', 'contextRef', 'tabRef', 'documentGeneration']);
      const { ownerRef, contextRef, tabRef, documentGeneration } = options;
      if ([ownerRef, contextRef, tabRef].some(ref => typeof ref !== 'string') ||
          !Number.isSafeInteger(documentGeneration) || documentGeneration < 0) throw failure('INVALID_ARGUMENT');
      const targetKey = key([ownerRef, contextRef, tabRef, documentGeneration]);
      const tabKey = key([ownerRef, contextRef, tabRef]);
      latestGoneGeneration.set(tabKey, Math.max(documentGeneration, latestGoneGeneration.get(tabKey) ?? -1));
      const record = runningByDocument.get(targetKey);
      if (!record) return false;
      record.documentGone = true;
      record.result = null;
      if (record.state !== 'cancelled') {
        record.state = 'unknown';
        record.cleanupState = 'unknown';
      }
      detachAbortListener(record);
      releaseDocumentLock(record);
      return true;
    },

    disposeOwner(options = {}) {
      plainObject(options, ['ownerRef'], ['ownerRef']);
      const { ownerRef } = options;
      if (typeof ownerRef !== 'string') throw failure('INVALID_ARGUMENT');
      for (const record of new Set([...tickets.values(), ...runningByDocument.values()])) {
        if (record.ownerRef !== ownerRef) continue;
        record.cancelled = true;
        record.result = null;
        record.state = 'cancelled';
        record.cleanupState = 'result-dropped';
        detachAbortListener(record);
      }
      return true;
    },
  });
}

export const browserAccessibilityLimits = Object.freeze({
  maxExecutionMs: MAX_EXECUTION_MS,
  maxTicketTtlMs: MAX_TICKET_TTL_MS,
  maxTickets: MAX_TICKETS,
  maxRules: MAX_RULES,
  maxNodesPerRule: MAX_NODES_PER_RULE,
  maxOutputBytes: MAX_OUTPUT_BYTES,
});
