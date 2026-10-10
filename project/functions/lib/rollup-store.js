'use strict';

const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');
const { buildRollup, planDate } = require('./aggregate');
const { dateKey, periodFor, validDateKey, dayBounds } = require('./reporting');

async function readAll(query) {
  const documents = [];
  let cursor;
  do {
    let page = query.orderBy(FieldPath.documentId()).limit(500);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    documents.push(...snapshot.docs);
    cursor = snapshot.size === 500 ? snapshot.docs.at(-1) : null;
  } while (cursor);
  return documents;
}

async function markDates(db, uid, keys) {
  if (!uid) return;
  if (!(await db.doc(`users/${uid}`).get()).exists) return;
  const periods = new Map();
  for (const key of keys.filter(validDateKey)) {
    for (const type of ['day', 'week', 'month', 'year']) {
      const period = periodFor(key, type);
      periods.set(period.id, period);
    }
  }
  if (!periods.size) return;
  const batch = db.batch();
  for (const period of periods.values()) {
    batch.set(db.doc(`users/${uid}/analyticsPending/${period.id}`), {
      ...period, updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

async function writeRollups(db, uid, rollups, updatedAt) {
  for (let offset = 0; offset < rollups.length; offset += 400) {
    const batch = db.batch();
    for (const rollup of rollups.slice(offset, offset + 400)) {
      batch.set(db.doc(`users/${uid}/analytics/${rollup.id}`), { ...rollup, updatedAt });
    }
    await batch.commit();
  }
}

async function rebuildUserData(db, uid, asOf = new Date(), options = {}) {
  const userRef = db.doc(`users/${uid}`);
  const user = await userRef.get();
  if (!user.exists) return;
  const profile = user.data();
  const stateRef = userRef.collection('analyticsState').doc('rollup');
  const state = await stateRef.get();
  if (state.data()?.lastRunAt?.toDate().getTime() > asOf.getTime()) return;
  const updatedAt = asOf;
  const today = dateKey(asOf);
  const periods = new Map(['day', 'week', 'month', 'year'].map((type) => {
    const period = periodFor(today, type);
    return [period.id, period];
  }));
  // Include the previous day: at a week/month boundary its period just closed.
  const yesterday = dateKey(new Date(asOf.getTime() - 86400000));
  for (const type of ['day', 'week', 'month', 'year']) {
    const period = periodFor(yesterday, type);
    periods.set(period.id, period);
  }
  const pending = await readAll(userRef.collection('analyticsPending'));
  for (const entry of pending) {
    const data = entry.data();
    if (validDateKey(data.startDate) && ['day', 'week', 'month', 'year'].includes(data.type)) {
      const period = periodFor(data.startDate, data.type);
      periods.set(period.id, period);
    }
  }
  if (options.forceHistorical || !state.exists || state.data().schemaVersion !== 1 || state.data().insightsVersion !== 1 || state.data().periodVersion !== 2) {
    // One-time backfill for prototype data. Subsequent jobs only read affected periods.
    const [logDocs, planDocs, oldRollups] = await Promise.all([
      readAll(db.collection('mealLogs').where('userId', '==', uid)),
      readAll(userRef.collection('plans')),
      readAll(userRef.collection('analytics')),
    ]);
    const logs = logDocs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const plans = planDocs.map((doc) => ({ ...doc.data(), id: doc.id }));
    const keys = [...logs.map((log) => log.date == null ? null : dateKey(log.date)), ...plans.map(planDate)];
    for (const key of keys.filter(validDateKey)) {
      for (const type of ['day', 'week', 'month', 'year']) {
        const period = periodFor(key, type);
        periods.set(period.id, period);
      }
    }
    for (const doc of oldRollups) {
      const data = doc.data();
      if (validDateKey(data.startDate) && ['day', 'week', 'month', 'year'].includes(data.type)) {
        const period = periodFor(data.startDate, data.type);
        periods.set(period.id, period);
      }
    }
    await writeRollups(db, uid, [...periods.values()].map((period) => buildRollup(period, logs, plans, asOf, profile)), updatedAt);
    await stateRef.set({ schemaVersion: 1, insightsVersion: 1, periodVersion: 2, backfilledAt: updatedAt });
  } else {
    for (const period of periods.values()) {
      const start = dayBounds(period.startDate).start;
      const end = dayBounds(period.endDate).start;
      const [logDocs, planDocs] = await Promise.all([
        readAll(db.collection('mealLogs').where('userId', '==', uid).where('date', '>=', start).where('date', '<', end).orderBy('date')),
        readAll(userRef.collection('plans').where(FieldPath.documentId(), '>=', period.startDate).where(FieldPath.documentId(), '<', period.endDate)),
      ]);
      const logs = logDocs.map((doc) => ({ ...doc.data(), id: doc.id }));
      const plans = planDocs.map((doc) => ({ ...doc.data(), id: doc.id }));
      await writeRollups(db, uid, [buildRollup(period, logs, plans, asOf, profile)], updatedAt);
    }
  }
  // Preserve a new edit arriving while aggregation was running for the next nightly job.
  for (const entry of pending) {
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(entry.ref);
      if (current.exists && current.updateTime.isEqual(entry.updateTime)) transaction.delete(entry.ref);
    });
  }
  await stateRef.set({ lastRunAt: asOf }, { merge: true });
  // A profile deleted during a job must not leave orphaned analytics behind.
  if (!(await userRef.get()).exists) await deleteAnalytics(db, uid);
}

async function rebuildUser(db, uid, asOf = new Date(), options = {}) {
  const userRef = db.doc(`users/${uid}`);
  const lockRef = userRef.collection('analyticsState').doc('processing');
  const token = randomUUID();
  const acquired = await db.runTransaction(async (transaction) => {
    const [user, lock] = await Promise.all([transaction.get(userRef), transaction.get(lockRef)]);
    if (!user.exists) return false;
    if (lock.data()?.expiresAt?.toMillis() > Date.now()) throw new Error('Analytics rebuild already running; retry later.');
    transaction.set(lockRef, { token, expiresAt: new Date(Date.now() + 600000) });
    return true;
  });
  if (!acquired) return;
  try {
    await rebuildUserData(db, uid, asOf, options);
  } finally {
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);
      if (lock.data()?.token === token) transaction.delete(lockRef);
    });
  }
}

async function deleteAnalytics(db, uid) {
  for (const name of ['analytics', 'analyticsPending', 'analyticsState']) {
    await db.recursiveDelete(db.collection(`users/${uid}/${name}`));
  }
}

module.exports = { readAll, markDates, rebuildUser, deleteAnalytics };
