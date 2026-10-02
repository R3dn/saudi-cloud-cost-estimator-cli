import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist', 'index.js');
let PRELOAD_DIR: string;
let PRELOAD: string;

/**
 * Full end-to-end tests: the real built CLI binary against faithful mocks of all
 * four provider pricing APIs. Mock data and golden numbers are derived from the
 * providers' own published rate tables (verified 2026-10-02):
 *
 * - AWS me-south-1 bulk CSVs (real on-demand prices and column shapes, incl.
 *   camelCase StartingRange/EndingRange/usageType and real volume tiers).
 * - OCI price list parts incl. the verified free allowances: object storage
 *   first 10 GB free, MEA egress first 10,240 GB (10 TB) free, LB first
 *   744 LB-hours/month free. No fabricated parts.
 * - Azure uaenorth retail items incl. egress volume tiers via tierMinimumUnits
 *   (first 100 GB free, then 0.181/GB MGN); no LB/NAT meters (as in the real API).
 * - GCP Dammam Billing Catalog SKUs incl. tieredRates on the egress SKU.
 *
 * Every assertion is exact â€” goldens computed from these tables by hand.
 */

const FX_SAR_PER_USD = 3.75;
const VAT = 1.15;

// â”€â”€â”€ OCI (verified live from the OCI price list API, SAR) â”€â”€â”€
const OCPU_SAR = 0.09376;
const MEM_SAR = 0.0056256;
const A10_SAR = 7.5008;
const OCI_LB_HOURLY_SAR = 0.04237952; // B93030: [0,744) free, then 0.04237952/hr
const OCI_EGRESS_SAR = 0.18752; // B93456: [0,10240) free, then 0.18752/GB

const OCI_PARTS: Record<string, { sar: number; metric: string; name: string; tiers?: { value: number; rangeMin: number; rangeMax: number }[] }> = {
  B93113: { sar: 0.09376, metric: 'OCPU Per Hour', name: 'Compute - Standard - E4 - OCPU' },
  B93114: { sar: 0.0056256, metric: 'Gigabyte Per Hour', name: 'Compute - Standard - E4  - Memory' },
  B95909: { sar: 7.5008, metric: 'GPU Per Hour', name: 'Compute  - GPU - A10' },
  B91628: { sar: 0.0956352, metric: 'Gigabyte Storage Capacity Per Month', name: 'Object Storage - Storage', tiers: [{ value: 0, rangeMin: 0, rangeMax: 10 }, { value: 0.0956352, rangeMin: 10, rangeMax: 999999999 }] },
  B91961: { sar: 0.0956352, metric: 'Gigabyte Storage Capacity Per Month', name: 'Block Volume - Storage' },
  B89057: { sar: 1.12512, metric: 'Gigabyte Storage Capacity Per Month', name: 'File Storage - Storage' },
  // Real MEA egress: first 10 TB (10240 GB) free
  B93456: { sar: 0.18752, metric: 'Gigabyte Outbound Data Transfer Per Month', name: 'Outbound Data Transfer - Originating in Middle East and Africa', tiers: [{ value: 0, rangeMin: 0, rangeMax: 10240 }, { value: 0.18752, rangeMin: 10240, rangeMax: 999999999999999 }] },
  // Real LB: first 744 LB-hours/month free
  B93030: { sar: 0.04237952, metric: 'Load Balancer', name: 'Load Balancer Base', tiers: [{ value: 0, rangeMin: 0, rangeMax: 744 }, { value: 0.04237952, rangeMin: 744, rangeMax: 999999999 }] },
  B112725: { sar: 0.20177152, metric: 'ECPU Per Hour', name: 'Oracle Base Database Service - Standard - x86 - ECPU' },
  B111584: { sar: 0.450048, metric: 'Gigabyte (GB) Storage Capacity Per Month', name: 'Oracle Base Database Service - Database Storage' },
  B109356: { sar: 1.2601344, metric: 'ECPU Per Hour', name: 'Oracle Exadata Exascale Database ECPU' },
  B107952: { sar: 0.73245312, metric: 'Gigabyte (GB) Storage Capacity Per Month', name: 'Oracle Exadata Exascale Smart Database Storage' },
  B96545: { sar: 0.37504, metric: 'Cluster Per Hour', name: 'OCI Kubernetes Engine - Enhanced Cluster' },
  B96109: { sar: 0.112512, metric: 'Hour', name: 'OCI Kubernetes Engine - Virtual Node' },
};

// â”€â”€â”€ AWS me-south-1 (verified live from the bulk CSVs, USD) â”€â”€â”€
const AWS_EC2_PRICES: Record<string, { price: number; vcpu: string; mem: string; gpu?: string; gpuModel?: string }> = {
  'm6i.large': { price: 0.132, vcpu: '2', mem: '8 GiB' },
  'm6i.xlarge': { price: 0.264, vcpu: '4', mem: '16 GiB' },
  'm6i.2xlarge': { price: 0.528, vcpu: '8', mem: '32 GiB' },
  'm6i.4xlarge': { price: 1.056, vcpu: '16', mem: '64 GiB' },
  'm6i.8xlarge': { price: 2.112, vcpu: '32', mem: '128 GiB' },
  'm6i.16xlarge': { price: 4.224, vcpu: '64', mem: '256 GiB' },
  'r6i.xlarge': { price: 0.3102, vcpu: '4', mem: '32 GiB' },
  'r6i.2xlarge': { price: 0.6204, vcpu: '8', mem: '64 GiB' },
  'r6i.4xlarge': { price: 1.2408, vcpu: '16', mem: '128 GiB' },
  'r6i.8xlarge': { price: 2.4816, vcpu: '32', mem: '256 GiB' },
  'c6i.xlarge': { price: 0.2112, vcpu: '4', mem: '8 GiB' },
  'c6i.2xlarge': { price: 0.4224, vcpu: '8', mem: '16 GiB' },
  'c6i.4xlarge': { price: 0.8448, vcpu: '16', mem: '32 GiB' },
  'c6i.8xlarge': { price: 1.6896, vcpu: '32', mem: '64 GiB' },
  'g4dn.xlarge': { price: 0.645, vcpu: '4', mem: '16 GiB', gpu: '1', gpuModel: 'T4' },
  'g4dn.12xlarge': { price: 4.798, vcpu: '48', mem: '192 GiB', gpu: '4', gpuModel: 'T4' },
};
// Real me-south-1 egress tiers (AWS Outbound â†’ External, DataTransfer-Out-Bytes):
const AWS_EGRESS_TIERS = [
  { start: 0, end: 10240, price: 0.117 },
  { start: 10240, end: 51200, price: 0.1105 },
  { start: 51200, end: 153600, price: 0.091 },
  { start: 153600, end: 'Inf', price: 0.065 },
];
// Real me-south-1 S3 general purpose tiers (per GB-Mo):
const AWS_S3_TIERS = [
  { start: 0, end: 51200, price: 0.025 },
  { start: 51200, end: 512000, price: 0.024 },
  { start: 512000, end: 'Inf', price: 0.023 },
];
const AWS_LB_HOURLY = 0.02772; // ALB/NLB hours (Product Family "Load Balancer-Application")
const AWS_NAT_HOURLY = 0.0528;
const AWS_EBS_GP3_PER_GB_MONTH = 0.0968;
const AWS_EFS_PER_GB_MONTH = 0.36;
const AWS_EKS_CLUSTER_HOURLY = 0.1;
const AWS_RDS_SINGLE_AZ: Record<string, number> = { 'db.t3.micro': 0.022, 'db.t3.medium': 0.086, 'db.m6i.xlarge': 0.434 };
const AWS_RDS_MULTI_AZ: Record<string, number> = { 'db.t3.micro': 0.043, 'db.t3.medium': 0.172, 'db.m6i.xlarge': 0.868 };
const AWS_RDS_GP3_PG_PER_GB_MONTH = 0.14; // PostgreSQL Single-AZ GP3 storage
const AWS_RDS_GP3_PG_PIOPS = 0.024; // PostgreSQL Single-AZ GP3 provisioned IOPS

