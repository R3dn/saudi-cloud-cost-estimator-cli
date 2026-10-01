import type { ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { providers } from '../../providers/index.js';
import { assertRegion } from '../../providers/oci.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { estimateAwsNetwork } from './aws.js';
import { estimateAzureNetwork } from './azure.js';
import { estimateGcpNetwork } from './gcp.js';
import { estimateOciNetwork } from './oci.js';

export async function networkEstimate(
  providerId: ProviderId,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  return estimators[providerId](input.region, input, opts);
}

const estimators: Record<ProviderId, (region: string, input: NetworkInput, opts: ServiceEstimateOptions) => Promise<NetworkEstimate>> = {
  aws: estimateAwsNetwork,
  azure: estimateAzureNetwork,
  gcp: estimateGcpNetwork,
  oci: estimateOciNetwork,
};

export interface NetworkEstimateArgs {
  providerId: ProviderId;
  regionId: string;
  input: NetworkInput;
  json?: boolean;
}

export async function runNetworkEstimate(
  opts: ServiceEstimateOptions,
  args: NetworkEstimateArgs,
): Promise<void> {
  const provider = providers[args.providerId]!;
  assertRegion(provider.regions, args.regionId, provider.name);

  const estimate = await estimators[args.providerId](args.regionId, args.input, opts);

  if (args.json) {
    console.log(JSON.stringify(estimate, null, 2));
    return;
  }

  const { renderServiceEstimate } = await import('../../ui/tables.js');
  renderServiceEstimate(estimate, [
    ['Egress', args.input.egressGb],
    ['Load Balancers', args.input.loadBalancers],
    ['NAT Gateway', args.input.nat ? 'Yes' : 'No'],
  ]);
}
