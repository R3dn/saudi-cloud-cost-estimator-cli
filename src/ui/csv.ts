import type { CompareRowInput } from '../core/envelope.js';

/**
 * RFC 4180 CSV for compare output: one row per provider. Errors are quoted,
 * never fatal. Meant for spreadsheets and CI artifacts.
 */
export function renderCompareCsv(rows: CompareRowInput[], opts: { currency: CompareRowInput['currency']; vat: boolean }): void {
  const header = ['provider', 'region', 'monthly', 'monthlyVat', 'currency', 'vat', 'error'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        esc(r.provider),
        esc(r.region),
        r.monthly === null ? '' : r.monthly.toFixed(2),
        r.monthlyVat === null ? '' : r.monthlyVat.toFixed(2),
        r.currency ?? opts.currency,
        opts.vat ? 'true' : 'false',
        esc(r.error ?? ''),
      ].join(','),
    );
  }
  console.log(lines.join('\n'));
}
