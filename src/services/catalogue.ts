import { GAS_EMERGENCY_NOTICE, JOBS, type Job, type JobPricing, type JobType } from '../domain/catalogue.js';
import { CALLOUT_PENCE, EXTRA_HOUR_PENCE } from '../domain/pricing.js';

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

const pounds = (pence: number) => `£${pence / 100}`;

function describePricing(pricing: JobPricing): string {
  if (pricing.kind === 'fixed') return `Fixed price ${pounds(pricing.fixedPence)} ex VAT`;
  return `${pounds(CALLOUT_PENCE)} callout (includes the first hour), then ${pounds(EXTRA_HOUR_PENCE)} per extra hour. Estimated ${pricing.minHours}-${pricing.maxHours} hours, parts ${pounds(pricing.partsMinPence)}-${pounds(pricing.partsMaxPence)}. All ex VAT.`;
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
