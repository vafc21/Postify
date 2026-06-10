const { generateSlots } = require('../services/slotGenerator');

// Use a future date so slots are not filtered out by "dt > new Date()"
const FUTURE_DATE = new Date('2099-01-01T00:00:00.000Z');

describe('generateSlots', () => {
  test('daily: generates correct number of slots', () => {
    const campaign = {
      id: 'camp-1', clientId: 'client-1', frequency: 'daily',
      timesPerCycle: 2, scheduleConfig: { times: ['09:00', '18:00'] }, postToStory: true,
    };
    const slots = generateSlots(campaign, FUTURE_DATE, 7);
    expect(slots.length).toBe(14);
  });

  test('daily: slot scheduledFor has correct time', () => {
    const campaign = {
      id: 'camp-1', clientId: 'client-1', frequency: 'daily',
      timesPerCycle: 1, scheduleConfig: { times: ['09:00'] }, postToStory: true,
    };
    const slots = generateSlots(campaign, FUTURE_DATE, 1);
    expect(slots.length).toBe(1);
    const d = new Date(slots[0].scheduledFor);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(0);
  });

  test('weekly: generates slot only on specified day', () => {
    // 2099-01-01 is a Thursday (day 4). Next Friday is 2099-01-02 (day 5).
    const campaign = {
      id: 'camp-1', clientId: 'client-1', frequency: 'weekly',
      timesPerCycle: 1, scheduleConfig: { days: ['friday'], time: '12:00' }, postToStory: false,
    };
    const slots = generateSlots(campaign, FUTURE_DATE, 14);
    expect(slots.length).toBe(2); // two Fridays in 14 days
    slots.forEach(s => {
      expect(new Date(s.scheduledFor).getUTCDay()).toBe(5);
    });
  });

  test('monthly: generates slot on correct date', () => {
    const campaign = {
      id: 'camp-1', clientId: 'client-1', frequency: 'monthly',
      timesPerCycle: 1, scheduleConfig: { date: 1, time: '10:00' }, postToStory: true,
    };
    // Start from 2099-01-02 so Jan 1 is skipped; Feb 1 and Mar 1 should appear in 60 days
    const slots = generateSlots(campaign, new Date('2099-01-02T00:00:00.000Z'), 60);
    expect(slots.length).toBe(2);
    slots.forEach(s => {
      expect(new Date(s.scheduledFor).getUTCDate()).toBe(1);
    });
  });

  test('daily: DST fall-back day stays at the requested wall-clock time', () => {
    // US DST ends 2026-11-01 (02:00 EDT → 01:00 EST). A 05:00 slot is after the
    // switch, so it is 05:00 EST = 10:00 UTC. The old single-pass offset math put
    // it an hour early (09:00 UTC / 04:00 local).
    const campaign = {
      id: 'camp-1', clientId: 'client-1', frequency: 'daily',
      timesPerCycle: 1, scheduleConfig: { times: ['05:00'] }, postToStory: true,
    };
    const slots = generateSlots(campaign, new Date('2026-11-01T12:00:00.000Z'), 1, { timezone: 'America/New_York' });
    expect(slots.length).toBe(1);
    const d = new Date(slots[0].scheduledFor);
    expect(d.getUTCHours()).toBe(10);
    expect(d.getUTCMinutes()).toBe(0);
  });

  test('slots have correct shape', () => {
    const campaign = {
      id: 'camp-1', clientId: 'client-1', frequency: 'daily',
      timesPerCycle: 1, scheduleConfig: { times: ['09:00'] }, postToStory: true,
    };
    const slots = generateSlots(campaign, FUTURE_DATE, 1);
    const slot = slots[0];
    expect(slot).toMatchObject({
      campaignId: 'camp-1',
      clientId: 'client-1',
      status: 'pending',
      postToStory: true,
      mediaType: null,
      mediaUrls: [],
      caption: null,
    });
    expect(slot.scheduledFor).toBeInstanceOf(Date);
  });
});
