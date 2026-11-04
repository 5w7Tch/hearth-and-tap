# GAN harness spec: Hearth & Tap booking service, slices 2–5

**Source of truth:** `docs/SDD.md`, including §4.7 (decisions resolved at Gate 1). If this file and the SDD disagree, the SDD wins.
This is an **API-only** project (TypeScript, Hono, MCP). There is no frontend, so ignore any UI or design guidance in your agent prompt.

Slice 1 is **done and must not regress**: scaffold, service-area check end to end, 49 tests, `tsc` clean.
Run `npm test && npm run typecheck` before you finish.

## Hard constraints

- **Do not `git commit`.** The orchestrator commits after a human review gate. Leave changes in the working tree.
- Do not edit `docs/SDD.md`. Do not write `README.md` or `NOTE.md`; the orchestrator writes those.
- No new npm dependencies. Already installed: `hono`, `@hono/zod-openapi`, `@hono/swagger-ui`, `@modelcontextprotocol/sdk`,
  `zod` (v4), `luxon`, `@neondatabase/serverless`; dev: `@electric-sql/pglite`, `vitest`, `tsx`, `@hono/node-server`, `@types/luxon`.
- No dev server needed. Evaluation is code-only (tests, type check, coverage, code reading).

## Conventions from slice 1 (follow them exactly)

Read these files before writing anything: `src/app.ts`, `src/deps.ts`, `src/schemas.ts`, `src/domain/area.ts`, `src/domain/errors.ts`,
`src/http/problem.ts`, `src/http/routes/serviceArea.ts`, `src/mcp/runTool.ts`, `src/mcp/tools/checkServiceArea.ts`, `src/mcp/server.ts`,
`test/helpers.ts`, `test/http/app.test.ts`, `test/mcp/server.test.ts`.

- Layers: `src/domain/` is pure (no I/O, no clock; `now` is passed in). `src/services/` holds use cases taking `deps`.
  `src/adapters/` is external I/O. `src/http/routes/*.ts` exports `registerXRoute(app, deps)`. `src/mcp/tools/*.ts` exports `registerX(server, deps)`.
- ESM with NodeNext: relative imports end in `.js`. Use `import type` for types. No `any`.
- Schemas go in `src/schemas.ts` and are shared by REST (`createRoute`) and MCP (`registerTool` input/output schemas). DRY.
  **Call `.openapi(...)` before `.describe(...)`**, or the description is lost from the MCP JSON Schema.
  MCP `outputSchema` must be a `z.object` (no unions at the root). Domain types are the source; schemas use `satisfies z.ZodType<DomainType>`.
- Errors: throw `AppError(code, customerReadableMessage)` with the codes in `src/domain/errors.ts` (SDD §4.7.4).
  REST maps them to problem+json automatically. List each route's error statuses with `problemResponses({...})`. MCP tools wrap the use case in `runTool(deps.log, fn)`.
- Money is **integer pence** everywhere (`Number.isInteger` must hold). VAT is 20%. Round once, at the end, with `Math.round` on integer maths.
- Tests: Vitest in `test/**`, mirroring `src/`. Use `makeDeps()` from `test/helpers.ts`, extending it as needed.
  Keep its default clock (Wed 2026-11-04 09:00 London) unless a test needs another. Use fakes for external HTTP. Use **PGlite for the database (real SQL, no mocks)**.
- Tool descriptions are written **for an LLM** (GPT-6 Luna). Say when to call the tool, what the units are, and what to do on failure.

## New shared pieces

- `Deps` gains:
  - `bankHolidays: BankHolidaySource`, which returns England & Wales bank-holiday dates (`YYYY-MM-DD`).
  - `bookings: BookingsRepo`.
  - `newReference: () => string`.
  `buildProductionDeps()` reads `process.env.DATABASE_URL` and **throws if it is missing** (fail loudly).
  `src/dev.ts` uses in-memory PGlite with migrations applied when `DATABASE_URL` is unset, and logs that it did.
- `src/adapters/db.ts`: port `interface Db { query<T>(text: string, params?: unknown[]): Promise<T[]> }`. Implementations:
  - `src/adapters/pglite.ts` wraps `db.query(text, params)` → `.rows`.
  - `src/adapters/neon.ts` uses `neon(url)` and calls `sql.query(text, params)`, which already returns rows.
