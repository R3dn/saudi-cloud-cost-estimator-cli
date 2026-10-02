import type { Component, ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, componentConverter } from '../../core/normalization.js';
import { providers } from '../../providers/index.js';
import { assertRegion } from '../../core/regions.js';
import type { K8sEstimate, K8sInput } from './types.js';
import { awsK8sPrices } from './aws.js';
import { azureK8sPrices } from './azure.js';
import { gcpK8sPrices } from './gcp.js';
import { ociK8sPrices } from './oci.js';

type NodePriceInfo = {
  controlPlaneHourly: number;
  nodeHourly: number;
  listedCurrency: 'USD' | 'SAR';
  controlPlaneSource: 'live' | 'assumption' | 'fallback';
  controlPlaneSkuRef: string;
  warnings: string[];
};

const PROVIDER_FNS: Record<ProviderId, (input: { region: string; nodeProfile: K8sInput['nodeProfile'] }, opts: ServiceEstimateOptions) => Promise<NodePriceInfo>> = {
  aws: awsK8sPrices,
  azure: azureK8sPrices,
  gcp: gcpK8sPrices,
  oci: ociK8sPrices,
};

export async function k8sEstimate(
  providerId: ProviderId,
  input: K8sInput,
  opts: ServiceEstimateOptions,
): Promise<K8sEstimate> {
  const fn = PROVIDER_FNS[providerId];
  const provider = providers[providerId]!;
  assertRegion(provider.regions, input.region, provider.name);
  const region = provider.regions.find((r) => r.id === input.region);

  const fx = await getSarPerUsd(opts.noCache);
  const prices = await fn({ region: input.region, nodeProfile: input.nodeProfile }, opts);

  const controlPlaneMonthly = input.controlPlane ? prices.controlPlaneHourly * opts.hours : 0;
  const nodesMonthly = prices.nodeHourly * opts.hours * input.nodeCount;
  const monthlyUsd = controlPlaneMonthly + nodesMonthly;

  const norm = normalizeMonthly({
    monthly: monthlyUsd,
    listedCurrency: prices.listedCurrency,
    displayCurrency: opts.currency,
    fxRate: fx.sarPerUsd,
    withVat: opts.vat,
    country: region?.country,
  });

  const conv = componentConverter(prices.listedCurrency, opts.currency, fx.sarPerUsd);

  const controlPlaneComp: Component = {
    monthly: conv(controlPlaneMonthly),
    source: input.controlPlane ? prices.controlPlaneSource : 'assumption',
    skuRef: input.controlPlane ? prices.controlPlaneSkuRef : 'not requested',
  };
  const nodesComp: Component = { monthly: conv(nodesMonthly), source: 'live', skuRef: 'node instances (on-demand)' };

  return {
    provider: providerId,
    providerName: provider.name,
    region: input.region,
    regionName: region?.name ?? input.region,
    monthly: norm.monthly,
    monthlyVat: norm.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: norm.nativeSar,
    components: {
      controlPlane: controlPlaneComp,
      nodes: nodesComp,
    },
    warnings: prices.warnings,
  };
}
