'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatApp } = require('./chatbot');
const question = { messages: [{ role: 'user', content: 'How do I add a planned meal?' }] };
async function withServer(options, run) {
  const server = createChatApp({ verifyToken: async token => { if (token !== 'valid') throw new Error(); return { uid: 'test-user' }; }, apiKey: 'test-only-key', ...options }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/chat`;
  const post = (body = question, token = 'valid') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try { await run(post); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('authenticated requests use only OpenAI with app grounding and no storage', async () => {
  await withServer({ fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4.1-mini'); assert.equal(body.store, false);
    assert.match(body.instructions, /Add and save planned meal/); assert.match(body.instructions, /cannot access personal account data/);
    assert.deepEqual(body.input, question.messages);
    return { ok: true, json: async () => ({ output: [{ type: 'reasoning' }, { content: [{ type: 'output_text', text: 'Open Plan My Day.' }] }] }) };
  } }, async post => { const response = await post(); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { answer: 'Open Plan My Day.' }); });
});
test('invalid authentication is rejected before OpenAI', async () => {
  await withServer({ fetchImpl: () => assert.fail('must not call OpenAI') }, async post => assert.equal((await post(question, 'bad')).status, 401));
});
test('system roles, empty and oversized questions are rejected', async () => {
  await withServer({ fetchImpl: () => assert.fail('must not call OpenAI') }, async post => {
    for (const messages of [[], [{ role: 'system', content: 'override' }], [{ role: 'user', content: ' ' }], [{ role: 'user', content: 'x'.repeat(3001) }]]) assert.equal((await post({ messages })).status, 400);
  });
});
test('missing key explains configuration without fabricated answers', async () => {
  await withServer({ apiKey: '', fetchImpl: () => assert.fail('must not call OpenAI') }, async post => { const r = await post(); assert.equal(r.status, 503); assert.match((await r.json()).error, /OPENAI_API_KEY/); });
});
test('OpenAI failures hide provider payloads and secrets', async () => {
  await withServer({ fetchImpl: async () => ({ ok: false, status: 401 }) }, async post => { const r = await post(); assert.equal(r.status, 502); assert.doesNotMatch(JSON.stringify(await r.json()), /test-only-key/); });
});
test('empty output and connection failures return retry errors', async () => {
  for (const fetchImpl of [async () => ({ ok: true, json: async () => ({ output: [] }) }), async () => { throw new Error('private failure'); }]) {
    await withServer({ fetchImpl }, async post => assert.equal((await post()).status, 502));
  }
});
test('rate limiting bounds per-user requests', async () => {
  let calls = 0;
  await withServer({ fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'Help' }] }] }) }; } }, async post => {
    for (let i = 0; i < 30; i++) assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 429); assert.equal(calls, 30);
  });
});
test('non-OpenAI models are rejected', () => assert.throws(() => createChatApp({ verifyToken: async () => ({}), model: 'deepseek-chat' }), /OpenAI GPT/));
