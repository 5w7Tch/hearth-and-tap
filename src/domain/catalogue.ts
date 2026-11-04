import { AppError } from './errors.js';

export const JOB_TYPES = [
  'dripping_tap',
  'blocked_sink',
  'toilet_repair',
  'leak_investigation',
  'burst_pipe',
  'radiator_problem',
  'no_heating_hot_water',
  'boiler_service',
  'gas_safety_certificate',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type Urgency = 'standard' | 'emergency';

export type JobPricing =
  /** Callout (includes the first hour) plus hourly labour. Hours and parts are ranges. Money in pence ex VAT. */
  | { kind: 'hourly'; minHours: number; maxHours: number; partsMinPence: number; partsMaxPence: number }
  | { kind: 'fixed'; fixedPence: number };

export interface Job {
  type: JobType;
  label: string;
  gasSafeRequired: boolean;
  emergencyEligible: boolean;
  pricing: JobPricing;
}

const hourly = (minHours: number, maxHours: number, partsMinPounds: number, partsMaxPounds: number): JobPricing => ({
  kind: 'hourly',
  minHours,
  maxHours,
  partsMinPence: partsMinPounds * 100,
  partsMaxPence: partsMaxPounds * 100,
});

export const JOBS: readonly Job[] = [
  { type: 'dripping_tap', label: 'Dripping or leaking tap', gasSafeRequired: false, emergencyEligible: false, pricing: hourly(0.5, 1, 5, 40) },
  { type: 'blocked_sink', label: 'Blocked sink, bath or shower', gasSafeRequired: false, emergencyEligible: false, pricing: hourly(0.5, 1.5, 0, 20) },
  { type: 'toilet_repair', label: 'Toilet running, not flushing or leaking', gasSafeRequired: false, emergencyEligible: false, pricing: hourly(1, 1.5, 10, 80) },
  { type: 'leak_investigation', label: 'Leak or water-damage investigation', gasSafeRequired: false, emergencyEligible: true, pricing: hourly(1, 2, 10, 80) },
  { type: 'burst_pipe', label: 'Burst pipe', gasSafeRequired: false, emergencyEligible: true, pricing: hourly(1, 2.5, 15, 120) },
  { type: 'radiator_problem', label: 'Radiator cold, leaking or noisy', gasSafeRequired: false, emergencyEligible: false, pricing: hourly(1, 2, 0, 90) },
  { type: 'no_heating_hot_water', label: 'No heating or hot water (boiler fault)', gasSafeRequired: true, emergencyEligible: true, pricing: hourly(1, 2, 0, 250) },
  { type: 'boiler_service', label: 'Annual boiler service', gasSafeRequired: true, emergencyEligible: false, pricing: { kind: 'fixed', fixedPence: 9500 } },
  { type: 'gas_safety_certificate', label: 'Landlord gas safety certificate (CP12)', gasSafeRequired: true, emergencyEligible: false, pricing: { kind: 'fixed', fixedPence: 7000 } },
];

export interface Engineer {
  id: string;
  firstName: string;
  gasSafe: boolean;
}

/** In preference order: the non-gas engineer first, which keeps Gas Safe capacity free. */
export const ENGINEERS: readonly Engineer[] = [
  { id: 'eng_tom', firstName: 'Tom', gasSafe: false },
  { id: 'eng_dan', firstName: 'Dan', gasSafe: true },
  { id: 'eng_priya', firstName: 'Priya', gasSafe: true },
];

export const GAS_EMERGENCY_NOTICE =
  'If you smell gas or suspect a carbon monoxide leak, do not book online. Leave the property, avoid switches and flames, and call the National Gas Emergency Service on 0800 111 999.';

export function getJob(type: JobType): Job {
  const job = JOBS.find((j) => j.type === type);
  if (!job) throw new Error(`Unknown job type: ${type}`);
  return job;
}

export function getEngineer(id: string): Engineer {
  const engineer = ENGINEERS.find((e) => e.id === id);
  if (!engineer) throw new Error(`Unknown engineer: ${id}`);
  return engineer;
}

export function assertEmergencyAllowed(job: Job, urgency: Urgency): void {
  if (urgency === 'emergency' && !job.emergencyEligible) {
    throw new AppError('NOT_EMERGENCY_ELIGIBLE', `${job.label} is not an emergency job. Book a standard visit instead.`);
  }
}
