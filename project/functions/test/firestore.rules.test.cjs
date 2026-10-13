'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const client = require('firebase/firestore');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { markDates, rebuildUser, deleteAnalytics } = require('../lib/rollup-store');
const { dateKey, periodFor } = require('../lib/reporting');

let environment, adminApp, adminDb;
const projectId = 'demo-mealcare-analytics';
const nutrition = { calories: 500, protein: 30, carbs: 50, fat: 20 };
const slot = { id: 'lunch', name: 'Lunch', time: '12:00', locationType: 'home', menuItem: { id: 'dish', foodName: 'Chicken rice', ...nutrition }, alternatives: [], notify: false, budget: 600 };

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run this test through the Firestore emulator.');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  environment = await initializeTestEnvironment({ projectId, firestore: {
    host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8'),
  } });
  adminApp = initializeApp({ projectId }, 'analytics-test');
  adminDb = getFirestore(adminApp);
});
beforeEach(async () => environment.clearFirestore());
after(async () => { await environment?.cleanup(); if (adminApp) await deleteApp(adminApp); });

function serviceFor(db, name = 'mealPlanPersistence') {
  const ts = require('../../node_modules/typescript');
  const filename = path.resolve(__dirname, `../../utils/${name}.ts`);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const service = new Module(filename, module);
  service.filename = filename;
  service.paths = module.paths;
  service.require = (name) => name === '../firebaseConfig' ? { db } : name === 'firebase/firestore' ? client
    : name === '../functions/lib/insights' ? require('../lib/insights')
    : name === '../functions/lib/reporting' ? require('../lib/reporting') : require(name);
  service._compile(output, filename);
  return service.exports;
}

test('owners can read summaries, other users/anonymous clients cannot, clients cannot write analytics', async () => {
  await adminDb.doc('users/alice/analytics/week-2026-09-14').set({ calories: 500 });
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const path = 'users/alice/analytics/week-2026-09-14';
  await assertSucceeds(client.getDoc(client.doc(alice, path)));
  await assertFails(client.getDoc(client.doc(bob, path)));
  await assertFails(client.getDoc(client.doc(anonymous, path)));
  await assertFails(client.setDoc(client.doc(alice, path), { calories: 900 }));
  await assertFails(client.deleteDoc(client.doc(alice, path)));
  await assertFails(client.setDoc(client.doc(alice, 'users/alice/analyticsPending/week-2026-09-14'), {}));
  await assertFails(client.setDoc(client.doc(alice, 'users/alice/analyticsState/rollup'), {}));
  await assertFails(client.setDoc(client.doc(alice, `${path}/nested/doc`), {}));
});

test('meal ownership cannot be reassigned and plans remain private', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  await assertSucceeds(client.setDoc(client.doc(alice, 'mealLogs/meal'), { userId: 'alice', ...nutrition }));
  await assertFails(client.updateDoc(client.doc(alice, 'mealLogs/meal'), { userId: 'bob' }));
  await assertFails(client.deleteDoc(client.doc(bob, 'mealLogs/meal')));
  await assertSucceeds(client.setDoc(client.doc(alice, 'users/alice/plans/2026-09-15'), { slots: [slot] }));
  await assertFails(client.getDoc(client.doc(bob, 'users/alice/plans/2026-09-15')));
});

