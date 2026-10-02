# Contributing

Thanks for your interest in improving the Saudi Cloud Cost Estimator.

## Ground rules

- **Pricing correctness is financially sensitive.** Every change that touches how a
  price is fetched, parsed, converted or displayed must be verified against the
  provider's own pricing page for the region in question. State in your PR how the
  number was verified.
- **Never let an approximation look like an official price.** If a live source is
  unavailable, fail loudly or fall back with an explicit `source: 'fallback'` /
  `source: 'assumption'` marker and a warning string. Reviewers will reject silent
  fallbacks.
- Pricing data comes from official APIs only — no scraping, no hardcoded price tables
  without a labeled `assumption` source.

## Setup

```bash
npm install
npm run typecheck
npm run lint
npm run test:unit   # or npm test for everything incl. CLI e2e
npm run build
npm run smoke       # help + regions on the built CLI
```

Run `npm run smoke` before opening a PR; CI (Linux + Windows, Node 20/22) runs
the same checks plus the unit/fixture tests on every push, and a dedicated job
runs the CLI smoke + end-to-end suites. All tests run against **mocked provider
APIs** (mock data derived from the providers' published rate tables) plus
recorded fixtures in `tests/fixtures/` — no test run ever hits a live endpoint.
Golden numbers must be derived from the provider's own pricing page, not from
the current implementation output.

## Adding a provider

1. Create `src/providers/<id>.ts` and a `src/providers/<id>Catalog.ts` for its shared
   API fetching; register it in `src/providers/index.ts`.
2. Map every size profile in `src/data/sizes.ts` (all four families + GPU; unknown
    offerings throw rather than approximate). GPU profiles must use a SKU/part that
    verifiably exists in the region's catalog.
3. Add per-service estimators under `src/services/<service>/<id>.ts` and register
   them in that service's estimate/compare registries.
4. Verify the prices your adapter produces against the provider's official pricing
   page for each supported region, and note the verification in your PR.

## Adding a service

1. `src/services/<service>/types.ts` — inputs and an estimate extending
   `ServiceEstimate` (components with provenance + `warnings`).
2. One estimator per provider + a registry in `estimate.ts`; `compare.ts` uses
   `runAcrossProviders` + `compareEnvelope` and emits the standard JSON envelope
   `{ input, currency, vat, hours, rows[] }` (CSV via `renderCompareCsv`).
3. Wire the CLI in `src/index.ts` (estimate + compare subcommands, non-negative
   parsers for quantities, `--hours` threaded through, `--csv` on compares).

## Conventions

- ESM + NodeNext; relative imports need `.js` extensions.
- Strict TypeScript (`noUncheckedIndexedAccess` on).
- Comments are for pricing semantics (tier structures, free allowances, why a
  filter matches what it matches) — not for restating the code.
- Region-reality notes (AWS KSA announced, Azure KSA unpriced, Alibaba/Huawei no API)
  belong in provider region notes and `src/cli/regions.ts`.
