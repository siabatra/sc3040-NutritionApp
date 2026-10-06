'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { getFunctions } = require('firebase-admin/functions');
const { getAuth } = require('firebase-admin/auth');
const functionsV1 = require('firebase-functions/v1');
const logger = require('firebase-functions/logger');
const { dateKey, TIME_ZONE } = require('./lib/reporting');
const { planDate } = require('./lib/aggregate');
const { markDates, rebuildUser, deleteAnalytics } = require('./lib/rollup-store');

initializeApp();
const db = getFirestore();
const REGION = 'asia-southeast1';

exports.markMealAnalyticsDirty = onDocumentWritten({
  document: 'mealLogs/{mealId}', region: REGION, retry: true,
}, async (event) => {
  const changes = [event.data?.before, event.data?.after].filter((snapshot) => snapshot?.exists);
  const byUser = new Map();
  for (const snapshot of changes) {
    const data = snapshot.data();
    if (typeof data.userId !== 'string' || !data.userId) continue;
    if (!byUser.has(data.userId)) byUser.set(data.userId, []);
    byUser.get(data.userId).push(data.date == null ? null : dateKey(data.date));
  }
  await Promise.all([...byUser].map(([uid, keys]) => markDates(db, uid, keys)));
});

exports.markPlanAnalyticsDirty = onDocumentWritten({
  document: 'users/{uid}/plans/{planId}', region: REGION, retry: true,
}, async (event) => {
  const keys = [event.data?.before, event.data?.after].filter((snapshot) => snapshot?.exists)
    .map((snapshot) => planDate({ ...snapshot.data(), id: event.params.planId }));
  await markDates(db, event.params.uid, keys);
});

// Per-user tasks keep the nightly scheduler bounded as the user base grows.
exports.rebuildUserAnalytics = onTaskDispatched({
  region: REGION, timeoutSeconds: 540, memory: '512MiB',
  retryConfig: { maxAttempts: 5, minBackoffSeconds: 60 },
  rateLimits: { maxConcurrentDispatches: 5, maxDispatchesPerSecond: 5 },
}, async (request) => {
  const { uid, asOf } = request.data || {};
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new Error('Invalid analytics user');
  const date = new Date(asOf);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid analytics cutoff');
  try {
    await getAuth().getUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    await deleteAnalytics(db, uid);
    return;
  }
  await rebuildUser(db, uid, date);
});

exports.nightlyAnalyticsRollup = onSchedule({
  schedule: '0 1 * * *', timeZone: TIME_ZONE, region: REGION,
  timeoutSeconds: 540, retryCount: 3, maxInstances: 1,
}, async (event) => {
  const asOf = event.scheduleTime || new Date().toISOString();
  const queue = getFunctions().taskQueue(`locations/${REGION}/functions/rebuildUserAnalytics`);
  let cursor;
  let count = 0;
  do {
    let query = db.collection('users').orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (let offset = 0; offset < page.size; offset += 10) {
      await Promise.all(page.docs.slice(offset, offset + 10).map((user) => queue.enqueue({ uid: user.id, asOf })));
    }
    count += page.size;
    cursor = page.size === 100 ? page.docs.at(-1) : null;
  } while (cursor);
  logger.info('Queued nightly analytics', { userCount: count });
});

exports.removeProfileAnalytics = onDocumentDeleted({
  document: 'users/{uid}', region: REGION, retry: true,
}, (event) => deleteAnalytics(db, event.params.uid));

exports.removeDeletedAccountAnalytics = functionsV1.region(REGION).auth.user().onDelete((user) => deleteAnalytics(db, user.uid));
