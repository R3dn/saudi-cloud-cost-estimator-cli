import { describe, expect, it } from 'vitest';
import { PROFILE_SPECS, SKU_MAP, SIZE_PROFILES, resolveSize } from '../src/data/sizes.js';
import { SIZE_PROFILES as CORE_SIZE_PROFILES } from '../src/core/types.js';

describe('size profiles', () => {
  it('keeps data/sizes.ts and core/types.ts profile lists in sync', () => {
    expect([...SIZE_PROFILES]).toEqual([...CORE_SIZE_PROFILES]);
  });

  it('maps every profile for every provider', () => {
    for (const p of SIZE_PROFILES) {
      expect(PROFILE_SPECS[p]).toBeDefined();
      for (const provider of ['oci', 'aws', 'azure', 'gcp'] as const) {
        expect(SKU_MAP[provider][p]).toBeDefined();
        expect(SKU_MAP[provider][p]!.instance).toBeTruthy();
      }
    }
  });

  it('keeps general profiles aligned across providers (same vcpu/gb)', () => {
    for (const p of ['small', 'medium', 'large', 'xlarge', '2xlarge', '3xlarge'] as const) {
      for (const provider of ['oci', 'aws', 'azure', 'gcp'] as const) {
        expect(SKU_MAP[provider][p]!.vcpu).toBe(PROFILE_SPECS[p]!.vcpu);
        expect(SKU_MAP[provider][p]!.gb).toBe(PROFILE_SPECS[p]!.gb);
      }
    }
  });
});

describe('resolveSize', () => {
  it('defaults to medium profile', () => {
    const s = resolveSize({ providerId: 'aws' });
    expect(s.profile).toBe('medium');
    expect(s.instance).toBe('m6i.xlarge');
  });

  it('prices an arbitrary AWS sku via --instance', () => {
    const s = resolveSize({ providerId: 'aws', instance: 'g6e.2xlarge' });
    expect(s.instance).toBe('g6e.2xlarge');
    expect(s.profile).toBeUndefined();
  });

  it('sizes an OCI flex shape from --ocpus/--memory', () => {
    const s = resolveSize({ providerId: 'oci', ocpus: 6, memory: 48 });
    expect(s.instance).toBe('VM.Standard.E4.Flex');
    expect(s.ocpus).toBe(6);
    expect(s.gb).toBe(48);
  });

  it('rejects --instance for OCI (flex shapes)', () => {
    expect(() => resolveSize({ providerId: 'oci', instance: 'x' })).toThrow(/--ocpus\/--memory/);
  });

  it('rejects --instance combined with --size', () => {
    expect(() => resolveSize({ providerId: 'aws', profile: 'medium', instance: 'x' })).toThrow(/cannot be combined/);
  });

  it('rejects --ocpus/--memory outside OCI', () => {
    expect(() => resolveSize({ providerId: 'aws', ocpus: 4 })).toThrow(/only apply to OCI/);
  });

  it('rejects --ocpus/--memory combined with --size', () => {
    expect(() => resolveSize({ providerId: 'oci', profile: 'medium', ocpus: 4 })).toThrow(/cannot be combined/);
  });

  it('rejects --instance combined with --ocpus', () => {
    expect(() => resolveSize({ providerId: 'aws', instance: 'x', ocpus: 4 })).toThrow(/cannot be combined/);
  });
});
