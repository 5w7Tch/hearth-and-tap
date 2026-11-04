import type { Deps } from '../deps.js';
import { assertEmergencyAllowed, getJob, type JobType, type Urgency } from '../domain/catalogue.js';
import type { Quote } from '../domain/pricing.js';
import { quoteVisit, requireCoveredArea, requireWindow } from './visit.js';

export interface QuoteRequest {
  jobType: JobType;
  postcode: string;
  urgency: Urgency;
  windowStart?: string | undefined;
}

export type QuoteResult = Quote & {
  jobType: JobType;
  jobLabel: string;
  urgency: Urgency;
  postcode: string;
  windowStart: string | null;
  tierNote: string;
}

export async function getQuote(deps: Deps, { jobType, postcode, urgency, windowStart }: QuoteRequest): Promise<QuoteResult> {
  const job = getJob(jobType);
  assertEmergencyAllowed(job, urgency);
  const area = await requireCoveredArea(deps, postcode);
  const window = windowStart === undefined ? null : await requireWindow(deps, job, urgency, windowStart);
  const quote = quoteVisit(job, area, urgency, window?.tier ?? 'standard');
  return {
    ...quote,
    jobType,
    jobLabel: job.label,
    urgency,
    postcode: area.postcode,
    windowStart: window?.start ?? null,
    tierNote: window
      ? `Priced for ${window.label} (${window.tier} tier).`
      : 'No window chosen, so this is priced at the standard (weekday daytime) tier. Call get_quote again with windowStart for the exact price of a window.',
  };
}
