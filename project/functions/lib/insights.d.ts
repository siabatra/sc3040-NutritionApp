export interface InsightStats { breakfastDays: number; targetCalories: number; targetDays: number }
export interface AnalyticsInsight { id: string; title: string; message: string }
export function buildInsights(data: {
  insightStats?: InsightStats; loggedDays: number; mealCount: number;
  actual: { calories: number; protein: number; carbs: number; fat: number };
  actualMissing: { calories: number; protein: number; carbs: number; fat: number };
  mealCountsByLocation: Record<string, number>;
}): AnalyticsInsight[];
