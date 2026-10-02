import type { Provider, RegionInfo } from './types.js';

export function assertRegion(regions: RegionInfo[], region: string, providerName: string): void {
  if (!regions.some((r) => r.id === region)) {
    const ids = regions.map((r) => r.id).join(', ');
    throw new Error(`Unknown ${providerName} region "${region}". Supported: ${ids}`);
  }
}

export function firstRegionId(provider: Provider): string {
  return provider.regions[0]!.id;
}
