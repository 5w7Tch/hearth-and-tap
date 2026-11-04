import type { Deps } from '../deps.js';
import { eligibleEngineers } from '../domain/allocation.js';
import { getJob, type JobType, type Urgency } from '../domain/catalogue.js';
import { AppError } from '../domain/errors.js';
import { generateWindows, lastBookableDate, londonDate, MAX_HORIZON_DAYS, type Window } from '../domain/windows.js';

export interface AvailabilityRequest {
  jobType: JobType;
  urgency: Urgency;
  from?: string | undefined;
  days: number;
}

export type AvailabilityResult = {
  jobType: JobType;
  urgency: Urgency;
  from: string;
  days: number;
  windows: Window[];
}

export async function findAvailability(deps: Deps, { jobType, urgency, from, days }: AvailabilityRequest): Promise<AvailabilityResult> {
  const job = getJob(jobType);
  const start = from ?? londonDate(deps.now());
  const lastDay = lastBookableDate(deps.now());
  if (start > lastDay) {
    throw new AppError('VALIDATION_ERROR', `We take bookings for the next ${MAX_HORIZON_DAYS} days including today, so "from" must be on or before ${lastDay}.`);
  }
  const candidates = generateWindows({ from: start, days, now: deps.now(), jobType, urgency, bankHolidays: await deps.bankHolidays.dates() });
  const first = candidates[0];
  const last = candidates.at(-1);
  if (!first || !last) return { jobType, urgency, from: start, days, windows: [] };

  // One query covers the whole range.
  const booked = await deps.bookings.bookedSlots(new Date(first.start), new Date(last.start));
  const isBooked = (engineerId: string, window: Window) =>
    booked.some((b) => b.engineerId === engineerId && b.windowStart.getTime() === Date.parse(window.start));
  const engineers = eligibleEngineers(job);
  const windows = candidates.filter((w) => engineers.some((e) => !isBooked(e.id, w)));
  return { jobType, urgency, from: start, days, windows };
}
