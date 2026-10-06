'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dateKey, validDateKey, periodFor, previousPeriod, dayBounds } = require('../lib/reporting');
const { buildRollup } = require('../lib/aggregate');

const period = periodFor('2026-09-15', 'week');
const asOf = new Date('2026-09-21T01:00:00+08:00');
const nutrition = { calories: 500, protein: 30, carbs: 50, fat: 20 };
const meal = (overrides = {}) => ({ id: 'log1', foodName: 'Chicken rice', ...nutrition, date: new Date('2026-09-15T12:00:00+08:00'), mealType: 'Lunch', ...overrides });
const plan = (overrides = {}) => ({ id: '2026-09-15', slots: [{ id: 'lunch', menuItem: { foodName: 'Chicken rice', ...nutrition } }], ...overrides });

test('Singapore midnight, month/year/leap boundaries and Monday-based weeks', () => {
  assert.equal(dateKey('2026-09-30T16:01:00Z'), '2026-10-01');
  assert.equal(dateKey('2026-09-30T15:59:00Z'), '2026-09-30');
  assert.equal(validDateKey('2026-02-30'), false);
  assert.equal(validDateKey('2024-02-29'), true);
  assert.equal(periodFor('2026-01-01', 'week').startDate, '2025-12-29');
  const feb = periodFor('2024-02-29', 'month');
  assert.equal(feb.endDate, '2024-03-01');
  assert.equal(previousPeriod(feb, -1).startDate, '2024-01-01');
  assert.equal(previousPeriod(feb, 1).startDate, '2024-03-01');
  assert.equal(dayBounds('2026-10-01').start.toISOString(), '2026-09-30T16:00:00.000Z');
});

test('compares intake only on saved-plan days, with macro gaps and meal-type calories', () => {
  const result = buildRollup(period, [meal(), meal({ id: 'snack', date: new Date('2026-09-16T12:00:00+08:00'), mealType: 'snack', calories: 200 })], [plan()], asOf);
  assert.equal(result.actual.calories, 700);
  assert.equal(result.comparableActual.calories, 500);
  assert.equal(result.planned.calories, 500);
  assert.equal(result.gaps.calories, 0);
  assert.equal(result.caloriesByMealType.lunch, 500);
  assert.equal(result.caloriesByMealType.snack, 200);
  assert.equal(result.loggedDays, 2);
  assert.equal(result.daily.length, 7);
});

test('counts distinct linked slots, rejects edited/substituted meals and cross-day links', () => {
  const linked = meal({ planId: '2026-09-15', slotId: 'lunch' });
  assert.equal(buildRollup(period, [linked, { ...linked, id: 'duplicate' }], [plan()], asOf).adherencePercent, 100);
  assert.equal(buildRollup(period, [{ ...linked, calories: 600 }], [plan()], asOf).adherencePercent, 0);
  assert.equal(buildRollup(period, [{ ...linked, foodName: 'Different meal' }], [plan()], asOf).adherencePercent, 0);
  assert.equal(buildRollup(period, [meal()], [plan()], asOf).adherencePercent, 100);
  assert.equal(buildRollup(period, [{ ...linked, date: new Date('2026-09-16T12:00:00+08:00') }], [plan()], asOf).adherencePercent, 0);
});

test('deleted logs and historical edits change rebuilt metrics', () => {
  const result = buildRollup(period, [], [plan()], asOf);
  assert.equal(result.actual.calories, 0);
  assert.equal(result.adherencePercent, 0);
  const edited = buildRollup(period, [meal({ calories: 700, protein: 40 })], [plan()], asOf);
  assert.equal(edited.gaps.calories, 200);
  assert.equal(edited.gaps.protein, 10);
});

test('includes today and excludes future dates from summaries', () => {
  const result = buildRollup(period, [meal()], [plan()], new Date('2026-09-15T23:00:00+08:00'));
  assert.equal(result.actual.calories, 500);
  assert.equal(result.plannedMealCount, 1);
  assert.equal(result.throughDate, '2026-09-15');
  const future = buildRollup(period, [meal({ date: new Date('2026-09-16T12:00:00+08:00') })], [], new Date('2026-09-15T23:00:00+08:00'));
  assert.equal(future.actual.calories, 0);
});

test('missing nutrient values do not become confirmed zero; unaffected metrics survive', () => {
  const result = buildRollup(period, [meal({ protein: undefined, calories: -1, fat: NaN })], [plan()], asOf);
  assert.equal(result.actualMissing.protein, 1);
  assert.equal(result.gaps.protein, null);
  assert.equal(result.gaps.calories, null);
  assert.equal(result.gaps.carbs, 0);
  assert.equal(result.actual.protein, 0);
});

test('legacy erased plan slots make full comparisons unavailable', () => {
  const result = buildRollup(period, [meal()], [plan({ slots: [{ id: 'lunch', menuItem: null }] })], asOf);
  assert.equal(result.legacyMissingPlanCount, 1);
  assert.equal(result.adherencePercent, null);
  assert.equal(result.gaps.calories, null);
  assert.equal(result.actual.calories, 500);
});

test('saved plans with no logs remain visible, logs without plans keep nutrition', () => {
  const plannedOnly = buildRollup(period, [], [plan()], asOf);
  assert.equal(plannedOnly.planned.calories, 500);
  assert.equal(plannedOnly.loggedDays, 0);
  const actualOnly = buildRollup(period, [meal()], [], asOf);
  assert.equal(actualOnly.actual.calories, 500);
  assert.equal(actualOnly.gaps.calories, null);
  assert.equal(actualOnly.adherencePercent, null);
});

