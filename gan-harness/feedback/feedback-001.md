# Evaluation: Iteration 001 (slices 2-5)

## Evaluation Mode

**Achieved:** `code-only` (as requested). No browser or dev server. I ran `npm test`, `npm run typecheck` and `npm run test:coverage`. I read `src/**`, `test/**`, `db/**` and `scripts/**`. I also ran my own `npx tsx` checks against the domain functions (script kept in the scratchpad, no source files modified).

Command results (my own runs):
- `npm test`: 19 files, 205 tests, all pass (6.6 s).
- `npm run typecheck`: clean.
- `npm run test:coverage`: Statements 97.43, Branches 93.16, Functions 97.18, Lines 99.44. The thresholds in `vitest.config.ts` are 80 on all four metrics.

## Scores

| Criterion | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Spec correctness | 8.0/10 | 0.40 | 3.20 |
| Test quality | 8.0/10 | 0.25 | 2.00 |
| Craft | 8.5/10 | 0.20 | 1.70 |
| Agent-facing contract | 8.0/10 | 0.15 | 1.20 |
| **TOTAL** | | | **8.1/10** |

## Verdict: PASS (threshold: 7.0)

## Independently verified (not taken from generator-state)

- **Quote values:**
  - dripping_tap, standard, £0 travel: 9600-13800.
  - burst_pipe, emergency, out_of_hours, £20 travel: 22500-51300.
  - boiler_service, saturday: 14250-14250.
  - All maths is integer. `labourPence` uses `base * percent / 100`, and I found no input that produces a fractional pence. VAT is rounded once on the subtotal (`pricing.ts:72-73`).
- **DST:**
  - Sun 2026-10-25 10:00 London = 10:00Z.
  - Fri 2026-10-23 08:00 = 07:00Z.
  - Sun 2027-03-28 10:00 = 09:00Z.
  - Output is identical under `TZ=America/Los_Angeles`, so there is no host-timezone leak.
  - A 7-day range from 2026-10-22 has no gaps or duplicates.
  - Windows use `day.set({hour})` on a London-zone `DateTime`, so there are no UTC-offset arithmetic bugs.
- **Bank holidays:** Fri 2026-12-25 and Mon 2026-12-28 give 0 standard windows and emergency 10-12, 12-14, 14-16 only (out_of_hours tier). Matches SDD §4.7.3.
- **Minimum notice:** at now = 07:00Z the 08:00 window is present. At 07:01Z the first window is 10:00 (the 08:00 window is dropped). The comparison is `start < earliest`, so exactly +60 min is included.
- **Engineer order:** `ENGINEERS` is Tom, Dan, Priya (`catalogue.ts:58-62`). Gas jobs filter to Dan, Priya.
- **Allocation SQL (`bookingsRepo.ts:77-91`):**
  - `ON CONFLICT (engineer_id, window_start) WHERE status = 'confirmed' DO NOTHING` matches the partial index predicate in `db/migrations/001_bookings.sql:22-23`.
  - Every value is a `$n` parameter. There is no string concatenation anywhere in the SQL.
  - Timestamps are bound as ISO strings with `::timestamptz`.
- **Idempotency:** `bookVisit` selects by key first (`booking.ts:68`). A `23505` re-selects by key, otherwise retries once with a fresh reference (`booking.ts:53-65`). Replay returns `created:false`, which is 200 on REST.
- **404 parity:** `findOwnBooking` (`booking.ts:80-85`) throws the same `NOT_FOUND` for an unknown reference and a postcode mismatch. The REST test compares the raw response text.
- **Cancel boundary:** `canCancel` is `now <= start - 2h` (`booking.ts:51-53`). Tested at exactly -2h (200) and -1h59m (409).
- **Non-London offset `windowStart`:** `2026-11-09T09:00:00+01:00` resolves to the 08:00Z window. `findWindow` compares instants, not strings, so any offset works.
- **`from`:** read as a London calendar date (`windows.ts:70`). The default is the London date of `now` (`londonDate`), tested near midnight. `2026-02-31` is rejected by `z.iso.date()` (400).
- **REST == MCP:** both go through the same service functions and shared zod schemas. A parity test covers all 7 capabilities.
- **Annotations:** correct. `book_visit` is non-destructive and idempotent. `cancel_booking` is destructive and idempotent. Reads are `readOnlyHint`.

