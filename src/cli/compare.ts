import pc from 'picocolors';
import type { EstimateOptions, ProviderId, SizeProfile, SizeSpec } from '../core/types.js';
import { providerList } from '../providers/index.js';
import { SIZE_PROFILES, SKU_MAP } from '../data/sizes.js';
import { PROFILE_SPECS } from '../data/sizes.js';
import { getSarPerUsd } from '../core/fx.js';
import { normalizeQuote } from '../core/pricing.js';
import { renderCompare, fmtMoney, type CompareRow } from '../ui/tables.js';

interface CompareResult {
  providerName: string;
  regionName: string;
  instance: string;
  hourly: number;
  monthly: number;
  monthlyVat: number;
  source: 'live' | 'fallback' | 'assumption';
  skuRef?: string;
  error?: string;
}

export async function runCompare(opts: EstimateOptions, profile: SizeProfile, json: boolean, regionId?: string): Promise<void> {
  const fx = await getSarPerUsd(opts.noCache);

  const results = await Promise.all(
    providerList.map(async (provider): Promise<CompareResult> => {
      const region = regionId && provider.regions.some((r) => r.id === regionId)
        ? provider.regions.find((r) => r.id === regionId)!
        : provider.regions[0]!;
      const size = SKU_MAP[provider.id]![profile]!;
      try {
        const quote = await provider.getHourlyPrice(region.id, size, opts);
        const result = normalizeQuote(
          {
            quote,
            providerName: provider.name,
            regionName: region.name,
            currency: opts.currency,
            hours: opts.hours,
            sarPerUsd: fx.sarPerUsd,
          },
          opts.vat,
        );
        return {
          providerName: provider.name,
          regionName: region.name,
          instance: result.instance,
          hourly: result.hourlyDisplay,
          monthly: result.monthly,
          monthlyVat: result.monthlyVat,
          source: result.source,
          skuRef: result.skuRef,
        };
      } catch (err) {
        return {
          providerName: provider.name,
          regionName: region.name,
          instance: size.instance,
          hourly: 0,
          monthly: 0,
          monthlyVat: 0,
          source: 'live',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  if (json) {
    console.log(
      JSON.stringify(
        {
          profile,
          currency: opts.currency,
          hours: opts.hours,
          vat: opts.vat,
          rows: results.map((r) => ({
            provider: providerList.find((p) => p.name === r.providerName)!.id,
            providerName: r.providerName,
            regionName: r.regionName,
            instance: r.instance,
            hourly: r.error ? null : r.hourly,
            monthly: r.error ? null : r.monthly,
            monthlyVat: r.error ? null : r.monthlyVat,
            source: r.error ? null : r.source,
            skuRef: r.error ? null : r.skuRef ?? null,
            error: r.error ?? null,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const spec = `profile "${profile}" — ${PROFILE_SPECS[profile]!.vcpu} vCPU / ${PROFILE_SPECS[profile]!.gb} GB, ${opts.hours} hrs/month`;
  console.log(`\n${pc.bold('Cloud cost comparison')} — ${pc.cyan(spec)}`);
  const rows: CompareRow[] = results.map((r) =>
    r.error
      ? {
          providerName: r.providerName,
          regionName: r.regionName,
          instance: r.instance,
          hourly: '-',
          monthly: '-',
          monthlyVat: '-',
          error: r.error,
        }
      : {
          providerName: r.providerName,
          regionName: r.regionName,
          instance: r.instance,
          hourly: fmtMoney(r.hourly, opts.currency),
          monthly: fmtMoney(r.monthly, opts.currency),
          monthlyVat: fmtMoney(r.monthlyVat, opts.currency),
        },
  );
  renderCompare(rows, opts.currency, opts.vat);
  const fxLine = fx.source === 'fallback' ? 'USD→SAR pegged at 3.75 (fallback)' : `USD→SAR @ ${fx.sarPerUsd.toFixed(4)} (${fx.source})`;
  console.log(pc.dim(`  ${fxLine}`));
  console.log(pc.dim('  Indicative on-demand Linux rates; disk, network and OS licenses not included.\n'));
}

export function parseProfile(value: string): SizeProfile {
  if (!SIZE_PROFILES.includes(value as SizeProfile)) {
    throw new Error(`Invalid size profile "${value}". Use one of: ${SIZE_PROFILES.join(', ')}`);
  }
  return value as SizeProfile;
}

export function sizeFor(providerId: ProviderId, profile: SizeProfile): SizeSpec {
  return SKU_MAP[providerId]![profile]!;
}

