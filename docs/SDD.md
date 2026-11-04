# Hearth & Tap — Software Design Document (v1.0)

Agentplace Full-Stack Engineer test task. An Agentplace agent (GPT-6 Luna) for a
London plumbing & heating company, extended with a deployed booking service.

> **Hearth & Tap is a demo business.** The name, engineers and prices are
> invented for this task. Both the agent UI and the API landing page must say so,
> so no member of the public mistakes it for a real tradesperson.

## 1. Goal

A homeowner opens the published agent, describes a plumbing or heating problem,
and leaves with a **confirmed visit and a booking reference**. Along the way
the agent checks their postcode, quotes a price and shows real open slots.
Later they can come back, quote the reference and get the status or cancel.

The agent never invents prices, coverage or availability. It always calls the
service. That follows the principle Agentplace's own users describe: *"the AI
handles the conversation, deterministic backend logic controls pricing,
availability and booking state."*

## 2. Scope

### In scope (MVP)

| # | Capability | External dependency |
|---|------------|---------------------|
| C1 | Service catalogue: what jobs we do, how they're priced | — |
| C2 | Service-area check for a UK postcode (borough, distance, travel band) | **postcodes.io** (public API) |
| C3 | Price quote for a job + postcode + optional time window | postcodes.io |
| C4 | Availability: open 2-hour arrival windows over the next N days | **gov.uk bank holidays** (public API), Postgres |
| C5 | Book a visit (engineer allocation, double-booking safe, idempotent) | Postgres |
| C6 | Booking status lookup and cancellation (reference + postcode) | Postgres |
| C7 | Same capabilities exposed as **MCP tools** (Streamable HTTP) and a **REST API** with OpenAPI 3.1 + Swagger UI | — |
| C8 | Agentplace agent built on Luna, connected to the MCP server, published publicly | Agentplace |

### Out of scope (named in the production note instead)

Payments/deposits, SMS/email confirmations, real engineer calendars, rescheduling,
admin UI, price locking, auth for end customers beyond reference + postcode.

## 3. Locked decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Language / runtime | TypeScript, Node 22 | Matches the role (TS/Node). |
| HTTP framework | Hono 4 + `@hono/zod-openapi` | One Zod schema drives validation **and** the OpenAPI spec (DRY). First-class on Vercel. |
| Agent integration | MCP server (Streamable HTTP, stateless) via `@modelcontextprotocol/sdk` + `@hono/mcp` | Agentplace supports MCP connections natively. |
| REST | Same use cases behind `/api/v1/*` + `/openapi.json` + `/docs` | Fallback integration path; human-readable contract for reviewers. |
| Database | Postgres on Neon (Vercel Marketplace), `@neondatabase/serverless` HTTP driver | Serverless-friendly. A partial unique index gives real double-booking protection. |
| Test DB | PGlite (real Postgres in WASM) running the same migration SQL | Tests run real SQL with no mocks and no Docker. |
| Time | Luxon, all scheduling in `Europe/London` | BST/GMT transitions must be correct. |
| Tests | Vitest; external HTTP behind injected clients with fakes in unit tests | Pure domain, side effects at the edges. |
| Hosting | Vercel (zero-config Hono) | Already authenticated; free tier. |
| Money | Integer pence everywhere; VAT 20% | No float money bugs. |

## 4. Business rules (the deterministic core)

### 4.1 Base, area and travel
- Base: Clapham, SW4 (lat 51.46096, lon -0.13646).
- Covered when postcodes.io `region === "London"` **and** haversine distance ≤ 9 miles.
- Travel band (ex VAT): 0–3 mi £0 · 3–6 mi £10 · 6–9 mi £20.
- Invalid postcode → `INVALID_POSTCODE`. Valid but not covered → `covered: false` (not an error).

### 4.2 Engineers
| id | First name | Gas Safe |
|----|-----------|----------|
| eng_dan | Dan | yes |
| eng_priya | Priya | yes |
| eng_tom | Tom | no |

One job per engineer per window. Gas jobs need a Gas Safe engineer. Non-gas jobs
take the non-gas engineer first, which keeps Gas Safe capacity free.

### 4.3 Windows (Europe/London, 2-hour arrival windows)
- **Standard** (all jobs): Mon–Fri 08–10, 10–12, 12–14, 14–16, 16–18; Sat 09–11, 11–13.
- **Emergency only** (`urgency = "emergency"` on an emergency-eligible job): adds Mon–Fri 18–20, 20–22, and Sun/bank-holiday 10–12, 12–14, 14–16.
- England & Wales bank holidays (gov.uk) have no standard windows.
- Minimum notice: window start ≥ now + 60 min. Horizon: bookings up to London today + 13 days. `find_availability` shows 7 days by default, at most 14.
- Price tier per window: `standard` (weekday daytime), `saturday` (×1.25 labour), `out_of_hours` (weekday evening, Sunday, bank holiday: ×1.5 labour).

