import { describe, expect, it } from 'vitest';
import { assessServiceArea, BASE, distanceMiles, normalisePostcode, travelFeeForDistance } from '../../src/domain/area.js';
import { POSTCODES } from '../fakes/postcodes.js';

describe('normalisePostcode', () => {
  it.each([
    ['sw47aa', 'SW4 7AA'],
    [' SW4  7AA ', 'SW4 7AA'],
    ['sw1a1aa', 'SW1A 1AA'],
    ['E16AN', 'E1 6AN'],
    ['se10 9nf', 'SE10 9NF'],
  ])('%j -> %j', (input, expected) => {
    expect(normalisePostcode(input)).toBe(expected);
  });

  it.each(['', 'SW4', 'hello', '12345', 'SW4 7AAA', 'Q1 1AA1'])('rejects %j as INVALID_POSTCODE', (input) => {
    expect(() => normalisePostcode(input)).toThrow(expect.objectContaining({ code: 'INVALID_POSTCODE' }));
  });
});

describe('distanceMiles', () => {
  it('is zero from the base to itself', () => {
    expect(distanceMiles(BASE, BASE)).toBe(0);
  });

  it('matches known distances from the Clapham base', () => {
    expect(distanceMiles(BASE, POSTCODES.city)).toBeCloseTo(4.72, 1);
    expect(distanceMiles(BASE, POSTCODES.bromley)).toBeCloseTo(7.72, 1);
  });
});

describe('travelFeeForDistance', () => {
  it.each([
    [0, 0],
    [3, 0],
    [3.01, 1000],
    [6, 1000],
    [6.01, 2000],
    [9, 2000],
  ])('%d miles costs %d pence', (miles, pence) => {
    expect(travelFeeForDistance(miles)).toBe(pence);
  });

  it('returns null beyond 9 miles', () => {
    expect(travelFeeForDistance(9.01)).toBeNull();
  });
});

describe('assessServiceArea', () => {
  it('covers a nearby London postcode with no travel fee', () => {
    expect(assessServiceArea(POSTCODES.westminster)).toEqual({
      postcode: 'SW1A 1AA',
      covered: true,
      borough: 'Westminster',
      distanceMiles: 2.8,
      travelFeePence: 0,
      reason: null,
    });
  });

  it('charges the 6-9 mile band for Bromley', () => {
    expect(assessServiceArea(POSTCODES.bromley)).toMatchObject({ covered: true, travelFeePence: 2000 });
  });

  it('does not cover London postcodes beyond 9 miles', () => {
    expect(assessServiceArea(POSTCODES.wembley)).toMatchObject({ covered: false, travelFeePence: null, reason: 'too_far' });
  });

  it('does not cover a postcode outside London even when it is close', () => {
    const nearButNotLondon = { ...POSTCODES.base, region: 'South East' };
    expect(assessServiceArea(nearButNotLondon)).toMatchObject({ covered: false, reason: 'outside_london' });
  });
});