// â”€â”€â”€ Azure uaenorth (verified live from the retail prices API, USD) â”€â”€â”€
const AZURE_VM_PRICES: Record<string, number> = {
  Standard_D2s_v5: 0.0964,
  Standard_D4s_v5: 0.1928,
  Standard_D8s_v5: 0.3856,
  Standard_D16s_v5: 0.7712,
  Standard_D32s_v5: 1.883,
  Standard_D64s_v5: 3.766,
  Standard_E4s_v5: 0.31,
  Standard_E8s_v5: 0.62,
  Standard_E16s_v5: 1.241,
  Standard_E32s_v5: 2.482,
  Standard_F4s_v2: 0.211,
  Standard_F8s_v2: 0.422,
  Standard_F16s_v2: 0.844,
  Standard_F32s_v2: 1.688,
  Standard_NC24lds_xl_RTXPRO6000BSE_v6: 1.617,
  Standard_NC144lds_xl_RTXPRO6000BSE_v6: 7.87,
};
// Real uaenorth Standard Data Transfer Out tiers (Routing Preference: MGN):
const AZURE_EGRESS_TIERS = [
  { tierMin: 0, price: 0.0 },
  { tierMin: 100, price: 0.181 },
  { tierMin: 10335, price: 0.175 },
  { tierMin: 51295, price: 0.17 },
  { tierMin: 153695, price: 0.16 },
  { tierMin: 512095, price: 0.16 },
];
const AZURE_BLOB_PER_GB_MONTH = 0.018;
const AZURE_FILES_PER_GB_MONTH = 0.06;
const AZURE_S10_DISK_MONTH = 1.732;
const AZURE_PG_HOURLY: Record<string, number> = { B1ms: 0.0135, B2ms: 0.0542, D2ds_v4: 0.268 };
const AZURE_PG_STORAGE_GB_MONTH = 0.115;
const AZURE_LB_LIST_HOURLY = 0.0065; // published list (retail API has no LB meter for uaenorth)

// â”€â”€â”€ GCP me-central2 (Dammam) USD â”€â”€â”€
const GCP_N2_CPU = 0.0335;
const GCP_N2_RAM = 0.0044;
const GCP_T4_GPU = 0.35;
// Real GCP internet egress is tiered (premium-tier, first 200 TB in the mock):
const GCP_EGRESS_TIERS = [
  { start: 0, price: 0.12 },
  { start: 204800, price: 0.11 },
  { start: 512000, price: 0.09 },
];
const GCP_LB_HOURLY = 0.025;
const GCP_NAT_HOURLY = 0.045;
const GCP_GCS_STANDARD = 0.02;
const GCP_PD_SSD = 0.17;
const GCP_GKE_MGMT = 0.1;

function money(units: number): { units: string; nanos: number } {
  return { units: String(Math.floor(units)), nanos: Math.round((units % 1) * 1e9) };
}

function gcpSku(
  description: string,
  resourceGroup: string,
  region: string,
  price: number,
  unit = 'h',
  resourceFamily = 'Compute',
  tiers?: { startUsageAmount: number; price: number }[],
) {
  const rateTiers = (tiers ?? [{ startUsageAmount: 0, price }]).map((t) => ({ startUsageAmount: t.startUsageAmount, unitPrice: money(t.price) }));
  return {
    description,
    category: { resourceGroup, resourceFamily, usageType: 'OnDemand' },
    serviceRegions: [region],
    pricingInfo: [{ pricingExpression: { usageUnit: unit, tieredRates: rateTiers } }],
  };
}

interface AzureItem {
  armSkuName: string;
  skuName: string;
  meterName: string;
  productName: string;
  serviceName: string;
  retailPrice: number;
  unitOfMeasure: string;
  type: string;
  armRegionName: string;
  tierMinimumUnits?: number;
}

function azureVmItem(sku: string, price: number): AzureItem {
  return {
    armSkuName: sku,
    skuName: sku.replace('Standard_', ''),
    meterName: sku.replace('Standard_', ''),
    productName: 'Virtual Machines',
    serviceName: 'Virtual Machines',
    retailPrice: price,
    unitOfMeasure: '1 Hour',
    type: 'Consumption',
    armRegionName: 'uaenorth',
  };
}

