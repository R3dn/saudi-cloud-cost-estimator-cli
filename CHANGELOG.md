# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Expanded compute sizing**: 16 size profiles across four families — general
  purpose (`small`…`3xlarge`, new `2xlarge`/`3xlarge` 32/64 vCPU), memory-optimized
  (`mem-*`, r6i/Esv5/n2-highmem), compute-optimized (`cpu-*`, c6i/Fsv2/n2-highcpu)
  and GPU (`gpu-medium`/`gpu-large`). The GPU profiles pick the smallest
  inference-class GPU actually listed per region: OCI VM.GPU.A10 (live A10 GPU part
  `B95909` in native SAR), AWS g4dn (T4 — the only GPU family in me-south-1),
  Azure RTX PRO 6000 Blackwell v6 (uaenorth lists no T4 series), GCP T4 discovered
  at runtime (fails loudly if the region has no matching SKU).
- **`--instance <sku>`** on `compute estimate` (and the top-level alias): price any
  on-demand Linux SKU for AWS/Azure/GCP. AWS reads vCPU/RAM/GPU specs from the bulk
  CSV; Azure derives specs from the SKU name (the retail API returns none); GCP
  parses predefined `n2`/`e2`/`c2` machine types. Unknown SKUs fail loudly — no
  silent substitution.
- **`--ocpus`/`--memory`** on `compute estimate`: custom OCI flex shapes, priced by
  the live OCPU/GB parts. `--instance` on OCI points to these flags (flex shapes
  have no fixed SKUs). Flags are mutually exclusive with `--size` and each other.
- **End-to-end test suite** (`tests/cli-e2e.test.ts`, private suite): the built binary
  run as a real child process against faithful mocks of all four provider APIs
  (AWS ranged CSV chunks, Azure OData filters, GCP Billing Catalog, OCI parts incl.
  GPU/tiers) plus the FX API — 47 cases with golden numbers covering every profile,
  custom sizing, GPU pricing, cross-service composition (k8s/storage/db/network/TCO)
  and the failure contracts. `npm test` runs unit + service + CLI smoke + e2e;
  `test:cli` runs the CLI suites on a fresh build. Restored the missing `test`,
  `test:unit`, `test:cli` scripts and the `vitest` devDependency (the suite itself
  remains unpublished in the package, per repository policy).
- README: Arabic introduction for the Arabic cloud community the tool serves.
- README: "Initial vs. final pricing" section — the tool is positioned as an
  initial (budgetary) estimator; the final price set by the provider usually
  differs after negotiated discounts, reserved/committed-use rates,
  promotions or credits.

### Fixed

- **Financial correctness**
  - `tco` respects explicit zeros: `--storage-block 0`, `--network-egress 0`,
    `--network-lb 0`, `--k8s-nodes 0` and `--db-storage 0` are honoured instead of
    being silently replaced by their defaults (`0 || 100` coercion bug, caught by
    the e2e suite).
  - `storage compare`, `database compare` and `k8s compare` no longer pass an empty
    region to estimators; each provider resolves its own region, so rows are priced
    (or fail) against real region data instead of silently falling back to hardcoded
    US-region prices (or fabricating GCP numbers).
  - OCI egress now uses the correct **MEA** part (`B93456`) instead of the APAC part
    (`B93455`); OCI database storage now uses `B111584` instead of the Enterprise
    ECPU part; OCI file storage uses `B89057` instead of a mount-target part.
  - OCI tiered prices (`rangeMin`/`rangeMax`, e.g. free first 10 GB object storage,
    744 free LB hours) are now honoured: the previous code took the first PAYG entry
    and priced those components as **free**.
  - `--hours` now applies to every hourly-billed service (compute, DB, k8s nodes and
    control plane, LB, NAT); previously only compute honored it and the rest hardcoded
    730.
  - `tco` no longer double-bills egress (previously 100 GB was charged under both
    storage and network) and no longer forces an always-on database
    (`--db-engine none` skips the line; `--k8s-nodes 0` skips kubernetes).
  - `k8s estimate -p <provider>` now estimates a single provider instead of ignoring
    the flag and comparing all providers.
  - Kubernetes control-plane pricing is now real where obtainable: EKS per-cluster
    hours from the AmazonEKS bulk offer, OKE Enhanced Cluster from the OCI price
    list, GKE management fee from the Billing Catalog (published list $0.10/hr as a
    labeled fallback). The previous code invented a $0.10/hr constant for AWS *and*
    Azure (AKS's free-tier control plane is actually $0).
  - AWS RDS lookup now matches the real `Database Engine` CSV column (was `Engine`,
    which never matched); Azure DB tiers use real flexible-server SKUs (B1ms/B2ms).
  - AWS NAT/LB row matching fixed (`NatGateway-Hours`, `LoadBalancerUsage` usage types).
  - `--object 0`/`--lb 0` etc. no longer error (quantities use a non-negative parser).

### Added

- **Price provenance**: every estimate and line item now carries
  `source: live | fallback | assumption`, a `skuRef` identifying the SKU/part it came
  from, and human-readable `warnings`. Tables and JSON surface this; approximations
  are never presented as official prices.
- **Documented VAT assumption**: 15% Saudi VAT is applied by default, including to
  Bahrain/UAE consumption; the output now states this is an assumption that depends on
  the customer's VAT registration.
- `--gcp-key-file` to pass the Google Cloud API key without leaking it into shell history.
- In-flight fetch dedup: concurrent calls within one run share a single download/parse
  (one TCO run no longer downloads the ~70 MB EC2 CSV three times).
- Windows CI matrix, `npm audit` job, Dependabot config, release workflow.

### Changed (repository)

- `AGENTS.md`, the `tests/` suite and `vitest` tooling are no longer published in the
  public repository; CI runs typecheck, lint, build and smoke checks.

### Changed

- One shared catalog fetcher per provider API (`ociCatalog`, `awsCatalog`, `gcpCatalog`,
  `azureCatalog`) replaces five duplicated OCI list fetchers and duplicated AWS/GCP/Azure
  plumbing across services.
- Single type system in `src/core/types.ts` (`src/providers/types.ts` re-exports it);
  single VAT/normalization path in `src/core`.
- Uniform JSON envelope across all `compare` commands: `{ input, currency, vat, hours, rows[] }`.
- `--version` is read from `package.json` (was duplicated).

## [0.1.0]

- Initial release: compute estimate/compare across OCI (Riyadh/Jeddah), AWS (Bahrain),
  Azure (UAE North) and GCP (Dammam), in SAR with 15% VAT, live pricing APIs with a
  24h disk cache, verified ranged downloads for the AWS bulk CSV, interactive mode,
  `regions` and `cache` commands.
