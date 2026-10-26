import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createBrowserSemanticClient, browserSemanticLimits } from '../src/browser-semantic.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  try { return await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function ollamaReply(model, content, status = 200) {
  return (request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model, message: { role: 'assistant', content }, done: true }));
  };
}

const candidateSet = [
  { candidateId: 'button-save', role: 'button', accessibleName: 'Save', label: 'Save changes' },
  { candidateId: 'link-help', role: 'link', accessibleName: 'Help', label: 'Open help' },
];

test('uses direct loopback HTTP and sends only the bounded query/candidate projection', async () => {
  let observed;
  await withServer(async (request, response) => {
    observed = { method: request.method, url: request.url, host: request.headers.host,
      contentType: request.headers['content-type'], body: JSON.parse(await readBody(request)) };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'local/vision:latest', message: {
      role: 'assistant', content: JSON.stringify({ candidateIds: ['button-save'], abstain: false }),
    }, done: true }));
  }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'local/vision:latest', endpoint });
    const result = await client.query({ query: 'the control that saves changes', candidates: candidateSet,
      limit: 3, deadline: Date.now() + 2000 });
    assert.deepEqual(result, { candidateIds: ['button-save'], abstained: false,
      provider: { name: 'ollama', model: 'local/vision:latest' }, truncated: false });
  });

  assert.equal(observed.method, 'POST');
  assert.equal(observed.url, '/api/chat');
  assert.match(observed.host, /^127\.0\.0\.1:\d+$/);
  assert.equal(observed.contentType, 'application/json');
  assert.equal(observed.body.model, 'local/vision:latest');
  assert.equal(observed.body.stream, false);
  assert.equal(observed.body.format, 'json');
  assert.deepEqual(observed.body.options, { temperature: 0, num_predict: 128 });
  assert.equal(observed.body.messages.length, 2);
  assert.match(observed.body.messages[0].content, /untrusted page data/);
  assert.deepEqual(JSON.parse(observed.body.messages[1].content), { query: 'the control that saves changes', candidates: candidateSet });
  assert.equal(JSON.stringify(observed.body).includes('url'), false);
});

test('malformed, unknown, duplicate, over-limit, or abstaining model IDs yield empty abstention', async () => {
  const answers = [
    '{"candidateIds":[],"abstain":true}',
    '{"candidateIds":["unknown"],"abstain":false}',
    '{"candidateIds":["button-save","button-save"],"abstain":false}',
    '{"candidateIds":["button-save","link-help"],"abstain":false}',
    '{"candidateIds":["button-save"],"abstain":true}',
    '{"candidateIds":["button-save"],"abstain":false,"explanation":"no"}',
    'not JSON',
  ];
  await withServer((request, response) => {
    const content = answers.shift();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'local/model', message: { role: 'assistant', content }, done: true }));
  }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'local/model', endpoint });
    for (let index = 0; index < 7; index++) {
      const result = await client.query({ query: 'match', candidates: candidateSet, limit: 1, deadline: Date.now() + 2000 });
      assert.deepEqual(result.candidateIds, []);
      assert.equal(result.abstained, true);
    }
  });
});

test('rejects body and response over the documented byte limits', async () => {
  let calls = 0;
  await withServer(async (request, response) => {
    calls++;
    await readBody(request);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(' '.repeat(browserSemanticLimits.maxResponseBytes + 1));
  }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'local/model', endpoint });
    const tooManyBytes = Array.from({ length: 100 }, (_, index) => ({
      candidateId: `candidate-${index}`, role: 'button', accessibleName: 'x'.repeat(256), label: 'y'.repeat(256),
    }));
    await assert.rejects(client.query({ query: 'match', candidates: tooManyBytes, limit: 20, deadline: Date.now() + 2000 }),
      { code: 'RESULT_TOO_LARGE' });
    assert.equal(calls, 0);

    await assert.rejects(client.query({ query: 'match', candidates: candidateSet, limit: 1, deadline: Date.now() + 2000 }),
      { code: 'RESULT_TOO_LARGE' });
    assert.equal(calls, 1);
  });
});

test('does not connect without explicit model configuration', async () => {
  let connected = false;
  await withServer(() => { connected = true; }, async endpoint => {
    const client = createBrowserSemanticClient({ model: '', endpoint });
    assert.equal(client.configured, false);
    await assert.rejects(client.query({ query: 'match', candidates: candidateSet, limit: 1,
      deadline: Date.now() + 2000 }), { code: 'BACKEND_UNAVAILABLE', dispatchState: 'notSent' });
  });
  assert.equal(connected, false);
});

test('readiness checks only the configured model on the fixed loopback show route', async () => {
  let received;
  await withServer(async (request, response) => {
    received = { method: request.method, url: request.url, body: JSON.parse(await readBody(request)) };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ modelfile: 'FROM local/model' }));
  }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'local/model', endpoint });
    assert.deepEqual(await client.readiness({ deadline: Date.now() + 2000 }),
      { available: true, reason: null, model: 'local/model' });
  });
  assert.deepEqual(received, { method: 'POST', url: '/api/show', body: { model: 'local/model', verbose: false } });

  await withServer((request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"model not found"}');
  }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'missing/model', endpoint });
    assert.deepEqual(await client.readiness({ deadline: Date.now() + 2000 }),
      { available: false, reason: 'MODEL_NOT_AVAILABLE', model: 'missing/model' });
  });
});

test('rejects non-loopback endpoints and invalid candidate payloads before HTTP', async () => {
  assert.throws(() => createBrowserSemanticClient({ model: 'local/model', endpoint: 'http://localhost:11434' }),
    { code: 'INVALID_ARGUMENT' });
  assert.throws(() => createBrowserSemanticClient({ model: 'local/model', endpoint: 'http://192.0.2.4:11434' }),
    { code: 'INVALID_ARGUMENT' });

  let connected = false;
  await withServer(() => { connected = true; }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'local/model', endpoint });
    await assert.rejects(client.query({ query: 'match', candidates: [{ ...candidateSet[0], value: 'secret' }],
      limit: 1, deadline: Date.now() + 2000 }), { code: 'INVALID_ARGUMENT' });
    assert.equal(connected, false);
  });
});

test('HTTP deadline aborts the local request without retry', async () => {
  let calls = 0;
  await withServer((request) => { calls++; request.on('data', () => {}); }, async endpoint => {
    const client = createBrowserSemanticClient({ model: 'local/model', endpoint });
    await assert.rejects(client.query({ query: 'match', candidates: candidateSet, limit: 1,
      deadline: Date.now() + 40 }), { code: 'TIMEOUT', dispatchState: 'sent' });
    assert.equal(calls, 1);
  });
});