- `db/migrations/001_bookings.sql`: the schema from SDD §7. `src/adapters/migrate.ts` exports `applyMigrations(db)`, which reads the SQL files in order
  and runs one statement at a time (split on `;`). Tests and `scripts/migrate.ts` both use it.
- `src/adapters/bankHolidays.ts`: fetches `https://www.gov.uk/bank-holidays.json` and uses `england-and-wales.events[].date`.
  Validate the body with zod. Cache it in memory for 12 h, driven by an injected clock.
  Network error, non-2xx or a malformed body → `UPSTREAM_UNAVAILABLE`.

## Slice 2: catalogue + quote

- `src/domain/catalogue.ts`: the 9 jobs from SDD §4.4, engineers from §4.2, and the gas-emergency safety notice (0800 111 999).
  Engineers live in code, not the DB.
- `src/domain/pricing.ts`: pure `priceJob({ job, tier, urgency, travelFeePence })` → line items, low/high subtotal, VAT and total, all in pence.
  - Hourly: `labour = (7500 + max(0, hours − 1) × 6000) × multiplier`.
  - Fixed: `labour = fixedPence × multiplier`.
  - Multipliers: standard 1, saturday 1.25, out_of_hours 1.5.
  - `+ parts + travel + (emergency ? 4000 : 0)`, then `× 1.2`.
- `get_quote` / `POST /api/v1/quotes`. Input: `{ jobType, postcode, urgency? = 'standard', windowStart? }`.
  The postcode must be covered (`OUT_OF_AREA` otherwise). Emergency on a non-eligible job → `NOT_EMERGENCY_ELIGIBLE`.
  Without `windowStart`, price at the `standard` tier and say so. With `windowStart`, it must be a real window for that job and urgency (`INVALID_WINDOW` otherwise), priced at that window's tier.
  The output includes `tier`, `lineItems`, `totalLowPence`, `totalHighPence`, `currency: 'GBP'` and the note "Final price confirmed by the engineer before work starts."
- `list_services` / `GET /api/v1/services`: catalogue with pricing basis, `gasSafeRequired` and `emergencyEligible`, plus the safety notice.
- **Required test values** (VAT inclusive):
  - `dripping_tap`, standard, £0 travel: 9600–13800.
  - `burst_pipe`, emergency, out_of_hours, £20 travel: 22500–51300.
  - `boiler_service`, saturday: 14250–14250.
  - 0.5 hours adds no extra labour.

## Slice 3: availability

- `src/domain/windows.ts`: pure `generateWindows({ from, days, now, jobType, urgency, bankHolidays })` following SDD §4.3 and §4.7.3, all in `Europe/London` via Luxon.
  Each window is `{ start, end, label, tier }`:
  - `start`/`end` are ISO 8601 with the London offset.
  - `label` is like "Mon 9 Nov, 8–10am".
  - The minimum-notice rule: `start ≥ now + 60 min`.
- `src/domain/allocation.ts`: pure `eligibleEngineers(job)` in preference order. Gas jobs: Dan, Priya. Non-gas jobs: Tom, Dan, Priya.
- `find_availability` / `GET /api/v1/availability?jobType&urgency&from&days`:
  - `from` defaults to today (London).
  - `days` is 1–14 (default 7). Anything else → `VALIDATION_ERROR`.
  - Only windows with at least one free eligible engineer are returned. Free means no confirmed booking for that engineer at that `window_start`; one repo query covers the whole range.
- **Required tests:**
  - Mon 2026-11-09: 5 standard windows.
  - Sat 2026-11-07: 2 windows on the saturday tier.
  - Sun 2026-11-08: 0 standard; 3 out_of_hours for emergency `burst_pipe`.
  - Weekday emergency: adds 18–20 and 20–22 on the out_of_hours tier.
  - Fri 2026-12-25 and Mon 2026-12-28 (bank holidays): 0 standard; emergency 10–16 only.
  - DST: Sun 2026-10-25 10:00 London = 10:00Z; Fri 2026-10-23 08:00 London = 07:00Z; Sun 2027-03-28 10:00 London = 09:00Z.
  - A 7-day range across a DST change has no missing or duplicated day.
  - Minimum notice: at now = 07:00 London the 08:00 window is included; at now = 07:01 it is excluded.
  - Gas window with Dan and Priya booked → closed. Non-gas window with only Tom booked → still open.
  - Holiday cache: no refetch at 11h59m, refetch at 12h.
  - gov.uk down → 503.

