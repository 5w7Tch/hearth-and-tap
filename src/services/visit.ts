// Checks shared by quoting and booking, so both enforce the same rules.
import type { Deps } from '../deps.js';
import { normalisePostcode, type ServiceArea } from '../domain/area.js';
import { assertEmergencyAllowed, type Job, type Urgency } from '../domain/catalogue.js';
import { AppError } from '../domain/errors.js';
import { priceJob, type Quote, type Tier } from '../domain/pricing.js';
import { findWindow, type Window } from '../domain/windows.js';
import { checkServiceArea } from './area.js';

/** The covered area for a postcode. Throws OUT_OF_AREA when we do not serve it. */
export async function requireCoveredArea(deps: Pick<Deps, 'postcodes'>, rawPostcode: string): Promise<ServiceArea & { travelFeePence: number }> {
  const area = await checkServiceArea(deps, normalisePostcode(rawPostcode));
  if (!area.covered || area.travelFeePence === null) {
    throw new AppError('OUT_OF_AREA', `Sorry, we do not cover ${area.postcode}. We serve London within 9 miles of Clapham.`);
  }
  return { ...area, travelFeePence: area.travelFeePence };
}

/** The real window starting at `windowStart` for this job and urgency, or INVALID_WINDOW. */
export async function requireWindow(deps: Pick<Deps, 'bankHolidays' | 'now'>, job: Job, urgency: Urgency, windowStart: string): Promise<Window> {
  assertEmergencyAllowed(job, urgency);
  const window = findWindow({
    windowStart: new Date(windowStart),
    now: deps.now(),
    jobType: job.type,
    urgency,
    bankHolidays: await deps.bankHolidays.dates(),
  });
  if (window === null) {
    throw new AppError('INVALID_WINDOW', 'That is not an open arrival window for this job (we book for the next 14 days including today). Call find_availability and pick one of the windows it returns.');
  }
  return window;
}

export function quoteVisit(job: Job, area: { travelFeePence: number }, urgency: Urgency, tier: Tier): Quote {
  return priceJob({ job, tier, urgency, travelFeePence: area.travelFeePence });
}
