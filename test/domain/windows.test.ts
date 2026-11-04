import { describe, expect, it } from 'vitest';
import { findWindow, generateWindows, lastBookableDate, type Window } from '../../src/domain/windows.js';
import type { JobType, Urgency } from '../../src/domain/catalogue.js';

const NOW = new Date('2026-11-04T09:00:00Z'); // Wed 4 Nov, 09:00 London (GMT)
const HOLIDAYS = ['2026-12-25', '2026-12-28'];
/** A clock at midnight UTC the day before `date`, so the date is inside both the notice period and the 14-day horizon. */
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 60 * 60 * 1000);

function windows(from: string, opts: { days?: number; now?: Date; jobType?: JobType; urgency?: Urgency; bankHolidays?: string[] } = {}): Window[] {
  return generateWindows({
    from,
    days: opts.days ?? 1,
    now: opts.now ?? NOW,
    jobType: opts.jobType ?? 'dripping_tap',
    urgency: opts.urgency ?? 'standard',
    bankHolidays: new Set(opts.bankHolidays ?? HOLIDAYS),
  });
}

describe('generateWindows', () => {
  it('Mon 9 Nov has 5 standard windows with London offsets and labels', () => {
    const ws = windows('2026-11-09');
    expect(ws.map((w) => w.label)).toEqual([
      'Mon 9 Nov, 8–10am',
      'Mon 9 Nov, 10am–12pm',
      'Mon 9 Nov, 12–2pm',
      'Mon 9 Nov, 2–4pm',
      'Mon 9 Nov, 4–6pm',
    ]);
    expect(new Set(ws.map((w) => w.tier))).toEqual(new Set(['standard']));
    expect(ws[0]).toMatchObject({ start: '2026-11-09T08:00:00+00:00', end: '2026-11-09T10:00:00+00:00' });
  });

  it('Sat 7 Nov has 2 windows on the saturday tier', () => {
    const ws = windows('2026-11-07');
    expect(ws.map((w) => w.label)).toEqual(['Sat 7 Nov, 9–11am', 'Sat 7 Nov, 11am–1pm']);
    expect(ws.every((w) => w.tier === 'saturday')).toBe(true);
  });

  it('Sun 8 Nov has no standard windows but 3 out-of-hours windows for an emergency', () => {
    expect(windows('2026-11-08')).toHaveLength(0);
    const ws = windows('2026-11-08', { jobType: 'burst_pipe', urgency: 'emergency' });
    expect(ws.map((w) => w.label)).toEqual(['Sun 8 Nov, 10am–12pm', 'Sun 8 Nov, 12–2pm', 'Sun 8 Nov, 2–4pm']);
    expect(ws.every((w) => w.tier === 'out_of_hours')).toBe(true);
  });

  it('a weekday emergency adds 6-8pm and 8-10pm on the out-of-hours tier', () => {
    const ws = windows('2026-11-09', { jobType: 'burst_pipe', urgency: 'emergency' });
    expect(ws).toHaveLength(7);
    expect(ws.slice(5).map((w) => [w.label, w.tier])).toEqual([
      ['Mon 9 Nov, 6–8pm', 'out_of_hours'],
      ['Mon 9 Nov, 8–10pm', 'out_of_hours'],
    ]);
  });

  it('a Saturday emergency gets no extra windows beyond the saturday ones', () => {
    expect(windows('2026-11-07', { jobType: 'burst_pipe', urgency: 'emergency' })).toHaveLength(2);
  });

  it.each(['2026-12-25', '2026-12-28'])('bank holiday %s: no standard windows, emergency 10am-4pm only', (date) => {
    expect(windows(date, { now: dayBefore(date) })).toHaveLength(0);
    const ws = windows(date, { jobType: 'leak_investigation', urgency: 'emergency', now: dayBefore(date) });
    expect(ws.map((w) => w.start.slice(11, 16))).toEqual(['10:00', '12:00', '14:00']);
    expect(ws.every((w) => w.tier === 'out_of_hours')).toBe(true);
  });

  it('rejects an emergency on a job that is not emergency eligible', () => {
    expect(() => windows('2026-11-09', { urgency: 'emergency' })).toThrowError(expect.objectContaining({ code: 'NOT_EMERGENCY_ELIGIBLE' }));
  });

  describe('DST', () => {
    const emergency = { jobType: 'burst_pipe', urgency: 'emergency' } as const;
    const startOf = (date: string, hhmm: string, extra = emergency) =>
      new Date(windows(date, { ...extra, now: dayBefore(date) }).find((w) => w.start.includes(`T${hhmm}`))!.start).toISOString();

    it('Sun 2026-10-25 10:00 London is 10:00Z (clocks went back that night)', () => {
      expect(startOf('2026-10-25', '10:00')).toBe('2026-10-25T10:00:00.000Z');
    });

    it('Fri 2026-10-23 08:00 London is 07:00Z (still BST)', () => {
      expect(startOf('2026-10-23', '08:00')).toBe('2026-10-23T07:00:00.000Z');
    });

    it('Sun 2027-03-28 10:00 London is 09:00Z (clocks went forward that night)', () => {
      expect(startOf('2027-03-28', '10:00')).toBe('2027-03-28T09:00:00.000Z');
    });

    it.each(['2026-10-22', '2027-03-25'])('a 7-day range from %s across a DST change has no missing or duplicated day', (from) => {
      const ws = windows(from, { days: 7, now: dayBefore(from) });
      const days = ws.map((w) => w.start.slice(0, 10));
      const expected = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
      // Sundays have no standard windows; every other day appears with 5 (weekday) or 2 (Saturday) windows.
      const withWindows = expected.filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 0);
      expect([...new Set(days)]).toEqual(withWindows);
      expect(new Set(ws.map((w) => w.start)).size).toBe(ws.length);
    });
  });

  describe('minimum notice', () => {
    it('includes the 08:00 window at 07:00 London and excludes it at 07:01', () => {
      const at = (iso: string) => windows('2026-11-09', { now: new Date(iso) }).map((w) => w.start.slice(11, 16));
      expect(at('2026-11-09T07:00:00Z')).toContain('08:00');
      expect(at('2026-11-09T07:01:00Z')).not.toContain('08:00');
    });

    it('measures notice in London time during BST', () => {
      // 2026-10-23 is BST: 07:00 London = 06:00Z.
      const at = (iso: string) => windows('2026-10-23', { now: new Date(iso) }).map((w) => w.start.slice(11, 16));
      expect(at('2026-10-23T06:00:00Z')).toContain('08:00');
      expect(at('2026-10-23T06:01:00Z')).not.toContain('08:00');
    });
  });
});

