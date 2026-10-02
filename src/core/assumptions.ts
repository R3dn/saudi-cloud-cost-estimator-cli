/**
 * Published list rates used when a provider's pricing API does not expose the
 * meter. Every value here is surfaced to the user as source: 'assumption' with
 * the skuRef below — never presented as a live API price. Update alongside the
 * provider's public pricing page and note the verification in the PR.
 */
export interface AssumedRate {
  rate: number;
  skuRef: string;
}

export const ASSUMED_RATES: Record<
  'azureLoadBalancerHourlyUsd' | 'azureNatGatewayHourlyUsd' | 'ociNatGatewayHourlyUsd' | 'gcpFilestorePerGbMonthUsd' | 'gcpGkeManagementHourlyUsd' | 'gcpCloudSqlStoragePerGbMonthUsd',
  AssumedRate
> = {
  azureLoadBalancerHourlyUsd: { rate: 0.0065, skuRef: 'Standard Load Balancer published list $0.0065/hr' },
  azureNatGatewayHourlyUsd: { rate: 0.045, skuRef: 'NAT Gateway published list $0.045/hr' },
  ociNatGatewayHourlyUsd: { rate: 0.055, skuRef: 'NAT Gateway published list price $0.055/hr' },
  gcpFilestorePerGbMonthUsd: { rate: 0.3, skuRef: 'Filestore standard (assumed $0.30/GB-month)' },
  gcpGkeManagementHourlyUsd: { rate: 0.1, skuRef: 'GKE management fee (published list price $0.10/hr per cluster)' },
  gcpCloudSqlStoragePerGbMonthUsd: { rate: 0.17, skuRef: 'Cloud SQL storage (assumed $0.17/GB-month)' },
};
