'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const children = [
  spawn(process.execPath, [path.join(root, 'functions/scripts/worker.js')], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'start', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; children.forEach((child) => child.kill()); process.exitCode = code;
}
children[0].on('exit', (code) => { if (!stopping && code) console.error('Analytics worker stopped. Check its error above; the app can still start.'); });
children[1].on('exit', (code) => stop(code || 0));
process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop());