describe('findWindow', () => {
  const input = { now: NOW, jobType: 'dripping_tap', urgency: 'standard', bankHolidays: new Set<string>() } as const;

  it('finds the window that starts at the given instant', () => {
    expect(findWindow({ ...input, windowStart: new Date('2026-11-09T10:00:00Z') })).toMatchObject({ label: 'Mon 9 Nov, 10am–12pm' });
  });

  it('returns null for an instant that is not a window start', () => {
    expect(findWindow({ ...input, windowStart: new Date('2026-11-09T10:30:00Z') })).toBeNull();
    expect(findWindow({ ...input, windowStart: new Date('2026-11-08T10:00:00Z') })).toBeNull();
  });

  it('returns null for a window inside the minimum notice', () => {
    expect(findWindow({ ...input, windowStart: new Date('2026-11-04T09:30:00Z') })).toBeNull();
  });

  it('returns null beyond the 14-day horizon, where bank holidays may be unknown', () => {
    expect(findWindow({ ...input, windowStart: new Date('2026-11-17T16:00:00Z') })).not.toBeNull();
    expect(findWindow({ ...input, windowStart: new Date('2026-11-18T08:00:00Z') })).toBeNull();
    expect(findWindow({ ...input, windowStart: new Date('2030-01-01T08:00:00Z') })).toBeNull();
  });
});

describe('booking horizon and edge days', () => {
  it('takes bookings until London today + 13 (Tue 17 Nov) and none on day 14', () => {
    expect(lastBookableDate(NOW)).toBe('2026-11-17');
    const ws = windows('2026-11-17', { days: 2 });
    expect(ws.map((w) => w.start.slice(0, 10))).toEqual(Array(5).fill('2026-11-17'));
  });

  it('a bank holiday on a Saturday follows Sunday rules', () => {
    expect(windows('2026-11-07', { bankHolidays: ['2026-11-07'] })).toEqual([]);
    const emergency = windows('2026-11-07', { bankHolidays: ['2026-11-07'], jobType: 'burst_pipe', urgency: 'emergency' });
    expect(emergency.map((w) => [w.start.slice(11, 16), w.tier])).toEqual([
      ['10:00', 'out_of_hours'],
      ['12:00', 'out_of_hours'],
      ['14:00', 'out_of_hours'],
    ]);
  });

  it('rejects an impossible from date with VALIDATION_ERROR', () => {
    expect(() => windows('2026-02-31')).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
