import type { EstimateOptions, PriceQuote, Provider, SizeSpec } from './types.js';
import { fetchAzureItems } from './azureCatalog.js';
import { assertRegion } from './oci.js';

export const azureProvider: Provider = {
  id: 'azure',
  name: 'Microsoft Azure',
  regions: [
    {
      id: 'uaenorth',
      name: 'UAE North',
      country: 'AE',
      note: 'Nearest priced region to KSA. Azure Saudi Arabia East has been announced but is not yet in the retail pricing API.',
    },
  ],
  async getHourlyPrice(region: string, size: SizeSpec, opts: EstimateOptions): Promise<PriceQuote> {
    assertRegion(azureProvider.regions, region, 'Azure');
    const specs = size.profile ? undefined : azureSpecsFromName(size.instance);
    const hourly = await fetchVmPrice(region, size.instance, opts.noCache);
    return {
      provider: 'azure',
      region,
      instance: size.instance,
      hourly,
      listedCurrency: 'USD',
      vcpu: specs?.vcpu ?? size.vcpu,
      gb: specs?.gb ?? size.gb,
      source: 'live',
      skuRef: `${size.instance} Consumption`,
    };
  },
};

async function fetchVmPrice(region: string, sku: string, noCache: boolean): Promise<number> {
  const filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${region}' and priceType eq 'Consumption' and armSkuName eq '${sku}'`;
  const items = await fetchAzureItems(filter, noCache);
  const candidates = items.filter(
    (i) =>
      i.unitOfMeasure === '1 Hour' &&
      !/Windows/i.test(i.productName) &&
      !/Spot|Low Priority/i.test(i.skuName),
  );
  if (candidates.length === 0) {
    throw new Error(`Azure ${sku} not found in ${region} consumption Linux pricing`);
  }
  const best = candidates.reduce((a, b) => (b.retailPrice < a.retailPrice ? b : a));
  return best.retailPrice;
}

/**
 * Parses vCPU/RAM out of an Azure VM SKU name (e.g. Standard_D4s_v5 → 4 vCPU /
 * 16 GB via the family ratio table). The retail pricing API does not return
 * machine specs, so family ratios are a documented assumption of this tool.
 * Returns undefined for unparseable names — the caller keeps its own specs.
 */
export function azureSpecsFromName(sku: string): { vcpu: number; gb: number } | undefined {
  const m = /^Standard_([A-Za-z]+?)(\d+)([a-z]0-9]*)?/.exec(sku);
  const vcpu = m ? Number(m[2]) : NaN;
  if (!m || !Number.isFinite(vcpu) || vcpu <= 0) return undefined;
  const gbPerVcpu = AZURE_FAMILY_GB_PER_VCPU[m[1]!.toUpperCase()];
  if (gbPerVcpu === undefined) return undefined;
  return { vcpu, gb: vcpu * gbPerVcpu };
}

/** GiB per vCPU by Azure VM family letter (a documented assumption for display specs). */
const AZURE_FAMILY_GB_PER_VCPU: Record<string, number> = {
  A: 1,
  B: 4,
  D: 4,
  E: 8,
  F: 2,
  L: 2,
};