### 4.4 Catalogue and pricing (ex VAT)
Hourly jobs: **callout £75 includes the first hour**, then £60/h. Parts are estimated as a range.

| jobType | Label | Gas | Pricing | Hours | Parts | Emergency eligible |
|---------|-------|-----|---------|-------|-------|--------------------|
| dripping_tap | Dripping or leaking tap | – | hourly | 0.5–1 | £5–£40 | – |
| blocked_sink | Blocked sink, bath or shower | – | hourly | 0.5–1.5 | £0–£20 | – |
| toilet_repair | Toilet running, not flushing or leaking | – | hourly | 1–1.5 | £10–£80 | – |
| leak_investigation | Leak or water-damage investigation | – | hourly | 1–2 | £10–£80 | yes |
| burst_pipe | Burst pipe | – | hourly | 1–2.5 | £15–£120 | yes |
| radiator_problem | Radiator cold, leaking or noisy | – | hourly | 1–2 | £0–£90 | – |
| no_heating_hot_water | No heating or hot water (boiler fault) | yes | hourly | 1–2 | £0–£250 | yes |
| boiler_service | Annual boiler service | yes | fixed £95 | – | – | – |
| gas_safety_certificate | Landlord gas safety certificate (CP12) | yes | fixed £70 | – | – | – |

Quote formula, per bound (low/high):
`labour = (callout + max(0, hours − 1) × 60) × tierMultiplier` (fixed jobs use the fixed price × multiplier),
`subtotal = labour + parts + travelBand + (emergency ? £40 : 0)`, `total = subtotal × 1.2` (VAT),
rounded to whole pence with integer maths. The response lists the line items, low/high totals,
the tier it was priced at, and the note *"Final price confirmed by the engineer before work starts."*

### 4.5 Safety rule (agent + API docs)
A gas smell or a suspected carbon-monoxide leak is never booked. The agent tells the customer to
leave the property and call the **National Gas Emergency Service on 0800 111 999**. This lives in the
agent's instructions and the catalogue description.

### 4.6 Booking
- Input: jobType, urgency, postcode, addressLine1, windowStart, customer {name, phone, email?},
  problemDescription, **idempotency key** (`Idempotency-Key` header on REST, `idempotencyKey` arg on MCP).
- Server re-validates everything (area, window validity, notice) and prices with the same pure function.
  It stores the quote snapshot with the booking.
- Allocation: try eligible engineers in preference order with
  `INSERT … ON CONFLICT DO NOTHING RETURNING *`. A partial unique index on
  `(engineer_id, window_start) WHERE status = 'confirmed'` makes a double booking impossible, even
  under concurrent requests. If nobody is free → `SLOT_UNAVAILABLE` (409).
- Same idempotency key again → the original booking comes back (no duplicate).
- Reference: `HT-` + 6 Crockford base32 chars (no I/L/O/U).
- Status/cancel need **reference + postcode**. A mismatch returns 404, so references can't be enumerated.
- Cancel allowed until 2 hours before window start, else `TOO_LATE_TO_CANCEL` (409).

### 4.7 Decisions resolved at Gate 1

1. **Conflict handling.** Allocation uses `ON CONFLICT (engineer_id, window_start) WHERE status = 'confirmed' DO NOTHING`.
   That way only the double-booking rule reads as "slot taken". A `23505` on `idempotency_key` re-selects and returns the
   existing booking. A `23505` on `reference` retries with a fresh reference.
2. **Quote without `windowStart`** is priced on the `standard` tier and says which `tier` it used. The agent re-quotes once a window is picked.
3. **A bank holiday counts as a Sunday.** No standard windows; emergency gets 10–12, 12–14, 14–16 only.
4. **Error codes:** `VALIDATION_ERROR` 400, `INVALID_POSTCODE` 422, `OUT_OF_AREA` 422, `INVALID_WINDOW` 422,
   `NOT_EMERGENCY_ELIGIBLE` 422 (emergency urgency on an ineligible job is rejected, not downgraded), `IDEMPOTENCY_KEY_REUSED` 422, `NOT_FOUND` 404,
   `SLOT_UNAVAILABLE` 409, `TOO_LATE_TO_CANCEL` 409, `UPSTREAM_UNAVAILABLE` 503.
5. **Migrations:** `npm run db:migrate` applies `db/migrations/*.sql` one statement at a time. It is run by hand before deploy.
6. **Repeats.** The same idempotency key **with the same request** (job, window instant, postcode, phone) returns the
   original booking. The same key with a different request gets `IDEMPOTENCY_KEY_REUSED`, as Stripe does.
   *Amended after the evaluator's review:* returning the original for any payload would have handed a stranger someone
   else's name and address whenever an LLM reused a guessable key like `booking-1`.
   Cancelling an already-cancelled booking returns 200 with the cancelled booking.

