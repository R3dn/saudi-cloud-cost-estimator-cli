import type { Currency, PriceSource, ServiceEstimateOptions, SizeProfile } from '../../core/types.js';
import { SKU_MAP } from '../../data/sizes.js';
import { ociProvider } from '../../providers/oci.js';
import {
  fetchOciPriceList,
  ociCurrency,
  ociPartProduct,
  OCI_PARTS,
  paygRate,
} from '../../providers/ociCatalog.js';

/**
 * OKE control plane: "Enhanced Cluster" is the only paid cluster type (Basic clusters
 * are free). Price fetched live from the OCI price list; Basic (free) mode is a
 * documented assumption surfaced to the user.
 */
export async function ociK8sPrices(
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
  const size = SKU_MAP.oci[input.nodeProfile]!;
  const compute = await ociProvider.getHourlyPrice(input.region, size, opts);

  const currency = ociCurrency(opts.currency);
  const products = await fetchOciPriceList(opts.noCache);
  const enhancedCluster = ociPartProduct(products, OCI_PARTS.okeEnhancedCluster);
  const clusterHourly = paygRate(enhancedCluster, currency);

  return {
    controlPlaneHourly: clusterHourly,
    nodeHourly: compute.hourly,
    listedCurrency: compute.listedCurrency,
    controlPlaneSource: 'live',
    controlPlaneSkuRef: `${OCI_PARTS.okeEnhancedCluster} (OKE Enhanced Cluster)`,
    warnings: [
      'OKE control plane priced as Enhanced Cluster; OKE Basic clusters are free (choose 0 control-plane cost if on Basic).',
    ],
  };
}
