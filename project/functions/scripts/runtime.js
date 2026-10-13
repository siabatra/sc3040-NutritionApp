'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
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
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId, credential: applicationDefault() });
    return getFirestore();
  }
  const keyPath = findServiceAccountKey(projectRoot);
  if (!keyPath) {
    throw new Error('No Firebase Admin key found. Place it at project/server/serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS.');
  }
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (key.project_id && key.project_id !== projectId) {
    throw new Error(`${path.basename(keyPath)} belongs to Firebase project "${key.project_id}", but the app uses "${projectId}".`);
  }
  initializeApp({ projectId, credential: cert(key) });
  return getFirestore();
}

function findServiceAccountKey(projectRoot) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return path.resolve(projectRoot, process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const keys = fs.readdirSync(projectRoot).filter((name) => name.includes('-firebase-adminsdk-') && name.endsWith('.json'));
  if (keys.length === 1) return path.join(projectRoot, keys[0]);
  const serverKey = path.join(projectRoot, 'server/serviceAccountKey.json');
  return fs.existsSync(serverKey) ? serverKey : null;
}

async function generateSummaries(db, uid) {
  if (uid && !(await db.doc(`users/${uid}`).get()).exists) throw new Error('User profile does not exist.');
  const users = uid ? [{ id: uid }] : await readAll(db.collection('users'));
  const asOf = new Date();
  let completed = 0;
  for (const user of users) {
    await rebuildUser(db, user.id, asOf, { forceHistorical: true });
    completed++;
  }
  console.log(`Analytics rebuilt for ${completed} user(s).`);
}
module.exports = { initialiseBackend, generateSummaries };
