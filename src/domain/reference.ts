// Crockford base32: no I, L, O or U, so references survive being read out over the phone.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 6;

export const REFERENCE_PATTERN = /^HT-[0-9A-HJKMNP-TV-Z]{6}$/;

/** `randomBytes` is injected so this stays pure. 256 is a multiple of 32, so `byte % 32` is unbiased. */
export function makeReference(randomBytes: (length: number) => Uint8Array): string {
  const chars = Array.from(randomBytes(LENGTH), (byte) => ALPHABET[byte % ALPHABET.length]);
  return `HT-${chars.join('')}`;
}
