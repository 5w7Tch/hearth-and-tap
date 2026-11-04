import type { PostcodeLocation } from '../../src/domain/area.js';
import type { PostcodeLookup } from '../../src/adapters/postcodes.js';
import { AppError } from '../../src/domain/errors.js';

// Real postcodes.io records (fetched 2026-11-04), trimmed to the fields we use.
export const POSTCODES = {
  base: { postcode: 'SW4 7AA', region: 'London', borough: 'Lambeth', latitude: 51.461518, longitude: -0.137855 },
  westminster: { postcode: 'SW1A 1AA', region: 'London', borough: 'Westminster', latitude: 51.50101, longitude: -0.141563 },
  city: { postcode: 'E1 6AN', region: 'London', borough: 'City of London', latitude: 51.518887, longitude: -0.078479 },
  greenwich: { postcode: 'SE10 9NF', region: 'London', borough: 'Greenwich', latitude: 51.480285, longitude: -0.00602 },
  bromley: { postcode: 'BR1 1AA', region: 'London', borough: 'Bromley', latitude: 51.401545, longitude: 0.01544 },
  wembley: { postcode: 'HA0 2AA', region: 'London', borough: 'Brent', latitude: 51.552223, longitude: -0.298015 },
  redhill: { postcode: 'RH1 1AA', region: 'South East', borough: 'Reigate and Banstead', latitude: 51.240565, longitude: -0.164656 },
} satisfies Record<string, PostcodeLocation>;

export interface FakePostcodes extends PostcodeLookup {
  calls: string[];
}

/** In-memory postcode lookup. Unknown postcodes behave like a postcodes.io 404. */
export function fakePostcodes(known: PostcodeLocation[] = Object.values(POSTCODES)): FakePostcodes {
  const byPostcode = new Map(known.map((p) => [p.postcode, p]));
  const calls: string[] = [];
  return {
    calls,
    async lookup(postcode) {
      calls.push(postcode);
      const hit = byPostcode.get(postcode);
      if (!hit) throw new AppError('INVALID_POSTCODE', 'We could not find that postcode.');
      return hit;
    },
  };
}