## Slice 4: book, status, cancel

- `src/domain/reference.ts`: `HT-` + 6 Crockford base32 chars, matching `^HT-[0-9A-HJKMNP-TV-Z]{6}$`. Inject the RNG.
  Production uses `crypto.getRandomValues`.
- `src/adapters/bookingsRepo.ts`: SQL over the `Db` port.
- `book_visit` / `POST /api/v1/bookings`. Idempotency key: the `Idempotency-Key` header on REST, the required `idempotencyKey` arg on MCP; 8–100 chars `[A-Za-z0-9_-]`.
  - Validate: area covered, window valid for the job, urgency and minimum notice, emergency eligibility.
  - UK phone: strip spaces, dashes and parens, then match `^(\+44|0)\d{9,10}$`.
  - Optional email; name 1–80, addressLine1 1–120, problemDescription 1–1000.
  - Price with the same pure function and store the quote snapshot as `jsonb`.
  - **Allocation algorithm:**
    1. `SELECT` by idempotency key. If found, return the existing booking: 200 on REST, the same body.
    2. For each eligible engineer in order: `INSERT … ON CONFLICT (engineer_id, window_start) WHERE status = 'confirmed' DO NOTHING RETURNING *`. The first returned row wins (201).
    3. If a `23505` unique violation is raised (idempotency-key or reference race), re-select by idempotency key and return it if found.
       Otherwise retry once with a fresh reference.
    4. If no engineer is free → `SLOT_UNAVAILABLE`.
  - Output: `{ reference, status, jobType, jobLabel, urgency, window, engineer: { firstName }, postcode, addressLine1, customerName, quote, cancellableUntil }`.
- `get_booking` / `GET /api/v1/bookings/{reference}?postcode=`. A postcode mismatch (after normalising) returns `NOT_FOUND`, the **same response as an unknown reference**.
- `cancel_booking` / `POST /api/v1/bookings/{reference}/cancel`, body `{ postcode }`:
  - Allowed until `window_start − 2h` inclusive; after that → `TOO_LATE_TO_CANCEL`.
  - Cancelling an already-cancelled booking returns 200 with the booking.
- MCP annotations:
  - `book_visit`: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true }`.
  - `cancel_booking`: `{ destructiveHint: true, idempotentHint: true }`.
  - Reads: `readOnlyHint: true`.
- **Required tests (PGlite):**
  - Reference format.
  - Engineer preference order.
  - Happy path 201, with the snapshot stored.
  - `Promise.all` of 3 gas bookings for one window with distinct keys → 2 succeed, 1 gets `SLOT_UNAVAILABLE`.
  - Raw duplicate confirmed insert → unique violation.
  - A cancelled slot can be re-booked.
  - Same key twice, sequential and concurrent → 1 row, same reference.
  - Missing `Idempotency-Key` → 400.
  - Server re-validation: window under 60 min away, out-of-area postcode, bad phone.
  - `get_booking` with "sw40lg"-style casing works; wrong postcode → 404 identical to an unknown reference.
  - Cancel at exactly start − 2h → 200; at start − 1h59m → 409; wrong postcode → 404.
- **REST/MCP parity test:** for each of the 7 capabilities, the REST JSON equals the MCP `structuredContent`.

## Slice 5: deploy tooling (write it, don't run it against production)

- `scripts/migrate.ts`: `DATABASE_URL` → `applyMigrations(neon)`. Add an npm script `db:migrate`.
- `scripts/smoke.ts`: `BASE_URL` env. Calls `/health`. Over MCP JSON-RPC on `/mcp`: `initialize`, `tools/list` (expect 7 tools),
  `check_service_area`, `get_quote`, `find_availability`, `book_visit` (first window), `get_booking`, `cancel_booking`. Exit non-zero on any failure.
  Add an npm script `smoke`.
- `/openapi.json` documents all 8 REST endpoints with their error responses.

## Done when

`npm test`, `npm run typecheck` and `npm run test:coverage` (≥ 80% on every metric) all pass. Every required test above exists and is meaningful.
Write `gan-harness/generator-state.md` covering what you built, deviations, known issues, and the test and coverage numbers you saw.
