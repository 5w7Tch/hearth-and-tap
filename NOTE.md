# Hearth & Tap: approach note

**Agent:** https://hnmgn1kjrmak.run.agentplace.io/ (GPT-6 Luna, public, no sign-in)
**API:** https://hearth-and-tap.vercel.app (`/docs`, `/openapi.json`, `/mcp`)
**Code:** this repository

Hearth & Tap is a demo London plumbing & heating company. A homeowner describes a problem and the agent checks the postcode, quotes a price and shows real open slots. It books a visit only after an explicit "yes" and returns a reference. A returning customer can look up or cancel with that reference and their postcode. A gas smell is never booked: the agent sends the customer to 0800 111 999.

## How the pieces fit

```
Customer ⇄ Agentplace agent (Luna) ── custom tool code (Builder-generated) ──HTTPS──▶ Hearth & Tap API (Vercel)
                                                                                    ├─ postcodes.io      coverage, distance
                                                                                    ├─ gov.uk            bank holidays
                                                                                    └─ Neon Postgres     bookings
```

- **The LLM owns the conversation and the API owns the facts.** Coverage, price, availability and booking state all come from deterministic code. Luna never does arithmetic on money or guesses a slot.
- **One domain core sits behind two transports:** an MCP server and a REST API with OpenAPI. Both share the same zod schemas, and a test asserts they return identical results for all 7 capabilities.
- **Booking is safe under concurrency and retries.** A partial unique index stops double-booking an engineer. Idempotency keys make retries safe, and a reused key with a different request is rejected, so a guessable key can't return another customer's booking.
  - I checked this against the live database, not only in tests. 6 simultaneous Gas Safe bookings for one window gave exactly 2 successes and 4 × 409. 5 simultaneous retries with one key gave a single booking.
- **Failures are loud and typed.** If postcodes.io or gov.uk is down, the agent gets `UPSTREAM_UNAVAILABLE` and is told to offer a call-back. It never gets a made-up answer.

**Verified on the published agent:**
- Gas smell → no booking, emergency number.
- BR1 1AA radiator → £114–£294 including the £20 travel band, which matches the pricing formula by hand.
- A full book → look up → cancel journey (HT-Z4ES24). I confirmed the rows in Postgres.

## Where I hit the platform's limits

1. **No bring-your-own MCP server.**
   - *What happened:* Agentplace's MCP integrations come from its catalogue (Composio). The Builder reported that the self-hosted MCP endpoint "wasn't available in the MCP integration catalogue". Its first pass built the UI but left booking unconnected; it flagged this honestly, but didn't offer an alternative. On a second prompt it generated a custom tool in the agent's backend (`tool-registry.factory.ts` plus a `hearth-and-tap-booking` tool) against the REST API. That's why the API has both transports.
   - *How I'd build it:*
     - A "Custom MCP server" connection type: a URL plus auth (none, bearer secret, or MCP OAuth 2.1).
     - `initialize` and `tools/list` at connect time, with the tools imported into the tool registry.
     - Tool annotations mapped to policy. For example, `destructiveHint` means "requires customer confirmation", and `readOnlyHint` means "safe to call freely".
     - A periodic health check that surfaces "integration unavailable" to the owner.
2. **No end-user identity on outbound tool calls.**
   - *What happened:* every request comes from Agentplace's servers, so my API can't tell one customer from another. Per-IP rate limits would throttle all customers at once. I set Vercel's limit deliberately high (120/min per IP), and abuse controls like "max 3 open bookings per customer" are impossible.
   - *How I'd build it:* sign each outbound tool call with a short-lived JWT, issued by Agentplace, carrying the agent ID and an opaque visitor or session ID. Backends can then rate-limit, attribute and authorise per end user without seeing personal data.
3. **"Luna is free" isn't what the credit counter shows.** Luna was selected for both the Builder and the agent the whole time, yet four Builder runs took the counter from 4,773 to 4,407 (366 credits), including about 80 spent on a run that failed. The Builder itself said Luna's "free pricing has not been independently verified". If these are non-model costs, such as tool execution, previews or builds, the UI should say what was charged.
4. **Builder runs can fail late, with nothing to show.**
   - *What happened:* one 13-minute run showed only "Search files" and made six file reads. It then ended with "The model provider is temporarily unavailable", keeping no partial result.
   - *Workaround:* resending the change as two smaller requests worked (about 18 minutes each).
   - *How I'd fix it:* stream progress and make runs resumable, which would save owners time and credits.
5. **The arrival screen is generated by the model on every visit.**
   - *What happened:* a new visitor sees a blank page with "Working…" for 14–25 seconds before anything appears, and the wording changed between visits until I pinned it in the instructions.
   - *How I'd fix it:* render the arrival screen once, at publish time (SSR or cached), and call the model only when the customer first types. Most visitors decide in those first seconds.

## What I'd change for production

- **Auth:** an API key or signed requests from the agent to the API (see limit 2), per-customer rate limits, longer booking references with lockout after failed lookups, and the phone number's last four digits required to cancel.
- **Real scheduling:** sync with the engineers' calendars or field-service tool, such as Google Calendar or Jobber, and allow for travel time between jobs. Today it uses fixed 2-hour windows.
- **Price lock:** persist quotes with an expiry and book against a quote ID, so the price can't change between quote and booking.
- **Customer comms and payments:**
  - SMS or email confirmations and reminders.
  - A Stripe deposit for emergency call-outs.
  - Human handoff for anything the rules don't cover, such as landlord access.
- **Data:**
  - A retention policy and a GDPR deletion endpoint.
  - Personal data encrypted at rest.
  - The booking reference kept out of request logs.
  - Neon branches for preview deployments.
  - A migration tool in place of the hand-rolled runner.
- **Operations:**
  - OpenTelemetry tracing across agent → API → upstreams.
  - Alerts on the `UPSTREAM_UNAVAILABLE` rate.
  - Caching postcodes.io lookups.
  - Bundling a fallback bank-holiday list.
- **Transport:** once Agentplace supports BYO MCP, switch the agent from the REST tool to `/mcp`. The service needs no change.

## How it was built

Built with Claude Code using the ECC `orch-build-mvp` pipeline, in this order:

1. A design doc ([docs/SDD.md](docs/SDD.md)) and a slice plan, approved by a human before any code.
2. A generator→evaluator loop ([gan-harness/](gan-harness/)).
3. Separate code and security reviews.
4. Commits only after a second human approval.

The reviews caught two real bugs, both now fixed and tested:

- Bookings had no horizon, so they could be made for 2030.
- Idempotency replay could hand one customer another customer's booking.

Deploying surfaced one more: TypeScript 7 drops the JavaScript compiler API that Vercel's builder calls, so it's pinned to TypeScript 6.
