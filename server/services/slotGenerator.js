const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Convert a wall-clock time in the given IANA timezone to a UTC Date.
 * Handles DST automatically. Falls back to UTC if tz === 'UTC' or invalid.
 */
function localTimeToUtc(year, month, day, hours, minutes, tz, seconds = 0, ms = 0) {
  const naive = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms));
  if (!tz || tz === 'UTC') return naive;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = fmt.formatToParts(naive);
    const map = {};
    for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
    const tzAsUtc = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour), Number(map.minute), Number(map.second)
    );
    const offsetMs = tzAsUtc - naive.getTime();
    return new Date(naive.getTime() - offsetMs);
  } catch (_) {
    return naive;
  }
}

/**
 * Get a calendar (year, month, day) representing today in the given timezone.
 */
function todayInTz(now, tz) {
  if (!tz || tz === 'UTC') {
    return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
  }
  const iso = now.toLocaleDateString('en-CA', { timeZone: tz });
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function addDays(y, m, d, addD) {
  const dt = new Date(Date.UTC(y, m - 1, d + addD));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}

/**
 * Generate scheduled_post data objects for a campaign.
 * @param {object} campaign
 * @param {Date} fromDate - start date (typically "now")
 * @param {number} days - number of days to generate
 * @param {object} [options]
 * @param {string} [options.timezone] - IANA timezone for interpreting schedule times
 * @returns {object[]}
 */
function generateSlots(campaign, fromDate, days, options = {}) {
  const tz = options.timezone || 'UTC';
  const slots = [];
  const { frequency, scheduleConfig, id: campaignId, clientId, postToStory, endDate } = campaign;
  const cutoff = endDate ? new Date(endDate) : null;
  const within = (dt) => !cutoff || dt <= cutoff;
  const now = new Date();
  const start = todayInTz(fromDate, tz);

  if (frequency === 'daily') {
    const times = scheduleConfig.times || ['09:00'];
    for (let d = 0; d < days; d++) {
      const cal = addDays(start.y, start.m, start.d, d);
      for (const time of times) {
        const [hours, minutes] = time.split(':').map(Number);
        const dt = localTimeToUtc(cal.y, cal.m, cal.d, hours, minutes, tz);
        if (dt > now && within(dt)) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  } else if (frequency === 'weekly') {
    const targetDays = (scheduleConfig.days || []).map(d => DAY_NAMES.indexOf(d.toLowerCase()));
    const [hours, minutes] = (scheduleConfig.time || '09:00').split(':').map(Number);
    for (let d = 0; d < days; d++) {
      const cal = addDays(start.y, start.m, start.d, d);
      if (targetDays.includes(cal.dow)) {
        const dt = localTimeToUtc(cal.y, cal.m, cal.d, hours, minutes, tz);
        if (dt > now && within(dt)) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  } else if (frequency === 'monthly') {
    const targetDate = scheduleConfig.date || 1;
    const [hours, minutes] = (scheduleConfig.time || '09:00').split(':').map(Number);
    for (let d = 0; d < days; d++) {
      const cal = addDays(start.y, start.m, start.d, d);
      if (cal.d === targetDate) {
        const dt = localTimeToUtc(cal.y, cal.m, cal.d, hours, minutes, tz);
        if (dt > now && within(dt)) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  }

  return slots;
}

function makeSlot(campaignId, clientId, scheduledFor, postToStory) {
  return {
    campaignId,
    clientId,
    scheduledFor,
    mediaType: null,
    mediaUrls: [],
    caption: null,
    postToStory: postToStory ?? true,
    status: 'pending',
  };
}

/**
 * Convert a YYYY-MM-DD date (or Date object) to the UTC instant of
 * end-of-day (23:59:59.999) in the given IANA timezone. Used to clamp
 * campaign end dates so the last day is included in the user's tz.
 */
function endOfDayInTz(dateInput, tz) {
  if (!dateInput) return null;
  let y, m, d;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    [y, m, d] = dateInput.slice(0, 10).split('-').map(Number);
  } else {
    const parsed = new Date(dateInput);
    if (isNaN(parsed.getTime())) return null;
    const iso = parsed.toLocaleDateString('en-CA', { timeZone: tz || 'UTC' });
    [y, m, d] = iso.split('-').map(Number);
  }
  return localTimeToUtc(y, m, d, 23, 59, tz, 59, 999);
}

module.exports = { generateSlots, endOfDayInTz };
