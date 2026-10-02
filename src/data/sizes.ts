import type { ProviderId, SizeProfile, SizeSpec } from '../core/types.js';
import { SIZE_PROFILES } from '../core/types.js';

export { SIZE_PROFILES };

export const PROFILE_SPECS: Record<SizeProfile, { vcpu: number; gb: number }> = {
  small: { vcpu: 2, gb: 8 },
  medium: { vcpu: 4, gb: 16 },
  large: { vcpu: 8, gb: 32 },
  xlarge: { vcpu: 16, gb: 64 },
  '2xlarge': { vcpu: 32, gb: 128 },
  '3xlarge': { vcpu: 64, gb: 256 },
  'mem-medium': { vcpu: 4, gb: 32 },
  'mem-large': { vcpu: 8, gb: 64 },
  'mem-xlarge': { vcpu: 16, gb: 128 },
  'mem-2xlarge': { vcpu: 32, gb: 256 },
  'cpu-medium': { vcpu: 4, gb: 8 },
  'cpu-large': { vcpu: 8, gb: 16 },
  'cpu-xlarge': { vcpu: 16, gb: 32 },
  'cpu-2xlarge': { vcpu: 32, gb: 64 },
  'gpu-medium': { vcpu: 4, gb: 16 },
  'gpu-large': { vcpu: 48, gb: 192 },
};

/**
 * Curated mapping of size profiles to concrete SKUs per provider (a documented
 * assumption of this tool, not a provider fact). OCI shapes are flexible
 * (OCPU + GB priced separately), others are fixed SKUs. GPU profiles pick the
 * smallest inference / dedicated GPU offering actually listed in each region:
 * AWS me-south-1 only lists g4dn (T4); Azure uaenorth lists RTX PRO 6000 v6
 * and H100 v5; OCI prices GPUs per-GPU-hour via part B95909 (A10).
 */
