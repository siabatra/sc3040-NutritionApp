'use strict';

const { buildInsights } = require('./insights');
const { METRICS, dateKey, validDateKey, shiftDate, normaliseMealType, emptyNutrition, TIME_ZONE } = require('./reporting');

function nutritionOf(record) {
  const nutrition = {};
  for (const metric of METRICS) {
    const value = record?.[metric];
    nutrition[metric] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }
  return nutrition;
}

function addNutrition(total, values, missing) {
  for (const metric of METRICS) {
    if (values[metric] === null) missing[metric] += 1;
    else total[metric] += values[metric];
  }
}

function samePlannedMeal(log, item) {
  const name = (value) => String(value || '').trim().toLowerCase();
  if (!name(log.foodName) || name(log.foodName) !== name(item.foodName)) return false;
  const actual = nutritionOf(log);
  const planned = nutritionOf(item);
  return METRICS.every((metric) => actual[metric] !== null && planned[metric] !== null
    && Math.abs(actual[metric] - planned[metric]) < 0.01);
}

function planDate(plan) {
  return validDateKey(plan.reportingDate) ? plan.reportingDate : validDateKey(plan.id) ? plan.id : null;
}

function buildRollup(period, logs, plans, asOf = new Date(), profile = {}) {
  const today = dateKey(asOf);
  const tomorrow = shiftDate(today, 1);
  const cutoff = tomorrow < period.endDate ? tomorrow : period.endDate;
  const daily = new Map();
  for (let key = period.startDate; key < cutoff; key = shiftDate(key, 1)) {
    daily.set(key, {
      date: key, actual: emptyNutrition(), planned: emptyNutrition(),
      actualMissing: emptyNutrition(), plannedMissing: emptyNutrition(),
      mealCount: 0, plannedMealCount: 0, followedMealCount: 0, linkedMealCount: 0,
      hasPlan: false, legacyMissingPlanCount: 0,
    });
  }
  const caloriesByMealType = { breakfast: 0, lunch: 0, dinner: 0, snack: 0, other: 0 };
  const mealCountsByType = { breakfast: 0, lunch: 0, dinner: 0, snack: 0, other: 0 };
  const mealCountsByLocation = { restaurant: 0, home: 0, custom: 0, other: 0 };
  const inPeriodLogs = [];
  let invalidDateCount = 0;
  for (const log of logs) {
    const key = log.date == null ? null : dateKey(log.date);
    if (!key) { invalidDateCount += 1; continue; }
    const day = daily.get(key);
    if (!day) continue;
    const values = nutritionOf(log);
    addNutrition(day.actual, values, day.actualMissing);
    day.mealCount += 1;
    const type = normaliseMealType(log.mealType);
    caloriesByMealType[type] += values.calories ?? 0;
    mealCountsByType[type] += 1;
    const location = log.location?.type;
    mealCountsByLocation[Object.hasOwn(mealCountsByLocation, location) ? location : 'other'] += 1;
    inPeriodLogs.push({ ...log, reportingDate: key });
  }
  const logsBySlot = new Map();
  for (const log of inPeriodLogs) {
    if (!log.planId || !log.slotId) continue;
    const key = `${log.planId}/${log.slotId}`;
    if (!logsBySlot.has(key)) logsBySlot.set(key, []);
    logsBySlot.get(key).push(log);
  }
  const matchedLogs = new Set();
  for (const plan of plans) {
    const day = daily.get(planDate(plan));
    if (!day) continue;
    day.hasPlan = true;
    const seenSlots = new Set();
    for (const slot of Array.isArray(plan.slots) ? plan.slots : []) {
      if (seenSlots.has(slot.id)) continue;
      seenSlots.add(slot.id);
      if (!slot.menuItem) { day.legacyMissingPlanCount += 1; continue; }
      day.plannedMealCount += 1;
      addNutrition(day.planned, nutritionOf(slot.menuItem), day.plannedMissing);
      const linked = (logsBySlot.get(`${plan.id}/${slot.id}`) || []).filter((log) => log.reportingDate === day.date);
      if (linked.length) day.linkedMealCount += 1;
      const candidate = linked.find((log) => !matchedLogs.has(log.id) && samePlannedMeal(log, slot.menuItem))
        || inPeriodLogs.find((log) => !log.planId && !log.slotId && !matchedLogs.has(log.id)
          && log.reportingDate === day.date && samePlannedMeal(log, slot.menuItem)
          && (normaliseMealType(slot.name) === 'other' || normaliseMealType(log.mealType) === normaliseMealType(slot.name)));
      if (candidate) { day.followedMealCount += 1; matchedLogs.add(candidate.id); }
    }
  }
  const actual = emptyNutrition();
  const planned = emptyNutrition();
  const comparableActual = emptyNutrition();
  const actualMissing = emptyNutrition();
  const plannedMissing = emptyNutrition();
  const comparableActualMissing = emptyNutrition();
  let loggedDays = 0, plannedDays = 0, comparableDays = 0;
  let mealCount = 0, plannedMealCount = 0, followedMealCount = 0, linkedMealCount = 0, legacyMissingPlanCount = 0;
  const points = [...daily.values()];
  for (const day of points) {
    day.deviation = Object.fromEntries(METRICS.map((metric) => [metric,
      day.plannedMealCount && !day.actualMissing[metric] && !day.plannedMissing[metric]
        ? day.actual[metric] - day.planned[metric] : null,
    ]));
  }
  for (const day of points) {
    if (day.mealCount) loggedDays += 1;
    if (day.hasPlan) plannedDays += 1;
    if (day.hasPlan && day.plannedMealCount) {
      comparableDays += 1;
      for (const metric of METRICS) {
        comparableActual[metric] += day.actual[metric];
        comparableActualMissing[metric] += day.actualMissing[metric];
      }
    }
    for (const metric of METRICS) {
      actual[metric] += day.actual[metric]; planned[metric] += day.planned[metric];
      actualMissing[metric] += day.actualMissing[metric]; plannedMissing[metric] += day.plannedMissing[metric];
    }
    mealCount += day.mealCount; plannedMealCount += day.plannedMealCount;
    followedMealCount += day.followedMealCount; linkedMealCount += day.linkedMealCount;
    legacyMissingPlanCount += day.legacyMissingPlanCount;
  }
  const gaps = {};
  for (const metric of METRICS) {
    gaps[metric] = comparableDays && !plannedMissing[metric] && !comparableActualMissing[metric] ? comparableActual[metric] - planned[metric] : null;
  }
  const target = profile.dailyCalorieTarget;
  const hasTarget = typeof target === 'number' && Number.isFinite(target) && target > 0;
  const insightStats = {
    breakfastDays: new Set(inPeriodLogs.filter((log) => normaliseMealType(log.mealType) === 'breakfast').map((log) => log.reportingDate)).size,
    targetCalories: hasTarget ? target * loggedDays : 0, targetDays: hasTarget ? loggedDays : 0,
  };
  const result = {
    insightsVersion: 1, insightStats,
    schemaVersion: 1, ...period, timeZone: TIME_ZONE, throughDate: points.at(-1)?.date ?? null,
    actual, planned, comparableActual, gaps, actualMissing, plannedMissing, comparableActualMissing,
    loggedDays, plannedDays, comparableDays, mealCount, plannedMealCount, followedMealCount, linkedMealCount,
    legacyMissingPlanCount, invalidDateCount,
    adherencePercent: plannedMealCount ? followedMealCount / plannedMealCount * 100 : null,
    caloriesByMealType, mealCountsByType, mealCountsByLocation, daily: points,
  };
  result.insights = buildInsights(result);
  return result;
}

module.exports = { buildRollup, nutritionOf, samePlannedMeal, planDate };
