import type { Currency, PriceSource, ServiceEstimateOptions } from '../../core/types.js';
import { SKU_MAP } from '../../data/sizes.js';
import { awsProvider } from '../../providers/aws.js';
import { fetchAwsOfferRows, bestPrice } from '../../providers/awsCatalog.js';

/**
 * EKS control plane: real per-cluster hourly price from the AmazonEKS bulk-pricing
 * offer (usageType ...-AmazonEKS-Hours:perCluster). Nodes are priced as EC2.
 */
export async function awsK8sPrices(
  input: { region: string; nodeProfile: K8sNodeProfile },
  opts: ServiceEstimateOptions,
): Promise<{
  controlPlaneHourly: number;
  nodeHourly: number;
  listedCurrency: Currency;
  controlPlaneSource: PriceSource;
  controlPlaneSkuRef: string;
  warnings: string[];
}> {
  const size = SKU_MAP.aws[input.nodeProfile]!;
  const quote = await awsProvider.getHourlyPrice(input.region, size, opts);

  let controlPlaneHourly: number | null = null;
  try {
    const rows = await fetchAwsOfferRows('AmazonEKS', input.region, opts.noCache);
    controlPlaneHourly = bestPrice(
      rows,
      (r) =>
        r['TermType'] === 'OnDemand' &&
        /EKS-Hours:perCluster/i.test(r['usageType'] ?? '') &&
        /cluster/i.test(r['PriceDescription'] ?? r['usageType'] ?? ''),
    );
  } catch {
    controlPlaneHourly = null;
  }

  const warnings: string[] = [];
  let controlPlaneSource: PriceSource = 'live';
  if (controlPlaneHourly === null) {
    warnings.push('EKS control-plane price unavailable; line item omitted (no fallback price invented).');
    controlPlaneSource = 'assumption';
    controlPlaneHourly = 0;
  }

  return {
    controlPlaneHourly,
    nodeHourly: quote.hourly,
    listedCurrency: quote.listedCurrency,
    controlPlaneSource,
    controlPlaneSkuRef: 'AmazonEKS per-cluster hours (on-demand)',
    warnings,
  };
}

type K8sNodeProfile = 'small' | 'medium' | 'large' | 'xlarge';
