import type { EstimateOptions, PriceQuote, Provider, RegionInfo, SizeSpec } from './types.js';
import {
  fetchOciPriceList,
  ociCurrency,
  ociPartProduct,
  OCI_PARTS,
  paygRate,
} from './ociCatalog.js';

export const ociProvider: Provider = {
  id: 'oci',
  name: 'Oracle Cloud Infrastructure',
  regions: [
    { id: 'me-riyadh-1', name: 'Saudi Arabia Central (Riyadh)', country: 'SA' },
    { id: 'me-jeddah-1', name: 'Saudi Arabia West (Jeddah)', country: 'SA' },
  ],
  async getHourlyPrice(region: string, size: SizeSpec, opts: EstimateOptions): Promise<PriceQuote> {
    assertRegion(ociProvider.regions, region, 'OCI');
    const products = await fetchOciPriceList(opts.noCache);
    const ocpuPart = ociPartProduct(products, OCI_PARTS.computeOcpu);
    const memPart = ociPartProduct(products, OCI_PARTS.computeMemory);
    const ocpus = size.ocpus ?? size.vcpu;
    const currency = ociCurrency(opts.currency);
    const ocpuRate = paygRate(ocpuPart, currency);
    const memRate = paygRate(memPart, currency);
    const hourly = ocpus * ocpuRate + size.gb * memRate;
    return {
      provider: 'oci',
      region,
      instance: `VM.Standard.E4.Flex (${ocpus} OCPU / ${size.gb} GB)`,
      hourly,
      listedCurrency: currency,
      vcpu: size.vcpu,
      gb: size.gb,
      source: 'live',
      skuRef: `${OCI_PARTS.computeOcpu}+${OCI_PARTS.computeMemory}`,
    };
  },
};

export function assertRegion(regions: RegionInfo[], region: string, providerName: string): void {
  if (!regions.some((r) => r.id === region)) {
    const ids = regions.map((r) => r.id).join(', ');
    throw new Error(`Unknown ${providerName} region "${region}". Supported: ${ids}`);
  }
}

export function firstRegionId(provider: Provider): string {
  return provider.regions[0]!.id;
}
