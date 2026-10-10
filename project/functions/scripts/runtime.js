'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { readAll, rebuildUser } = require('../lib/rollup-store');

function initialiseBackend() {
  const projectRoot = path.resolve(__dirname, '../..');
  try { process.loadEnvFile(path.join(projectRoot, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true' && !process.env.GCLOUD_PROJECT) {
    process.env.GCLOUD_PROJECT = 'demo-mealcare-analytics';
    const host = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
    process.env.FIRESTORE_EMULATOR_HOST ||= `${host}:8080`;
  }
  const projectId = process.env.GCLOUD_PROJECT || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Set GCLOUD_PROJECT to the intended Firebase project.');
  // Local development only. Never bundle Admin credentials in the application.
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) {
    const keys = fs.readdirSync(projectRoot).filter((name) => name.includes('-firebase-adminsdk-') && name.endsWith('.json'));
    if (keys.length === 1) process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(projectRoot, keys[0]);
  }
  initializeApp({ projectId, credential: applicationDefault() });
  return getFirestore();
}

async function generateSummaries(db, uid) {
  if (uid && !(await db.doc(`users/${uid}`).get()).exists) throw new Error('User profile does not exist.');
  const users = uid ? [{ id: uid }] : await readAll(db.collection('users'));
  const asOf = new Date();
  let completed = 0;
  for (const user of users) {
    // No deployed dirty triggers are needed for this explicit local maintenance job.
    await rebuildUser(db, user.id, asOf, { forceHistorical: true });
    completed++;
  }
  console.log(`Analytics rebuilt for ${completed} user(s).`);
}
module.exports = { initialiseBackend, generateSummaries };
