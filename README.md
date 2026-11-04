# Hearth & Tap booking service

The external capability behind the **Hearth & Tap** Agentplace agent. It handles quotes, availability and bookings for a London plumbing & heating company, exposed as an **MCP server** for the agent and as a **REST API** with OpenAPI for everyone else.

> **Demo business.** Hearth & Tap, its engineers and its prices are invented for the Agentplace Full-Stack Engineer test task. No engineer will visit and no payment is taken.

- **Agent (published, GPT-6 Luna):** https://hnmgn1kjrmak.run.agentplace.io/
- **API:** https://hearth-and-tap.vercel.app · [Swagger UI](https://hearth-and-tap.vercel.app/docs) · [OpenAPI](https://hearth-and-tap.vercel.app/openapi.json) · MCP at `https://hearth-and-tap.vercel.app/mcp`
- **Note on approach, production changes and platform limits:** [NOTE.md](NOTE.md)
- **Design doc:** [docs/SDD.md](docs/SDD.md)

## What the agent can do with it

| MCP tool | REST | What it does | External dependency |
|----------|------|--------------|---------------------|
| `list_services` | `GET /api/v1/services` | Jobs we do and how each is priced | — |
| `check_service_area` | `GET /api/v1/service-area?postcode=` | Borough, distance from our Clapham base, travel fee | [postcodes.io](https://postcodes.io) |
| `get_quote` | `POST /api/v1/quotes` | Low–high price incl. VAT, with line items | postcodes.io |
| `find_availability` | `GET /api/v1/availability` | Open 2-hour arrival windows in London time | [gov.uk bank holidays](https://www.gov.uk/bank-holidays.json), Postgres |
| `book_visit` | `POST /api/v1/bookings` | Confirms a visit and assigns an engineer | Postgres |
| `get_booking` | `GET /api/v1/bookings/{reference}?postcode=` | Booking status | Postgres |
| `cancel_booking` | `POST /api/v1/bookings/{reference}/cancel` | Cancels up to 2 h before the window | Postgres |

The agent never invents a price, a slot or a booking. The LLM handles the conversation, and this service owns every fact and every state change.

**How the Agentplace agent connects:** through the REST API. Agentplace only offers MCP for servers in its integration catalogue, so the Builder generated a custom tool against `/api/v1/*` instead. The MCP server is ready for when bring-your-own MCP lands, and it works today with any MCP client (Claude, ChatGPT, Cursor). See [NOTE.md](NOTE.md).

## How it's built

```
Agentplace agent (GPT-6 Luna) ──MCP──┐        ┌──REST + OpenAPI── browsers, curl, reviewers
                                     ▼        ▼
                 src/mcp/ tools    src/http/ routes      ← thin transport adapters, one shared zod schema set
                         └───────┬───────┘
                          src/services/                  ← use cases (validate, price, allocate)
                          src/domain/                    ← pure rules: pricing, windows, area, allocation
                          src/adapters/                  ← postcodes.io · gov.uk · Postgres (Neon / PGlite)
```

- **One core, two transports.** REST and MCP call the same services with the same zod schemas, so validation, the OpenAPI spec and the MCP JSON Schema can't drift. A parity test asserts that REST JSON equals MCP `structuredContent` for all 7 capabilities.
- **A pure domain.** Pricing, windows and allocation take `now` and data as arguments. There is no I/O and no clock in `src/domain/`.
- **Money is integer pence**, and VAT is rounded once.
- **London time.** Windows are generated in `Europe/London` with Luxon and tested across both 2026/27 clock changes. Bank holidays come from gov.uk and are cached for 12 h.
- **No double bookings.** A partial unique index on `(engineer_id, window_start) WHERE status = 'confirmed'` arbitrates races in Postgres. Allocation is `INSERT … ON CONFLICT DO NOTHING` per eligible engineer, with Gas Safe jobs restricted to Gas Safe engineers.
- **Idempotent booking.** The key is the `Idempotency-Key` header on REST or the `idempotencyKey` argument on MCP. The same key with the same request returns the original booking. The same key with a *different* request gets `IDEMPOTENCY_KEY_REUSED`, so a guessable key can never return someone else's booking.
- **Errors fail loudly.** Expected failures are typed codes (problem+json on REST, `isError` on MCP). If postcodes.io or gov.uk is down, the result is `UPSTREAM_UNAVAILABLE`, never an invented answer. Unexpected errors are logged and returned as a generic `INTERNAL_ERROR`.
- **Stateless MCP.** Each request gets a fresh server and transport with JSON responses (no SSE), which suits serverless.

## Run it

```bash
npm install
npm test               # 223 tests; real SQL on in-memory PGlite
npm run test:coverage  # ≥ 94% on every metric
npm run typecheck
npm run dev            # http://localhost:3000, in-memory PGlite unless DATABASE_URL is set
```

Deploy (Vercel + Neon):

```bash
vercel integration add neon      # provisions Postgres, sets DATABASE_URL
npm run db:migrate               # with DATABASE_URL in the environment
vercel deploy --prod
BASE_URL=https://<deployment> npm run smoke   # MCP handshake → quote → availability → book → get → cancel
```

## How it was made

Built with Claude Code using the ECC `orch-build-mvp` pipeline:

1. Design doc ([docs/SDD.md](docs/SDD.md)).
2. Plan of vertical slices, approved by a human.
3. Slice 1 scaffolded by hand to set the conventions.
4. A generator→evaluator loop ([gan-harness/](gan-harness/)) for the remaining slices, scoring 8.1/10 on an API rubric.
5. Separate code and security reviews.
6. Fixes for everything the reviews raised that would bite. That included two real bugs: a missing booking horizon, and idempotency replay that leaked personal data.
7. Commits after a second human gate.