## 5. Architecture

```
Agentplace agent (GPT-6 Luna, published)
        │  MCP (Streamable HTTP)            Browser / reviewer
        ▼                                          │ REST + Swagger UI
┌──────────────────────── Vercel: Hono app ────────┴───────────────┐
│  src/mcp/   MCP tools ──┐                ┌── src/http/ OpenAPI routes │
│                         ▼                ▼                            │
│                 src/services/  (use cases: area, quote, availability, │
│                                booking, status, cancel)               │
│                  │            │                    │                  │
│     src/domain/ (PURE: catalogue, pricing, windows, area, allocation) │
│                  │            │                    │                  │
│  src/adapters/ postcodes.io client · gov.uk client · Postgres repo    │
└──────────────────┼────────────┼────────────────────┼──────────────────┘
                   ▼            ▼                    ▼
             api.postcodes.io  www.gov.uk/bank-holidays.json  Neon Postgres
```

- Domain functions take `now` and data as arguments. No I/O, no clock.
- Services get their dependencies through a `Deps` object built once in `src/deps.ts`.
- Domain errors are a typed `AppError(code, httpStatus, message)`. REST maps them to
  `application/problem+json`. MCP returns `isError: true` with the same code and message.
- gov.uk bank holidays are cached in memory for 12 h per instance. If postcodes.io or gov.uk is
  down, the API returns `UPSTREAM_UNAVAILABLE` (503). It never makes up an answer, and the agent is
  told to apologise and offer a callback.

## 6. API surface

| MCP tool | REST | Purpose |
|----------|------|---------|
| `list_services` | `GET /api/v1/services` | Catalogue + pricing basis |
| `check_service_area` | `GET /api/v1/service-area?postcode=` | Coverage, borough, distance, travel band |
| `get_quote` | `POST /api/v1/quotes` | Price range for job + postcode (+ windowStart, urgency) |
| `find_availability` | `GET /api/v1/availability?jobType&urgency&from&days` | Open windows with price tier |
| `book_visit` | `POST /api/v1/bookings` | Confirmed booking + reference |
| `get_booking` | `GET /api/v1/bookings/{reference}?postcode=` | Status |
| `cancel_booking` | `POST /api/v1/bookings/{reference}/cancel` | Cancel |
| — | `GET /openapi.json`, `GET /docs`, `GET /health`, `GET /` | Contract, Swagger UI, health, landing |

## 7. Data model

```sql
create table if not exists bookings (
  id bigserial primary key,
  reference text not null unique,
  idempotency_key text not null unique,
  status text not null check (status in ('confirmed','cancelled')),
  job_type text not null,
  urgency text not null check (urgency in ('standard','emergency')),
  engineer_id text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  postcode text not null,
  address_line1 text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  problem_description text not null,
  quote jsonb not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index if not exists bookings_engineer_window_confirmed
  on bookings (engineer_id, window_start) where status = 'confirmed';
```

## 8. Agentplace agent

- Name: **Hearth & Tap — Book a plumber or heating engineer** (demo banner visible).
- Model: GPT-6 Luna.
- Flow: triage (safety check first) → postcode → `check_service_area` → `get_quote` →
  `find_availability` → customer picks a window → shows a summary and asks for explicit
  confirmation → `book_visit` → shows the reference card. Returning customers use `get_booking` / `cancel_booking`.
- UI: the adaptive page shows a quote card, a slot picker and a booking confirmation card.
- Connection: MCP server URL `https://<deployment>/mcp`. If the Builder can't take MCP for a custom
  server, fall back to REST via the OpenAPI spec. The note records whichever was the case.

## 9. Non-functional

- Validation on every input (Zod). Phone: UK formats. Postcode: normalised to upper case with a single space.
- No secrets in the repo. `DATABASE_URL` comes from the Vercel env.
- Tests: domain unit tests (pricing edges, BST/GMT boundaries, bank holidays, allocation), service tests
  on PGlite, HTTP tests with `app.request()`, MCP tool tests through an in-memory client. Coverage ≥ 80%.
- Logs: one structured line per request (method, path, status, ms), with no PII.

## 10. Definition of done

1. `npm test` green, coverage ≥ 80%, `tsc --noEmit` clean.
2. Deployed on Vercel. `/health`, `/docs` and `/mcp` work from the public internet. A smoke script books, reads and cancels a visit.
3. Agent published publicly on Agentplace, using Luna, and it completes a real booking through the MCP server.
4. Public GitHub repo with README and `NOTE.md` (approach, production changes, platform limits).
5. Submission email drafted for the user to send.
