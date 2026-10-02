import type { Provider, ProviderId } from '../core/types.js';
import { ociProvider } from './oci.js';
import { awsProvider } from './aws.js';
import { azureProvider } from './azure.js';
import { gcpProvider } from './gcp.js';

export const providers: Record<ProviderId, Provider> = {
  oci: ociProvider,
  aws: awsProvider,
  azure: azureProvider,
  gcp: gcpProvider,
};

export const providerList: Provider[] = [ociProvider, awsProvider, azureProvider, gcpProvider];
