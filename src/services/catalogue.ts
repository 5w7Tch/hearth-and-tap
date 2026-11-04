import { GAS_EMERGENCY_NOTICE, JOBS, type Job, type JobPricing, type JobType } from '../domain/catalogue.js';
import { CALLOUT_PENCE, EXTRA_HOUR_PENCE, withVat } from '../domain/pricing.js';

export type ServiceList = {
  services: Array<{
    jobType: JobType;
    label: string;
    gasSafeRequired: boolean;
    emergencyEligible: boolean;
    pricing: JobPricing;
    pricingBasis: string;
  }>;
  safetyNotice: string;
}

/** VAT-inclusive pounds for customers, e.g. 7500 -> "£90". UK consumer prices must include VAT. */
const poundsIncVat = (pence: number) => {
  const gross = withVat(pence);
  return `£${(gross / 100).toFixed(gross % 100 === 0 ? 0 : 2)}`;
};

function describePricing(pricing: JobPricing): string {
  if (pricing.kind === 'fixed') return `Fixed price ${poundsIncVat(pricing.fixedPence)} incl. VAT.`;
  return (
    `${poundsIncVat(CALLOUT_PENCE)} call-out (covers the first hour), then ${poundsIncVat(EXTRA_HOUR_PENCE)} per extra hour. ` +
    `Usually ${pricing.minHours}–${pricing.maxHours} hours; parts about ${poundsIncVat(pricing.partsMinPence)}–${poundsIncVat(pricing.partsMaxPence)}. ` +
    'All prices include VAT. Saturdays, evenings, Sundays, bank holidays and emergencies cost more.'
  );
}

const toService = (job: Job): ServiceList['services'][number] => ({
  jobType: job.type,
  label: job.label,
  gasSafeRequired: job.gasSafeRequired,
  emergencyEligible: job.emergencyEligible,
  pricing: job.pricing,
  pricingBasis: describePricing(job.pricing),
});

export function listServices(): ServiceList {
  return { services: JOBS.map(toService), safetyNotice: GAS_EMERGENCY_NOTICE };
}
