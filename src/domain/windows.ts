import { DateTime } from 'luxon';
import { assertEmergencyAllowed, getJob, type JobType, type Urgency } from './catalogue.js';
import { AppError } from './errors.js';
import type { Tier } from './pricing.js';

export const LONDON = 'Europe/London';
const MIN_NOTICE_MINUTES = 60;
export const MAX_HORIZON_DAYS = 14;

/** The first London midnight we no longer take bookings for: today + 14 days. */
function horizonEnd(now: Date): DateTime {
  return DateTime.fromJSDate(now, { zone: LONDON }).startOf('day').plus({ days: MAX_HORIZON_DAYS });
}

export interface Window {
  /** ISO 8601 with the London offset. */
  start: string;
  end: string;
  /** For people, e.g. "Mon 9 Nov, 8–10am". */
  label: string;
  tier: Tier;
}

interface Slot {
  startHour: number;
  tier: Tier;
}

const slots = (tier: Tier, ...startHours: number[]): Slot[] => startHours.map((startHour) => ({ startHour, tier }));

const WEEKDAY_STANDARD = slots('standard', 8, 10, 12, 14, 16);
const WEEKDAY_EVENING_EMERGENCY = slots('out_of_hours', 18, 20);
const SATURDAY = slots('saturday', 9, 11);
const SUNDAY_EMERGENCY = slots('out_of_hours', 10, 12, 14);

const SATURDAY_WEEKDAY = 6;
const SUNDAY_WEEKDAY = 7;

/** A bank holiday counts as a Sunday (SDD §4.7.3). */
function slotsForDay(date: DateTime, isBankHoliday: boolean, urgency: Urgency): Slot[] {
  const emergency = urgency === 'emergency';
  if (isBankHoliday || date.weekday === SUNDAY_WEEKDAY) return emergency ? SUNDAY_EMERGENCY : [];
  if (date.weekday === SATURDAY_WEEKDAY) return SATURDAY;
  return emergency ? [...WEEKDAY_STANDARD, ...WEEKDAY_EVENING_EMERGENCY] : WEEKDAY_STANDARD;
}

const hour12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
const meridiem = (h: number) => (h < 12 ? 'am' : 'pm');

/** (8, 10) -> "8–10am"; (10, 12) -> "10am–12pm". */
function hoursLabel(startHour: number, endHour: number): string {
  const startMeridiem = meridiem(startHour) === meridiem(endHour) ? '' : meridiem(startHour);
  return `${hour12(startHour)}${startMeridiem}–${hour12(endHour)}${meridiem(endHour)}`;
}

function iso(dt: DateTime): string {
  const value = dt.toISO({ suppressMilliseconds: true });
  if (value === null) throw new Error('Invalid DateTime');
  return value;
}

interface GenerateInput {
  /** First day, YYYY-MM-DD, read as a London calendar date. */
  from: string;
  days: number;
  now: Date;
  jobType: JobType;
  urgency: Urgency;
  /** England & Wales bank holidays, YYYY-MM-DD. */
  bankHolidays: ReadonlySet<string>;
}

/** All bookable arrival windows in the range, in time order, ignoring engineer availability. */
export function generateWindows({ from, days, now, jobType, urgency, bankHolidays }: GenerateInput): Window[] {
  assertEmergencyAllowed(getJob(jobType), urgency);
  const earliest = DateTime.fromJSDate(now).plus({ minutes: MIN_NOTICE_MINUTES });
  const latest = horizonEnd(now);
  const firstDay = DateTime.fromISO(from, { zone: LONDON, locale: 'en' }).startOf('day');
  if (!firstDay.isValid) throw new AppError('VALIDATION_ERROR', '"from" must be a real calendar date in YYYY-MM-DD format.');
  const result: Window[] = [];

  for (let i = 0; i < days; i++) {
    const day = firstDay.plus({ days: i });
    const isBankHoliday = bankHolidays.has(day.toISODate() ?? '');
    for (const { startHour, tier } of slotsForDay(day, isBankHoliday, urgency)) {
      const start = day.set({ hour: startHour });
      if (start < earliest || start >= latest) continue;
      result.push({ ...describeWindow(start.toJSDate(), day.set({ hour: startHour + 2 }).toJSDate()), tier });
    }
  }
  return result;
}

/** The generated window that starts exactly at `windowStart`, or null if there is none. */
export function findWindow({ windowStart, ...rest }: Omit<GenerateInput, 'from' | 'days'> & { windowStart: Date }): Window | null {
  const from = DateTime.fromJSDate(windowStart, { zone: LONDON }).toISODate();
  if (from === null) return null;
  return generateWindows({ ...rest, from, days: 1 }).find((w) => Date.parse(w.start) === windowStart.getTime()) ?? null;
}

/** ISO string with the London offset for an instant. */
export function toLondonIso(date: Date): string {
  return iso(DateTime.fromJSDate(date, { zone: LONDON }));
}

export function describeWindow(start: Date, end: Date): Pick<Window, 'start' | 'end' | 'label'> {
  const s = DateTime.fromJSDate(start, { zone: LONDON }).setLocale('en');
  const e = DateTime.fromJSDate(end, { zone: LONDON });
  return { start: iso(s), end: iso(e), label: `${s.toFormat('ccc d LLL')}, ${hoursLabel(s.hour, e.hour)}` };
}

/** Today's date in London, YYYY-MM-DD. */
export function londonDate(now: Date): string {
  const date = DateTime.fromJSDate(now, { zone: LONDON }).toISODate();
  if (date === null) throw new Error('Invalid date');
  return date;
}

/** The last London date we take bookings for (today + 13), YYYY-MM-DD. */
export function lastBookableDate(now: Date): string {
  return londonDate(horizonEnd(now).minus({ days: 1 }).toJSDate());
}
