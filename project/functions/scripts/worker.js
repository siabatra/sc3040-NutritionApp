'use strict';
const { initialiseBackend } = require('./runtime');
const { rebuildUser } = require('../lib/rollup-store');
const db = initialiseBackend();
const jobs = new Map();
let stopping = false;
function queue(uid) {
  if (!uid || stopping) return;
  let job = jobs.get(uid);
  if (!job) { job = { dirty: false, running: false, timer: null }; jobs.set(uid, job); }
  job.dirty = true;
  if (!job.running) { clearTimeout(job.timer); job.timer = setTimeout(() => run(uid, job), 400); }
}
function run(uid, job) {
  if (stopping || job.running) return;
  job.running = true; job.dirty = false;
  job.promise = refresh(uid, job);
}
async function refresh(uid, job) {
  let retryDelay = 1500;
  try { await rebuildUser(db, uid, new Date(), { forceHistorical: true }); console.log('Analytics refreshed after a data change.'); }
  catch (error) {
    job.dirty = true;
    if (error.code === 'analytics/busy') retryDelay = 30000;
    else console.error(`Analytics refresh failed: ${error.message}`);
  }
  finally {
    job.running = false;
    if (!stopping && job.dirty) job.timer = setTimeout(() => run(uid, job), retryDelay);
    else jobs.delete(uid);
  }
}
const watchError = (error) => { console.error(`Analytics watcher failed: ${error.message}`); };
const stops = [
  db.collection('mealLogs').onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) queue(change.doc.data().userId);
  }, watchError),
  db.collectionGroup('plans').onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.doc.ref.parent.parent?.parent.id === 'users') queue(change.doc.ref.parent.parent.id);
    }
  }, watchError),
];
const targets = new Map();
stops.push(db.collection('users').onSnapshot((snapshot) => {
  for (const change of snapshot.docChanges()) {
    const uid = change.doc.id;
    if (change.type === 'removed') { targets.delete(uid); continue; }
    const target = change.doc.data().dailyCalorieTarget;
    if (!targets.has(uid) || targets.get(uid) !== target) queue(uid);
    targets.set(uid, target);
  }
}, watchError));
const repair = setInterval(async () => {
  try { const users = await db.collection('users').get(); users.docs.forEach((user) => queue(user.id)); }
  catch (error) { watchError(error); }
}, 60000);
console.log('Live analytics worker watching meal logs and saved plans.');
let stopped;
function stop() {
  stopped ||= (async () => {
    stopping = true; clearInterval(repair); stops.forEach((unsubscribe) => unsubscribe());
    for (const job of jobs.values()) clearTimeout(job.timer);
    const running = [...jobs.values()].filter((job) => job.running).map((job) => job.promise);
    if (running.length) {
      console.log('Analytics worker finishing the current refresh before exiting...');
      await Promise.race([Promise.allSettled(running), new Promise((resolve) => setTimeout(resolve, 20000).unref())]);
    }
    await db.terminate();
  })();
  return stopped;
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