test('actual frontend plan save/log/delete flow is atomic, retains plans, and produces rollups', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const service = serviceFor(alice);
  await client.setDoc(client.doc(alice, 'users/alice'), { dailyCalorieTarget: 2000 });
  const today = dateKey();
  await service.saveDailyPlan('alice', [slot]);
  const [first, second] = await Promise.all([service.logDailyPlanMeal('alice', slot.id), service.logDailyPlanMeal('alice', slot.id)]);
  assert.ok(first[0].loggedMealId);
  assert.equal(first[0].loggedMealId, second[0].loggedMealId);
  assert.equal(first[0].menuItem.calories, 500);
  const logs = await client.getDocs(client.query(client.collection(alice, 'mealLogs'), client.where('userId', '==', 'alice')));
  assert.equal(logs.size, 1);
  assert.equal(logs.docs[0].data().mealType, 'lunch');
  assert.equal(logs.docs[0].data().planId, today);
  const regenerated = await service.saveDailyPlan('alice', [{ ...slot, id: 'regenerated-id', menuItem: { ...slot.menuItem, calories: 900 } }]);
  assert.equal(regenerated.length, 1);
  assert.equal(regenerated[0].menuItem.calories, 500);

  const asOf = new Date(`${today}T01:00:00+08:00`);
  asOf.setUTCDate(asOf.getUTCDate() + 1);
  await rebuildUser(adminDb, 'alice', asOf);
  const ref = adminDb.doc(`users/alice/analytics/${periodFor(today, 'week').id}`);
  assert.equal((await ref.get()).data().adherencePercent, 100);
  await service.deleteMealLog('alice', first[0].loggedMealId);
  const plan = await client.getDoc(client.doc(alice, `users/alice/plans/${today}`));
  assert.equal(plan.data().slots[0].loggedMealId, undefined);
  assert.equal(plan.data().slots[0].menuItem.calories, 500);
  await markDates(adminDb, 'alice', [today]);
  await rebuildUser(adminDb, 'alice', asOf);
  assert.equal((await ref.get()).data().actual.calories, 0);
  assert.equal((await ref.get()).data().adherencePercent, 0);
});

test('old edits, moved dates and deletions rebuild both historical periods and clear dirty markers', async () => {
  await adminDb.doc('users/alice').set({});
  const oldDate = '2026-03-10';
  const movedDate = '2026-04-10';
  const ref = adminDb.doc('mealLogs/old');
  await ref.set({ userId: 'alice', foodName: 'Meal', ...nutrition, date: new Date(`${oldDate}T12:00:00+08:00`) });
  const asOf = new Date('2026-10-01T01:00:00+08:00');
  await rebuildUser(adminDb, 'alice', asOf);
  const oldRollup = adminDb.doc(`users/alice/analytics/${periodFor(oldDate, 'month').id}`);
  assert.equal((await oldRollup.get()).data().actual.calories, 500);
  await ref.update({ calories: 700, date: new Date(`${movedDate}T12:00:00+08:00`) });
  await markDates(adminDb, 'alice', [oldDate, movedDate]);
  await rebuildUser(adminDb, 'alice', asOf);
  assert.equal((await oldRollup.get()).data().actual.calories, 0);
  const movedRollup = adminDb.doc(`users/alice/analytics/${periodFor(movedDate, 'month').id}`);
  assert.equal((await movedRollup.get()).data().actual.calories, 700);
  assert.equal((await adminDb.collection('users/alice/analyticsPending').get()).size, 0);
  await ref.delete();
  await markDates(adminDb, 'alice', [movedDate]);
  await rebuildUser(adminDb, 'alice', asOf);
  assert.equal((await movedRollup.get()).data().actual.calories, 0);
});

test('analytics cleanup removes only derived data and does not recreate it for a deleted profile', async () => {
  for (const name of ['analytics', 'analyticsPending', 'analyticsState', 'plans']) {
    await adminDb.doc(`users/alice/${name}/example`).set({});
  }
  await deleteAnalytics(adminDb, 'alice');
  assert.equal((await adminDb.doc('users/alice/plans/example').get()).exists, true);
  assert.equal((await adminDb.collection('users/alice/analytics').get()).size, 0);
  await markDates(adminDb, 'alice', ['2026-03-10']);
  await rebuildUser(adminDb, 'alice');
  assert.equal((await adminDb.collection('users/alice/analyticsPending').get()).size, 0);
  assert.equal((await adminDb.collection('users/alice/analytics').get()).size, 0);
});

test('overlapping jobs retry, older jobs cannot replace newer summaries, and locks are released', async () => {
  await adminDb.doc('users/alice').set({});
  const lock = adminDb.doc('users/alice/analyticsState/processing');
  await lock.set({ token: 'active', expiresAt: new Date(Date.now() + 600000) });
  await assert.rejects(rebuildUser(adminDb, 'alice'), /already running/);
  await lock.delete();
  const recent = new Date('2026-10-01T01:00:00+08:00');
  await rebuildUser(adminDb, 'alice', recent);
  assert.equal((await lock.get()).exists, false);
  await rebuildUser(adminDb, 'alice', new Date('2026-09-01T01:00:00+08:00'));
  assert.equal((await adminDb.doc('users/alice/analyticsState/rollup').get()).data().lastRunAt.toDate().getTime(), recent.getTime());
  assert.equal((await lock.get()).exists, false);
});