function awsCsvQuote(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function awsCsvLine(header: string[], cells: string[]): string {
  return cells.map(awsCsvQuote).join(',');
}

/** Builds a minimal-but-guard-passing EC2 CSV: MIN_INSTANCE_TYPES is 100. */
function buildAwsEc2Csv(): string {
  const header = [
    'SKU', 'OfferTermCode', 'RateCode', 'TermType', 'PriceDescription', 'EffectiveDate', 'StartingRange', 'EndingRange',
    'Unit', 'PricePerUnit', 'Currency', 'RelatedTo', 'LeaseContractLength', 'PurchaseOption', 'OfferingClass',
    'Product Family', 'serviceCode', 'Location', 'Location Type', 'Instance Type', 'Current Generation', 'Instance Family',
    'vCPU', 'Physical Processor', 'Clock Speed', 'Memory', 'Storage', 'Network Performance', 'Processor Architecture',
    'Tenancy', 'Operating System', 'License Model', 'Pre Installed S/W', 'CapacityStatus', 'usageType',
    'Region Code', 'Region Name', 'GPU', 'GPU Model',
  ];
  const lines = [
    '"FormatVersion","v1.0"',
    '"Disclaimer","..."',
    '"Publication Date","2026-09-25T17:45:21Z"',
    '"Version","20260925174521"',
    '"OfferCode","AmazonEC2"',
    header.map(awsCsvQuote).join(','),
  ];
  for (let i = 0; i < 120; i++) {
    lines.push(
      awsCsvLine(header, [
        `SKU${i}`, 'JRTCKXETXF', `RATE${i}`, 'OnDemand', `desc gen-${i}`, '2026-09-01', '0', 'Inf', 'Hrs',
        (0.01 + i / 10000).toFixed(10), 'USD', '', '', '', '', 'Compute Instance', 'AmazonEC2', 'Middle East (Bahrain)',
        'AWS Region', `gen-${i}`, 'Yes', 'General purpose', '2', 'Intel', '3.5 GHz', '8 GiB', 'EBS only', '10 Gigabit',
        '64-bit', 'Shared', 'Linux', 'No License required', 'NA', 'Used', `MES1-BoxUsage:gen-${i}`,
        'me-south-1', 'Middle East (Bahrain)', '', '',
      ]),
    );
  }
  for (const [type, info] of Object.entries(AWS_EC2_PRICES)) {
    lines.push(
      awsCsvLine(header, [
        `SKU-${type}`, 'JRTCKXETXF', `RATE-${type}`, 'OnDemand', `$${info.price} per On Demand Linux ${type} Instance Hour`,
        '2026-09-01', '0', 'Inf', 'Hrs', info.price.toFixed(10), 'USD', '', '', '', '', 'Compute Instance', 'AmazonEC2',
        'Middle East (Bahrain)', 'AWS Region', type, 'Yes', 'General purpose', info.vcpu, 'Intel', '3.5 GHz', info.mem,
        'EBS only', '10 Gigabit', '64-bit', 'Shared', 'Linux', 'No License required', 'NA', 'Used', `MES1-BoxUsage:${type}`,
        'me-south-1', 'Middle East (Bahrain)', info.gpu ?? '', info.gpuModel ?? '',
      ]),
    );
  }
  // Special EC2 rows are built by cell-name so column drift is impossible.
  const specRow = (cells: Record<string, string>): string => {
    const byName: Record<string, string> = {
      TermType: 'OnDemand',
      EffectiveDate: '2026-09-01',
      StartingRange: '0',
      EndingRange: 'Inf',
      Currency: 'USD',
      CapacityStatus: 'Used',
      ...cells,
    };
    const out = header.map((h) => byName[h] ?? '');
    out[0] = 'SKU-X';
    return awsCsvLine(header, out);
  };
  // Application LB hourly row (real EC2 offer carries these under
  // "Load Balancer-Application"/"Load Balancer-Network" product families).
  lines.push(
    specRow({
      PriceDescription: '$0.02772 per ALB-hour',
      Unit: 'Hrs',
      PricePerUnit: '0.0277200000',
      'Product Family': 'Load Balancer-Application',
      serviceCode: 'AmazonEC2',
      usageType: 'MES1-LoadBalancerUsage',
      'Region Code': 'me-south-1',
    }),
  );
  // NAT Gateway hourly row (real EC2 offer family "NAT Gateway").
  lines.push(
    specRow({
      PriceDescription: 'NAT Gateway hours',
      Unit: 'Hrs',
      PricePerUnit: '0.0528000000',
      'Product Family': 'NAT Gateway',
      serviceCode: 'AmazonEC2',
      usageType: 'MES1-NatGateway-Hours',
      'Region Code': 'me-south-1',
    }),
  );
  // EBS gp3 per GB-month row (real usageType MES1-EBS:VolumeUsage.gp3).
  lines.push(
    specRow({
      PriceDescription: '$0.0968 per GB-Month of General Purpose (gp3) provisioned storage',
      Unit: 'GB-Mo',
      PricePerUnit: '0.0968000000',
      'Product Family': 'Storage',
      serviceCode: 'AmazonEC2',
      usageType: 'MES1-EBS:VolumeUsage.gp3',
      'Region Code': 'me-south-1',
    }),
  );
  return lines.join('\n');
}

function buildAwsGenericCsv(offerCode: string, rows: Record<string, string>[]): string {
  const extraHeaders = ['SKU', 'OfferTermCode', 'RateCode'];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = [...extraHeaders, ...keys];
  const lines = [
    '"FormatVersion","v1.0"',
    '"Disclaimer","..."',
    '"Publication Date","2026-09-25T17:45:21Z"',
    '"Version","20260925174521"',
    `"OfferCode","${offerCode}"`,
    header.map(awsCsvQuote).join(','),
  ];
  let i = 0;
  for (const r of rows) {
    const cells = extraHeaders.map(() => `${offerCode}-SKU${i}`);
    for (const k of keys) cells.push(r[k] ?? '');
    lines.push(cells.map(awsCsvQuote).join(','));
    i++;
  }
  return lines.join('\n');
}

function mockFetchScript(): string {
  const ec2Csv = buildAwsEc2Csv();

  // S3 with the real three volume tiers (camelCase StartingRange/EndingRange).
  const s3Rows = AWS_S3_TIERS.map((t) => ({
    TermType: 'OnDemand', 'Product Family': 'Storage', Unit: 'GB-Mo', 'Storage Class': 'General Purpose',
    StartingRange: String(t.start), EndingRange: String(t.end), PricePerUnit: t.price.toFixed(10),
    'Region Code': 'me-south-1', usageType: 'MES1-TimedStorage-ByteHrs',
    PriceDescription: `$${t.price} per GB - tier ${t.start}-${t.end}`,
  }));
  const efsRows = [
    { TermType: 'OnDemand', Unit: 'GB-Mo', PriceDescription: 'Standard storage per GB-Month', PricePerUnit: AWS_EFS_PER_GB_MONTH.toFixed(10), 'Region Code': 'me-south-1', 'Product Family': 'Storage', usageType: 'MES1-TimedStorage-ByteHrs' },
  ];
  // DataTransfer with the real volume tiers plus the global 100 GB free row.
  const egressRows = AWS_EGRESS_TIERS.map((t) => ({
    TermType: 'OnDemand', 'Product Family': 'Data Transfer', 'Transfer Type': 'AWS Outbound', 'To Location': 'External', Unit: 'GB',
    StartingRange: String(t.start), EndingRange: String(t.end), PricePerUnit: t.price.toFixed(10),
    'From Location': 'Middle East (Bahrain)', 'Region Code': 'me-south-1', usageType: 'MES1-DataTransfer-Out-Bytes',
    PriceDescription: `$${t.price} per GB tier ${t.start}-${t.end}`,
  }));
  // The "Global-DataTransfer-Out-Bytes" 100 GB free row is the 12-month Free
  // Tier â€” the estimator deliberately excludes it, so the mock includes it to
  // prove it is not picked up.
  egressRows.push({
    TermType: 'OnDemand', 'Product Family': 'Data Transfer', 'Transfer Type': 'AWS Outbound', 'To Location': 'External', Unit: 'GB',
    StartingRange: '0', EndingRange: '100', PricePerUnit: '0.0000000000',
    'From Location': 'Middle East (Bahrain)', 'Region Code': 'me-south-1', usageType: 'Global-DataTransfer-Out-Bytes',
    PriceDescription: '$0 for 100GB of data transfer out to the internet, aggregated globally, each month',
  });
  const eksRows = [
    { TermType: 'OnDemand', usageType: 'MES1-AmazonEKS-Hours:perCluster', PriceDescription: 'EKS cluster hours', PricePerUnit: AWS_EKS_CLUSTER_HOURLY.toFixed(10), 'Region Code': 'me-south-1' },
  ];
  const rdsRows: Record<string, string>[] = [];
  for (const [type, price] of Object.entries(AWS_RDS_SINGLE_AZ)) {
    rdsRows.push({ TermType: 'OnDemand', 'Product Family': 'Database Instance', 'Instance Type': type, 'Database Engine': 'PostgreSQL', 'Deployment Option': 'Single-AZ', Unit: 'Hrs', PricePerUnit: price.toFixed(10), 'Region Code': 'me-south-1' });
  }
  for (const [type, price] of Object.entries(AWS_RDS_MULTI_AZ)) {
    rdsRows.push({ TermType: 'OnDemand', 'Product Family': 'Database Instance', 'Instance Type': type, 'Database Engine': 'PostgreSQL', 'Deployment Option': 'Multi-AZ', Unit: 'Hrs', PricePerUnit: price.toFixed(10), 'Region Code': 'me-south-1' });
  }
  rdsRows.push({ TermType: 'OnDemand', 'Product Family': 'Database Storage', 'Volume Type': 'General Purpose-GP3', 'Database Engine': 'PostgreSQL', 'Deployment Option': 'Single-AZ', Unit: 'GB-Mo', PricePerUnit: AWS_RDS_GP3_PG_PER_GB_MONTH.toFixed(10), 'Region Code': 'me-south-1', usageType: 'MES1-RDS:GP3' });
  rdsRows.push({ TermType: 'OnDemand', 'Product Family': 'Database Storage', 'Volume Type': 'General Purpose-GP3', 'Database Engine': 'PostgreSQL', 'Deployment Option': 'Multi-AZ', Unit: 'GB-Mo', PricePerUnit: '0.2790000000', 'Region Code': 'me-south-1', usageType: 'MES1-RDS:Multi-AZ-GP3' });
  rdsRows.push({ TermType: 'OnDemand', 'Product Family': 'Database Storage', 'Volume Type': 'General Purpose', 'Database Engine': 'PostgreSQL', 'Deployment Option': 'Single-AZ', Unit: 'GB-Mo', PricePerUnit: '0.1397000000', 'Region Code': 'me-south-1', usageType: 'MES1-RDS:gp2' });
  rdsRows.push({ TermType: 'OnDemand', 'Product Family': 'Database Storage', 'Database Engine': 'PostgreSQL', 'Deployment Option': 'Single-AZ', Unit: 'IOPS-Mo', PricePerUnit: AWS_RDS_GP3_PG_PIOPS.toFixed(10), 'Region Code': 'me-south-1', usageType: 'MES1-RDS:GP3-PIOPS' });

  const ociItems = Object.entries(OCI_PARTS).map(([partNumber, p]) => ({
    partNumber,
    displayName: p.name,
    metricName: p.metric,
    currencyCodeLocalizations: [
      {
        currencyCode: 'SAR',
        prices: p.tiers
          ? p.tiers.map((t) => ({ model: 'PAY_AS_YOU_GO', value: t.value, rangeMin: t.rangeMin, rangeMax: t.rangeMax }))
          : [{ model: 'PAY_AS_YOU_GO', value: p.sar }],
      },
    ],
  }));

  const azureVmItems = Object.entries(AZURE_VM_PRICES).map(([sku, price]) => azureVmItem(sku, price));
  const azureStorageItems: AzureItem[] = [
    { armSkuName: 'Standard LRS', skuName: 'Standard LRS', meterName: 'Data Stored', productName: 'Block Blob Standard', serviceName: 'Storage', retailPrice: AZURE_BLOB_PER_GB_MONTH, unitOfMeasure: 'GB/Month', type: 'Consumption', armRegionName: 'uaenorth' },
    { armSkuName: 'Standard LRS', skuName: 'S10 LRS', meterName: 'S10 Disks', productName: 'Standard SSD Managed Disks', serviceName: 'Storage', retailPrice: AZURE_S10_DISK_MONTH, unitOfMeasure: '1/Month', type: 'Consumption', armRegionName: 'uaenorth' },
    { armSkuName: 'Standard LRS', skuName: 'Standard LRS', meterName: 'Data Stored', productName: 'Files Standard', serviceName: 'Storage', retailPrice: AZURE_FILES_PER_GB_MONTH, unitOfMeasure: 'GB/Month', type: 'Consumption', armRegionName: 'uaenorth' },
  ];
  // Real uaenorth Bandwidth rows: tiered Standard Data Transfer Out (MGN) + unrelated meters.
  const azureEgressItems: AzureItem[] = AZURE_EGRESS_TIERS.map((t) => ({
    armSkuName: 'Bandwidth', skuName: 'Standard', meterName: 'Standard Data Transfer Out', productName: 'Rtn Preference: MGN',
    serviceName: 'Bandwidth', retailPrice: t.price, unitOfMeasure: '1 GB', type: 'Consumption', armRegionName: 'uaenorth',
    tierMinimumUnits: t.tierMin,
  }));
  azureEgressItems.push(
    { armSkuName: 'Bandwidth', skuName: 'Standard', meterName: 'Standard Inter-Region Data Transfer', productName: 'Rtn Preference: MGN', serviceName: 'Bandwidth', retailPrice: 0.16, unitOfMeasure: '1 GB', type: 'Consumption', armRegionName: 'uaenorth' },
    { armSkuName: 'Bandwidth', skuName: 'Standard', meterName: 'Standard Data Transfer In', productName: 'Rtn Preference: MGN', serviceName: 'Bandwidth', retailPrice: 0.0, unitOfMeasure: '1 GB', type: 'Consumption', armRegionName: 'uaenorth' },
  );
  const azurePgItems: AzureItem[] = [];
  for (const [tier, price] of Object.entries(AZURE_PG_HOURLY)) {
    azurePgItems.push({ armSkuName: tier, skuName: tier, meterName: `B ${tier}`, productName: 'Azure Database for PostgreSQL', serviceName: 'Azure Database for PostgreSQL', retailPrice: price, unitOfMeasure: '1 Hour', type: 'Consumption', armRegionName: 'uaenorth' });
  }
  azurePgItems.push({ armSkuName: 'Storage', skuName: 'Storage', meterName: 'Storage', productName: 'Azure Database for PostgreSQL', serviceName: 'Azure Database for PostgreSQL', retailPrice: AZURE_PG_STORAGE_GB_MONTH, unitOfMeasure: '1 GB', type: 'Consumption', armRegionName: 'uaenorth' });

  const gcpComputeSkus = [
    gcpSku('N2 Instance Core running in Dammam', 'CPU', 'me-central2', GCP_N2_CPU),
    gcpSku('N2 Instance Ram running in Dammam', 'RAM', 'me-central2', GCP_N2_RAM),
    gcpSku('NVIDIA T4 running in Dammam', 'GPU', 'me-central2', GCP_T4_GPU),
    gcpSku('Kubernetes Engine management fee running in Dammam', 'GKE', 'me-central2', GCP_GKE_MGMT),
    gcpSkuUnit('Internet egress from Dammam', 'Network', 'me-central2', GCP_EGRESS_TIERS, 'GiBy'),
    gcpSkuUnit('Network Load Balancing forwarding rule in Dammam', 'Network', 'me-central2', GCP_LB_HOURLY, 'hour'),
    gcpSkuUnit('NAT gateway in Dammam', 'Network', 'me-central2', GCP_NAT_HOURLY, 'hour'),
    gcpSkuUnit('SSD backed PD capacity in Dammam', 'SSD', 'me-central2', GCP_PD_SSD, 'GiBy.mo', 'Storage'),
  ];
  const gcpStorageSkus = [gcpSkuUnit('Standard Storage in Dammam', 'StandardStorage', 'me-central2', GCP_GCS_STANDARD, 'GiBy.mo')];

  const payload = {
    fx: { rates: { SAR: FX_SAR_PER_USD } },
    ociItems,
    ec2Csv,
    awsOffers: {
      AmazonS3: buildAwsGenericCsv('AmazonS3', s3Rows),
      AmazonEFS: buildAwsGenericCsv('AmazonEFS', efsRows),
      AWSDataTransfer: buildAwsGenericCsv('AWSDataTransfer', egressRows),
      AmazonEKS: buildAwsGenericCsv('AmazonEKS', eksRows),
      AmazonRDS: buildAwsGenericCsv('AmazonRDS', rdsRows),
    },
    azure: {
      vm: azureVmItems,
      storage: azureStorageItems,
      bandwidth: azureEgressItems,
      pg: azurePgItems,
    },
    gcp: {
      compute: gcpComputeSkus,
      storage: gcpStorageSkus,
    },
  };

  return `
const { fx, ociItems, ec2Csv, awsOffers, azure, gcp } = ${JSON.stringify(payload)};

const ec2Buf = Buffer.from(ec2Csv, 'utf8');
const offerBufs = { AmazonEC2: ec2Buf };
for (const [offer, csv] of Object.entries(awsOffers)) offerBufs[offer] = Buffer.from(csv, 'utf8');

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const method = init?.method ?? 'GET';

  if (u.includes('open.er-api.com')) {
    return { ok: true, status: 200, json: async () => fx };
  }

  if (u.includes('apexapps.oracle.com')) {
    return { ok: true, status: 200, json: async () => ({ items: ociItems }) };
  }

  if (u.includes('pricing.us-east-1.amazonaws.com')) {
    if (u.endsWith('region_index.json')) {
      // /offers/v1.0/aws/<OfferCode>/current/region_index.json
      const m = /\\/aws\\/([^/]+)\\/current\\/region_index\\.json/.exec(u);
      const offer = m ? m[1] : null;
      if (!offer || !offerBufs[offer]) throw new Error('unexpected AWS offer index: ' + u);
      return {
        ok: true, status: 200,
        json: async () => ({ regions: { 'me-south-1': { currentVersionUrl: '/offers/v1.0/aws/' + offer + '/20260925174521/me-south-1/index.json' } } }),
      };
    }
    const offerMatch = /\\/aws\\/([^/]+)\\//.exec(u);
    const offer = offerMatch ? offerMatch[1] : null;
    const buf = offer ? offerBufs[offer] : undefined;
    if (!buf) throw new Error('unexpected AWS offer url: ' + u);
    if (method === 'HEAD') {
      return { ok: true, status: 200, headers: new Map([['content-length', String(buf.length)]]) };
    }
    const range = init?.headers && typeof init.headers === 'object' ? init.headers['Range'] ?? init.headers['range'] : null;
    if (range) {
      const m = /bytes=(\\d+)-(\\d+)/.exec(String(range));
      if (m) {
        const start = Number(m[1]);
        const end = Math.min(Number(m[2]), buf.length - 1);
        return { ok: true, status: 206, headers: new Map(), arrayBuffer: async () => buf.subarray(start, end + 1) };
      }
    }
    return { ok: true, status: 200, arrayBuffer: async () => buf };
  }

  if (u.includes('prices.azure.com')) {
    const filter = decodeURIComponent(u.split('\\$filter=')[1] ?? '');
    let items = [];
    if (filter.includes("armSkuName eq 'Standard_")) {
      const m = /armSkuName eq '(Standard_[A-Za-z0-9_]+)'/u.exec(filter);
      items = azure.vm.filter((i) => i.armSkuName === m?.[1]);
    } else if (filter.includes("serviceName eq 'Storage'")) {
      items = azure.storage;
    } else if (filter.includes("serviceName eq 'Bandwidth'")) {
      items = azure.bandwidth;
    } else if (filter.includes("serviceName eq 'Azure Database for PostgreSQL'")) {
      items = azure.pg;
    } else if (filter.includes("serviceName eq 'Virtual Machines'")) {
      items = azure.vm;
    }
    return { ok: true, status: 200, json: async () => ({ Items: items, NextPageLink: null }) };
  }

  if (u.includes('cloudbilling.googleapis.com')) {
    if (u.includes('/services/6F81-5844-456A/skus')) {
      return { ok: true, status: 200, json: async () => ({ skus: gcp.compute, nextPageToken: undefined }) };
    }
    if (u.includes('/services/95FF-2EF5-EC87/skus')) {
      return { ok: true, status: 200, json: async () => ({ skus: gcp.storage, nextPageToken: undefined }) };
    }
    return { ok: true, status: 200, json: async () => ({ skus: [], nextPageToken: undefined }) };
  }

  throw new Error('unexpected fetch in e2e test: ' + u + ' ' + method);
};
`;
}

// GCP tiered egress SKU builder (kept outside payload for reuse).
function gcpSkuUnit(
  description: string,
  resourceGroup: string,
  region: string,
  priceOrTiers: number | { start: number; price: number }[],
  unit: string,
  resourceFamily = 'Compute',
) {
  const tiers = Array.isArray(priceOrTiers)
    ? (priceOrTiers as { start: number; price: number }[])
    : [{ start: 0, price: priceOrTiers as number }];
  return gcpSku(
    description,
    resourceGroup,
    region,
    tiers[0]!.price,
    unit,
    resourceFamily,
    tiers.map((t) => ({ startUsageAmount: t.start, price: t.price })),
  );
}

function runCli(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const cacheDir = mkdtempSync(join(tmpdir(), 'scc-e2e-'));
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--no-warnings', `--import=${pathToFileURL(PRELOAD).href}`, DIST, ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SAUDI_CLOUD_COSTS_CACHE_DIR: cacheDir,
          GOOGLE_CLOUD_API_KEY: 'e2e-test-key',
          NO_COLOR: '1',
          ...env,
        },
        timeout: 120_000,
      },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message };
  }
}

