import Table from 'cli-table3';
import pc from 'picocolors';
import type { Currency, EstimateResult, PriceSource, RegionInfo } from '../core/types.js';
import type { ServiceEstimateOptions } from '../core/types.js';

export function fmtMoney(amount: number, currency: Currency): string {
  if (!Number.isFinite(amount)) return '-';
  const rounded = amount >= 100 ? amount.toFixed(0) : amount.toFixed(2);
  return `${currency === 'SAR' ? 'SAR ' : '$'}${rounded}`;
}

export function renderEstimate(result: EstimateResult): void {
  const vatNote =
    result.monthlyVat !== result.monthly
      ? pc.dim(' (incl. 15% Saudi VAT — assumed, see notes)')
      : pc.dim(' (excl. VAT)');
  console.log('');
  console.log(`  ${pc.bold(result.providerName)} — ${result.regionName}`);
  const specs =
    result.vcpu > 0 && result.gb > 0 ? `  (${result.vcpu} vCPU / ${result.gb} GB)` : '  (specs unavailable for this SKU)';
  console.log(`  Instance: ${result.instance}${specs}`);
  console.log(`  Hourly:   ${fmtMoney(result.hourlyDisplay, result.currency)}`);
  console.log(`  Monthly:  ${pc.bold(fmtMoney(result.monthlyVat, result.currency))}${vatNote}`);
  if (!result.nativeSar) {
    const src =
      result.currency === 'SAR'
        ? `USD→SAR @ ${result.fxRate.toFixed(4)}`
        : `listed in USD (SAR peg: ${result.fxRate.toFixed(4)})`;
    console.log(pc.dim(`  FX: ${src}`));
  } else {
    console.log(pc.dim('  FX: native SAR pricing from provider'));
  }
  const altCurrency = result.currency === 'SAR' ? 'USD' : 'SAR';
  const altSymbol = altCurrency === 'SAR' ? 'SAR' : '$';
  console.log(pc.dim(`  Equiv: ${altSymbol} ${result.altHourly.toFixed(4)} / hr`));
  if (result.skuRef) console.log(pc.dim(`  Price source: ${result.source} (${result.skuRef})`));
  console.log('');
}

export interface CompareRow {
  providerName: string;
  regionName: string;
  instance: string;
  specs: string;
  hourly: string;
  monthly: string;
  monthlyVat: string;
  error?: string;
}

export function renderCompare(rows: CompareRow[], currency: Currency, withVat: boolean): void {
  const vatHeader = withVat ? 'Monthly (incl. 15% VAT*)' : 'Monthly (excl. VAT)';
  const table = new Table({
    head: [
      pc.bold('Provider'),
      pc.bold('Region'),
      pc.bold('Instance'),
      pc.bold('Specs'),
      pc.bold('Hourly'),
      pc.bold(vatHeader),
    ],
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    if (row.error) {
      table.push([
        row.providerName,
        row.regionName,
        pc.dim(row.instance),
        pc.dim(row.specs),
        pc.dim('-'),
        pc.yellow(row.error),
      ]);
    } else {
      table.push([
        row.providerName,
        row.regionName,
        row.instance,
        pc.dim(row.specs),
        row.hourly,
        pc.bold(row.monthlyVat),
      ]);
    }
  }
  console.log(table.toString());
  if (withVat) {
    console.log(pc.dim('  *15% Saudi VAT applied by default, including to Bahrain/UAE consumption — verify your VAT registration treatment.'));
  }
}

export function renderRegions(providerName: string, regions: RegionInfo[]): void {
  const table = new Table({
    head: [pc.bold('Region ID'), pc.bold('Name'), pc.bold('Country'), pc.bold('Note')],
    style: { head: [], border: [] },
  });
  for (const r of regions) {
    const country = r.country === 'SA' ? pc.green('Saudi Arabia') : r.country === 'BH' ? 'Bahrain' : 'UAE';
    table.push([r.id, r.name, country, r.note ? pc.dim(r.note) : '']);
  }
  console.log(`\n${pc.bold(providerName)}`);
  console.log(table.toString());
}

export interface EstimateListRow {
  providerName: string;
  regionName: string;
  monthly: number;
  monthlyVat: number;
  currency: Currency;
  warnings: string[];
  error?: string;
}

/** Shared renderer for per-service compare output (storage/db/k8s/network). */
export function renderEstimateList(rows: EstimateListRow[], opts: ServiceEstimateOptions): void {
  const table = new Table({
    head: [pc.bold('Provider'), pc.bold('Region'), pc.bold(`Monthly (${opts.vat ? 'incl. 15% VAT*' : 'excl. VAT'})`)],
    style: { head: [], border: [] },
  });
  for (const r of rows) {
    if (r.error) {
      table.push([r.providerName, r.regionName, pc.yellow(r.error)]);
    } else {
      table.push([r.providerName, r.regionName, pc.bold(fmtMoney(r.monthlyVat, r.currency))]);
    }
  }
  console.log(table.toString());
  const hasWarnings = rows.some((r) => r.warnings.length > 0);
  if (hasWarnings) {
    for (const r of rows) {
      for (const w of r.warnings) console.log(pc.yellow(`  ${r.providerName}: ${w}`));
    }
  }
  if (opts.vat) {
    console.log(pc.dim('  *15% Saudi VAT applied by default, including to Bahrain/UAE consumption — verify your VAT registration treatment.'));
  }
  console.log('');
}

/** Shared renderer for a single service estimate with component breakdown. */
export function renderServiceEstimate(
  estimate: { providerName: string; regionName: string; monthlyVat: number; currency: Currency; components: Record<string, { monthly: number; source: PriceSource; skuRef?: string }>; warnings: string[] },
  inputLines: [string, string | number][],
): void {
  const vatNote = estimate.monthlyVat > 0 ? pc.dim(' (incl. 15% VAT — assumed where applicable)') : '';
  console.log('');
  console.log(`  ${pc.bold(estimate.providerName)} — ${estimate.regionName}`);
  for (const [label, value] of inputLines) console.log(`  ${label}: ${value}`);
  console.log(`  Monthly: ${pc.bold(fmtMoney(estimate.monthlyVat, estimate.currency))}${vatNote}`);
  for (const [name, comp] of Object.entries(estimate.components)) {
    const tag = comp.source === 'live' ? pc.dim(`[live: ${comp.skuRef ?? 'official API'}]`) : pc.yellow(`[${comp.source}${comp.skuRef ? `: ${comp.skuRef}` : ''}]`);
    console.log(`    - ${name}: ${fmtMoney(comp.monthly, estimate.currency)} ${tag}`);
  }
  for (const w of estimate.warnings) console.log(pc.yellow(`  Note: ${w}`));
  console.log('');
}
