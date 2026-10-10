'use strict';
const { initialiseBackend, generateSummaries } = require('./runtime');
async function main() {
  const db = initialiseBackend();
  try { await generateSummaries(db, process.argv[2]); }
  finally { await db.terminate(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