function jsonOut(r: { status: number; stdout: string }): Record<string, unknown> {
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

describe('CLI e2e (built dist, all providers mocked)', () => {
  beforeAll(async () => {
    if (!existsSync(DIST)) {
      execFileSync('npm', ['run', 'build'], {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: 180_000,
        shell: process.platform === 'win32',
      });
    }
    PRELOAD_DIR = mkdtempSync(join(tmpdir(), 'scc-e2e-preload-'));
    PRELOAD = join(PRELOAD_DIR, 'preload.mjs');
    mkdirSync(PRELOAD_DIR, { recursive: true });
    writeFileSync(PRELOAD, mockFetchScript(), 'utf8');
  });

  afterAll(() => {
    if (PRELOAD_DIR) rmSync(PRELOAD_DIR, { recursive: true, force: true });
  });

  describe('compute estimate â€” profiles', () => {
    const cases: { profile: string; ocpus: number; gb: number }[] = [
      { profile: 'small', ocpus: 2, gb: 8 },
      { profile: 'medium', ocpus: 4, gb: 16 },
      { profile: 'large', ocpus: 8, gb: 32 },
      { profile: 'xlarge', ocpus: 16, gb: 64 },
      { profile: '2xlarge', ocpus: 32, gb: 128 },
      { profile: '3xlarge', ocpus: 64, gb: 256 },
      { profile: 'mem-medium', ocpus: 4, gb: 32 },
      { profile: 'mem-2xlarge', ocpus: 32, gb: 256 },
      { profile: 'cpu-medium', ocpus: 4, gb: 8 },
      { profile: 'cpu-2xlarge', ocpus: 32, gb: 64 },
    ];

    for (const c of cases) {
      it(`oci ${c.profile} matches the golden OCPU+memory math`, () => {
        const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '-s', c.profile, '--json']));
        const expectedHourly = c.ocpus * OCPU_SAR + c.gb * MEM_SAR;
        expect(out.hourly).toBeCloseTo(expectedHourly, 9);
        expect(out.monthly).toBeCloseTo(expectedHourly * 730, 6);
        expect(out.monthlyVat).toBeCloseTo(expectedHourly * 730 * VAT, 6);
        expect(out.source).toBe('live');
        expect(out.listedCurrency).toBe('SAR');
        expect(out.nativeSar).toBe(true);
        expect(out.vcpu).toBe(c.ocpus);
        expect(out.gb).toBe(c.gb);
      });
    }

    it('oci gpu-medium adds the A10 GPU part per hour', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '-s', 'gpu-medium', '--json']));
      const expectedHourly = 4 * OCPU_SAR + 24 * MEM_SAR + 1 * A10_SAR;
      expect(out.hourly).toBeCloseTo(expectedHourly, 9);
      expect(out.skuRef).toBe('B93113+B93114+B95909');
      expect(out.instance).toContain('A10');
    });

    it('oci gpu-large prices 4 A10s', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '-s', 'gpu-large', '--json']));
      const expectedHourly = 48 * OCPU_SAR + 192 * MEM_SAR + 4 * A10_SAR;
      expect(out.hourly).toBeCloseTo(expectedHourly, 9);
    });

    it('aws profiles price from the mocked bulk CSV in USD', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'aws', '-s', '2xlarge', '--json']));
      expect(out.hourly).toBeCloseTo(2.112, 9);
      expect(out.listedCurrency).toBe('USD');
      expect(out.hourlyDisplay).toBeCloseTo(2.112 * FX_SAR_PER_USD, 9);
      expect(out.monthlyVat).toBeCloseTo(2.112 * 730 * FX_SAR_PER_USD * VAT, 6);
      expect(out.vcpu).toBe(32);
      expect(out.gb).toBe(128);
    });

    it('aws mem-medium (r6i.xlarge) and cpu-medium (c6i.xlarge) price exactly', () => {
      const mem = jsonOut(runCli(['compute', 'estimate', '-p', 'aws', '-s', 'mem-medium', '--json']));
      expect(mem.hourly).toBeCloseTo(0.3102, 9);
      expect(mem.gb).toBe(32);
      const cpu = jsonOut(runCli(['compute', 'estimate', '-p', 'aws', '-s', 'cpu-medium', '--json']));
      expect(cpu.hourly).toBeCloseTo(0.2112, 9);
      expect(cpu.gb).toBe(8);
    });

    it('aws gpu-medium reads the T4 GPU count from the CSV', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'aws', '-s', 'gpu-medium', '--json']));
      expect(out.hourly).toBeCloseTo(0.645, 9);
      expect(out.vcpu).toBe(4);
      expect(out.gb).toBe(16);
    });

    it('azure profiles price from the mocked retail API', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'azure', '-s', 'medium', '--json']));
      expect(out.hourly).toBeCloseTo(0.1928, 9);
      expect(out.hourlyDisplay).toBeCloseTo(0.1928 * FX_SAR_PER_USD, 9);
    });

    it('azure gpu profiles (RTX PRO 6000) price live rows', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'azure', '-s', 'gpu-medium', '--json']));
      expect(out.hourly).toBeCloseTo(1.617, 9);
      expect(out.skuRef).toContain('RTXPRO6000BSE');
    });

    it('gcp profiles price from N2 CPU/RAM SKUs', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'gcp', '-s', 'mem-medium', '--json']));
      const expected = 4 * GCP_N2_CPU + 32 * GCP_N2_RAM;
      expect(out.hourly).toBeCloseTo(expected, 9);
      expect(out.vcpu).toBe(4);
      expect(out.gb).toBe(32);
    });

    it('gcp gpu-medium adds the per-GPU-hour T4 SKU', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'gcp', '-s', 'gpu-medium', '--json']));
      const expected = 4 * GCP_N2_CPU + 16 * GCP_N2_RAM + 1 * GCP_T4_GPU;
      expect(out.hourly).toBeCloseTo(expected, 9);
      expect(out.instance).toContain('T4');
    });
  });

  describe('compute estimate â€” custom sizing', () => {
    it('oci --ocpus/--memory builds a flex shape', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '--ocpus', '6', '--memory', '48', '--json']));
      const expectedHourly = 6 * OCPU_SAR + 48 * MEM_SAR;
      expect(out.hourly).toBeCloseTo(expectedHourly, 9);
      expect(out.instance).toContain('6 OCPU / 48 GB');
    });

    it('aws --instance prices an arbitrary SKU with CSV-derived specs', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'aws', '--instance', 'r6i.4xlarge', '--json']));
      expect(out.hourly).toBeCloseTo(1.2408, 9);
      expect(out.vcpu).toBe(16);
      expect(out.gb).toBe(128);
    });

    it('aws --instance with an unknown SKU fails loudly (no fallback)', () => {
      const r = runCli(['compute', 'estimate', '-p', 'aws', '--instance', 'not-a-type', '--json']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('not found');
    });

    it('azure --instance derives specs from the SKU name', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'azure', '--instance', 'Standard_E8s_v5', '--json']));
      expect(out.hourly).toBeCloseTo(0.62, 9);
      expect(out.vcpu).toBe(8);
      expect(out.gb).toBe(64);
    });

    it('gcp --instance prices a predefined machine type', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'gcp', '--instance', 'n2-standard-8', '--json']));
      const expected = 8 * GCP_N2_CPU + 32 * GCP_N2_RAM;
      expect(out.hourly).toBeCloseTo(expected, 9);
      expect(out.instance).toContain('8 vCPU / 32 GB');
    });

    it('gcp --instance rejects unsupported machine families', () => {
      const r = runCli(['compute', 'estimate', '-p', 'gcp', '--instance', 'm3-ultramem-64', '--json']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('not a supported');
    });

    it('oci --instance is rejected with a pointing error', () => {
      const r = runCli(['compute', 'estimate', '-p', 'oci', '--instance', 'VM.Standard.E4.Flex', '--json']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('--ocpus');
    });

    it('--instance + --size is rejected', () => {
      const r = runCli(['compute', 'estimate', '-p', 'aws', '-s', 'medium', '--instance', 'r6i.4xlarge', '--json']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('cannot be combined');
    });

    it('--ocpus on a non-OCI provider is rejected', () => {
      const r = runCli(['compute', 'estimate', '-p', 'aws', '--ocpus', '4', '--memory', '16', '--json']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('only apply to OCI');
    });
  });

  describe('compute compare', () => {
    type CompareRowJson = { provider: string; hourly: number | null; instance: string; region: string; source: string | null; error: string | null };

    function rowsByProvider(out: Record<string, unknown>): Record<string, CompareRowJson> {
      const by: Record<string, CompareRowJson> = {};
      for (const row of out.rows as CompareRowJson[]) by[row.provider] = row;
      return by;
    }

    it('returns one row per provider with the right instances for mem-medium', () => {
      const out = jsonOut(runCli(['compute', 'compare', '-s', 'mem-medium', '--json']));
      expect(out.input).toEqual({ profile: 'mem-medium' });
      const byProvider = rowsByProvider(out);
      expect(Object.keys(byProvider).sort()).toEqual(['aws', 'azure', 'gcp', 'oci']);
      expect(byProvider['oci']!.region).toBe('me-riyadh-1');
      expect(byProvider['oci']!.hourly).toBeCloseTo(4 * OCPU_SAR + 32 * MEM_SAR, 9);
      expect(byProvider['aws']!.instance).toBe('r6i.xlarge');
      expect(byProvider['aws']!.region).toBe('me-south-1');
      expect(byProvider['aws']!.hourly).toBeCloseTo(0.3102 * FX_SAR_PER_USD, 9);
      expect(byProvider['azure']!.instance).toBe('Standard_E4s_v5');
      expect(byProvider['gcp']!.hourly).toBeCloseTo((4 * GCP_N2_CPU + 32 * GCP_N2_RAM) * FX_SAR_PER_USD, 9);
      expect((out.rows as CompareRowJson[]).every((r) => r.error === null && r.source === 'live')).toBe(true);
    });

    it('gpu-medium compare rows across all four providers', () => {
      const out = jsonOut(runCli(['compute', 'compare', '-s', 'gpu-medium', '--json']));
      const byProvider = rowsByProvider(out);
      expect(byProvider['aws']!.instance).toBe('g4dn.xlarge');
      expect(byProvider['aws']!.hourly).toBeCloseTo(0.645 * FX_SAR_PER_USD, 9);
      expect(byProvider['azure']!.instance).toContain('RTXPRO6000BSE');
      expect(byProvider['oci']!.skuRef).toContain('B95909');
      expect(byProvider['gcp']!.hourly).toBeCloseTo((4 * GCP_N2_CPU + 16 * GCP_N2_RAM + GCP_T4_GPU) * FX_SAR_PER_USD, 9);
    });

    it('compute compare emits CSV with one row per provider', () => {
      const r = runCli(['compute', 'compare', '-s', 'medium', '--csv']);
      expect(r.status).toBe(0);
      const lines = r.stdout.trim().split(/\r?\n/);
      expect(lines[0]).toBe('provider,region,monthly,monthlyVat,currency,vat,error');
      expect(lines.length).toBe(5);
      expect(lines[1]).toContain('oci,me-riyadh-1');
    });

    it('all 16 profiles parse and price on oci', () => {
      const profiles = [
        'small', 'medium', 'large', 'xlarge', '2xlarge', '3xlarge',
        'mem-medium', 'mem-large', 'mem-xlarge', 'mem-2xlarge',
        'cpu-medium', 'cpu-large', 'cpu-xlarge', 'cpu-2xlarge',
        'gpu-medium', 'gpu-large',
      ];
      for (const p of profiles) {
        const r = runCli(['compute', 'estimate', '-p', 'oci', '-s', p, '--json']);
        expect(r.status, `profile ${p}`).toBe(0);
        const out = JSON.parse(r.stdout);
        expect(out.source, `profile ${p}`).toBe('live');
        expect(out.hourly, `profile ${p}`).toBeGreaterThan(0);
      }
    });
  });

  describe('cross-service e2e (aws)', () => {
    it('k8s estimate prices EKS control plane + nodes from mocked offers', () => {
      const out = jsonOut(
        runCli(['k8s', 'estimate', '-p', 'aws', '--nodes', '2', '--node-size', 'cpu-medium', '--control-plane', '--json']),
      );
      // 2 Ã— c6i.xlarge Ã— 730h + 0.1 Ã— 730h, USD â†’ SAR, +VAT
      const nodesMonthly = 2 * 0.2112 * 730 * FX_SAR_PER_USD;
      const cpMonthly = AWS_EKS_CLUSTER_HOURLY * 730 * FX_SAR_PER_USD;
      expect(out.monthly).toBeCloseTo(nodesMonthly + cpMonthly, 4);
      expect(out.monthlyVat).toBeCloseTo((nodesMonthly + cpMonthly) * VAT, 4);
      expect(out.components.controlPlane.source).toBe('live');
      expect(out.components.nodes.monthly).toBeCloseTo(nodesMonthly, 4);
    });

    it('network estimate prices tiered egress + ALB + NAT from mocked offers', () => {
      const out = jsonOut(runCli(['network', 'estimate', '-p', 'aws', '--egress', '100', '--lb', '2', '--nat', '--json']));
      // 100 GB egress: 100 GB free (global row [0,100)=$0) â€” all within the free window
      const egress = 0;
      const lb = 2 * AWS_LB_HOURLY * 730 * FX_SAR_PER_USD;
      const nat = AWS_NAT_HOURLY * 730 * FX_SAR_PER_USD;
      expect(out.components.egress.monthly).toBeCloseTo(egress, 4);
      expect(out.components.loadBalancer.monthly).toBeCloseTo(lb, 4);
      expect(out.components.nat.monthly).toBeCloseTo(nat, 4);
      expect(out.monthly).toBeCloseTo(egress + lb + nat, 4);
    });

    it('aws egress beyond the free 100 GB bills at the first paid tier', () => {
      const r = runCli(['network', 'estimate', '-p', 'aws', '--egress', '5000', '--lb', '0', '--json']);
      const out = jsonOut(r);
      // 5000 GB: 100 free, 4900 × $0.117
      const egress = 4900 * 0.117 * FX_SAR_PER_USD;
      expect(out.components.egress.monthly).toBeCloseTo(egress, 4);
    });

    it('aws egress across tiers is billed per tier, not at the cheapest rate', () => {
      const out = jsonOut(runCli(['network', 'estimate', '-p', 'aws', '--egress', '20000', '--lb', '0', '--json']));
      // 20000 GB: 100 free + 10140 Ã— 0.117 + 9760 Ã— 0.1105
      const expected = (100 * 0 + 10140 * 0.117 + 9760 * 0.1105) * FX_SAR_PER_USD;
      expect(out.components.egress.monthly).toBeCloseTo(expected, 3);
    });

    it('storage estimate prices tiered S3 + EBS gp3 + EFS from mocked offers', () => {
      const out = jsonOut(runCli(['storage', 'estimate', '-p', 'aws', '--object', '10', '--block', '100', '--file', '50', '--json']));
      // S3 10 GB is within the first tier ($0.025/GB), not the cheapest tier
      const object = 10 * 0.025 * FX_SAR_PER_USD;
      const block = 100 * AWS_EBS_GP3_PER_GB_MONTH * FX_SAR_PER_USD;
      const file = 50 * AWS_EFS_PER_GB_MONTH * FX_SAR_PER_USD;
      expect(out.components.objectStorage.monthly).toBeCloseTo(object, 4);
      expect(out.components.blockStorage.monthly).toBeCloseTo(block, 4);
      expect(out.components.fileStorage.monthly).toBeCloseTo(file, 4);
      expect(out.monthly).toBeCloseTo(object + block + file, 4);
    });

    it('aws S3 across volume tiers is billed per tier', () => {
      const out = jsonOut(runCli(['storage', 'estimate', '-p', 'aws', '--object', '60000', '--block', '0', '--file', '0', '--json']));
      // 60000 GB: 51200 Ã— $0.025 + 8800 Ã— $0.024
      const expected = (51200 * 0.025 + 8800 * 0.024) * FX_SAR_PER_USD;
      expect(out.components.objectStorage.monthly).toBeCloseTo(expected, 3);
    });

    it('database estimate prices RDS single-AZ + GP3 storage (engine-matched)', () => {
      const out = jsonOut(runCli(['database', 'estimate', '-p', 'aws', '-e', 'postgresql', '-t', 'medium', '--storage', '50', '--json']));
      const compute = AWS_RDS_SINGLE_AZ['db.t3.medium']! * 730 * FX_SAR_PER_USD;
      const storage = 50 * AWS_RDS_GP3_PG_PER_GB_MONTH * FX_SAR_PER_USD;
      expect(out.monthly).toBeCloseTo(compute + storage, 4);
      expect(out.components.storage.skuRef).toContain('gp3');
    });

    it('database estimate with --ha doubles to Multi-AZ (GP3 storage at the Multi-AZ rate)', () => {
      const out = jsonOut(runCli(['database', 'estimate', '-p', 'aws', '-e', 'postgresql', '-t', 'medium', '--storage', '50', '--ha', '--json']));
      const compute = AWS_RDS_MULTI_AZ['db.t3.medium']! * 730 * FX_SAR_PER_USD;
      // HA storage bills at the Multi-AZ GP3 rate ($0.279/GB for PostgreSQL)
      const storage = 50 * 0.279 * FX_SAR_PER_USD;
      expect(out.monthly).toBeCloseTo(compute + storage, 4);
    });

    it('tco composes compute + storage + db + network with --hours respected', () => {
      const out = jsonOut(
        runCli([
          'tco', '-p', 'aws', '--compute-size', 'medium', '--hours', '100', '--storage-object', '10',
          '--storage-block', '0', '--db-engine', 'none', '--k8s-nodes', '0',
          '--network-egress', '0', '--network-lb', '0', '--json',
        ]),
      );
      const compute = 0.264 * 100 * FX_SAR_PER_USD;
      const storage = 10 * 0.025 * FX_SAR_PER_USD;
      expect(out.services.compute.monthly).toBeCloseTo(compute, 4);
      expect(out.services.storage.monthly).toBeCloseTo(storage, 4);
      expect(out.services.database.monthly).toBe(0);
      expect(out.services.kubernetes.monthly).toBe(0);
      expect(out.services.network.monthly).toBe(0);
      expect(out.totalMonthly).toBeCloseTo(compute + storage, 4);
    });
  });

  describe('cross-service e2e (azure/gcp/oci)', () => {
    it('azure k8s nodes on the cpu-medium profile price via retail API', () => {
      const out = jsonOut(runCli(['k8s', 'estimate', '-p', 'azure', '--nodes', '2', '--node-size', 'cpu-medium', '--json']));
      const nodes = 2 * AZURE_VM_PRICES['Standard_F4s_v2']! * 730 * FX_SAR_PER_USD;
      expect(out.monthly).toBeCloseTo(nodes, 4);
      expect(out.components.controlPlane.monthly).toBe(0);
    });

    it('azure network prices tiered egress + assumed LB (labeled)', () => {
      const out = jsonOut(runCli(['network', 'estimate', '-p', 'azure', '--egress', '5000', '--lb', '1', '--json']));
      // 5000 GB: first 100 free, 4900 Ã— $0.181
      const egress = 4900 * 0.181 * FX_SAR_PER_USD;
      const lb = AZURE_LB_LIST_HOURLY * 730 * FX_SAR_PER_USD;
      expect(out.components.egress.monthly).toBeCloseTo(egress, 4);
      expect(out.components.loadBalancer.monthly).toBeCloseTo(lb, 4);
      expect(out.components.loadBalancer.source).toBe('assumption');
      expect(out.warnings.some((w: string) => /list \$0.0065\/hr/.test(w))).toBe(true);
    });

    it('azure egress within the free 100 GB is zero, live-labeled', () => {
      const out = jsonOut(runCli(['network', 'estimate', '-p', 'azure', '--egress', '50', '--lb', '0', '--json']));
      expect(out.components.egress.monthly).toBeCloseTo(0, 6);
      expect(out.components.egress.source).toBe('live');
    });

    it('gcp k8s with control plane prices the GKE management fee SKU', () => {
      const out = jsonOut(runCli(['k8s', 'estimate', '-p', 'gcp', '--nodes', '1', '--node-size', 'small', '--control-plane', '--json']));
      const nodes = (2 * GCP_N2_CPU + 8 * GCP_N2_RAM) * 730 * FX_SAR_PER_USD;
      const cp = GCP_GKE_MGMT * 730 * FX_SAR_PER_USD;
      expect(out.monthly).toBeCloseTo(nodes + cp, 4);
      expect(out.components.controlPlane.source).toBe('live');
    });

    it('gcp network prices tiered egress from the SKU tieredRates', () => {
      const r = runCli(['network', 'estimate', '-p', 'gcp', '--egress', '1000', '--lb', '1', '--json']);
      const out = jsonOut(r);
      const egress = 1000 * 0.12 * FX_SAR_PER_USD;
      const lb = GCP_LB_HOURLY * 730 * FX_SAR_PER_USD;
      expect(out.components.egress.monthly).toBeCloseTo(egress, 4);
      expect(out.components.loadBalancer.monthly).toBeCloseTo(lb, 4);
      expect(out.monthly).toBeCloseTo(egress + lb, 4);
    });

    it('gcp storage prices GCS standard + PD-SSD with the Filestore assumption labeled', () => {
      const out = jsonOut(runCli(['storage', 'estimate', '-p', 'gcp', '--object', '100', '--block', '50', '--file', '10', '--json']));
      const object = 100 * GCP_GCS_STANDARD * FX_SAR_PER_USD;
      const block = 50 * GCP_PD_SSD * FX_SAR_PER_USD;
      expect(out.components.objectStorage.monthly).toBeCloseTo(object, 4);
      expect(out.components.blockStorage.monthly).toBeCloseTo(block, 4);
      expect(out.warnings.some((w: string) => /Filestore|assum/i.test(w))).toBe(true);
    });

    it('azure database (postgresql) prices compute + storage rows', () => {
      const out = jsonOut(runCli(['database', 'estimate', '-p', 'azure', '-e', 'postgresql', '-t', 'medium', '--storage', '20', '--json']));
      const compute = AZURE_PG_HOURLY['B2ms']! * 730 * FX_SAR_PER_USD;
      const storage = 20 * AZURE_PG_STORAGE_GB_MONTH * FX_SAR_PER_USD;
      expect(out.monthly).toBeCloseTo(compute + storage, 4);
    });

    it('oci network: LB within the 744-hour free allowance costs SAR 0 (regression)', () => {
      const out = jsonOut(runCli(['network', 'estimate', '-p', 'oci', '--egress', '0', '--lb', '1', '--nat', '--json']));
      // 1 LB Ã— 730h = 730 LB-hours â€” entirely free (first 744 LB-hrs/month free)
      expect(out.components.loadBalancer.monthly).toBeCloseTo(0, 6);
      expect(out.components.loadBalancer.source).toBe('live');
      expect(out.warnings.some((w: string) => /first 744 LB-hours\/month free/.test(w))).toBe(true);
      // NAT is not in the price list API â†’ assumption, published list $0.055/hr
      expect(out.components.nat.source).toBe('assumption');
      expect(out.components.nat.monthly).toBeCloseTo(0.055 * 730 * FX_SAR_PER_USD, 4);
    });

    it('oci network prices 10 TB egress free tier + LB beyond 744 hours + assumed NAT', () => {
      const out = jsonOut(runCli(['network', 'estimate', '-p', 'oci', '--egress', '11000', '--lb', '2', '--nat', '--json']));
      // egress: first 10,240 GB free, 760 paid GB Ã— 0.18752 SAR
      const egress = 760 * OCI_EGRESS_SAR;
      // LB: 2 Ã— 730h = 1460 LB-hours â†’ 744 free, 716 billed at 0.04237952 SAR/hr
      const lb = 716 * OCI_LB_HOURLY_SAR;
      const nat = 0.055 * 730 * FX_SAR_PER_USD;
      expect(out.components.egress.monthly).toBeCloseTo(egress, 4);
      expect(out.components.loadBalancer.monthly).toBeCloseTo(lb, 4);
      expect(out.components.nat.monthly).toBeCloseTo(nat, 4);
      expect(out.monthly).toBeCloseTo(egress + lb + nat, 4);
      expect(out.warnings.some((w: string) => /first 10240 GB\/month free/.test(w))).toBe(true);
    });

    it('oci tco with a single LB charges nothing for the LB line at default hours', () => {
      const out = jsonOut(
        runCli(['tco', '-p', 'oci', '--db-engine', 'none', '--k8s-nodes', '0', '--storage-block', '0', '--network-egress', '0', '--network-lb', '1', '--network-nat', '--json']),
      );
      // network = LB (free within 744h) + NAT (assumed $0.055/hr)
      const nat = 0.055 * 730 * FX_SAR_PER_USD;
      expect(out.services.network.monthly).toBeCloseTo(nat, 4);
      expect(out.warnings.some((w: string) => /first 744 LB-hours\/month free/.test(w))).toBe(true);
    });
  });

  describe('envelope and regression invariants', () => {
    it('compute estimate envelope keeps the documented JSON contract', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '-s', 'medium', '--json']));
      for (const key of [
        'provider', 'providerName', 'region', 'regionName', 'instance', 'vcpu', 'gb',
        'hourly', 'hourlyDisplay', 'altHourly', 'monthly', 'monthlyVat', 'currency',
        'fxRate', 'listedCurrency', 'nativeSar', 'source',
      ]) {
        expect(out, key).toHaveProperty(key);
      }
      expect(out.source).toBe('live');
    });

    it('compare envelope is uniform across services (input/currency/vat/hours/rows)', () => {
      for (const args of [
        ['storage', 'compare', '--object', '10', '--block', '10'],
        ['database', 'compare', '--storage', '10'],
        ['k8s', 'compare', '--nodes', '1'],
        ['network', 'compare', '--egress', '10'],
        ['compute', 'compare', '-s', 'small'],
      ]) {
        const out = jsonOut(runCli([...args, '--json']));
        expect(out.currency).toBe('SAR');
        expect(out.vat).toBe(true);
        expect(out.hours).toBe(730);
        expect(Array.isArray(out.rows)).toBe(true);
        for (const key of ['provider', 'providerName', 'region', 'regionName', 'monthly', 'monthlyVat', 'currency', 'components', 'warnings', 'error']) {
          expect(out.rows[0], key).toHaveProperty(key);
        }
      }
    });

    it('USD display keeps USD hourly for AWS with alt in SAR', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'aws', '-s', 'medium', '--currency', 'USD', '--no-vat', '--json']));
      expect(out.currency).toBe('USD');
      expect(out.hourlyDisplay).toBeCloseTo(0.264, 9);
      expect(out.altHourly).toBeCloseTo(0.264 * FX_SAR_PER_USD, 9);
      expect(out.monthlyVat).toBeCloseTo(0.264 * 730, 6);
    });

    it('--hours multiplies every hourly-billed estimate', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '-s', 'medium', '--hours', '10', '--json']));
      const expectedHourly = 4 * OCPU_SAR + 16 * MEM_SAR;
      expect(out.monthly).toBeCloseTo(expectedHourly * 10, 9);
    });

    it('--no-vat returns monthly === monthlyVat', () => {
      const out = jsonOut(runCli(['compute', 'estimate', '-p', 'oci', '-s', 'medium', '--no-vat', '--json']));
      expect(out.monthly).toBe(out.monthlyVat);
    });

    it('regions lists all providers, and regions --json emits the machine envelope', () => {
      const r = runCli(['regions']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Oracle Cloud Infrastructure');
      expect(r.stdout).toContain('me-central2');
      const j = jsonOut(runCli(['regions', '--json']));
      const providers = j.providers as { provider: string; regions: { id: string }[] }[];
      expect(providers.map((p) => p.provider).sort()).toEqual(['aws', 'azure', 'gcp', 'oci']);
      expect(providers.find((p) => p.provider === 'gcp')!.regions[0]!.id).toBe('me-central2');
    });

    it('storage compare CSV emits the documented header', () => {
      const r = runCli(['storage', 'compare', '--block', '10', '--csv']);
      expect(r.status).toBe(0);
      const lines = r.stdout.trim().split(/\r?\n/);
      expect(lines[0]).toBe('provider,region,monthly,monthlyVat,currency,vat,error');
      expect(lines.length).toBe(5);
    });
  });
});
