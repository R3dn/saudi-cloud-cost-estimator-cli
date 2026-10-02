# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-10-02

First public release. Everything below ships in 0.3.0 — the intermediate
development versions were never tagged or published.

### Fixed — pricing correctness (verified against provider data 2026-10-02)

- **OCI Load Balancer free allowance**: the LB is priced through its real tier
  structure — the first 744 LB-hours/month are free (Always Free allowance,
  verified live from part `B93030`), and hours beyond that bill at
  0.04237952 SAR/hr. Previously every LB-hour was billed from hour 0 at the
  headline rate, overstating OCI by ~SAR 31/month per always-on LB and flipping
  the OCI-vs-Azure comparison. `network estimate -p oci` now shows SAR 0 for a
  single LB at default hours.
- **Volume-tiered egress and storage for AWS, Azure and GCP** (previously a
  single flat rate labeled `live`):
  - AWS reads the real `DataTransfer-Out-Bytes` tiers (me-south-1: $0.117/GB up
    to 10 TB, then $0.1105/0.091/0.065) from the bulk CSV's `StartingRange`/
    `EndingRange` columns — each tier applies only to the volume inside its
    window. The 12-month Free Tier "Global 100 GB" row is deliberately
    excluded (it is a promotion, not steady-state pricing).
  - Azure reads `tierMinimumUnits` from the retail API (`Standard Data Transfer Out`
    meter): first 100 GB/month free, then $0.181/GB descending — previously
    the cheapest-row filter picked the $0.00 free-tier row and reported Azure
    egress as $0.00/GB. Azure publishes multiple routing-preference schedules
    at the same tier boundaries (default Microsoft Global Network vs the
    cheaper opt-in Internet preference); schedules are never mixed — the
    default-routing schedule is billed and the cheaper opt-in is disclosed as
    a warning.
  - GCP reads `tieredRates`/`startUsageAmount` from the egress SKU itself —
    previously the cheapest single rate was applied to the whole volume.
  - AWS S3 bills the real three volume tiers ($0.025/0.024/0.023 per GB-Mo) —
    previously the >500 TB rate was applied to every volume.
- **OCI tiered prices honoured end-to-end**: free first 10 GB object storage,
  free first 10,240 GB (10 TB) MEA egress per month, and the 744-hour LB
  allowance are applied per tier (`paygTiers` + `tieredCost`) instead of a
  single headline rate.
- **AWS column-name fixes**: the bulk CSVs use camelCase
  (`StartingRange`/`EndingRange`/`usageType`); the old spaced-name filters with
  permissive fallbacks matched the wrong rows.
- **AWS load balancer**: ALB/NLB hourly rows live under product family
  `Load Balancer-Application`/`Load Balancer-Network` ($0.02772/hr) — the old
  filter picked the legacy classic LB ($0.0308/hr). NAT Gateway hours are read
  from the EC2 offer (`MES1-NatGateway-Hours`, $0.0528/hr).
- **AWS RDS**: GP3 storage is priced per engine and deployment option (PostgreSQL
  Single-AZ $0.14/GB-month, Multi-AZ $0.279) instead of the cheapest generic gp
  row; provisioned IOPS now uses the live GP3-PIOPS rate ($0.024/IOPS-month) —
  previously a hardcoded $0.10/IOPS was labeled `live`. The RDS lookup matches
  the real `Database Engine` CSV column (was `Engine`, which never matched).
- **OCI part fixes**: MEA egress uses `B93456` (was the APAC part `B93455`);
  database storage uses `B111584`; file storage uses `B89057`.
- **Azure catalog keeps zero-priced meters** so free-tier rows are visible;
  min-price consumers guard `retailPrice > 0` themselves. Azure DB tiers use
  real flexible-server SKUs (B1ms/B2ms).
