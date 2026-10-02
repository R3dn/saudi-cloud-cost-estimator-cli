import type { EstimateOptions, GcpSku, PriceQuote, Provider, SizeSpec } from './types.js';
import { fetchGcpSkus, requireGcpKey, skuPrice } from './gcpCatalog.js';
import { assertRegion } from './oci.js';

export const gcpProvider: Provider = {
  id: 'gcp',
  name: 'Google Cloud',
  regions: [
    {
      id: 'me-central2',
      name: 'Dammam',
      country: 'SA',
      note: 'Requires a Google Cloud API key with the Cloud Billing API enabled (GOOGLE_CLOUD_API_KEY or --gcp-key).',
    },
  ],
  async getHourlyPrice(region: string, size: SizeSpec, opts: EstimateOptions): Promise<PriceQuote> {
    assertRegion(gcpProvider.regions, region, 'GCP');
    const apiKey = requireGcpKey(opts);
    const specs = gcpSpecsFromName(size.instance);
    if (!specs) {
      throw new Error(
        `GCP machine type "${size.instance}" is not a supported N2/E2/C2 predefined series (e.g. n2-standard-4)`,
      );
    }
    if (size.gpu) {
      return gpuQuote(region, size, specs, apiKey, opts);
    }
    const { cpu, ram } = await fetchSeriesPrices(apiKey, region, specs.series, opts.noCache);
    const hourly = specs.vcpu * cpu + specs.gb * ram;
    return {
      provider: 'gcp',
      region,
      instance: `${size.instance} (${specs.vcpu} vCPU / ${specs.gb} GB)`,
      hourly,
      listedCurrency: 'USD',
      vcpu: specs.vcpu,
      gb: specs.gb,
      source: 'live',
      skuRef: `${specs.series.toUpperCase()} Instance Core + ${specs.series.toUpperCase()} Instance Ram (${region})`,
    };
  },
};

interface GcpMachineSpecs {
  series: 'n2' | 'e2' | 'c2';
  vcpu: number;
  gb: number;
}

/**
 * Parses GCP predefined machine types (n2-standard-4, e2-highmem-8, ...).
 * Custom/shared-core beyond the ratio table are rejected — the tool only
 * prices what it can derive from the machine name.
 */
export function gcpSpecsFromName(machine: string): GcpMachineSpecs | undefined {
  const m = /^(n2|e2|c2)-(standard|highmem|highcpu)-(\d+)$/.exec(machine);
  if (!m) return undefined;
  const series = m[1] as GcpMachineSpecs['series'];
  const vcpu = Number(m[3]);
  if (!Number.isFinite(vcpu) || vcpu <= 0) return undefined;
  const gbPerVcpu = { n2: { standard: 4, highmem: 8, highcpu: 2 }, e2: { standard: 4, highmem: 8, highcpu: 2 }, c2: { standard: 4, highmem: 8, highcpu: 2 } }[
    series
  ][m[2] as 'standard' | 'highmem' | 'highcpu']!;
  return { series, vcpu, gb: vcpu * gbPerVcpu };
}

async function fetchSeriesPrices(
  apiKey: string,
  region: string,
  series: 'n2' | 'e2' | 'c2',
  noCache: boolean,
): Promise<{ cpu: number; ram: number }> {
  const skus = await fetchGcpSkus(apiKey, '6F81-5844-456A', region, noCache);
  let cpu = NaN;
  let ram = NaN;
  const prefix = `${series.toUpperCase()} Instance`;
  for (const sku of skus) {
    const isCore = sku.category.resourceGroup === 'CPU' && sku.description.startsWith(`${prefix} Core`);
    const isRam = sku.category.resourceGroup === 'RAM' && sku.description.startsWith(`${prefix} Ram`);
    const price = skuPrice(sku);
    if (!Number.isFinite(price)) continue;
    if (isCore && (Number.isNaN(cpu) || price < cpu)) cpu = price;
    if (isRam && (Number.isNaN(ram) || price < ram)) ram = price;
  }
  if (Number.isNaN(cpu) || Number.isNaN(ram)) {
    throw new Error(`GCP ${series.toUpperCase()} on-demand CPU/RAM SKUs not found for region ${region}`);
  }
  return { cpu, ram };
}

/**
 * GPU machine types price as host CPU/RAM SKUs plus per-GPU-hour SKUs
 * (e.g. "NVIDIA T4" attached to the instance). Throws when the region has no
 * matching GPU SKU — never a silent fallback.
 */
async function gpuQuote(
  region: string,
  size: SizeSpec,
  specs: GcpMachineSpecs,
  apiKey: string,
  opts: EstimateOptions,
): Promise<PriceQuote> {
  const skus = await fetchGcpSkus(apiKey, '6F81-5844-456A', region, opts.noCache);
  const prefix = `${specs.series.toUpperCase()} Instance`;
  const gpuSku = findGpuSku(skus, size.gpu!.model);
  const { cpu, ram } = seriesPricesFromSkus(skus, prefix, specs.series, region);
  const gpuRate = skuPrice(gpuSku);
  if (!Number.isFinite(gpuRate) || gpuRate <= 0) {
    throw new Error(`GCP ${size.gpu!.model} GPU SKU has no usable price in region ${region}`);
  }
  const hourly = specs.vcpu * cpu + specs.gb * ram + size.gpu!.count * gpuRate;
  return {
    provider: 'gcp',
    region,
    instance: `${size.instance} (${specs.vcpu} vCPU / ${specs.gb} GB + ${size.gpu!.count}× ${size.gpu!.model})`,
    hourly,
    listedCurrency: 'USD',
    vcpu: specs.vcpu,
    gb: specs.gb,
    source: 'live',
    skuRef: `${prefix} Core+Ram + ${gpuSku.description}`,
  };
}

function findGpuSku(skus: GcpSku[], model: string): GcpSku {
  const candidates = skus.filter(
    (s) =>
      s.category.resourceGroup === 'GPU' &&
      s.description.toLowerCase().includes(model.toLowerCase()) &&
      !/spot|commit|reserved/i.test(s.description),
  );
  const priced = candidates.filter((s) => {
    const p = skuPrice(s);
    return Number.isFinite(p) && p > 0;
  });
  if (priced.length === 0) {
    throw new Error(`GCP ${model} GPU SKU not found in region — this region may not list ${model} GPUs`);
  }
  return priced.reduce((a, b) => (skuPrice(b) < skuPrice(a) ? b : a));
}

function seriesPricesFromSkus(
  skus: GcpSku[],
  prefix: string,
  series: 'n2' | 'e2' | 'c2',
  region: string,
): { cpu: number; ram: number } {
  let cpu = NaN;
  let ram = NaN;
  for (const sku of skus) {
    const isCore = sku.category.resourceGroup === 'CPU' && sku.description.startsWith(`${prefix} Core`);
    const isRam = sku.category.resourceGroup === 'RAM' && sku.description.startsWith(`${prefix} Ram`);
    const price = skuPrice(sku);
    if (!Number.isFinite(price)) continue;
    if (isCore && (Number.isNaN(cpu) || price < cpu)) cpu = price;
    if (isRam && (Number.isNaN(ram) || price < ram)) ram = price;
  }
  if (Number.isNaN(cpu) || Number.isNaN(ram)) {
    throw new Error(`GCP ${series.toUpperCase()} on-demand CPU/RAM SKUs not found for region ${region}`);
  }
  return { cpu, ram };
}