test('frontend summary reads and longer existing views use only precomputed monthly documents', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const service = serviceFor(alice, 'analytics');
  await adminDb.doc('users/alice').set({});
  await adminDb.doc('mealLogs/old').set({ userId: 'alice', foodName: 'Meal', ...nutrition, date: new Date('2026-09-15T12:00:00+08:00') });
  await rebuildUser(adminDb, 'alice', new Date('2026-10-01T01:00:00+08:00'));
  const selected = service.analyticsPeriodFor('2026-09-15', 'month');
  const summary = await service.fetchAnalyticsRollup('alice', selected);
  assert.equal(summary.actual.calories, 500);
  assert.equal(summary.daily.find((day) => day.date === '2026-09-15').deviation.calories, null);
  assert.ok(summary.updatedAt instanceof Date);
  const window = service.analyticsPeriodFor('2026-10-01', '3months');
  assert.equal(window.startDate, '2026-08-01');
  assert.equal(window.endDate, '2026-11-01');
  const combined = await service.fetchAnalyticsRollup('alice', window);
  assert.equal(combined.actual.calories, 500);
  assert.equal(combined.missingRollupCount, 1);
  assert.equal(combined.adherencePercent, null);
  assert.equal(service.adjacentAnalyticsPeriod(window, -1).startDate, '2026-05-01');
  const bob = environment.authenticatedContext('bob').firestore();
  await assertFails(serviceFor(bob, 'analytics').fetchAnalyticsRollup('alice', selected));
});

test('upgrades historical summaries and combines insights across monthly targets', async () => {
  await adminDb.doc('users/alice').set({ dailyCalorieTarget: 2000 });
  await adminDb.doc('users/alice/analyticsState/rollup').set({ schemaVersion: 1 });
  await adminDb.doc('mealLogs/august').set({ userId: 'alice', foodName: 'Meal', ...nutrition, mealType: 'Breakfast', location: { type: 'restaurant' }, date: new Date('2026-08-15T12:00:00+08:00') });
  await adminDb.doc('mealLogs/september').set({ userId: 'alice', foodName: 'Meal', ...nutrition, mealType: 'Lunch', date: new Date('2026-09-15T12:00:00+08:00') });
  const asOf = new Date('2026-10-01T01:00:00+08:00');
  await rebuildUser(adminDb, 'alice', asOf);
  const august = adminDb.doc('users/alice/analytics/month-2026-08-01');
  assert.equal((await august.get()).data().insightsVersion, 1);
  assert.equal((await august.get()).data().insightStats.targetCalories, 2000);
  assert.equal((await adminDb.doc('users/alice/analyticsState/rollup').get()).data().insightsVersion, 1);
  await adminDb.doc('users/alice').update({ dailyCalorieTarget: 1000 });
  await markDates(adminDb, 'alice', ['2026-09-15']);
  await rebuildUser(adminDb, 'alice', asOf);
  const service = serviceFor(environment.authenticatedContext('alice').firestore(), 'analytics');
  const combined = await service.fetchAnalyticsRollup('alice', service.analyticsPeriodFor('2026-10-01', '3months'));
  assert.equal(combined.missingRollupCount, 0);
  assert.deepEqual(combined.insightStats, { breakfastDays: 1, targetDays: 2, targetCalories: 3000 });
  assert.match(combined.insights.find((item) => item.id === 'calories').message, /1500 kcal/);
  assert.match(combined.insights.find((item) => item.id === 'breakfast').message, /1 of 2 logged days/);
  assert.match(combined.insights.find((item) => item.id === 'restaurants').message, /1 of 2 recorded meals/);
  await august.update({ insightsVersion: 0 });
  const legacy = await service.fetchAnalyticsRollup('alice', service.analyticsPeriodFor('2026-10-01', '3months'));
  assert.equal(legacy.insightsVersion, undefined);
  assert.deepEqual(legacy.insights, []);
});

