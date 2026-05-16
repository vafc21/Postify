const TEMPLATES = [
  { key: 'brand_awareness', name: 'Brand Awareness', frequency: 'daily', timesPerCycle: 1, scheduleConfig: { times: ['09:00'] } },
  { key: 'daily_tips', name: 'Daily Tips', frequency: 'daily', timesPerCycle: 1, scheduleConfig: { times: ['09:00'] } },
  { key: 'weekly_highlight', name: 'Weekly Highlight', frequency: 'weekly', timesPerCycle: 1, scheduleConfig: { days: ['friday'], time: '12:00' } },
  { key: 'product_launch', name: 'Product Launch', frequency: 'daily', timesPerCycle: 3, scheduleConfig: { times: ['09:00', '13:00', '18:00'] } },
  { key: 'monthly_recap', name: 'Monthly Recap', frequency: 'monthly', timesPerCycle: 1, scheduleConfig: { date: 1, time: '10:00' } },
];

function getTemplate(key) {
  return TEMPLATES.find(t => t.key === key) || null;
}

module.exports = { TEMPLATES, getTemplate };
