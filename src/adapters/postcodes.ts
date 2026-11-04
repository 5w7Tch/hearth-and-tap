import { z } from 'zod';
import type { PostcodeLocation } from '../domain/area.js';
import { AppError } from '../domain/errors.js';

export interface PostcodeLookup {
  /** Looks up a normalised postcode. Throws INVALID_POSTCODE or UPSTREAM_UNAVAILABLE. */
  lookup(postcode: string): Promise<PostcodeLocation>;
}

// Only the fields we use; postcodes.io returns many more.
const PostcodesIoBody = z.object({
  result: z.object({
    postcode: z.string(),
    region: z.string().nullable(),
    admin_district: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }),
});

interface Options {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Client for the public postcodes.io API (https://postcodes.io). */
export function createPostcodesIo({ baseUrl = 'https://api.postcodes.io', fetch: doFetch = fetch, timeoutMs = 4000 }: Options = {}): PostcodeLookup {
  return {
    async lookup(postcode) {
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/postcodes/${encodeURIComponent(postcode)}`, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'The postcode service is not responding. Please try again shortly.', { cause: err });
      }
      if (res.status === 404) {
        throw new AppError('INVALID_POSTCODE', 'We could not find that postcode.');
      }
      if (!res.ok) {
        throw new AppError('UPSTREAM_UNAVAILABLE', `The postcode service returned HTTP ${res.status}.`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'The postcode service returned an unreadable response.', { cause: err });
      }
      const parsed = PostcodesIoBody.safeParse(body);
      if (!parsed.success) {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'The postcode service returned an unexpected response.', { cause: parsed.error });
      }
      const { result } = parsed.data;
      if (result.latitude === null || result.longitude === null) {
        throw new AppError('INVALID_POSTCODE', 'That postcode has no address we can visit.');
      }
      return {
        postcode: result.postcode,
        region: result.region,
        borough: result.admin_district,
        latitude: result.latitude,
        longitude: result.longitude,
      };
    },
  };
}