- **Financial plumbing**:
  - `tco` respects explicit zeros (`--storage-block 0`, `--network-egress 0`,
    `--network-lb 0`, `--k8s-nodes 0`, `--db-storage 0`) instead of silently
    replacing them with defaults.
  - `--hours` applies to every hourly-billed service (compute, DB, k8s nodes and
    control plane, LB, NAT) — previously only compute honoured it and the rest
    hardcoded 730.
  - `tco` no longer double-bills egress (previously charged under both storage
    and network) and no longer forces an always-on database
    (`--db-engine none` skips the line; `--k8s-nodes 0` skips kubernetes).
  - `k8s estimate -p <provider>` estimates a single provider instead of
    ignoring the flag and comparing all providers.
  - Kubernetes control-plane pricing is real where obtainable: EKS per-cluster
    hours from the AmazonEKS bulk offer, OKE Enhanced Cluster from the OCI price
    list, GKE management fee from the Billing Catalog (published list $0.10/hr as
    a labeled fallback). The previous code invented a $0.10/hr constant for AWS
    *and* Azure (AKS's free-tier control plane is actually $0).
  - `storage compare`, `database compare` and `k8s compare` resolve each
    provider's own region instead of passing an empty region.

### Added

- **Price provenance**: every estimate and line item carries
  `source: live | fallback | assumption`, a `skuRef` identifying the SKU/part,
  and human-readable `warnings`. Approximations are never presented as
  official prices.
- **Expanded compute sizing**: 16 size profiles across four families — general
  purpose (`small`…`3xlarge`, up to 64 vCPU), memory-optimized (`mem-*`,
  r6i/Esv5/n2-highmem), compute-optimized (`cpu-*`, c6i/Fsv2/n2-highcpu) and
  GPU (`gpu-medium`/`gpu-large`). GPU profiles pick the smallest inference-class
  GPU actually listed per region: OCI VM.GPU.A10 (live A10 GPU part `B95909` in
  native SAR), AWS g4dn (T4 — the only GPU family in me-south-1), Azure RTX PRO
  6000 Blackwell v6 (uaenorth lists no T4 series), GCP T4 discovered at runtime
  (fails loudly if the region has no matching SKU).
- **`--instance <sku>`**: price any on-demand Linux SKU for AWS/Azure/GCP.
  AWS reads vCPU/RAM/GPU specs from the bulk CSV; Azure derives them from the
  SKU name; GCP parses predefined `n2`/`e2`/`c2` machine types. Unknown SKUs
  fail loudly — no silent substitution.
- **`--ocpus`/`--memory`**: custom OCI flex shapes priced by the live OCPU/GB
  parts (OCI has no fixed SKUs; `--instance` on OCI points here). Mutually
  exclusive with `--size` and each other, enforced with clear errors.
- **Public test suite** (`tests/`, run in CI): unit + service + TCO tests, CLI
  smoke and end-to-end cases running the built binary against mocks of all four
  provider APIs, and **recorded-fixture contract tests**
  (`tests/fixtures.test.ts`) pinning the parsers to real API captures (OCI price
  list parts incl. the LB/egress free allowances; AWS me-south-1 bulk CSV rows
  incl. the egress tiers, ALB-vs-classic LB rows and S3 tiers). Golden numbers
  are derived from the providers' published rate tables — a provider-side schema
  change fails before it can misprice anything. No test run ever hits a live
  endpoint.
- **`--csv` output** on every compare command (RFC 4180, one row per provider)
  and **`--json` on `regions`**.
- **Unified compare envelope**: every `compare` command emits the same
  `{ input, currency, vat, hours, rows[] }` contract; rows carry the region id
  and (compute) instance specs + provenance. Previously `compute compare`
  emitted a different shape and recovered provider ids by display-name lookup.
- **Specs column** in the compute compare table (vCPU/GB per row) so
  differently-sized GPU rows cannot be misread as like-for-like.
- **`--gcp-key-file`** to pass the Google Cloud API key without leaking it into
  shell history.
- Documented VAT assumption: 15% Saudi VAT is applied by default, including on
  Bahrain/UAE consumption; output states this depends on the customer's VAT
  registration.
- In-flight fetch dedupe: concurrent calls within one run share a single
  download/parse (one TCO run no longer downloads the ~70 MB EC2 CSV multiple
  times). Windows CI matrix, `npm audit` job, Dependabot config, release
  workflow, issue/PR templates.

### Changed

- **AWS rows cache compacted**: only OnDemand rows of relevant product families
  are kept, projected to the ~35 columns estimators read, under a versioned
  cache key (`aws-rows-v2-*`). The EC2 cache drops from hundreds of MB to a few
  MB; parse time on cache hits drops accordingly.
- **Assumed rates centralised** in `src/core/assumptions.ts` (Azure LB/NAT, OCI
  NAT, GCP Filestore/GKE fee/Cloud SQL storage) — every one still surfaces as
  `source: 'assumption'` with its published-list skuRef.
- One shared catalog fetcher per provider API (`ociCatalog`, `awsCatalog`,
  `gcpCatalog`, `azureCatalog`) replaces duplicated fetching across services;
  one shared tier engine (`src/core/tiers.ts`) prices every volume-tiered meter.
- `assertRegion`/`firstRegionId` moved from the OCI adapter to
  `src/core/regions.ts`; `src/providers/types.ts` (a pure re-export) removed.
- Shared compare runner + envelope builder (`src/core/compareRunner.ts`,
  `src/core/envelope.ts`) replace four near-identical per-service compare
  implementations; CLI flag builders in `src/index.ts` replace ~10 copies of
  the same option blocks.
- Dead code removed: `bestHourlyMonthly`/`bestMonthlyPrice` (Azure helpers,
  one hardcoding 730h against configurable `--hours`), `renderMoney`,
  `sourceTag`, `sizeFor`, back-compat `getCache/putCache` re-exports.
- Build target `node20` now matches `engines.node` (was `node22`); `--version`
  is read from `package.json`.
- `--json` and `--csv` are mutually exclusive with a clear error.

## [0.1.0] — internal development version

- Initial implementation: compute estimate/compare across OCI (Riyadh/Jeddah),
  AWS (Bahrain), Azure (UAE North) and GCP (Dammam), in SAR with 15% VAT, live
  pricing APIs with a 24h disk cache, verified ranged downloads for the AWS bulk
  CSV, interactive mode, `regions` and `cache` commands. Never published.

[0.3.0]: https://github.com/R3dn/saudi-cloud-cost-estimator-cli/releases/tag/v0.3.0
