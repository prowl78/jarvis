const fs = require('fs');
const path = require('path');

const LAST_SEEN_PATH = path.join(__dirname, '..', 'last-seen.json');

function getSydneyHour() {
  const now = new Date();
  const sydneyStr = now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false });
  return parseInt(sydneyStr, 10);
}

function getTimeOfDay(hour) {
  if (hour >= 5  && hour < 8)  return 'early morning';
  if (hour >= 8  && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 23) return 'night';
  return 'late night';
}

function getEnergy(hour) {
  if (hour >= 8  && hour < 11) return 'high';
  if (hour >= 11 && hour < 14) return 'medium';
  if (hour >= 14 && hour < 16) return 'low';   // afternoon dip
  if (hour >= 16 && hour < 20) return 'medium';
  if (hour >= 20 && hour < 23) return 'low';
  return 'low'; // late night / early morning
}

function getTimeContext() {
  const now = new Date();
  const sydney = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const hour       = sydney.getHours();
  const dayOfWeek  = sydney.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long' });
  const isWeekend  = [0, 6].includes(sydney.getDay());
  const isWorkHours = !isWeekend && hour >= 9 && hour < 18;

  // Session gap
  let goneMinutes = 0;
  try {
    const raw = fs.readFileSync(LAST_SEEN_PATH, 'utf8');
    const { ts } = JSON.parse(raw);
    goneMinutes = Math.round((now.getTime() - ts) / 60000);
  } catch { /* first run or missing file */ }

  // Update last-seen
  try {
    fs.writeFileSync(LAST_SEEN_PATH, JSON.stringify({ ts: now.getTime() }), 'utf8');
  } catch (err) {
    console.warn('[time-context] could not write last-seen.json:', err.message);
  }

  return {
    hour,
    timeOfDay:    getTimeOfDay(hour),
    dayOfWeek,
    isWeekend,
    isWorkHours,
    energy:       getEnergy(hour),
    goneMinutes,
  };
}

module.exports = { getTimeContext };