## Critical Issues (must fix)

None. Tests are green, `tsc` is clean, every required number matches and no SDD rule is missing.

## Major Issues (should fix)

1. **Booking horizon is not enforced server-side.**
   - Where: `src/domain/windows.ts:86-90` (`findWindow`) and `src/services/visit.ts:20-33` (`requireWindow`).
   - SDD §4.3 says "Horizon: default 7 days, max 14", and §4.6 says the server re-validates everything.
   - `findWindow` accepts any future date. I generated 54 valid windows starting 2030-01-01.
   - `get_quote` and `book_visit` therefore accept `windowStart` months or years ahead.
   - Beyond the gov.uk feed's range, bank holidays are unknown, so such a booking would be priced and accepted as a normal weekday.
   - Fix: add `MAX_HORIZON_DAYS = 14` in `windows.ts`. In `findWindow`, return null when the window start is after `londonDate(now) + 14 days` (end of day). Add a test for a booking at day 15 (`INVALID_WINDOW`) and day 14 (ok).
   - Also decide whether `find_availability` `from` should be capped (for example `from <= today + 14`).

2. **An idempotency key replay discloses another customer's booking.**
   - Where: `src/services/booking.ts:68-69` (SDD §4.7.6).
   - A replay returns the stored `BookingView` (name, address, postcode) without checking the caller's payload.
   - Keys are global across customers, and agent-generated keys such as `booking-1` are guessable. Anyone who sends a guessed key gets the original customer's name and address back, without the reference+postcode check that `get_booking` enforces.
   - This follows the letter of §4.7.6, so it is a design risk, not an implementation error.
   - Fix (needs a human decision, since it changes §4.7.6): on replay, require `normalisePostcode(request.postcode) === existing.postcode`, otherwise return `VALIDATION_ERROR` or 409 with no booking data. Alternatively, at minimum document the risk in the NOTE.

3. **Concurrency tests do not exercise real concurrent connections.**
   - Where: `test/services/booking.test.ts:38-49` and `:78-85`, and `test/fakes/db.ts`.
   - PGlite is a single connection, so `Promise.all` interleaves only at `await` points. Postgres never arbitrates a true race. The `23505` race path is reached only by interleaving.
   - The required tests exist and assert real behaviour. But the claim "double-booking impossible under concurrent requests" rests on the index, which is only proven by the raw-duplicate-insert test (`bookingsRepo.test.ts:56`).
   - Fix: say this in the test comments. If a real DB is available later, add one test against `DATABASE_URL` or a Postgres container with two pooled connections.

4. **Schema-level MCP validation errors don't use the documented error contract.**
   - Where: the MCP SDK validates `inputSchema` before `runTool`. Known issue in generator-state.
   - The tool descriptions tell the LLM "On VALIDATION_ERROR fix the input" (`bookVisit.ts:17`). A bad `idempotencyKey`, `days=99` or malformed `windowStart` over MCP gets the SDK's own message with no `code`, and the description's recovery advice doesn't match.
   - I did not run this myself. It rests on the generator's note and on how the SDK works.
   - Fix: either add a test pinning the actual SDK behaviour and soften the descriptions ("fix the input if the tool reports invalid arguments"), or register the tools with a permissive `z.object({}).passthrough()` input. Then parse with the shared schema inside `runTool` and map failures to `AppError('VALIDATION_ERROR')` (also removes the REST/MCP validation divergence).

## Minor Issues (nice to fix)

