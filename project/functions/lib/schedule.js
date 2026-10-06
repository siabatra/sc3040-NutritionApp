'use strict';
const { dateKey, dayBounds } = require('./reporting');
function nextNightlyRun(now = new Date()) {
  const today = dayBounds(dateKey(now)).start;
  const atOne = new Date(today.getTime() + 60 * 60 * 1000);
  return atOne > now ? atOne : new Date(atOne.getTime() + 86400000);
}
module.exports = { nextNightlyRun };
