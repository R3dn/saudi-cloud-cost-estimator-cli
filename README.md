# Saudi Cloud Cost Estimator CLI

**Compare cloud costs across providers serving Saudi Arabia — in SAR, with 15% Saudi VAT — with price provenance on every line.**

[![CI](https://github.com/R3dn/saudi-cloud-cost-estimator-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/R3dn/saudi-cloud-cost-estimator-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)

Aligned with Saudi Vision 2030 cloud localization, this CLI answers a simple question that
no existing open-source tool answers: *what does the same workload cost across the clouds you
can actually use in or near Saudi Arabia?*

```text
Provider                      Region                          Instance                              Hourly    Monthly (incl. 15% VAT*)
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Oracle Cloud Infrastructure   Saudi Arabia Central (Riyadh)   VM.Standard.E4.Flex (4 OCPU / 16 GB)  SAR 0.47  SAR 390
Amazon Web Services           Middle East (Bahrain)           m6i.xlarge                            SAR 0.99  SAR 831
Microsoft Azure               UAE North                        Standard_D4s_v5                       SAR 0.88  SAR 740
Google Cloud                  Dammam                          n2-standard-4                         see note   see note
```

Every number is tagged `live`, `fallback` or `assumption` — this tool never makes an
approximation look like an official provider price.

## Why this exists

Most cloud cost tools focus on US/EU regions and USD. Saudi teams need:

- **SAR pricing** with the mandatory **15% Saudi VAT** applied (and clearly flagged when
  it is applied to Bahrain/UAE consumption — see [VAT treatment](#vat-treatment))
- The providers with real Saudi presence: **Oracle (Riyadh, Jeddah)** and **Google (Dammam)**
- The nearest practical alternatives: **AWS Bahrain** and **Azure UAE North** (both have
  announced Saudi regions that are not live/priced yet — tracked in `regions`)

## Install

**From npm** (once the first release is published):

```bash
npm install -g saudi-cloud-cost-estimator-cli
npx saudi-cloud-cost-estimator-cli   # or run once without installing
```

**From source** (works today):

```bash
git clone https://github.com/R3dn/saudi-cloud-cost-estimator-cli.git
cd saudi-cloud-cost-estimator-cli
npm install
npm run build
node dist/index.js --help
```

Requires Node.js >= 20.

## Usage

### Interactive (no arguments)

```bash
saudi-cloud-costs estimate           # compute wizard
saudi-cloud-costs tco                # full TCO wizard
```

### Compute

```bash
saudi-cloud-costs compute estimate -p oci -r me-riyadh-1 -s medium
saudi-cloud-costs compute estimate -p aws -s large --currency USD --no-vat
saudi-cloud-costs compute compare -s medium --json
```

### Storage / database / Kubernetes / network

```bash
saudi-cloud-costs storage compare --object 50 --block 100
saudi-cloud-costs database compare -e postgresql -t medium --storage 100
saudi-cloud-costs k8s compare --nodes 3 --node-size medium --control-plane
saudi-cloud-costs network compare --egress 100 --lb 1 --nat
```

### Total cost of ownership

```bash
saudi-cloud-costs tco -p oci --db-engine none --k8s-nodes 0             # compute + storage + network
saudi-cloud-costs tco -p aws --db-ha --k8s-nodes 3 --k8s-control-plane  # everything on
```

`--db-engine none` skips the database line; `--k8s-nodes 0` skips Kubernetes. Egress is
billed once, under `network` — never under storage.

### Regions & cache

```bash
saudi-cloud-costs regions
saudi-cloud-costs cache info
saudi-cloud-costs cache clear
```

### Size profiles

| Profile | vCPU | RAM | OCI (flex) | AWS | Azure | GCP |
|---|---|---|---|---|---|---|
| small | 2 | 8 GB | E4.Flex 2/8 | m6i.large | D2s_v5 | n2-standard-2 |
| medium | 4 | 16 GB | E4.Flex 4/16 | m6i.xlarge | D4s_v5 | n2-standard-4 |
| large | 8 | 32 GB | E4.Flex 8/32 | m6i.2xlarge | D8s_v5 | n2-standard-8 |
| xlarge | 16 | 64 GB | E4.Flex 16/64 | m6i.4xlarge | D16s_v5 | n2-standard-16 |

### Options

| Flag | Description |
|---|---|
| `-p, --provider` | oci, aws, azure or gcp |
| `-r, --region` | region id (see `regions`) |
| `-s, --size` | small, medium, large, xlarge |
| `--currency` | SAR (default) or USD |
| `--hours` | hours per month (default 730) — applies to **every** hourly-billed service |
| `--no-vat` | exclude 15% Saudi VAT |
| `--no-cache` | bypass the 24h price cache |
| `--gcp-key` / `--gcp-key-file` | Google Cloud API key (or `GOOGLE_CLOUD_API_KEY`) |
| `--json` | machine-readable output |

### JSON output

All `compare` commands emit the same envelope:

```json
{
  "input": { "...": "service-specific inputs" },
  "currency": "SAR",
  "vat": true,
  "hours": 730,
  "rows": [
    {
      "provider": "oci",
      "providerName": "Oracle Cloud Infrastructure",
      "region": "me-riyadh-1",
      "regionName": "Saudi Arabia Central (Riyadh)",
      "monthly": 339.49,
      "monthlyVat": 390.41,
      "components": { "objectStorage": { "monthly": 3.83, "source": "live", "skuRef": "B91628" } },
      "warnings": ["Object storage: first 10 GB/month free, remainder billed at 0.0956352 SAR/GB."],
      "error": null
    }
  ]
}
```

Every component carries `source` (`live` | `fallback` | `assumption`) and the SKU/part it
came from. Consumers can filter on provenance.

## VAT treatment

The tool applies **15% Saudi VAT** by default, including on Bahrain and UAE consumption.
That is a **documented assumption, not a provider fact**: the actual treatment depends on
your VAT registration (e.g. Bahrain 10%, UAE 5%, or reverse charge on import). Output
labels VAT-inclusive totals accordingly. Use `--no-vat` and apply your own rate when you
need otherwise.

## Price provenance

| Tag | Meaning |
|---|---|
| `live` | Fetched from the provider's official pricing API (or its 24h cache) |
| `fallback` | Built-in approximation because the live source failed — never an official price |
| `assumption` | A documented modelling assumption (e.g. Azure's published LB list price when the retail API has no LB meter for the region; HA modelled as a full standby) |

Examples of assumptions the tool makes explicit: Azure bills managed disks **per tier, not
per GB** (the block rate shown is the S10 tier price spread over 128 GB, labeled as a
derivation); OCI NAT Gateway is not exposed by its price list API (published list price,
labeled); OKE control plane is priced as the paid *Enhanced Cluster* type (Basic clusters
are free). Warnings always appear in output when an assumption affects a number.

## Google Cloud setup (optional)

GCP pricing requires a free API key with the **Cloud Billing API** enabled:

1. Create/choose a Google Cloud project
2. Enable the [Cloud Billing API](https://console.cloud.google.com/apis/library/cloudbilling.googleapis.com)
3. Create an [API key](https://console.cloud.google.com/apis/credentials)
4. `set GOOGLE_CLOUD_API_KEY=your-key` (or pass `--gcp-key` / `--gcp-key-file`)

Without a key, other providers still work; GCP rows show a clear error instead of guessed numbers.

## Data sources

Live, official pricing APIs — no scraping, no static price files:

| Provider | Source |
|---|---|
| OCI | [OCI Price List public API](https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/) — includes native SAR prices and tiered PAYG rates |
| AWS | [Bulk Pricing region index](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json) (Bahrain CSVs for EC2/S3/EFS/RDS/DataTransfer/EKS, ~70 MB each, downloaded in verifiable chunks, cached 24h) |
| Azure | [Azure Retail Prices API](https://prices.azure.com/api/retail/prices) (UAE North, `armRegionName`) |
| GCP | [Cloud Billing Catalog API](https://cloud.google.com/billing/v1/how-tos/catalog-api) (Dammam `me-central2`) |
| FX | [open.er-api.com](https://open.er-api.com) USD→SAR, cached 24h, pegged fallback 3.75 |

Prices are **on-demand Linux** rates. SAR is USD-pegged at 3.75, so currency conversion is stable.

### Cache

Prices and FX rates are cached on disk for 24h (`~/.cache/saudi-cloud-costs`, override with
`SAUDI_CLOUD_COSTS_CACHE_DIR`) so repeat runs are instant and API-friendly. Concurrent
calls within one run share a single download. `--no-cache` skips both cache reads and writes.

## Notes & limitations

- Estimates cover the services listed above at on-demand rates — OS licences are not included.
- Azure's Saudi Arabia East region is announced but not yet in the retail pricing API; the tool uses UAE North until it appears.
- AWS has announced a Saudi region; Bahrain is used until it goes live.
- Alibaba Cloud (Riyadh partner region) and Huawei Cloud (Riyadh) have no public pricing APIs; they are listed in `regions` as unavailable to automated pricing.
- Prices are indicative; your negotiated/committed rates may differ.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run build
npm run smoke
```

CI (Linux + Windows, Node 20/22) runs the same checks on every push.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules — most importantly:
every price needs provenance, and every pricing change must be verified against the
provider's own pricing page.

## Roadmap

- [ ] Windows and RHEL licensing add-ons
- [ ] Reserved/committed-use pricing comparisons
- [ ] Azure Saudi Arabia East + AWS KSA regions once live
- [ ] i18n (Arabic output)

## Security

The tool only calls public, official pricing APIs and writes to its own cache
directory. The only optional credential is a Google Cloud API key for the public
Cloud Billing Catalog API — pass it via `GOOGLE_CLOUD_API_KEY` or `--gcp-key-file`
rather than a shell-visible flag where possible. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Ground rules: every price needs provenance,
and every pricing change needs a test with a mocked API response.

## License

[MIT](LICENSE)
