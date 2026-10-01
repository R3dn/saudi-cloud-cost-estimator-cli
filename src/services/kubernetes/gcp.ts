import type { Currency, PriceSource, ServiceEstimateOptions } from '../../core/types.js';
import { SKU_MAP } from '../../data/sizes.js';
import { gcpProvider } from '../../providers/gcp.js';
import { fetchGcpSkus, requireGcpKey, skuPrice, GCP_COMPUTE_SERVICE } from '../../providers/gcpCatalog.js';

/**
 * GKE management fee: fetched live from the Billing Catalog (Kubernetes Engine
 * management fee SKU). Falls back to the published $0.10/hour per-cluster list fee
 * only when the API is unreachable, explicitly labeled as an assumption.
 */
export async function gcpK8sPrices(
  input: { region: string; nodeProfile: GcpNodeProfile },
  opts: ServiceEstimateOptions,
): Promise<{
  controlPlaneHourly: number;
  nodeHourly: number;
  listedCurrency: Currency;
  controlPlaneSource: PriceSource;
  controlPlaneSkuRef: string;
  warnings: string[];
}> {
  const size = SKU_MAP.gcp[input.nodeProfile]!;
  const quote = await gcpProvider.getHourlyPrice(input.region, size, opts);

  let controlPlaneHourly = 0.1;
  let controlPlaneSource: PriceSource = 'assumption';
  let controlPlaneSkuRef = 'GKE management fee (published list price $0.10/hr per cluster)';
  const warnings: string[] = [];

  try {
    const apiKey = requireGcpKey(opts);
    const skus = await fetchGcpSkus(apiKey, GCP_COMPUTE_SERVICE, input.region, opts.noCache);
    const mgmt = skus.find((s) => /Kubernetes Engine management fee/i.test(s.description));
    if (mgmt) {
      const p = skuPrice(mgmt);
      if (Number.isFinite(p) && p > 0) {
        controlPlaneHourly = p;
        controlPlaneSource = 'live';
        controlPlaneSkuRef = mgmt.description;
      }
    }
  } catch {
    warnings.push('GKE management fee API unavailable; using published list price $0.10/hr per cluster (assumption).');
  }

  return {
    controlPlaneHourly,
    nodeHourly: quote.hourly,
    listedCurrency: quote.listedCurrency,
    controlPlaneSource,
    controlPlaneSkuRef,
    warnings,
  };
}

type GcpNodeProfile = 'small' | 'medium' | 'large' | 'xlarge';
