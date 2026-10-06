import type { InsightStats, AnalyticsInsight } from '../functions/lib/insights';
import type { ReportingPeriod } from '../functions/lib/reporting';

export type AnalyticsPeriodType = 'day' | 'week' | 'month' | '3months' | 'year';
export interface AnalyticsPeriod extends Omit<ReportingPeriod, 'type'> { type: AnalyticsPeriodType }

export type NutritionMetric = 'calories' | 'protein' | 'carbs' | 'fat';
export type NutritionValues = Record<NutritionMetric, number>;
export interface AnalyticsDay {
  deviation?: Record<NutritionMetric, number | null>;
  date: string;
  actual: NutritionValues;
  planned: NutritionValues;
  actualMissing: NutritionValues;
  plannedMissing: NutritionValues;
  mealCount: number;
  plannedMealCount: number;
  followedMealCount: number;
  linkedMealCount: number;
  hasPlan: boolean;
  legacyMissingPlanCount: number;
}
export interface AnalyticsRollup extends AnalyticsPeriod {
  schemaVersion: number;
  insightsVersion?: number;
  insightStats?: InsightStats;
  insights?: AnalyticsInsight[];
  timeZone: string;
  throughDate: string | null;
  updatedAt: Date | null;
  actual: NutritionValues;
  planned: NutritionValues;
  comparableActual: NutritionValues;
  gaps: Record<NutritionMetric, number | null>;
  actualMissing: NutritionValues;
  plannedMissing: NutritionValues;
  comparableActualMissing: NutritionValues;
  loggedDays: number;
  plannedDays: number;
  comparableDays: number;
  mealCount: number;
  plannedMealCount: number;
  followedMealCount: number;
  linkedMealCount: number;
  legacyMissingPlanCount: number;
  adherencePercent: number | null;
  caloriesByMealType: Record<string, number>;
  mealCountsByType: Record<string, number>;
  mealCountsByLocation: Record<string, number>;
  daily: AnalyticsDay[];
  missingRollupCount?: number;
}