test('classifies home, custom and unknown separately and canonicalises meal types', () => {
  const result = buildRollup(period, [meal({ location: { type: 'home' } }), meal({ location: { type: 'custom' }, mealType: ' DINNER ' }), meal({ mealType: 'unexpected' })], [], asOf);
  assert.equal(result.mealCountsByLocation.home, 1);
  assert.equal(result.mealCountsByLocation.custom, 1);
  assert.equal(result.mealCountsByLocation.other, 1);
  assert.equal(result.caloriesByMealType.dinner, 500);
  assert.equal(result.caloriesByMealType.other, 500);
});

test('missing or malformed meal dates do not create misleading historical intake', () => {
  const result = buildRollup(period, [meal({ date: null }), meal({ date: undefined }), meal({ date: 'invalid' })], [], asOf);
  assert.equal(result.actual.calories, 0);
  assert.equal(result.invalidDateCount, 3);
});


test('insights count distinct breakfast days and compare saved targets', () => {
  const result = buildRollup(period, [meal({ mealType: 'Breakfast', location: { type: 'restaurant' } }), meal({ mealType: ' breakfast ', location: { type: 'home' } }), meal({ date: new Date('2026-09-16T12:00:00+08:00'), location: { type: 'custom' } })], [], asOf, { dailyCalorieTarget: 2000 });
  assert.deepEqual(result.insightStats, { breakfastDays: 1, targetCalories: 4000, targetDays: 2 });
  assert.equal(result.insights.length, 4);
  assert.match(result.insights.find((item) => item.id === 'calories').message, /750 kcal/);
  assert.match(result.insights.find((item) => item.id === 'breakfast').message, /1 of 2 logged days/);
  assert.match(result.insights.find((item) => item.id === 'restaurants').message, /1 of 3 recorded meals/);
  assert.match(result.insights.find((item) => item.id === 'macros').message, /protein 24%, carbohydrates 40%, fat 36%/);
});

test('insights explain incomplete nutrition, absent targets and empty logs', () => {
  const partial = buildRollup(period, [meal({ calories: undefined, protein: undefined })], [], asOf, { dailyCalorieTarget: 2000 });
  assert.match(partial.insights.find((item) => item.id === 'calories').message, /lack valid calories/);
  assert.match(partial.insights.find((item) => item.id === 'macros').message, /needed/);
  const noTarget = buildRollup(period, [meal()], [], asOf, { dailyCalorieTarget: -1 });
  assert.match(noTarget.insights[0].message, /Set a daily calorie target/);
  const empty = buildRollup(period, [], [plan()], asOf);
  assert.equal(empty.insights[0].id, 'empty');
  assert.match(empty.insights[0].message, /Missing logs do not establish/);
});


test('daily deviation supports positive and negative trends and suppresses unavailable values', () => {
  const excess = buildRollup(period, [meal({ calories: 700, protein: 20 })], [plan()], asOf);
  const day = excess.daily.find((entry) => entry.date === '2026-09-15');
  assert.equal(day.deviation.calories, 200);
  assert.equal(day.deviation.protein, -10);
  assert.equal(excess.daily.find((entry) => entry.date === '2026-09-16').deviation.calories, null);
  const partial = buildRollup(period, [meal({ calories: undefined })], [plan()], asOf);
  assert.equal(partial.daily.find((entry) => entry.date === '2026-09-15').deviation.calories, null);
  assert.equal(partial.daily.find((entry) => entry.date === '2026-09-15').deviation.protein, 0);
});


test('local worker schedules Singapore 1 am across date boundaries', () => {
  const { nextNightlyRun } = require('../lib/schedule');
  assert.equal(nextNightlyRun(new Date('2026-12-31T00:30:00+08:00')).toISOString(), '2026-12-30T17:00:00.000Z');
  assert.equal(nextNightlyRun(new Date('2026-12-31T01:00:00+08:00')).toISOString(), '2026-12-31T17:00:00.000Z');
});


test('partial legacy plans retain known gaps and adherence from exact manual matches', () => {
  const mixed = plan({ slots: [{ id: 'lost', menuItem: null }, { id: 'lunch', name: 'Lunch', menuItem: { foodName: 'Chicken rice', ...nutrition } }] });
  const result = buildRollup(period, [meal()], [mixed], asOf);
  assert.equal(result.legacyMissingPlanCount, 1);
  assert.equal(result.gaps.calories, 0);
  assert.equal(result.gaps.protein, 0);
  assert.equal(result.adherencePercent, 100);
  const wrongType = buildRollup(period, [meal({ mealType: 'Dinner' })], [mixed], asOf);
  assert.equal(wrongType.adherencePercent, 0);
  const duplicates = plan({ slots: [mixed.slots[1], { ...mixed.slots[1], id: 'second' }] });
  assert.equal(buildRollup(period, [meal()], [duplicates], asOf).followedMealCount, 1);
});


test('daily and calendar-year periods include a single logged/planned meal', () => {
  const day = periodFor('2026-09-15', 'day');
  assert.equal(day.endDate, '2026-09-16');
  const year = periodFor('2026-09-15', 'year');
  assert.equal(year.startDate, '2026-01-01'); assert.equal(year.endDate, '2027-01-01');
  assert.equal(previousPeriod(year, 1).startDate, '2027-01-01');
  for (const selected of [day, year]) {
    const result = buildRollup(selected, [meal()], [plan()], asOf);
    assert.equal(result.actual.calories, 500); assert.equal(result.planned.calories, 500);
    assert.equal(result.gaps.protein, 0); assert.equal(result.adherencePercent, 100);
    assert.equal(result.daily.filter((entry) => entry.mealCount).length, 1);
  }
});
