import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { dateKey, normaliseMealType } from '../functions/lib/reporting';
import type { MealSlot } from '../types/mealPlanner';

export async function saveDailyPlan(uid: string, slots: MealSlot[], dietaryPreferences?: string[]) {
  const reportingDate = dateKey()!;
  const ref = doc(db, 'users', uid, 'plans', reportingDate);
  return runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);
    const oldSlots: MealSlot[] = existing.data()?.slots || [];
    // Completed slots keep their original planned values even if the rest is regenerated.
    const completed = oldSlots.filter((slot) => slot.loggedMealId);
    const matches = (left: MealSlot, right: MealSlot) => left.id === right.id
      || (normaliseMealType(left.name) !== 'other' && normaliseMealType(left.name) === normaliseMealType(right.name));
    const savedSlots = [
      ...slots.map((slot) => completed.find((old) => matches(old, slot)) || slot),
      ...completed.filter((old) => !slots.some((slot) => matches(old, slot))),
    ];
    transaction.set(ref, {
      slots: savedSlots, reportingDate, schemaVersion: 2,
      timeZone: 'Asia/Singapore', createdAt: existing.data()?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(dietaryPreferences ? { dietaryPreferences } : {}),
    }, { merge: true });
    return savedSlots;
  });
}

export async function logDailyPlanMeal(uid: string, slotId: string) {
  const planId = dateKey()!;
  const planRef = doc(db, 'users', uid, 'plans', planId);
  const mealRef = doc(collection(db, 'mealLogs'));
  return runTransaction(db, async (transaction) => {
    const plan = await transaction.get(planRef);
    const slots: MealSlot[] = plan.data()?.slots || [];
    const slot = slots.find((entry) => entry.id === slotId);
    if (!slot?.menuItem) throw new Error('This planned meal is no longer available. Reload your plan.');
    if (slot.loggedMealId) return slots;
    const item = slot.menuItem;
    transaction.set(mealRef, {
      userId: uid, foodName: item.foodName, calories: item.calories,
      protein: item.protein ?? 0, carbs: item.carbs ?? 0, fat: item.fat ?? 0,
      date: new Date(), createdAt: serverTimestamp(),
      mealType: normaliseMealType(slot.name), planId, slotId,
      location: slot.locationType === 'home'
        ? { name: 'Home', type: 'home' }
        : { name: slot.restaurantName || item.restaurantName || item.location?.name || 'Restaurant', type: 'restaurant', placeId: slot.restaurantId || '', address: item.restaurantAddress || item.location?.address || '' },
    });
    const updated = slots.map((entry) => entry.id === slotId ? { ...entry, loggedMealId: mealRef.id } : entry);
    transaction.update(planRef, { slots: updated, updatedAt: serverTimestamp() });
    return updated;
  });
}

export async function deleteMealLog(uid: string, mealId: string) {
  const mealRef = doc(db, 'mealLogs', mealId);
  return runTransaction(db, async (transaction) => {
    const meal = await transaction.get(mealRef);
    if (!meal.exists()) return;
    const data = meal.data();
    if (data.userId !== uid) throw new Error('You can only delete your own meals.');
    const planRef = typeof data.planId === 'string' && typeof data.slotId === 'string'
      ? doc(db, 'users', uid, 'plans', data.planId) : null;
    const plan = planRef ? await transaction.get(planRef) : null;
    if (plan?.exists() && planRef) {
      const slots: MealSlot[] = plan.data().slots || [];
      const updated = slots.map((slot) => {
        if (slot.id !== data.slotId || slot.loggedMealId !== mealId) return slot;
        const remaining = { ...slot };
        delete remaining.loggedMealId;
        return remaining;
      });
      transaction.update(planRef, { slots: updated, updatedAt: serverTimestamp() });
    }
    transaction.delete(mealRef);
  });
}
