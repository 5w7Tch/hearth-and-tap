import { describe, expect, it } from 'vitest';
import { ENGINEERS, GAS_EMERGENCY_NOTICE, JOBS, assertEmergencyAllowed, getJob } from '../../src/domain/catalogue.js';

describe('catalogue', () => {
  it('has the 9 jobs from the SDD', () => {
    expect(JOBS.map((j) => j.type)).toEqual([
      'dripping_tap', 'blocked_sink', 'toilet_repair', 'leak_investigation', 'burst_pipe',
      'radiator_problem', 'no_heating_hot_water', 'boiler_service', 'gas_safety_certificate',
    ]);
  });

  it('marks gas and emergency eligibility', () => {
    expect(JOBS.filter((j) => j.gasSafeRequired).map((j) => j.type)).toEqual(['no_heating_hot_water', 'boiler_service', 'gas_safety_certificate']);
    expect(JOBS.filter((j) => j.emergencyEligible).map((j) => j.type)).toEqual(['leak_investigation', 'burst_pipe', 'no_heating_hot_water']);
  });

  it('has three engineers, Tom being the only one without Gas Safe', () => {
    expect(ENGINEERS.filter((e) => !e.gasSafe).map((e) => e.firstName)).toEqual(['Tom']);
    expect(ENGINEERS).toHaveLength(3);
  });

  it('carries the gas emergency number', () => {
    expect(GAS_EMERGENCY_NOTICE).toContain('0800 111 999');
  });

  it('rejects emergency urgency on an ineligible job but allows it otherwise', () => {
    expect(() => assertEmergencyAllowed(getJob('dripping_tap'), 'emergency')).toThrowError(expect.objectContaining({ code: 'NOT_EMERGENCY_ELIGIBLE' }));
    expect(() => assertEmergencyAllowed(getJob('dripping_tap'), 'standard')).not.toThrow();
    expect(() => assertEmergencyAllowed(getJob('burst_pipe'), 'emergency')).not.toThrow();
  });
});
