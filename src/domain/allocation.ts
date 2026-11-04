import { ENGINEERS, type Engineer, type Job } from './catalogue.js';

/** Engineers who can do the job, in the order we try them. Gas jobs need Gas Safe. */
export function eligibleEngineers(job: Job): Engineer[] {
  return ENGINEERS.filter((e) => e.gasSafe || !job.gasSafeRequired);
}
