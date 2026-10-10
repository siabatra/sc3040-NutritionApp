import { buildInsights } from '../functions/lib/insights';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { AnalyticsPeriod, AnalyticsPeriodType, AnalyticsRollup } from '../types/analytics';
import { METRICS, emptyNutrition, periodFor, shiftDate } from '../functions/lib/reporting';

export function analyticsPeriodFor(key: string, type: AnalyticsPeriodType): AnalyticsPeriod {
  if (type !== '3months') return periodFor(key, type);
  const month = periodFor(key, 'month');
  const start = new Date(`${month.startDate}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - (type === '3months' ? 2 : 11));
  const startDate = start.toISOString().slice(0, 10);
  return { id: `${type}-${startDate}`, type, startDate, endDate: month.endDate };
}

export function adjacentAnalyticsPeriod(period: AnalyticsPeriod, direction: number): AnalyticsPeriod {
  if (period.type !== '3months') {
    return analyticsPeriodFor(direction < 0 ? shiftDate(period.startDate, -1) : period.endDate, period.type);
  }
  // Anchor a multi-month window at its last month, moving by a whole window.
  const anchor = new Date(`${shiftDate(period.endDate, -1)}T00:00:00Z`);
  anchor.setUTCDate(1);
  anchor.setUTCMonth(anchor.getUTCMonth() + (direction < 0 ? -1 : 1) * (period.type === '3months' ? 3 : 12));
  return analyticsPeriodFor(anchor.toISOString().slice(0, 10), period.type);
}

function combineSummaries(period: AnalyticsPeriod, summaries: (AnalyticsRollup | null)[]): AnalyticsRollup | null {
  const available = summaries.filter((summary): summary is AnalyticsRollup => summary !== null);
  if (!available.length) return null;
  const result: AnalyticsRollup = {
    ...available[0], ...period, actual: emptyNutrition(), planned: emptyNutrition(), comparableActual: emptyNutrition(),
    actualMissing: emptyNutrition(), plannedMissing: emptyNutrition(), comparableActualMissing: emptyNutrition(),
    gaps: { calories: null, protein: null, carbs: null, fat: null },
    loggedDays: 0, plannedDays: 0, comparableDays: 0, mealCount: 0, plannedMealCount: 0,
    followedMealCount: 0, linkedMealCount: 0, legacyMissingPlanCount: 0, adherencePercent: null,
    caloriesByMealType: {}, mealCountsByType: {}, mealCountsByLocation: {}, daily: [],
    missingRollupCount: summaries.length - available.length,
  };
  result.insightStats = available.every((summary) => summary.insightsVersion === 1 && summary.insightStats) ? { breakfastDays: 0, targetCalories: 0, targetDays: 0 } : undefined;
  result.insightsVersion = result.insightStats ? 1 : undefined;
  for (const summary of available) {
    if (result.insightStats && summary.insightStats) {
      for (const field of ['breakfastDays', 'targetCalories', 'targetDays'] as const) result.insightStats[field] += summary.insightStats[field];
    }
    for (const metric of METRICS) {
      for (const field of ['actual', 'planned', 'comparableActual', 'actualMissing', 'plannedMissing', 'comparableActualMissing'] as const) result[field][metric] += summary[field][metric];
    }
    for (const field of ['loggedDays', 'plannedDays', 'comparableDays', 'mealCount', 'plannedMealCount', 'followedMealCount', 'linkedMealCount', 'legacyMissingPlanCount'] as const) result[field] += summary[field];
    for (const field of ['caloriesByMealType', 'mealCountsByType', 'mealCountsByLocation'] as const) {
      for (const [name, value] of Object.entries(summary[field])) result[field][name] = (result[field][name] || 0) + value;
    }
    result.daily.push(...summary.daily);
    if (!summary.updatedAt || (result.updatedAt && summary.updatedAt < result.updatedAt)) result.updatedAt = summary.updatedAt;
  }
  result.daily.sort((a, b) => a.date.localeCompare(b.date));
  result.throughDate = result.daily[result.daily.length - 1]?.date || null;
  for (const metric of METRICS) {
    if (result.comparableDays && !result.plannedMissing[metric] && !result.comparableActualMissing[metric]) {
      result.gaps[metric] = result.comparableActual[metric] - result.planned[metric];
    }
  }
  if (result.plannedMealCount) result.adherencePercent = result.followedMealCount / result.plannedMealCount * 100;
  result.insights = buildInsights(result);
  return result;
}

export async function fetchAnalyticsRollup(uid: string, period: AnalyticsPeriod): Promise<AnalyticsRollup | null> {
  if (period.type === '3months') {
    const months = [];
    for (let start = period.startDate; start < period.endDate;) {
      const month = periodFor(start, 'month');
      months.push(month);
      start = month.endDate;
    }
    return combineSummaries(period, await Promise.all(months.map((month) => fetchAnalyticsRollup(uid, month))));
  }
  const snapshot = await getDoc(doc(db, 'users', uid, 'analytics', period.id));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.schemaVersion !== 1 || data.id !== period.id || !Array.isArray(data.daily)) {
    throw new Error('Unsupported analytics summary');
  }
  return {
    ...data,
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : null,
  } as AnalyticsRollup;
}


export function subscribeAnalyticsRollup(uid: string, period: AnalyticsPeriod,
  onChange: (summary: AnalyticsRollup | null) => void, onError: (error: Error) => void): () => void {
  const periods: AnalyticsPeriod[] = [];
  if (period.type !== '3months') periods.push(period);
  else for (let start = period.startDate; start < period.endDate;) {
    const month = periodFor(start, 'month'); periods.push(month); start = month.endDate;
  }
  const summaries: (AnalyticsRollup | null)[] = periods.map(() => null);
  const ready = new Set<number>(); let active = true;
  const stops = periods.map((selected, index) => onSnapshot(doc(db, 'users', uid, 'analytics', selected.id), (snapshot) => {
    if (!active) return;
    try {
      const data = snapshot.data();
      if (data && (data.schemaVersion !== 1 || data.id !== selected.id || !Array.isArray(data.daily))) throw new Error('Unsupported analytics summary');
      summaries[index] = data ? { ...data, updatedAt: data.updatedAt?.toDate?.() || null } as AnalyticsRollup : null;
      ready.add(index);
      if (ready.size === periods.length) onChange(periods.length === 1 ? summaries[0] : combineSummaries(period, summaries));
    } catch (error) { onError(error instanceof Error ? error : new Error('Invalid summary')); }
  }, (error) => { if (active) onError(error); }));
  return () => { active = false; stops.forEach((stop) => stop()); };
}
