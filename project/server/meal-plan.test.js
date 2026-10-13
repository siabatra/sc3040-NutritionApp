'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, mockResponse, withFetch, macros, planRequest } = require('./ai-test-helper');

test('daily meal plan generation submits preferences and returns meals', async () => {
  const meals = [{ slotId: 'lunch', dishName: 'Vegetable rice', ...macros }];
  await withFetch(async (url, options) => {
    assert.equal(url, 'http://localhost:3000/ai/meal-plan');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(options.body), planRequest);
    return mockResponse({ success: true, meals, totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    assert.deepEqual((await generateAiMealPlan(planRequest)).meals, meals);
  });
});

test('daily meal plan regeneration sends the previous plan and feedback', async () => {
  const request = { ...planRequest, feedback: 'More variety', previousPlan: [{ slotId: 'lunch', dishName: 'Vegetable rice' }] };
  await withFetch(async (url, options) => {
    assert.equal(url, 'http://localhost:3000/ai/meal-plan');
    assert.deepEqual(JSON.parse(options.body), request);
    return mockResponse({ success: true, meals: [], totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    await generateAiMealPlan(request);
  });
});

test('meal plan generation forwards multiple slots and restaurant candidates unchanged', async () => {
  const request = {
    ...planRequest,
    slots: [planRequest.slots[0], { id: 'dinner', name: 'Dinner', startTime: '18:00', endTime: '20:00', locationType: 'restaurant' }],
    candidates: [{ id: 'r1', foodName: 'Salad', restaurantId: 'store1', restaurantName: 'Cafe', calories: 350, protein: 12, carbs: 40, fat: 15 }]
  };
  await withFetch(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body), request);
    return mockResponse({ success: true, meals: [], totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    await generateAiMealPlan(request);
  });
});

test('meal plan generation forwards dietary exclusions', async () => {
  const request = { ...planRequest, exclusions: ['peanuts', 'shellfish'] };
  await withFetch(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).exclusions, ['peanuts', 'shellfish']);
    return mockResponse({ success: true, meals: [], totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    await generateAiMealPlan(request);
  });
});

test('meal plan regeneration preserves feedback and all previous meal slots', async () => {
  const previousPlan = [{ slotId: 'breakfast', dishName: 'Toast' }, { slotId: 'dinner', dishName: 'Pasta' }];
  const request = { ...planRequest, feedback: 'Avoid repeating meals', previousPlan };
  await withFetch(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).previousPlan, previousPlan);
    assert.equal(JSON.parse(options.body).feedback, 'Avoid repeating meals');
    return mockResponse({ success: true, meals: [], totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    await generateAiMealPlan(request);
  });
});

test('meal plan generation preserves returned nutritional totals and notes', async () => {
  const result = { success: true, meals: [{ slotId: 'lunch', dishName: 'Salad' }], totals: macros, notes: 'Estimated values' };
  await withFetch(async () => mockResponse(result), async ({ generateAiMealPlan }) => {
    assert.deepEqual(await generateAiMealPlan(planRequest), result);
  });
});

test('meal plan generation reports insufficient options', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'INSUFFICIENT_OPTIONS', message: 'Not enough choices' }, 422), async ({ generateAiMealPlan }) => {
    await assert.rejects(generateAiMealPlan(planRequest), error => error.code === 'INSUFFICIENT_OPTIONS' && error.status === 422);
  });
});

test('meal plan generation reports invalid requests', async () => {
  await withFetch(async () => mockResponse({ success: false, code: 'INVALID_REQUEST', message: 'Invalid slots' }, 400), async ({ generateAiMealPlan }) => {
    await assert.rejects(generateAiMealPlan({ ...planRequest, slots: [] }), error => error.code === 'INVALID_REQUEST' && error.status === 400);
  });
});

test('meal plan generation preserves zero remaining calories in the request', async () => {
  const request = { ...planRequest, remainingCalories: 0 };
  await withFetch(async (url, options) => {
    assert.equal(JSON.parse(options.body).remainingCalories, 0);
    return mockResponse({ success: true, meals: [], totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    await generateAiMealPlan(request);
  });
});

test('meal plan regeneration preserves an empty feedback string', async () => {
  const request = { ...planRequest, feedback: '', previousPlan: [{ slotId: 'lunch', dishName: 'Soup' }] };
  await withFetch(async (url, options) => {
    assert.deepEqual(JSON.parse(options.body), request);
    return mockResponse({ success: true, meals: [], totals: macros, notes: null });
  }, async ({ generateAiMealPlan }) => {
    await generateAiMealPlan(request);
  });
});
