# Saudi Cloud Cost Estimator CLI

**Compare cloud costs across providers serving Saudi Arabia — in SAR, with 15% Saudi VAT — with price provenance on every line.**

[![CI](https://github.com/R3dn/saudi-cloud-cost-estimator-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/R3dn/saudi-cloud-cost-estimator-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/saudi-cloud-cost-estimator-cli.svg)](https://www.npmjs.com/package/saudi-cloud-cost-estimator-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)

## مقدمة

أداة سطر أوامر (CLI) مفتوحة المصدر مبنية لخدمة مجتمع الحوسبة السحابية العربي، وخصوصًا في السعودية.
تقارن تكاليف البنية السحابية بين مزوّدي الخدمة المتاحين فعليًا في المملكة أو بالقرب منها —
**أوراكل كلاود (الرياض وجدة)** و**جوجل كلاود (الدمام)** و**أمازون ويب سيرفيسز (البحرين)**
و**مايكروسوفت أزور (الإمارات)** — بالريال السعودي، مع إضافة **ضريبة القيمة المضافة 15%** افتراضيًا.

لماذا هذه الأداة؟ أغلب أدوات تقدير التكاليف تركّز على مناطق أمريكا وأوروبا وتُسعّر بالدولار.
الفرق هنا:

- **الأسعار مباشرة من واجهات التسعير الرسمية** لكل مزوّد — بلا ملفات أسعار قديمة ولا تخمين.
- **مصدر كل رقم موثّق**: كل بند في النتيجة يحمل وسمًا — `live` (سعر رسمي من واجهة التسعير)
  أو `fallback` (تقدير بديل عند تعذّر المصدر) أو `assumption` (افتراض موثّق، مثل نمذجة
  الحلول عالية التوافر أو استخدام قائمة أسعار منشورة حين لا توفّر الواجهة الرسمية السعر).
  لا يُقدَّم أي تقدير على أنه سعر رسمي من المزوّد.
- **الضريبة والعملة صحيحة**: تُحتسب ضريبة القيمة المضافة السعودية 15% افتراضيًا كافتراض موثّق
  (بما في ذلك على الاستهلاك من البحرين والإمارات — راجع قسم VAT)، والريال مربوط بالدولار عند 3.75.
- **تغطية شاملة للخدمات**: حساب (بما فيها أحجام GPU وذاكرة/معالج مُحسّنة)، تخزين، قواعد بيانات،
  Kubernetes، شبكة، وحساب التكلفة الكلية للتملّك (TCO) — كلها بأمر واحد.
- **مخصصة للتسعير الأولي (budgetary)**: الأداة تمنحك خط أساس للمقارنة وبناء الميزانية قبل
  التفاوض مع المزوّدين — السعر النهائي يحدّده المزوّد وغالبًا سيكون أفضل بعد الخصومات،
  الحجوزات (Reserved/Committed)، أو برامج الرصيد الترويجية.

```bash
git clone https://github.com/R3dn/saudi-cloud-cost-estimator-cli.git
cd saudi-cloud-cost-estimator-cli && npm install && npm run build
node dist/index.js compute compare -s medium   # مقارنة فورية بين المزوّدين الأربعة
```

> التفاصيل الكاملة للأوامر والأعلام بالإنجليزية أدناه — وللأداة خارطة طريق لإضافة
> دعم اللغة العربية في المخرجات.

Aligned with Saudi Vision 2030 cloud localization, this CLI answers a simple question that
no existing open-source tool answers: *what does the same workload cost across the clouds you
can actually use in or near Saudi Arabia?*

```text
Provider                      Region                          Instance                              Specs          Hourly    Monthly (incl. 15% VAT*)
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Oracle Cloud Infrastructure   Saudi Arabia Central (Riyadh)   VM.Standard.E4.Flex (4 OCPU / 16 GB) 4 vCPU / 16 GB SAR 0.47  SAR 390
Amazon Web Services           Middle East (Bahrain)           m6i.xlarge                            4 vCPU / 16 GB SAR 0.99  SAR 831
Microsoft Azure               UAE North                       Standard_D4s_v5                       4 vCPU / 16 GB SAR 0.88  SAR 740
Google Cloud                  Dammam                          n2-standard-4                         see note       see note
```

Every number is tagged `live`, `fallback` or `assumption` — this tool never makes an
approximation look like an official provider price.

## Architecture

```text
src/index.ts (commander wiring, shared flag builders)
    ↓
src/cli/* (command actions + interactive @clack wizards)
    ↓
src/services/<service>/ (compute • storage • database • kubernetes • network • tco)
    one estimator per provider + a registry; compare.ts emits one JSON envelope
    ↓
src/core/  pricing math shared by everything:
    types (PriceQuote/ServiceEstimate/PriceTier) • pricing/normalization
    (FX + VAT + monthly) • tiers (tieredCost: marginal volume tiers)
    vat (15% + BH/AE reverse-charge note) • fx (USD→SAR, pegged fallback)
    envelope (uniform compare JSON) • cache (24h TTL, atomic writes)
    ↓
src/providers/<id>.ts (compute adapters) + <id>Catalog.ts (shared API fetchers,
    in-flight dedupe) • src/data/sizes.ts (curated profile → SKU map)
    ↓
Official pricing APIs (no static price files, no scraping)
```

Free allowances and volume tiers are modelled, not ignored: OCI's LB (744
LB-hrs/month) and egress (10 TB/month), AWS egress/S3 volume tiers, Azure's
100 GB egress allowance and GCP's `tieredRates` are all applied per tier.

## Why this exists

Most cloud cost tools focus on US/EU regions and USD. Saudi teams need:

- **SAR pricing** with the mandatory **15% Saudi VAT** applied (and clearly flagged when
  it is applied to Bahrain/UAE consumption — see [VAT treatment](#vat-treatment))
- The providers with real Saudi presence: **Oracle (Riyadh, Jeddah)** and **Google (Dammam)**
- The nearest practical alternatives: **AWS Bahrain** and **Azure UAE North** (both have
  announced Saudi regions that are not live/priced yet — tracked in `regions`)

## Install

**From npm**:

```bash
npm install -g saudi-cloud-cost-estimator-cli
saudi-cloud-costs --help          # or run once without installing:
npx saudi-cloud-cost-estimator-cli
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
saudi-cloud-costs compute estimate -p aws -s mem-large --currency USD --no-vat
saudi-cloud-costs compute estimate -p aws --instance r6i.4xlarge          # price any AWS SKU
saudi-cloud-costs compute estimate -p oci --ocpus 6 --memory 48           # custom OCI flex shape
saudi-cloud-costs compute compare -s gpu-medium --json                  # compare GPU offerings
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

Four families of curated t-shirt sizes (a documented mapping, not a provider fact).
`compute compare` keeps comparisons apples-to-apples by profile.

| Profile | vCPU | RAM | OCI (flex) | AWS | Azure | GCP |
|---|---|---|---|---|---|---|
| small | 2 | 8 GB | E4.Flex 2/8 | m6i.large | D2s_v5 | n2-standard-2 |
| medium | 4 | 16 GB | E4.Flex 4/16 | m6i.xlarge | D4s_v5 | n2-standard-4 |
| large | 8 | 32 GB | E4.Flex 8/32 | m6i.2xlarge | D8s_v5 | n2-standard-8 |
| xlarge | 16 | 64 GB | E4.Flex 16/64 | m6i.4xlarge | D16s_v5 | n2-standard-16 |
| 2xlarge | 32 | 128 GB | E4.Flex 32/128 | m6i.8xlarge | D32s_v5 | n2-standard-32 |
| 3xlarge | 64 | 256 GB | E4.Flex 64/256 | m6i.16xlarge | D64s_v5 | n2-standard-64 |
| mem-medium | 4 | 32 GB | E4.Flex 4/32 | r6i.xlarge | E4s_v5 | n2-highmem-4 |
| mem-large | 8 | 64 GB | E4.Flex 8/64 | r6i.2xlarge | E8s_v5 | n2-highmem-8 |
| mem-xlarge | 16 | 128 GB | E4.Flex 16/128 | r6i.4xlarge | E16s_v5 | n2-highmem-16 |
| mem-2xlarge | 32 | 256 GB | E4.Flex 32/256 | r6i.8xlarge | E32s_v5 | n2-highmem-32 |
| cpu-medium | 4 | 8 GB | E4.Flex 4/8 | c6i.xlarge | F4s_v2 | n2-highcpu-4 |
| cpu-large | 8 | 16 GB | E4.Flex 8/16 | c6i.2xlarge | F8s_v2 | n2-highcpu-8 |
| cpu-xlarge | 16 | 32 GB | E4.Flex 16/32 | c6i.4xlarge | F16s_v2 | n2-highcpu-16 |
| cpu-2xlarge | 32 | 64 GB | E4.Flex 32/64 | c6i.8xlarge | F32s_v2 | n2-highcpu-32 |

#### GPU profiles

GPU profiles pick the smallest inference-class GPU actually listed in each region —
the catalogs differ substantially:

| Profile | OCI (Riyadh/Jeddah) | AWS (Bahrain) | Azure (UAE North) | GCP (Dammam) |
|---|---|---|---|---|
| gpu-medium | VM.GPU.A10.1 (1× A10) | g4dn.xlarge (1× T4) | NC24lds RTX PRO 6000 v6 (1× RTX PRO 6000 Blackwell) | N2 + 1× T4 (if listed) |
| gpu-large | VM.GPU.A10.4 (4× A10) | g4dn.12xlarge (4× T4) | NC144lds RTX PRO 6000 v6 (4× RTX PRO 6000 Blackwell) | N2 + 4× T4 (if listed) |

- OCI adds the **A10 GPU part** (`B95909`, per-GPU-hour) on top of the flexible host
  OCPU/GB — both priced live in native SAR.
- GCP discovers GPU SKUs in the Billing Catalog at runtime; if the region has no
  matching GPU SKU the estimate **fails loudly** with a pointer instead of guessing.
- Training-class GPUs (H100, A100, B200...) are reachable via `--instance` where the
  provider lists them (e.g. `--instance Standard_NC40ads_H100_v5` on Azure).

#### Custom sizing

- `--instance <sku>` — price **any** on-demand Linux SKU for AWS/Azure/GCP instead of
  a profile. AWS reads vCPU/RAM/GPU specs from the bulk CSV; Azure derives them from
  the SKU name (the retail API does not return machine specs); GCP parses the
  predefined machine type (`n2-…`, `e2-…`, `c2-…`).
- `--ocpus <n>` `--memory <gb>` — size a custom **OCI flex shape** (OCI has no fixed
  SKUs to name, so `--instance` points OCI users here).
- The flags are mutually exclusive with `--size` and with each other; unknown SKUs
  fail loudly — the tool never substitutes a nearby instance silently.

### Options

| Flag | Description |
|---|---|
| `-p, --provider` | oci, aws, azure or gcp |
| `-r, --region` | region id (see `regions`) |
| `-s, --size` | size profile (see the table above) |
| `--instance <sku>` | price a specific AWS/Azure/GCP SKU instead of a profile |
| `--ocpus <n>` / `--memory <gb>` | custom OCI flex shape (estimate only) |
| `--currency` | SAR (default) or USD |
| `--hours` | hours per month (default 730) — applies to **every** hourly-billed service |
| `--no-vat` | exclude 15% Saudi VAT |
| `--no-cache` | bypass the 24h price cache |
| `--gcp-key` / `--gcp-key-file` | Google Cloud API key (or `GOOGLE_CLOUD_API_KEY`) |
| `--json` | machine-readable output |
| `--csv` | CSV output on compare commands (one row per provider) |

### JSON / CSV output

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

`compute compare` rows additionally carry `instance`, `vcpu`, `gb`, `hourly`,
`source` and `skuRef`. Every component carries `source` (`live` | `fallback` |
`assumption`) and the SKU/part it came from, so consumers can filter on
provenance. `regions --json` lists providers and regions the same way.

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

Free allowances and volume discounts are applied from the providers' own data, per tier —
e.g. `network estimate -p oci --egress 20480 --lb 1 --nat`:

```text
  Oracle Cloud Infrastructure — Saudi Arabia Central (Riyadh)
  Egress: 20480
  Load Balancers: 1
  NAT Gateway: Yes
  Monthly: SAR 2381 (incl. 15% VAT — assumed where applicable)
    - egress: SAR 1920 [live: B93456 (MEA outbound data transfer)]
    - loadBalancer: SAR 0.00 [live: B93030 (LB base)]
    - nat: SAR 151 [assumption: NAT Gateway published list price $0.055/hr]
  Note: OCI NAT Gateway is not exposed by the price list API; using NAT Gateway published list price $0.055/hr (assumption, not an official API price).
  Note: Egress: first 10240 GB/month free, remainder billed at 0.18752 SAR/GB.
  Note: Load Balancer: first 744 LB-hours/month free (Always Free allowance), remainder billed at 0.04237952 SAR/hr.
```

Above: the first 10 TB of monthly egress are free (billed per GB beyond that), and a
single always-on load balancer (730 h) sits entirely inside OCI's 744 LB-hour free
allowance — SAR 0, straight from the live part `B93030`, not an approximation.

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

Note on memory units: AWS and GCP list memory in GiB; the tool shows the provider-listed
number under a unified "GB" label (1 GiB ≈ 1.074 GB). The small unit difference is
disclosed here rather than silently converted, because providers bill on their own unit.

### Cache

Prices and FX rates are cached on disk for 24h (`~/.cache/saudi-cloud-costs`, override with
`SAUDI_CLOUD_COSTS_CACHE_DIR`) so repeat runs are instant and API-friendly. Concurrent
calls within one run share a single download. `--no-cache` skips both cache reads and writes.

## Initial vs. final pricing

This tool produces **initial (budgetary) estimates** to compare providers and size a
first budget — the number you need *before* talking to a cloud provider. It is not a
quote, and not a billing calculator.

The **final price you actually pay** is set by the provider and will usually differ,
typically in your favour:

| Factor | Typical impact |
|---|---|
| Negotiated / enterprise discounts | Often 10–40% off list for committed spend |
| Reserved instances, savings plans, committed-use contracts | 30–70% off on-demand for 1–3 year commitments |
| Promotions and startup/cloud-credits programs | Can cover a large share of early usage |
| Enterprise agreements / education & nonprofit offers | Contract-specific rates |
| Support plans, licences (Windows, RHEL, databases), managed services | Add-ons not included in these estimates |

How to use the two together:

1. Run the tool to get an on-demand baseline and a like-for-like comparison across providers.
2. Take the estimate to your provider(s) as a starting point for a commercial conversation.
3. Ask for a quote against your actual workload — then compare the quoted prices, not the list prices.

Everything the tool prints is list/on-demand pricing from official sources with its
provenance tagged (`live` / `fallback` / `assumption`); your negotiated rates never
appear in it. Reserved/committed-use comparisons are on the roadmap.

## Notes & limitations

- Estimates cover the services listed above at on-demand rates — OS licences are not included.
- Azure's Saudi Arabia East region is announced but not yet in the retail pricing API; the tool uses UAE North until it appears.
- AWS has announced a Saudi region; Bahrain is used until it goes live.
- Alibaba Cloud (Riyadh partner region) and Huawei Cloud (Riyadh) have no public pricing APIs; they are listed in `regions` as unavailable to automated pricing.
- Estimates are **initial/budgetary** on-demand rates — the final price with your provider usually differs once discounts, reserved capacity or credits are applied. See [Initial vs. final pricing](#initial-vs-final-pricing).

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run test:unit   # unit + service + TCO + fixture contract tests (mocked APIs)
npm run test:cli    # CLI smoke + end-to-end on the built binary (mocked APIs)
npm run build
npm run smoke
```

The test suite lives in `tests/` and never hits live endpoints: provider APIs are
mocked with data derived from the providers' own published rate tables, and
`tests/fixtures/` pins recorded captures of the real OCI price list and AWS
me-south-1 bulk CSV rows (including the OCI LB/egress free allowances and the
AWS egress/S3 volume tiers) so a provider-side schema change fails before it
can misprice anything. CI (Linux + Windows, Node 20/22) runs typecheck, lint,
unit tests, build and smoke checks on every push, plus a dedicated CLI e2e job.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules — most importantly:
every price needs provenance, and every pricing change must be verified against
the provider's own pricing page.

## Roadmap

- [ ] Windows and RHEL licensing add-ons
- [ ] Reserved/committed-use pricing comparisons
- [ ] Azure Saudi Arabia East + AWS KSA regions once live
- [ ] i18n (Arabic output)
- [ ] ARM/Graviton instance families in the curated profiles

## Security

The tool only calls public, official pricing APIs and writes to its own cache
directory. The only optional credential is a Google Cloud API key for the public
Cloud Billing Catalog API — pass it via `GOOGLE_CLOUD_API_KEY` or `--gcp-key-file`
rather than a shell-visible flag where possible. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Ground rules: every price needs provenance,
and pricing changes must be verified against the provider's official pricing page.

## License

[MIT](LICENSE)
