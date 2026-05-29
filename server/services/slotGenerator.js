const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Generate scheduled_post data objects for a campaign.
 * @param {object} campaign
 * @param {Date} fromDate - start date (UTC midnight)
 * @param {number} days - number of days to generate
 * @returns {object[]}
 */
function generateSlots(campaign, fromDate, days) {
  const slots = [];
  const { frequency, scheduleConfig, id: campaignId, clientId, postToStory, endDate } = campaign;
  const cutoff = endDate ? new Date(endDate) : null;
  const within = (dt) => !cutoff || dt <= cutoff;

  if (frequency === 'daily') {
    const times = scheduleConfig.times || ['09:00'];
    for (let d = 0; d < days; d++) {
      for (const time of times) {
        const [hours, minutes] = time.split(':').map(Number);
        const dt = new Date(fromDate);
        dt.setUTCDate(dt.getUTCDate() + d);
        dt.setUTCHours(hours, minutes, 0, 0);
        if (dt > new Date() && within(dt)) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  } else if (frequency === 'weekly') {
    const targetDays = (scheduleConfig.days || []).map(d => DAY_NAMES.indexOf(d.toLowerCase()));
    const [hours, minutes] = (scheduleConfig.time || '09:00').split(':').map(Number);
    for (let d = 0; d < days; d++) {
      const dt = new Date(fromDate);
      dt.setUTCDate(dt.getUTCDate() + d);
      if (targetDays.includes(dt.getUTCDay())) {
        dt.setUTCHours(hours, minutes, 0, 0);
        if (dt > new Date() && within(dt)) {
          slots.push(makeSlot(campaignId, clientId, dt, postToStory));
        }
      }
    }
  } else if (frequency === 'monthly') {
    const targetDate = scheduleConfig.date || 1;
    const [hours, minutes] = (scheduleConfig.time || '09:00').split(':').map(Number);
    for (let d = 0; d < days; d++) {
      const dt = new Date(fromDate);
      dt.setUTCDate(dt.getUTCDate() + d);
      if (dt.getUTCDate() === targetDate) {
        dt.setUTCHours(hours, minutes, 0, 0);
        if (dt > new Date() && within(dt)) {
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

module.exports = { generateSlots };
