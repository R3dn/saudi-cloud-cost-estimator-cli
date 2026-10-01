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
npm run build
npm run smoke       # help + regions on the built CLI
```

Run `npm run smoke` before opening a PR; CI (Linux + Windows, Node 20/22) runs the
same checks.

## Adding a provider

1. Create `src/providers/<id>.ts` and a `src/providers/<id>Catalog.ts` for its shared
   API fetching; register it in `src/providers/index.ts`.
2. Map size profiles in `src/data/sizes.ts`.
3. Add per-service estimators under `src/services/<service>/<id>.ts` and register
   them in that service's estimate/compare registries.
4. Verify the prices your adapter produces against the provider's official pricing
   page for each supported region, and note the verification in your PR.

## Adding a service

1. `src/services/<service>/types.ts` — inputs and an estimate extending
   `ServiceEstimate` (components with provenance + `warnings`).
2. One estimator per provider + a registry in `estimate.ts`; `compare.ts` renders via
   `renderEstimateList` and emits the standard JSON envelope
   `{ input, currency, vat, hours, rows[] }`.
3. Wire the CLI in `src/index.ts` (estimate + compare subcommands, non-negative
   parsers for quantities, `--hours` threaded through).

## Conventions

- ESM + NodeNext; relative imports need `.js` extensions.
- Strict TypeScript (`noUncheckedIndexedAccess` on).
- No comments unless requested; keep output text concise.
- Region-reality notes (AWS KSA announced, Azure KSA unpriced, Alibaba/Huawei no API)
  belong in provider region notes and `src/cli/regions.ts`.
