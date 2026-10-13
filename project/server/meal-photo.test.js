'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, mockResponse, withFetch, macros, planRequest } = require('./ai-test-helper');

test('photo meal logging sends authenticated photo and returns detected nutrition', async () => {
  const foods = [{ name: 'Chicken rice', ...macros }];
  await withFetch(async (url, options) => {
    assert.equal(url, 'http://localhost:3000/ai/analyze-meal-photo');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), { imageBase64: 'meal-image', mediaType: 'image/jpeg' });
    return mockResponse({ success: true, foods, totals: macros });
  }, async ({ analyzeMealPhoto }) => {
    assert.deepEqual(await analyzeMealPhoto('meal-image'), { success: true, foods, totals: macros });
  });
});

test('photo meal logging reports food identification failures', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'FOOD_NOT_IDENTIFIED', message: 'Food not identified' }, 422), async ({ analyzeMealPhoto }) => {
    await assert.rejects(analyzeMealPhoto('unclear-image'), error => error.code === 'FOOD_NOT_IDENTIFIED' && error.shouldOfferManualEntry);
  });
});

test('photo logging preserves separate foods and nutrition totals', async () => {
  const foods = [
    { name: 'Rice', calories: 200, protein: 4, carbs: 44, fat: 1 },
    { name: 'Chicken', calories: 250, protein: 30, carbs: 0, fat: 14 }
  ];
  const totals = { calories: 450, protein: 34, carbs: 44, fat: 15 };
  await withFetch(async () => mockResponse({ success: true, foods, totals }), async ({ analyzeMealPhoto }) => {
    assert.deepEqual(await analyzeMealPhoto('photo', 'image/png'), { success: true, foods, totals });
  });
});

test('photo logging sends selected image media type', async () => {
  await withFetch(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body), { imageBase64: 'webp-photo', mediaType: 'image/webp' });
    return mockResponse({ success: true, foods: [], totals: macros });
  }, async ({ analyzeMealPhoto }) => {
    await analyzeMealPhoto('webp-photo', 'image/webp');
  });
});

test('photo logging reports unreadable images without offering manual entry for this code', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'IMAGE_ILLEGIBLE', message: 'Unreadable' }, 422), async ({ analyzeMealPhoto }) => {
    await assert.rejects(analyzeMealPhoto('blurred'), error => error.code === 'IMAGE_ILLEGIBLE' && !error.shouldOfferManualEntry);
  });
});

test('photo logging offers manual entry when AI is unavailable', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'AI_UNAVAILABLE', message: 'Unavailable' }, 503), async ({ analyzeMealPhoto }) => {
    await assert.rejects(analyzeMealPhoto('photo'), error => error.code === 'AI_UNAVAILABLE' && error.shouldOfferManualEntry);
  });
});

test('photo logging offers manual entry when AI is busy', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'AI_BUSY', message: 'Busy' }, 429), async ({ analyzeMealPhoto }) => {
    await assert.rejects(analyzeMealPhoto('photo'), error => error.code === 'AI_BUSY' && error.shouldOfferManualEntry);
  });
});

test('photo logging preserves low-confidence foods for user review', async () => {
  const foods = [{ name: 'Unknown curry', servingDescription: 'one bowl', estimatedGrams: 300, confidence: 'low', usdaSearchTerms: ['curry'], verified: false, ...macros }];
  await withFetch(async () => mockResponse({ success: true, foods, totals: macros }), async ({ analyzeMealPhoto }) => {
    assert.deepEqual((await analyzeMealPhoto('photo')).foods, foods);
  });
});

test('photo logging reports an unconfigured AI and offers manual entry', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'AI_NOT_CONFIGURED', message: 'AI unavailable' }, 503), async ({ analyzeMealPhoto }) => {
    await assert.rejects(analyzeMealPhoto('photo'), error => error.code === 'AI_NOT_CONFIGURED' && error.shouldOfferManualEntry);
  });
});