export const SKU_MAP: Record<ProviderId, Record<SizeProfile, SizeSpec>> = {
  oci: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'VM.Standard.E4.Flex', ocpus: 2 },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'VM.Standard.E4.Flex', ocpus: 4 },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'VM.Standard.E4.Flex', ocpus: 8 },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'VM.Standard.E4.Flex', ocpus: 16 },
    '2xlarge': { profile: '2xlarge', vcpu: 32, gb: 128, instance: 'VM.Standard.E4.Flex', ocpus: 32 },
    '3xlarge': { profile: '3xlarge', vcpu: 64, gb: 256, instance: 'VM.Standard.E4.Flex', ocpus: 64 },
    'mem-medium': { profile: 'mem-medium', vcpu: 4, gb: 32, instance: 'VM.Standard.E4.Flex', ocpus: 4 },
    'mem-large': { profile: 'mem-large', vcpu: 8, gb: 64, instance: 'VM.Standard.E4.Flex', ocpus: 8 },
    'mem-xlarge': { profile: 'mem-xlarge', vcpu: 16, gb: 128, instance: 'VM.Standard.E4.Flex', ocpus: 16 },
    'mem-2xlarge': { profile: 'mem-2xlarge', vcpu: 32, gb: 256, instance: 'VM.Standard.E4.Flex', ocpus: 32 },
    'cpu-medium': { profile: 'cpu-medium', vcpu: 4, gb: 8, instance: 'VM.Standard.E4.Flex', ocpus: 4 },
    'cpu-large': { profile: 'cpu-large', vcpu: 8, gb: 16, instance: 'VM.Standard.E4.Flex', ocpus: 8 },
    'cpu-xlarge': { profile: 'cpu-xlarge', vcpu: 16, gb: 32, instance: 'VM.Standard.E4.Flex', ocpus: 16 },
    'cpu-2xlarge': { profile: 'cpu-2xlarge', vcpu: 32, gb: 64, instance: 'VM.Standard.E4.Flex', ocpus: 32 },
    'gpu-medium': {
      profile: 'gpu-medium',
      vcpu: 4,
      gb: 24,
      instance: 'VM.GPU.A10.1',
      ocpus: 4,
      gpu: { model: 'A10', count: 1 },
    },
    'gpu-large': {
      profile: 'gpu-large',
      vcpu: 48,
      gb: 192,
      instance: 'VM.GPU.A10.4',
      ocpus: 48,
      gpu: { model: 'A10', count: 4 },
    },
  },
  aws: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'm6i.large' },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'm6i.xlarge' },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'm6i.2xlarge' },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'm6i.4xlarge' },
    '2xlarge': { profile: '2xlarge', vcpu: 32, gb: 128, instance: 'm6i.8xlarge' },
    '3xlarge': { profile: '3xlarge', vcpu: 64, gb: 256, instance: 'm6i.16xlarge' },
    'mem-medium': { profile: 'mem-medium', vcpu: 4, gb: 32, instance: 'r6i.xlarge' },
    'mem-large': { profile: 'mem-large', vcpu: 8, gb: 64, instance: 'r6i.2xlarge' },
    'mem-xlarge': { profile: 'mem-xlarge', vcpu: 16, gb: 128, instance: 'r6i.4xlarge' },
    'mem-2xlarge': { profile: 'mem-2xlarge', vcpu: 32, gb: 256, instance: 'r6i.8xlarge' },
    'cpu-medium': { profile: 'cpu-medium', vcpu: 4, gb: 8, instance: 'c6i.xlarge' },
    'cpu-large': { profile: 'cpu-large', vcpu: 8, gb: 16, instance: 'c6i.2xlarge' },
    'cpu-xlarge': { profile: 'cpu-xlarge', vcpu: 16, gb: 32, instance: 'c6i.4xlarge' },
    'cpu-2xlarge': { profile: 'cpu-2xlarge', vcpu: 32, gb: 64, instance: 'c6i.8xlarge' },
    'gpu-medium': {
      profile: 'gpu-medium',
      vcpu: 4,
      gb: 16,
      instance: 'g4dn.xlarge',
      gpu: { model: 'T4', count: 1 },
    },
    'gpu-large': {
      profile: 'gpu-large',
      vcpu: 48,
      gb: 192,
      instance: 'g4dn.12xlarge',
      gpu: { model: 'T4', count: 4 },
    },
  },
  azure: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'Standard_D2s_v5' },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'Standard_D4s_v5' },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'Standard_D8s_v5' },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'Standard_D16s_v5' },
    '2xlarge': { profile: '2xlarge', vcpu: 32, gb: 128, instance: 'Standard_D32s_v5' },
    '3xlarge': { profile: '3xlarge', vcpu: 64, gb: 256, instance: 'Standard_D64s_v5' },
    'mem-medium': { profile: 'mem-medium', vcpu: 4, gb: 32, instance: 'Standard_E4s_v5' },
    'mem-large': { profile: 'mem-large', vcpu: 8, gb: 64, instance: 'Standard_E8s_v5' },
    'mem-xlarge': { profile: 'mem-xlarge', vcpu: 16, gb: 128, instance: 'Standard_E16s_v5' },
    'mem-2xlarge': { profile: 'mem-2xlarge', vcpu: 32, gb: 256, instance: 'Standard_E32s_v5' },
    'cpu-medium': { profile: 'cpu-medium', vcpu: 4, gb: 8, instance: 'Standard_F4s_v2' },
    'cpu-large': { profile: 'cpu-large', vcpu: 8, gb: 16, instance: 'Standard_F8s_v2' },
    'cpu-xlarge': { profile: 'cpu-xlarge', vcpu: 16, gb: 32, instance: 'Standard_F16s_v2' },
    'cpu-2xlarge': { profile: 'cpu-2xlarge', vcpu: 32, gb: 64, instance: 'Standard_F32s_v2' },
    'gpu-medium': {
      profile: 'gpu-medium',
      vcpu: 24,
      gb: 220,
      instance: 'Standard_NC24lds_xl_RTXPRO6000BSE_v6',
      gpu: { model: 'RTX PRO 6000 Blackwell', count: 1 },
    },
    'gpu-large': {
      profile: 'gpu-large',
      vcpu: 144,
      gb: 1408,
      instance: 'Standard_NC144lds_xl_RTXPRO6000BSE_v6',
      gpu: { model: 'RTX PRO 6000 Blackwell', count: 4 },
    },
  },
  gcp: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'n2-standard-2' },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'n2-standard-4' },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'n2-standard-8' },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'n2-standard-16' },
    '2xlarge': { profile: '2xlarge', vcpu: 32, gb: 128, instance: 'n2-standard-32' },
    '3xlarge': { profile: '3xlarge', vcpu: 64, gb: 256, instance: 'n2-standard-64' },
    'mem-medium': { profile: 'mem-medium', vcpu: 4, gb: 32, instance: 'n2-highmem-4' },
    'mem-large': { profile: 'mem-large', vcpu: 8, gb: 64, instance: 'n2-highmem-8' },
    'mem-xlarge': { profile: 'mem-xlarge', vcpu: 16, gb: 128, instance: 'n2-highmem-16' },
    'mem-2xlarge': { profile: 'mem-2xlarge', vcpu: 32, gb: 256, instance: 'n2-highmem-32' },
    'cpu-medium': { profile: 'cpu-medium', vcpu: 4, gb: 8, instance: 'n2-highcpu-4' },
    'cpu-large': { profile: 'cpu-large', vcpu: 8, gb: 16, instance: 'n2-highcpu-8' },
    'cpu-xlarge': { profile: 'cpu-xlarge', vcpu: 16, gb: 32, instance: 'n2-highcpu-16' },
    'cpu-2xlarge': { profile: 'cpu-2xlarge', vcpu: 32, gb: 64, instance: 'n2-highcpu-32' },
    'gpu-medium': {
      profile: 'gpu-medium',
      vcpu: 4,
      gb: 16,
      instance: 'n2-standard-4',
      gpu: { model: 'T4', count: 1 },
    },
    'gpu-large': {
      profile: 'gpu-large',
      vcpu: 48,
      gb: 192,
      instance: 'n2-standard-48',
      gpu: { model: 'T4', count: 4 },
    },
  },
};

