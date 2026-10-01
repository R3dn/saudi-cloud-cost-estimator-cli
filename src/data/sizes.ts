import type { ProviderId, SizeProfile, SizeSpec } from '../core/types.js';

export const SIZE_PROFILES: SizeProfile[] = ['small', 'medium', 'large', 'xlarge'];

export const PROFILE_SPECS: Record<SizeProfile, { vcpu: number; gb: number }> = {
  small: { vcpu: 2, gb: 8 },
  medium: { vcpu: 4, gb: 16 },
  large: { vcpu: 8, gb: 32 },
  xlarge: { vcpu: 16, gb: 64 },
};

/**
 * Curated mapping of size profiles to concrete SKUs per provider (a documented
 * assumption of this tool, not a provider fact). OCI shapes are flexible
 * (OCPU + GB priced separately), others are fixed SKUs.
 */
export const SKU_MAP: Record<ProviderId, Record<SizeProfile, SizeSpec>> = {
  oci: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'VM.Standard.E4.Flex', ocpus: 2 },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'VM.Standard.E4.Flex', ocpus: 4 },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'VM.Standard.E4.Flex', ocpus: 8 },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'VM.Standard.E4.Flex', ocpus: 16 },
  },
  aws: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'm6i.large' },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'm6i.xlarge' },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'm6i.2xlarge' },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'm6i.4xlarge' },
  },
  azure: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'Standard_D2s_v5' },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'Standard_D4s_v5' },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'Standard_D8s_v5' },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'Standard_D16s_v5' },
  },
  gcp: {
    small: { profile: 'small', vcpu: 2, gb: 8, instance: 'n2-standard-2' },
    medium: { profile: 'medium', vcpu: 4, gb: 16, instance: 'n2-standard-4' },
    large: { profile: 'large', vcpu: 8, gb: 32, instance: 'n2-standard-8' },
    xlarge: { profile: 'xlarge', vcpu: 16, gb: 64, instance: 'n2-standard-16' },
  },
};

export const DEFAULT_HOURS = 730;
export const HOURS_PER_MONTH = DEFAULT_HOURS;