1. **Whitespace-only text passes validation.**
   - Where: `src/schemas.ts:~128-135` (`name`, `addressLine1`, `problemDescription`).
   - `.min(1)` accepts `"   "`. Fix: `.trim().min(1)` (zod v4 supports `.trim()`).
2. **Plain `Error` for an invalid `from` at service level.**
   - Where: `windows.ts:49-53` and `:75`.
   - `generateWindows({from:'2026-02-31'})` throws a bare `Error('Invalid DateTime')`. The REST and MCP schemas block this, so it's unreachable today.
   - Fix: check `firstDay.isValid` and throw `AppError('VALIDATION_ERROR', ...)`.
3. **Error body shapes differ between transports.**
   - Where: `src/http/problem.ts:8` (`{type,title,status,code,detail}`) versus `src/mcp/runTool.ts:18` (`{code,message}`).
   - The code is shared, but the field name differs (`detail` vs `message`).
   - Fix: use one `toErrorBody(err)` helper, or document it.
4. **`neon.ts` is untested** (coverage 66.7% on that file, line 9). Overall coverage is still fine.
   - The Date/string handling in `bookingsRepo.toRecord` is correct. I checked that V8 parses Postgres text `2026-11-09 08:00:00+00`.
   - Fix: add a test with a fake `neon` function, or run the smoke script against a staging branch before the first deploy.
5. **Smoke script leaves a confirmed booking if `cancel_booking` fails** (`scripts/smoke.ts:102-104`). It has no cleanup path, and the booking holds a slot.
   - Fix: use the `SMOKE`-prefixed key and log the reference up front, or cancel in a `finally`.
6. **No test for a bank holiday on a Saturday.** `slotsForDay` (`windows.ts:35`) gives Sunday rules, so the emergency 10-16 windows replace the Saturday windows. SDD §4.7.3 supports this. Add a test with a faked Saturday holiday so the behaviour is pinned.
7. **OpenAPI omits 500 `INTERNAL_ERROR`** from every operation (`problem.ts` `problemResponses` calls), and the `label` example in `schemas.ts` uses `8-10am` with a hyphen while the code emits an en dash.
8. **`cancellableUntil` is returned for cancelled and past bookings.** It is accurate but potentially confusing for an LLM. Add a sentence to the field description.

## What was done well (do not regress)

- Domain stays pure. `now` and `bankHolidays` are injected, and the DST handling is done through Luxon zone arithmetic. This is the hardest part and it is correct.
- Integer-pence money with percentage maths, and a test that asserts `Number.isInteger` on every field.
- Shared validation in `services/visit.ts` for quote and booking, so rules aren't duplicated.
- Allocation SQL is fully parameterised, and the `ON CONFLICT` target matches the partial index.
- Loud failures: no `catch {}`, no `any`, unexpected errors logged and turned into a generic `INTERNAL_ERROR`. Reference-clash retry gives up loudly.
- Strong LLM-facing descriptions: each tool says when to call it, the units (pence, ex/incl VAT) and a recovery action per error code. Server `instructions` repeat the gas-safety rule.
- Real-SQL tests on PGlite running the actual migration. 404 parity is compared byte-for-byte.
- `/openapi.json` documents all 8 operations with problem+json error responses.

## What Improved Since Last Iteration

- Slice 1 (49 tests) still passes. No regression. The suite grew to 205 tests with 97% statement coverage.

## What Regressed Since Last Iteration

- Nothing found. (`vitest.config.ts` timeouts raised to 30 s to cope with parallel PGlite boots. It is acceptable and documented.)

## Specific Suggestions for Next Iteration

1. Enforce the 14-day horizon in `findWindow` and add boundary tests (Major 1).
2. Decide on the idempotency-replay disclosure (Major 2). Put the decision in the NOTE.
3. Pin MCP argument-validation behaviour with a test and align the tool descriptions (Major 4).
4. Trim whitespace in free-text fields and give `generateWindows` a typed error for invalid `from` (Minor 1-2).
5. Unify the REST/MCP error body (Minor 3).

## Screenshots

None (code-only mode).
