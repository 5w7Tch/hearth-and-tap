import { describe, expect, it } from 'vitest';
import { cancelDeadline, canCancel, normalisePhone, toBookingView, type BookingRecord } from '../../src/domain/booking.js';
import { getJob } from '../../src/domain/catalogue.js';
import { priceJob } from '../../src/domain/pricing.js';

describe('normalisePhone', () => {
  it.each([
    ['07700 900123', '+447700900123'],
    ['+44 7700 900123', '+447700900123'],
    ['+44 (0)7700 900123', '+447700900123'],
    ['0044 7700 900123', '+447700900123'],
    ['+44 20 7946 0000', '+442079460000'],
    ['+44 020 7946 0000', '+442079460000'],
    ['(020) 7946-0000', '+442079460000'],
  ])('accepts %s as %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each(['12345', '+1 202 555 0100', 'call me', '0770090012345678', '', '+44 00 1234 5678'])('rejects %j', (input) => {
    expect(() => normalisePhone(input)).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('cancellation deadline', () => {
  const start = new Date('2026-11-09T08:00:00Z');

  it('is two hours before the window start, inclusive', () => {
    expect(cancelDeadline(start).toISOString()).toBe('2026-11-09T06:00:00.000Z');
    expect(canCancel(start, new Date('2026-11-09T06:00:00Z'))).toBe(true);
    expect(canCancel(start, new Date('2026-11-09T06:00:01Z'))).toBe(false);
  });
});

describe('toBookingView', () => {
  const record: BookingRecord = {
    reference: 'HT-000001',
    status: 'confirmed',
    jobType: 'boiler_service',
    urgency: 'standard',
    engineerId: 'eng_dan',
    windowStart: new Date('2026-10-23T07:00:00Z'),
    windowEnd: new Date('2026-10-23T09:00:00Z'),
    postcode: 'SW4 7AA',
    addressLine1: '1 High St',
    customerName: 'Sam',
    customerPhone: '07700900123',
    customerEmail: null,
    problemDescription: 'Service',
    quote: priceJob({ job: getJob('boiler_service'), tier: 'standard', urgency: 'standard', travelFeePence: 0 }),
  };

  it('shows London-time windows, the engineer first name, and hides phone and email', () => {
    const view = toBookingView(record);
    expect(view.window).toEqual({ start: '2026-10-23T08:00:00+01:00', end: '2026-10-23T10:00:00+01:00', label: 'Fri 23 Oct, 8–10am', tier: 'standard' });
    expect(view.engineer).toEqual({ firstName: 'Dan' });
    expect(view.cancellableUntil).toBe('2026-10-23T06:00:00+01:00');
    expect(view.jobLabel).toBe('Annual boiler service');
    expect(JSON.stringify(view)).not.toContain('07700');
  });
});
