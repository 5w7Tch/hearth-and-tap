import { describe, expect, it } from 'vitest';
import { getJob } from '../../src/domain/catalogue.js';
import { priceJob } from '../../src/domain/pricing.js';

describe('priceJob', () => {
  it('prices a dripping tap at the standard tier with no travel: 9600-13800', () => {
    const q = priceJob({ job: getJob('dripping_tap'), tier: 'standard', urgency: 'standard', travelFeePence: 0 });
    expect(q.totalLowPence).toBe(9600);
    expect(q.totalHighPence).toBe(13800);
    expect(q.currency).toBe('GBP');
    expect(q.note).toBe('Final price confirmed by the engineer before work starts.');
  });

  it('prices an emergency burst pipe out of hours with GBP20 travel: 22500-51300', () => {
    const q = priceJob({ job: getJob('burst_pipe'), tier: 'out_of_hours', urgency: 'emergency', travelFeePence: 2000 });
    expect(q.totalLowPence).toBe(22500);
    expect(q.totalHighPence).toBe(51300);
  });

  it('prices a fixed-price boiler service on a saturday: 14250-14250', () => {
    const q = priceJob({ job: getJob('boiler_service'), tier: 'saturday', urgency: 'standard', travelFeePence: 0 });
    expect(q.totalLowPence).toBe(14250);
    expect(q.totalHighPence).toBe(14250);
  });

  it('adds no extra labour for 0.5 hours (callout includes the first hour)', () => {
    const q = priceJob({ job: getJob('dripping_tap'), tier: 'standard', urgency: 'standard', travelFeePence: 0 });
    const labour = q.lineItems.find((l) => l.description.startsWith('Labour'))!;
    expect(labour.lowPence).toBe(7500);
    expect(labour.highPence).toBe(7500);
  });

  it('charges 60/h after the first hour', () => {
    const q = priceJob({ job: getJob('burst_pipe'), tier: 'standard', urgency: 'standard', travelFeePence: 0 });
    const labour = q.lineItems[0]!;
    expect(labour.lowPence).toBe(7500);
    expect(labour.highPence).toBe(7500 + 9000);
  });

  it('keeps every amount an integer and VAT consistent with the totals', () => {
    for (const tier of ['standard', 'saturday', 'out_of_hours'] as const) {
      for (const jobType of ['dripping_tap', 'blocked_sink', 'toilet_repair', 'no_heating_hot_water', 'gas_safety_certificate'] as const) {
        const q = priceJob({ job: getJob(jobType), tier, urgency: 'standard', travelFeePence: 1000 });
        for (const n of [q.subtotalLowPence, q.subtotalHighPence, q.vatLowPence, q.vatHighPence, q.totalLowPence, q.totalHighPence]) {
          expect(Number.isInteger(n)).toBe(true);
        }
        expect(q.subtotalLowPence + q.vatLowPence).toBe(q.totalLowPence);
        expect(q.subtotalHighPence + q.vatHighPence).toBe(q.totalHighPence);
      }
    }
  });

  it('lists travel and emergency lines only when they cost something', () => {
    const plain = priceJob({ job: getJob('dripping_tap'), tier: 'standard', urgency: 'standard', travelFeePence: 0 });
    expect(plain.lineItems.map((l) => l.description)).toEqual(['Labour (callout includes first hour)', 'Parts (estimated)']);
    const urgent = priceJob({ job: getJob('burst_pipe'), tier: 'standard', urgency: 'emergency', travelFeePence: 1000 });
    expect(urgent.lineItems.map((l) => l.description)).toEqual([
      'Labour (callout includes first hour)',
      'Parts (estimated)',
      'Travel',
      'Emergency call-out surcharge',
    ]);
  });
});