export const DEFAULT_HOURS = 730;
export const HOURS_PER_MONTH = DEFAULT_HOURS;

export interface CustomSizeInput {
  providerId: ProviderId;
  profile?: SizeProfile;
  instance?: string;
  ocpus?: number;
  memory?: number;
}

/**
 * Builds the SizeSpec for a compute estimate from CLI flags. --instance prices
 * an arbitrary provider SKU (AWS/Azure/GCP); --ocpus/--memory size an OCI flex
 * shape. OCI has no fixed-SKU --instance because its shapes are flexible.
 */
export function resolveSize(input: CustomSizeInput): SizeSpec {
  const { providerId, profile, instance, ocpus, memory } = input;
  if (instance && (ocpus !== undefined || memory !== undefined)) {
    throw new Error('--instance cannot be combined with --ocpus/--memory');
  }
  if (instance && profile) {
    throw new Error('--instance cannot be combined with --size');
  }
  if (instance) {
    if (providerId === 'oci') {
      throw new Error('OCI shapes are flexible — use --ocpus/--memory (or a size profile) instead of --instance');
    }
    return { vcpu: 0, gb: 0, instance };
  }
  const ociCustom = ocpus !== undefined || memory !== undefined;
  if (ociCustom) {
    if (providerId !== 'oci') {
      throw new Error('--ocpus/--memory only apply to OCI flexible shapes');
    }
    if (profile) {
      throw new Error('--ocpus/--memory cannot be combined with --size');
    }
    return {
      vcpu: ocpus ?? 1,
      gb: memory ?? 0,
      instance: 'VM.Standard.E4.Flex',
      ocpus: ocpus ?? 1,
    };
  }
  return SKU_MAP[providerId]![profile ?? 'medium']!;
}
