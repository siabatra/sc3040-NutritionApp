'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../utils/aiApi.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function loadClient(user = { getIdToken: async () => 'test-token' }) {
  const moduleInstance = new Module(path.join(__dirname, '../utils/aiApi.ts'), module);
  moduleInstance.filename = path.join(__dirname, '../utils/aiApi.ts');
  moduleInstance.paths = module.paths;
  const stubs = {
    '../firebaseConfig': { auth: { currentUser: user } },
    './serverUrl': { localServerUrl: (override) => override },
  };
  moduleInstance.require = (id) => stubs[id] ?? require(id);
  moduleInstance._compile(compiled, moduleInstance.filename);
  return moduleInstance.exports;
}

function mockResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

async function withFetch(mock, run) {
  const original = global.fetch;
  const previousUrl = process.env.EXPO_PUBLIC_SERVER_URL;
  process.env.EXPO_PUBLIC_SERVER_URL = 'http://localhost:3000';
  global.fetch = mock;
  try { await run(loadClient()); }
  finally {
    global.fetch = original;
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SERVER_URL;
    else process.env.EXPO_PUBLIC_SERVER_URL = previousUrl;
  }
}

const macros = { calories: 500, protein: 30, carbs: 55, fat: 18 };
const planRequest = {
  remainingCalories: 1500,
  dietaryPreferences: ['vegetarian'],
  slots: [{ id: 'lunch', name: 'Lunch', startTime: '12:00', endTime: '14:00', locationType: 'home' }],
  candidates: []
};


module.exports = { loadClient, mockResponse, withFetch, macros, planRequest };
