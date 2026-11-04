import type { Job, Urgency } from './catalogue.js';

export type Tier = 'standard' | 'saturday' | 'out_of_hours';

export interface LineItem {
  description: string;
  /** Pence ex VAT. */
  lowPence: number;
  highPence: number;
}

export type Quote = {
  tier: Tier;
  lineItems: LineItem[];
  subtotalLowPence: number;
  subtotalHighPence: number;
  vatLowPence: number;
  vatHighPence: number;
  totalLowPence: number;
  totalHighPence: number;
  currency: 'GBP';
  note: string;
}

export const QUOTE_NOTE = 'Final price confirmed by the engineer before work starts.';

export const CALLOUT_PENCE = 7500;
export const EXTRA_HOUR_PENCE = 6000;
const EMERGENCY_SURCHARGE_PENCE = 4000;
const VAT_PERCENT = 20;
/** Adds VAT to an ex-VAT amount in pence, rounding once to the nearest penny. */
export function withVat(pence: number): number {
  return Math.round((pence * (100 + VAT_PERCENT)) / 100);
}

/** Labour multiplier as a whole percentage, so all arithmetic stays in integers. */
const TIER_PERCENT: Record<Tier, number> = { standard: 100, saturday: 125, out_of_hours: 150 };

interface PriceInput {
  job: Job;
  tier: Tier;
  urgency: Urgency;
  travelFeePence: number;
}

function labourPence(job: Job, hours: number | null, tier: Tier): number {
  const base = job.pricing.kind === 'fixed' ? job.pricing.fixedPence : CALLOUT_PENCE + Math.max(0, (hours ?? 0) - 1) * EXTRA_HOUR_PENCE;
  return (base * TIER_PERCENT[tier]) / 100;
}

/** Pure quote calculation. Every amount is integer pence; VAT is rounded once, on the subtotal. */
export function priceJob({ job, tier, urgency, travelFeePence }: PriceInput): Quote {
  const { pricing } = job;
  const labour: LineItem =
    pricing.kind === 'fixed'
      ? { description: 'Labour (fixed price)', lowPence: labourPence(job, null, tier), highPence: labourPence(job, null, tier) }
      : {
          description: 'Labour (callout includes first hour)',
          lowPence: labourPence(job, pricing.minHours, tier),
          highPence: labourPence(job, pricing.maxHours, tier),
        };
  const parts: LineItem =
    pricing.kind === 'fixed'
      ? { description: 'Parts (estimated)', lowPence: 0, highPence: 0 }
      : { description: 'Parts (estimated)', lowPence: pricing.partsMinPence, highPence: pricing.partsMaxPence };
  const emergency = urgency === 'emergency' ? EMERGENCY_SURCHARGE_PENCE : 0;

  const lineItems = [
    labour,
    parts,
    { description: 'Travel', lowPence: travelFeePence, highPence: travelFeePence },
    { description: 'Emergency call-out surcharge', lowPence: emergency, highPence: emergency },
  ].filter((item, i) => i === 0 || item.highPence > 0);

  const subtotalLowPence = lineItems.reduce((sum, i) => sum + i.lowPence, 0);
  const subtotalHighPence = lineItems.reduce((sum, i) => sum + i.highPence, 0);
  const totalLowPence = withVat(subtotalLowPence);
  const totalHighPence = withVat(subtotalHighPence);

  return {
    tier,
    lineItems,
    subtotalLowPence,
    subtotalHighPence,
    vatLowPence: totalLowPence - subtotalLowPence,
    vatHighPence: totalHighPence - subtotalHighPence,
    totalLowPence,
    totalHighPence,
    currency: 'GBP',
    note: QUOTE_NOTE,
  };
}
