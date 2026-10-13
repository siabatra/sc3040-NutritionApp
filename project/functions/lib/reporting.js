'use strict';

const TIME_ZONE = 'Asia/Singapore';
const METRICS = ['calories', 'protein', 'carbs', 'fat'];

function dateKey(value = new Date()) {
  if (value === null) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function validDateKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)
    && Number.isFinite(new Date(`${key}T00:00:00Z`).getTime())
    && new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key;
}

function shiftDate(key, days) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodFor(key, type) {
  if (!validDateKey(key) || !['day', 'week', 'month', 'year'].includes(type)) throw new Error('Invalid reporting period');
  let startDate;
  let endDate;
  if (type === 'day') {
    startDate = key; endDate = shiftDate(key, 1);
  } else if (type === 'year') {
    startDate = `${key.slice(0, 4)}-01-01`; endDate = `${Number(key.slice(0, 4)) + 1}-01-01`;
  } else if (type === 'week') {
    const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
    startDate = shiftDate(key, -((weekday + 6) % 7));
    endDate = shiftDate(startDate, 7);
  } else {
    startDate = `${key.slice(0, 7)}-01`;
    const next = new Date(`${startDate}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    endDate = next.toISOString().slice(0, 10);
  }
  return { id: `${type}-${startDate}`, type, startDate, endDate };
}

function previousPeriod(period, direction) {
  return periodFor(direction < 0 ? shiftDate(period.startDate, -1) : period.endDate, period.type);
}

function dayBounds(key) {
  return { start: new Date(`${key}T00:00:00+08:00`), end: new Date(`${shiftDate(key, 1)}T00:00:00+08:00`) };
}

function normaliseMealType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['breakfast', 'lunch', 'dinner', 'snack'].includes(type) ? type : 'other';
}

function emptyNutrition() {
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

module.exports = { TIME_ZONE, METRICS, dateKey, validDateKey, shiftDate, periodFor, previousPeriod, dayBounds, normaliseMealType, emptyNutrition };
