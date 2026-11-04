import { describe, expect, it } from 'vitest';
import { eligibleEngineers } from '../../src/domain/allocation.js';
import { getJob } from '../../src/domain/catalogue.js';

describe('eligibleEngineers', () => {
  it('gas jobs go to Dan then Priya', () => {
    expect(eligibleEngineers(getJob('boiler_service')).map((e) => e.firstName)).toEqual(['Dan', 'Priya']);
  });

  it('non-gas jobs prefer Tom, keeping Gas Safe capacity free', () => {
    expect(eligibleEngineers(getJob('dripping_tap')).map((e) => e.firstName)).toEqual(['Tom', 'Dan', 'Priya']);
  });
});
