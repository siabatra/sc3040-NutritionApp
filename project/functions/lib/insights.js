'use strict';

// Descriptive observations about recorded meals, never inferred missing intake.
function buildInsights(data) {
  if (!data.insightStats) return [];
  const { breakfastDays, targetCalories, targetDays } = data.insightStats;
  const insights = [];
  const add = (id, title, message) => insights.push({ id, title, message });
  const round = (value) => Math.round(value);
  if (!data.loggedDays) {
    add('empty', 'No recorded meals', 'Log meals to see personalised insights. Missing logs do not establish whether a meal was eaten.');
    return insights;
  }
  if (targetDays === data.loggedDays && targetCalories > 0 && !data.actualMissing.calories) {
    const average = round(data.actual.calories / data.loggedDays);
    const target = round(targetCalories / targetDays);
    const difference = round(data.actual.calories / targetCalories * 100 - 100);
    add('calories', 'Calorie target', `Recorded intake averages ${average} kcal per logged day, ${difference === 0 ? 'approximately equal to' : `${Math.abs(difference)}% ${difference < 0 ? 'below' : 'above'}`} the saved target average of ${target} kcal. Targets reflect the profile at each summary update; unlogged intake is unknown.`);
  } else {
    add('calories', 'Calorie target', data.actualMissing.calories ? 'Some recorded meals lack valid calories, so a full target comparison is unavailable.' : 'Set a daily calorie target in your profile to enable this comparison after the nightly update.');
  }
  const energy = { protein: data.actual.protein * 4, carbs: data.actual.carbs * 4, fat: data.actual.fat * 9 };
  const total = energy.protein + energy.carbs + energy.fat;
  if (total > 0 && !['protein', 'carbs', 'fat'].some((metric) => data.actualMissing[metric])) {
    add('macros', 'Macro distribution', `Recorded macro energy: protein ${round(energy.protein / total * 100)}%, carbohydrates ${round(energy.carbs / total * 100)}%, fat ${round(energy.fat / total * 100)}%.`);
  } else add('macros', 'Macro distribution', 'Complete protein, carbohydrate and fat values are needed for a full macro insight.');
  add('breakfast', 'Breakfast logging', `Breakfast was recorded on ${breakfastDays} of ${data.loggedDays} logged days (${round(breakfastDays / data.loggedDays * 100)}%). Days without a breakfast log do not prove breakfast was skipped.`);
  const restaurant = data.mealCountsByLocation.restaurant || 0;
  const unknown = data.mealCountsByLocation.other || 0;
  add('restaurants', 'Restaurant frequency', `${restaurant} of ${data.mealCount} recorded meals (${round(restaurant / data.mealCount * 100)}%) were tagged restaurant. ${unknown} had an unknown location; home and custom meals are counted separately.`);
  return insights;
}
module.exports = { buildInsights };
