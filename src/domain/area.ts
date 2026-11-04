import { AppError } from './errors.js';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface PostcodeLocation extends GeoPoint {
  postcode: string;
  region: string | null;
  borough: string | null;
}

export type ServiceArea = {
  postcode: string;
  covered: boolean;
  borough: string | null;
  distanceMiles: number;
  /** Travel fee in pence, ex VAT. Null when the postcode is not covered. */
  travelFeePence: number | null;
  reason: 'outside_london' | 'too_far' | null;
};

/** Our yard in Clapham (SW4 outcode centroid). */
export const BASE: GeoPoint = { latitude: 51.46096, longitude: -0.13646 };

const TRAVEL_BANDS = [
  { upToMiles: 3, feePence: 0 },
  { upToMiles: 6, feePence: 1000 },
  { upToMiles: 9, feePence: 2000 },
] as const;

const UK_POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/;
const EARTH_RADIUS_MILES = 3958.8;

/** "sw47aa" -> "SW4 7AA". Throws INVALID_POSTCODE for anything that is not a full UK postcode. */
export function normalisePostcode(input: string): string {
  const compact = input.replace(/\s+/g, '').toUpperCase();
  if (!UK_POSTCODE.test(compact)) {
    throw new AppError('INVALID_POSTCODE', 'That is not a full UK postcode (for example SW4 7AA).');
  }
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** Great-circle (haversine) distance in miles. */
export function distanceMiles(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** Travel fee in pence for a distance, or null when it is beyond our furthest band. */
export function travelFeeForDistance(miles: number): number | null {
  const band = TRAVEL_BANDS.find((b) => miles <= b.upToMiles);
  return band ? band.feePence : null;
}

export function assessServiceArea(location: PostcodeLocation): ServiceArea {
  const miles = distanceMiles(BASE, location);
  const result = {
    postcode: location.postcode,
    borough: location.borough,
    distanceMiles: Math.round(miles * 10) / 10,
  };
  if (location.region !== 'London') {
    return { ...result, covered: false, travelFeePence: null, reason: 'outside_london' };
  }
  const travelFeePence = travelFeeForDistance(miles);
  if (travelFeePence === null) {
    return { ...result, covered: false, travelFeePence: null, reason: 'too_far' };
  }
  return { ...result, covered: true, travelFeePence, reason: null };
}
