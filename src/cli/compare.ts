import pc from 'picocolors';
import type { EstimateOptions, SizeProfile } from '../core/types.js';
import { providerList } from '../providers/index.js';
import { SIZE_PROFILES, SKU_MAP, PROFILE_SPECS } from '../data/sizes.js';
import { getSarPerUsd } from '../core/fx.js';
import { normalizeQuote } from '../core/pricing.js';
import { compareEnvelope, type CompareRowInput } from '../core/envelope.js';
import { renderCompare, fmtMoney, type CompareRow } from '../ui/tables.js';
import { renderCompareCsv } from '../ui/csv.js';

export async function runCompare(opts: EstimateOptions, profile: SizeProfile, format: 'table' | 'json' | 'csv' = 'table', regionId?: string): Promise<void> {
  const fx = await getSarPerUsd(opts.noCache);

  const rows: (CompareRowInput & { vcpu: number | null; gb: number | null; instance: string; source: 'live' | 'fallback' | 'assumption' | null; skuRef: string | null })[] = await Promise.all(
    providerList.map(async (provider) => {
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
          provider: provider.id,
          providerName: provider.name,
          region: region.id,
          regionName: region.name,
          monthly: result.monthly,
          monthlyVat: result.monthlyVat,
          currency: opts.currency,
          components: null,
          warnings: [],
          error: null,
          vcpu: result.vcpu,
          gb: result.gb,
          instance: result.instance,
          source: result.source,
          skuRef: result.skuRef ?? null,
        };
      } catch (err) {
        return {
          provider: provider.id,
          providerName: provider.name,
          region: region.id,
          regionName: region.name,
          monthly: null,
          monthlyVat: null,
          currency: opts.currency,
          components: null,
          warnings: [],
          error: err instanceof Error ? err.message : String(err),
          vcpu: null,
          gb: null,
          instance: size.instance,
          source: null,
          skuRef: null,
        };
      }
    }),
  );

  if (format === 'json') {
    const envelope = compareEnvelope({ profile }, opts, rows);
    // compute rows carry the quoted instance, specs and provenance on top of the standard envelope
    const out = {
      ...envelope,
      rows: envelope.rows.map((r, i) => ({
        ...r,
        instance: rows[i]!.instance,
        vcpu: rows[i]!.vcpu,
        gb: rows[i]!.gb,
        source: rows[i]!.source,
        skuRef: rows[i]!.skuRef,
        hourly: rows[i]!.error ? null : monthlyToHourly(rows[i]!.monthly, opts.hours),
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (format === 'csv') {
    renderCompareCsv(rows, opts);
    return;
  }

  const spec = `profile "${profile}" — ${PROFILE_SPECS[profile]!.vcpu} vCPU / ${PROFILE_SPECS[profile]!.gb} GB, ${opts.hours} hrs/month`;
  console.log(`\n${pc.bold('Cloud cost comparison')} — ${pc.cyan(spec)}`);
  const tableRows: CompareRow[] = rows.map((r) =>
    r.error
      ? {
          providerName: r.providerName,
          regionName: r.regionName,
          instance: r.instance,
          specs: r.vcpu !== null && r.gb !== null ? `${r.vcpu} vCPU / ${r.gb} GB` : '-',
          hourly: '-',
          monthly: '-',
          monthlyVat: '-',
          error: r.error,
        }
      : {
          providerName: r.providerName,
          regionName: r.regionName,
          instance: r.instance,
          specs: r.vcpu !== null && r.gb !== null ? `${r.vcpu} vCPU / ${r.gb} GB` : '-',
          hourly: fmtMoney(monthlyToHourly(r.monthly, opts.hours), opts.currency),
          monthly: fmtMoney(r.monthly ?? 0, opts.currency),
          monthlyVat: fmtMoney(r.monthlyVat ?? 0, opts.currency),
        },
  );
  renderCompare(tableRows, opts.currency, opts.vat);
  const fxLine = fx.source === 'fallback' ? 'USD→SAR pegged at 3.75 (fallback)' : `USD→SAR @ ${fx.sarPerUsd.toFixed(4)} (${fx.source})`;
  console.log(pc.dim(`  ${fxLine}`));
  console.log(pc.dim('  Indicative on-demand Linux rates; disk, network and OS licenses not included.\n'));
}

function monthlyToHourly(monthly: number | null, hours: number): number {
  return monthly === null || hours <= 0 ? 0 : monthly / hours;
}

export function parseProfile(value: string): SizeProfile {
  if (!SIZE_PROFILES.includes(value as SizeProfile)) {
    throw new Error(`Invalid size profile "${value}". Use one of: ${SIZE_PROFILES.join(', ')}`);
  }
  return value as SizeProfile;
}