test('explicit local backfill refreshes old edits without deployed dirty triggers', async () => {
  await adminDb.doc('users/alice').set({});
  const log = adminDb.doc('mealLogs/local-old');
  await log.set({ userId: 'alice', foodName: 'Meal', ...nutrition, date: new Date('2026-03-15T12:00:00+08:00') });
  const asOf = new Date('2026-10-01T01:00:00+08:00');
  await rebuildUser(adminDb, 'alice', asOf);
  const rollup = adminDb.doc('users/alice/analytics/month-2026-03-01');
  await log.update({ calories: 800 });
  await rebuildUser(adminDb, 'alice', asOf, { forceHistorical: true });
  assert.equal((await rollup.get()).data().actual.calories, 800);
  await log.delete();
  await rebuildUser(adminDb, 'alice', asOf, { forceHistorical: true });
  assert.equal((await rollup.get()).data().actual.calories, 0);
});

test('live worker and frontend subscription update one-entry gaps, adherence and edited/deleted totals', async () => {
  const { spawn } = require('node:child_process');
  const worker = spawn(process.execPath, [path.join(__dirname, '../scripts/worker.js')], {
    env: { ...process.env, GCLOUD_PROJECT: projectId }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let workerErrors = ''; worker.stdout.on('data', (chunk) => { workerErrors += chunk.toString(); }); worker.stderr.on('data', (chunk) => { workerErrors += chunk.toString(); });
  const alice = environment.authenticatedContext('alice').firestore();
  const persistence = serviceFor(alice);
  const analytics = serviceFor(alice, 'analytics');
  let latest, failure;
  const waitFor = async (predicate) => {
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (failure) throw failure;
      if (latest && predicate(latest)) return latest;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for live analytics: ${JSON.stringify(latest && {meals: latest.mealCount, adherence: latest.adherencePercent, planned: latest.plannedMealCount})} ${workerErrors}`);
  };
  let stop = () => {};
  try {
    await adminDb.doc('users/alice').set({ dailyCalorieTarget: 2000 });
    await persistence.saveDailyPlan('alice', [slot]);
    stop = analytics.subscribeAnalyticsRollup('alice', analytics.analyticsPeriodFor(dateKey(), 'week'),
      (summary) => { latest = summary; }, (error) => { failure = error; });
    await persistence.logDailyPlanMeal('alice', 'lunch');
    const first = await waitFor((summary) => summary.mealCount === 1 && summary.adherencePercent === 100);
    assert.equal(first.gaps.calories, 0); assert.equal(first.gaps.protein, 0);
    assert.equal(first.daily.filter((day) => day.mealCount).length, 1);
    assert.equal(first.daily.find((day) => day.mealCount).deviation.calories, 0);
    const logs = await adminDb.collection('mealLogs').where('userId', '==', 'alice').get();
    const mealRef = logs.docs[0].ref;
    await mealRef.update({ calories: 700, protein: 40 });
    const edited = await waitFor((summary) => summary.actual.calories === 700);
    assert.equal(edited.gaps.calories, 200); assert.equal(edited.gaps.protein, 10);
    assert.equal(edited.adherencePercent, 0);
    await persistence.deleteMealLog('alice', mealRef.id);
    const removed = await waitFor((summary) => summary.mealCount === 0);
    assert.equal(removed.actual.calories, 0); assert.equal(removed.adherencePercent, 0);
  } finally { stop(); worker.kill(); }
});

test('daily, weekly, monthly and yearly summaries expose the same single-entry comparison', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const service = serviceFor(alice, 'analytics');
  await adminDb.doc('users/alice').set({});
  await adminDb.doc('users/alice/plans/2026-09-15').set({ slots: [slot] });
  await adminDb.doc('mealLogs/single-period').set({ userId: 'alice', foodName: 'Chicken rice', ...nutrition, mealType: 'Lunch', date: new Date('2026-09-15T12:00:00+08:00') });
  await rebuildUser(adminDb, 'alice', new Date('2026-09-16T01:00:00+08:00'));
  for (const type of ['day', 'week', 'month', 'year']) {
    const period = service.analyticsPeriodFor('2026-09-15', type);
    const summary = await service.fetchAnalyticsRollup('alice', period);
    assert.equal(summary.actual.calories, 500); assert.equal(summary.planned.calories, 500);
    assert.equal(summary.gaps.calories, 0); assert.equal(summary.adherencePercent, 100);
    assert.equal(service.adjacentAnalyticsPeriod(period, -1).endDate, period.startDate);
  }
});
