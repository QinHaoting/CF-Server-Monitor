import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { handleUpdate, handleUpdateWebSocketUpgrade } from '../src/handlers/update.js';
import { checkAuth, generateToken } from '../src/middleware/auth.js';
import { clearSiteSettingsCache, loadSiteSettings } from '../src/utils/settings.js';
import { isValidApiSecret, readLimitedJson } from '../src/utils/security.js';
import { MetricsBroadcaster } from '../src/durable/MetricsBroadcaster.js';

const SECRET = 'local-test-report-secret-at-least-32-characters';
const JWT_SECRET = 'independent-local-jwt-secret-at-least-32-characters';
const jsonRequest = body => new Request('https://example.com/update', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body
});

test('unconfigured Worker and direct report handlers fail before database access', async () => {
  for (const secret of [undefined, '', ' ', 'short', 123, ' '.repeat(32)]) {
    const env = { API_SECRET: secret, DB: { prepare() { throw new Error('Must not read D1'); } } };
    assert.equal(isValidApiSecret(secret), false);
    assert.equal((await worker.fetch(jsonRequest('{}'), env, {})).status, 503);
    assert.equal((await handleUpdate(jsonRequest('{}'), env, {})).status, 503);
    assert.equal((await handleUpdateWebSocketUpgrade(new Request('https://example.com/update'), env)).status, 503);
  }
});

test('JSON reader counts UTF-8 bytes, accepts the exact boundary, and cancels oversize streams', async () => {
  const body = JSON.stringify({ text: '汉字' });
  const size = new TextEncoder().encode(body).length;
  assert.deepEqual(await readLimitedJson(jsonRequest(body), size), { text: '汉字' });
  await assert.rejects(readLimitedJson(jsonRequest(body), size - 1), error => error.code === 413);
  let cancelled = false;
  const request = new Request('https://example.com/update', {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(11)); },
      cancel() { cancelled = true; }
    })
  });
  await assert.rejects(readLimitedJson(request, 10), error => error.code === 413);
  assert.equal(cancelled, true);
});

test('malformed JSON and non-object reports return 400', async () => {
  for (const body of ['{', '', 'null', '[]', '"report"']) {
    assert.equal((await handleUpdate(jsonRequest(body), { API_SECRET: SECRET }, {})).status, 400);
  }
});

test('JWT signing requires an independent persisted key and verification has no fallback', async () => {
  const env = { API_SECRET: SECRET };
  const token = await generateToken(env, { jwt_secret: JWT_SECRET });
  const request = new Request('https://example.com/admin/api', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(await checkAuth(request, env, { jwt_secret: JWT_SECRET }), true);
  for (const sys of [undefined, {}, { jwt_secret: 'short' }]) {
    await assert.rejects(generateToken(env, sys), error => error.code === 503);
    assert.equal(await checkAuth(request, env, sys), false);
  }
  const agentKeyToken = await generateToken(env, { jwt_secret: SECRET });
  assert.equal(await checkAuth(new Request('https://example.com/admin/api', {
    headers: { Authorization: `Bearer ${agentKeyToken}` }
  }), env, { jwt_secret: JWT_SECRET }), false);
});

test('settings defaults are private and settings failures cannot produce public fallback settings', async () => {
  clearSiteSettingsCache();
  await assert.rejects(loadSiteSettings({ prepare() { throw new Error('D1 unavailable'); } }), error => error.code === 503);
  const db = { prepare() { return {
    bind() { return this; },
    async first() { return { value: JSON.stringify({ jwt_secret: JWT_SECRET }) }; },
    async all() { return { results: [] }; }
  }; } };
  const settings = await loadSiteSettings(db);
  assert.equal(settings.is_public, 'false');
  assert.equal(settings.wss_report_enabled, 'false');
  clearSiteSettingsCache();
});

test('Durable Object cannot trust an authenticated attachment when its report key is missing', async () => {
  let closed;
  const broadcaster = Object.create(MetricsBroadcaster.prototype);
  broadcaster.env = {};
  broadcaster._closeWsWithError = (_ws, _message, status) => { closed = status; };
  assert.equal(await broadcaster._resolveAgentContext({}, { authenticated: true, serverId: 'node' }, { id: 'node' }), null);
  assert.equal(closed, 503);
});
