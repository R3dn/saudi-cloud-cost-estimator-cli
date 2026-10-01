import type { EstimateOptions, PriceQuote, Provider, SizeSpec } from './types.js';
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
    const { cpu, ram } = await fetchDammamPrices(apiKey, region, opts.noCache);
    const hourly = size.vcpu * cpu + size.gb * ram;
    return {
      provider: 'gcp',
      region,
      instance: `${size.instance} (${size.vcpu} vCPU / ${size.gb} GB)`,
      hourly,
      listedCurrency: 'USD',
      vcpu: size.vcpu,
      gb: size.gb,
      source: 'live',
      skuRef: 'N2 Instance Core + N2 Instance Ram (me-central2)',
    };
  },
};

async function fetchDammamPrices(apiKey: string, region: string, noCache: boolean): Promise<{ cpu: number; ram: number }> {
  const skus = await fetchGcpSkus(apiKey, '6F81-5844-456A', region, noCache);
  let cpu = NaN;
  let ram = NaN;
  for (const sku of skus) {
    const isN2Core = sku.category.resourceGroup === 'CPU' && /^N2 Instance Core/i.test(sku.description);
    const isN2Ram = sku.category.resourceGroup === 'RAM' && /^N2 Instance Ram/i.test(sku.description);
    const price = skuPrice(sku);
    if (!Number.isFinite(price)) continue;
    if (isN2Core && (Number.isNaN(cpu) || price < cpu)) cpu = price;
    if (isN2Ram && (Number.isNaN(ram) || price < ram)) ram = price;
  }
  if (Number.isNaN(cpu) || Number.isNaN(ram)) {
    throw new Error(`GCP N2 on-demand CPU/RAM SKUs not found for region ${region}`);
  }
  return { cpu, ram };
}
