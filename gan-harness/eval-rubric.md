# Evaluation rubric: Hearth & Tap booking service (code-only)

**Mode:** `code-only`. This is an API and MCP server with no UI.
**Replace the default Design / Originality / Craft / Functionality table with the four criteria below.**
Pass threshold: **7.0**.

## Commands to run

```bash
npm test 2>&1 | tail -30
npm run typecheck 2>&1 | tail -30
npm run test:coverage 2>&1 | grep -E "All files|Statements|Branches|Functions|Lines"
```

There is no build step and no linter configured. Don't penalise their absence.
Read the code: `src/**`, `test/**`, `db/**`, `scripts/**`.
Check behaviour against `docs/SDD.md` (§4 rules, §4.7 decisions) and `gan-harness/spec.md` (the required tests and values).

## Criteria

| Criterion | Weight | 10 looks like | ≤4 looks like |
|-----------|--------|---------------|---------------|
| **Spec correctness** | 0.40 | Every rule in SDD §4.1–4.7 is implemented exactly. The required values match (9600–13800; 22500–51300; 14250). DST, bank holidays, tiers, minimum notice, allocation order, idempotency, 404 on postcode mismatch and the cancel cut-off are all right. All 7 capabilities work over REST and MCP. | A rule is missing or wrong, or a number is off. Money uses floats. A capability is missing on either transport. |
| **Test quality** | 0.25 | Every required test in spec.md exists and asserts real behaviour. The DB tests use PGlite with real SQL. Concurrency and idempotency are exercised. Coverage is at least 80% on all four metrics. | Required cases are missing. Tests assert on mocks rather than behaviour. Coverage is under 80%, or tests fail. |
| **Craft** | 0.20 | The code follows the slice-1 conventions. The domain is pure, schemas are shared across REST and MCP, there's no `any`, no duplicated logic, and no swallowed errors or silent fallbacks. The SQL is parameterised. Files are small and named clearly. | Logic is copy-pasted between REST and MCP. I/O happens in the domain. There are `any` casts or `catch {}`. SQL is built with string concatenation. |
| **Agent-facing contract** | 0.15 | MCP tool names, descriptions and argument descriptions tell an LLM when to call each tool, the units and what to do on failure. The annotations are correct. The REST JSON equals the MCP `structuredContent`. OpenAPI documents all endpoints and error responses. | Descriptions are vague or missing. REST and MCP shapes differ. Endpoints or errors are undocumented. |

`TOTAL = 0.40·correctness + 0.25·tests + 0.20·craft + 0.15·contract`

## Feedback requirements

- Every issue needs **file:line**, what's wrong, the spec reference, and a concrete fix.
- Put correctness bugs first. A failing test or `tsc` error is a Critical Issue.
- **Verify the required values yourself.** Don't trust the generator's state file.
- Acknowledge what was done well, so the next iteration doesn't regress it.
