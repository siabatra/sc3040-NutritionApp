export type PeriodType = 'day' | 'week' | 'month' | 'year';
export interface ReportingPeriod { id: string; type: PeriodType; startDate: string; endDate: string }
export const TIME_ZONE: string;
export const METRICS: readonly ['calories', 'protein', 'carbs', 'fat'];
export function dateKey(value?: Date | string | { toDate(): Date }): string | null;
export function validDateKey(key: unknown): key is string;
export function shiftDate(key: string, days: number): string;
export function periodFor(key: string, type: PeriodType): ReportingPeriod;
export function previousPeriod(period: ReportingPeriod, direction: number): ReportingPeriod;
export function dayBounds(key: string): { start: Date; end: Date };
export function normaliseMealType(value?: string | null): string;
export function emptyNutrition(): { calories: number; protein: number; carbs: number; fat: number };
