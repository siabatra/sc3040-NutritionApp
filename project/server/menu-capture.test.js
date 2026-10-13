'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, mockResponse, withFetch, macros, planRequest } = require('./ai-test-helper');

test('restaurant menu capture sends authenticated image and returns extracted items', async () => {
  const items = [{ name: 'Vegetable rice', price: 8 }];
  await withFetch(async (url, options) => {
    assert.equal(url, 'http://localhost:3000/ai/extract-menu');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), { imageBase64: 'menu-image', mediaType: 'image/png' });
    return mockResponse({ success: true, items });
  }, async ({ extractMenuFromImage }) => {
    assert.deepEqual((await extractMenuFromImage('menu-image', 'image/png')).items, items);
  });
});

test('restaurant menu capture reports unreadable images', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'IMAGE_ILLEGIBLE', message: 'Image cannot be read' }, 422), async ({ extractMenuFromImage }) => {
    await assert.rejects(extractMenuFromImage('blurred-image'), error => error.code === 'IMAGE_ILLEGIBLE' && error.status === 422);
  });
});

test('menu extraction defaults to JPEG and preserves multiple extracted items', async () => {
  const items = [
    { name: 'Noodles', description: 'Spicy', price: 6, components: ['noodles'], estimatedPortionGrams: 250, verified: false },
    { name: 'Soup', description: null, price: null, components: ['vegetables'], estimatedPortionGrams: null, verified: false }
  ];
  await withFetch(async (url, options) => {
    assert.equal(JSON.parse(options.body).mediaType, 'image/jpeg');
    return mockResponse({ success: true, items });
  }, async ({ extractMenuFromImage }) => {
    assert.deepEqual((await extractMenuFromImage('photo')).items, items);
  });
});

test('menu extraction accepts an empty successful item list', async () => {
  await withFetch(async () => mockResponse({ success: true, items: [] }), async ({ extractMenuFromImage }) => {
    assert.deepEqual((await extractMenuFromImage('menu')).items, []);
  });
});

test('menu extraction propagates no-items-found errors', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'NO_ITEMS_FOUND', message: 'No dishes detected' }, 422), async ({ extractMenuFromImage }) => {
    await assert.rejects(extractMenuFromImage('blank-menu'), error => error.code === 'NO_ITEMS_FOUND' && error.status === 422);
  });
});

test('menu extraction propagates image size errors', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'IMAGE_TOO_LARGE', message: 'Image too large' }, 413), async ({ extractMenuFromImage }) => {
    await assert.rejects(extractMenuFromImage('large-menu'), error => error.code === 'IMAGE_TOO_LARGE' && error.status === 413);
  });
});

test('menu capture sends a GIF image without changing its encoded contents', async () => {
  await withFetch(async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { imageBase64: 'encoded-menu==', mediaType: 'image/gif' });
    return mockResponse({ success: true, items: [] });
  }, async ({ extractMenuFromImage }) => {
    await extractMenuFromImage('encoded-menu==', 'image/gif');
  });
});

test('menu capture preserves the server error message and HTTP status', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'AI_REFUSED', message: 'Unable to process menu' }, 403), async ({ extractMenuFromImage }) => {
    await assert.rejects(extractMenuFromImage('menu'), error => error.name === 'AiServiceError' && error.code === 'AI_REFUSED' && error.status === 403 && error.message === 'Unable to process menu');
  });
});
