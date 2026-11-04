import { z } from 'zod';
import { AppError } from '../domain/errors.js';

export interface BankHolidaySource {
  /** England & Wales bank-holiday dates as YYYY-MM-DD. Throws UPSTREAM_UNAVAILABLE. */
  dates(): Promise<ReadonlySet<string>>;
}

const GovUkBody = z.object({
  'england-and-wales': z.object({ events: z.array(z.object({ date: z.iso.date() })) }),
});

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

interface Options {
  now: () => Date;
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
}

/** Client for gov.uk's bank-holiday feed, cached in memory. Failures are never cached. */
export function createGovUkBankHolidays({
  now,
  url = 'https://www.gov.uk/bank-holidays.json',
  fetch: doFetch = fetch,
  timeoutMs = 4000,
  ttlMs = TWELVE_HOURS_MS,
}: Options): BankHolidaySource {
  let cache: { dates: ReadonlySet<string>; fetchedAt: number } | null = null;

  async function load(): Promise<ReadonlySet<string>> {
    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'The bank-holiday calendar is not responding. Please try again shortly.', { cause: err });
    }
    if (!res.ok) {
      throw new AppError('UPSTREAM_UNAVAILABLE', `The bank-holiday calendar returned HTTP ${res.status}.`);
    }
    const parsed = GovUkBody.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'The bank-holiday calendar returned an unexpected response.', { cause: parsed.error });
    }
    return new Set(parsed.data['england-and-wales'].events.map((e) => e.date));
  }

  return {
    async dates() {
      const nowMs = now().getTime();
      if (cache === null || nowMs - cache.fetchedAt >= ttlMs) {
        cache = { dates: await load(), fetchedAt: nowMs };
      }
      return cache.dates;
    },
  };
}
