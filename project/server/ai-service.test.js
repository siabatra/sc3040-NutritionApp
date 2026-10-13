'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, mockResponse, withFetch, macros, planRequest } = require('./ai-test-helper');

test('AI features reject unauthenticated users before calling the server', async () => {
  await withFetch(() => assert.fail('Server should not be called'), async () => {
    const client = loadClient(null);
    await assert.rejects(client.extractMenuFromImage('image'), error => error.code === 'UNAUTHENTICATED');
    await assert.rejects(client.analyzeMealPhoto('image'), error => error.code === 'UNAUTHENTICATED');
    await assert.rejects(client.generateAiMealPlan(planRequest), error => error.code === 'UNAUTHENTICATED');
  });
});

test('AI features convert network failures into retryable errors', async () => {
  await withFetch(async () => { throw new Error('connection failed'); }, async (client) => {
    await assert.rejects(client.extractMenuFromImage('image'), error => error.code === 'NETWORK');
    await assert.rejects(client.analyzeMealPhoto('image'), error => error.code === 'NETWORK');
    await assert.rejects(client.generateAiMealPlan(planRequest), error => error.code === 'NETWORK');
  });
});

test('AI features handle invalid JSON responses with a generic error', async () => {
  await withFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Invalid JSON'); } }), async (client) => {
    for (const run of [() => client.extractMenuFromImage('image'), () => client.analyzeMealPhoto('image'), () => client.generateAiMealPlan(planRequest)]) {
      await assert.rejects(run(), error => error.code === 'INTERNAL' && error.status === 200);
    }
  });
});

test('AI features reject unsuccessful payloads even with HTTP 200', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'AI_INVALID_RESPONSE', message: 'Invalid AI output' }), async (client) => {
    for (const run of [() => client.extractMenuFromImage('image'), () => client.analyzeMealPhoto('image'), () => client.generateAiMealPlan(planRequest)]) {
      await assert.rejects(run(), error => error.code === 'AI_INVALID_RESPONSE');
    }
  });
});

test('AI features use a generic error when the server supplies no error details', async () => {
  await withFetch(async () => mockResponse(null, 500), async (client) => {
    for (const run of [() => client.extractMenuFromImage('image'), () => client.analyzeMealPhoto('image'), () => client.generateAiMealPlan(planRequest)]) {
      await assert.rejects(run(), error => error.code === 'INTERNAL' && error.status === 500 && /Something went wrong/.test(error.message));
    }
  });
});

test('AI features use refreshed Firebase ID tokens for each request', async () => {
  let tokenCount = 0;
  const user = { getIdToken: async () => `token-${++tokenCount}` };
  const seen = [];
  await withFetch(async (url, options) => {
    seen.push(options.headers.Authorization);
    return mockResponse({ success: true, items: [], foods: [], meals: [], totals: macros, notes: null });
  }, async () => {
    const client = loadClient(user);
    await client.extractMenuFromImage('menu');
    await client.analyzeMealPhoto('meal');
    await client.generateAiMealPlan(planRequest);
    assert.deepEqual(seen, ['Bearer token-1', 'Bearer token-2', 'Bearer token-3']);
  });
});
