import type { Currency, PriceSource, ServiceEstimateOptions } from '../../core/types.js';
import { SKU_MAP } from '../../data/sizes.js';
import { azureProvider } from '../../providers/azure.js';

/**
 * AKS: the managed control plane (free tier) has no hourly charge; only the load
 * balancer it provisions is billed (surfaced via the network command). This is a
 * documented fact of the AKS free tier, labeled as such rather than a priced line.
 */
export async function azureK8sPrices(
  input: { region: string; nodeProfile: AzureNodeProfile },
  opts: ServiceEstimateOptions,
): Promise<{
  controlPlaneHourly: number;
  nodeHourly: number;
  listedCurrency: Currency;
  controlPlaneSource: PriceSource;
  controlPlaneSkuRef: string;
  warnings: string[];
}> {
  const size = SKU_MAP.azure[input.nodeProfile]!;
  const quote = await azureProvider.getHourlyPrice(input.region, size, opts);
  return {
    controlPlaneHourly: 0,
    nodeHourly: quote.hourly,
    listedCurrency: quote.listedCurrency,
    controlPlaneSource: 'assumption',
    controlPlaneSkuRef: 'AKS free-tier control plane (no hourly charge; LB billed separately)',
    warnings: ['AKS free-tier control plane has no hourly charge; the load balancer it creates is billed via the network command.'],
  };
}

type AzureNodeProfile = 'small' | 'medium' | 'large' | 'xlarge';
