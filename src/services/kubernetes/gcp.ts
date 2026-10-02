import type { Currency, PriceSource, ServiceEstimateOptions, SizeProfile } from '../../core/types.js';
import { ASSUMED_RATES } from '../../core/assumptions.js';
import { SKU_MAP } from '../../data/sizes.js';
import { gcpProvider } from '../../providers/gcp.js';
import { fetchGcpSkus, requireGcpKey, skuPrice, GCP_COMPUTE_SERVICE } from '../../providers/gcpCatalog.js';

/**
 * GKE management fee: fetched live from the Billing Catalog (Kubernetes Engine
 * management fee SKU). Falls back to the published list fee only when the API is
 * unreachable, explicitly labeled as an assumption.
 */
export async function gcpK8sPrices(
  input: { region: string; nodeProfile: SizeProfile },
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

  let controlPlaneHourly = ASSUMED_RATES.gcpGkeManagementHourlyUsd.rate;
  let controlPlaneSource: PriceSource = 'assumption';
  let controlPlaneSkuRef = ASSUMED_RATES.gcpGkeManagementHourlyUsd.skuRef;
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
    warnings.push(`GKE management fee API unavailable; using ${ASSUMED_RATES.gcpGkeManagementHourlyUsd.skuRef} (assumption).`);
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
