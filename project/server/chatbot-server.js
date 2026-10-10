'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const { initialiseBackend } = require('../functions/scripts/runtime');
initialiseBackend();
const backendRequire = createRequire(path.resolve(__dirname, '../functions/package.json'));
const { getAuth } = backendRequire('firebase-admin/auth');
if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `${process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1'}:9099`;
}
const { createChatApp } = require('./chatbot');
const port = Number(process.env.CHATBOT_PORT || 4001);
const app = createChatApp({ verifyToken: token => getAuth().verifyIdToken(token), apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini' });
app.listen(port, '0.0.0.0', () => {
  console.log(`MealCare OpenAI app help listening on port ${port}.`);
  if (!process.env.OPENAI_API_KEY) console.log('Set server OPENAI_API_KEY in .env and restart to enable answers.');
});
