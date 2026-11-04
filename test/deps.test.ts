import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProductionDeps } from '../src/deps.js';
import { REFERENCE_PATTERN } from '../src/domain/reference.js';

afterEach(() => vi.unstubAllEnvs());

describe('buildProductionDeps', () => {
  it('throws when DATABASE_URL is missing', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => buildProductionDeps()).toThrow(/DATABASE_URL is not set/);
  });

  it('wires real clock, references and clients when DATABASE_URL is set (no connection is made yet)', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://user:pass@example.neon.tech/db');
    const deps = buildProductionDeps();
    expect(deps.newReference()).toMatch(REFERENCE_PATTERN);
    expect(Math.abs(deps.now().getTime() - Date.now())).toBeLessThan(1000);
    expect(typeof deps.bookings.insertIfFree).toBe('function');
    expect(typeof deps.bankHolidays.dates).toBe('function');
  });
});
