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
    const hourly = await fetchVmPrice(region, size.instance, opts.noCache);
    return {
      provider: 'azure',
      region,
      instance: size.instance,
      hourly,
      listedCurrency: 'USD',
      vcpu: size.vcpu,
      gb: size.gb,
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
