import type { PriceTier } from './types.js';

/**
 * Cost of `quantity` under marginal tiered rates: each tier's rate applies only
 * to the quantity that falls inside its [rangeMin, rangeMax) window — never
 * retroactively to the whole volume. Tiers are sorted by rangeMin first;
 * quantity beyond the last tier's bound bills at the last tier's rate.
 *
 * Overlapping tiers (e.g. AWS's global 100 GB free egress row overlapping the
 * regional first tier) are clamped: each tier's window starts at max(rangeMin,
 * previous window end), so overlapping windows are consumed once, cheapest-first
 * at the same boundary, with no double-billing.
 */
export function tieredCost(tiers: PriceTier[], quantity: number): number {
  if (quantity <= 0 || tiers.length === 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.rangeMin - b.rangeMin || a.rate - b.rate);
  let remaining = quantity;
  let cost = 0;
  let prevMax = 0;
  for (const t of sorted) {
    if (remaining <= 0) break;
    const upper = t.rangeMax === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : t.rangeMax;
    const min = Math.max(t.rangeMin, prevMax);
    const span = Math.max(0, Math.min(remaining, upper - min));
    if (span > 0) {
      cost += span * t.rate;
      remaining -= span;
    }
    if (upper > prevMax) prevMax = upper;
  }
  if (remaining > 0) {
    const last = sorted[sorted.length - 1]!;
    cost += remaining * last.rate;
  }
  return cost;
}

/** First tier whose rate is non-zero (the cheapest paid rate for small volumes). */
export function firstPaidRate(tiers: PriceTier[]): number {
  const paid = tiers.filter((t) => t.rate > 0);
  return paid.length > 0 ? Math.min(...paid.map((t) => t.rate)) : 0;
}

/** Parses AWS bulk-CSV range cells ("0", "51200", "Inf") into PriceTiers. */
export function awsTiers(
  rows: Record<string, string>[],
  rangeMinOf: (r: Record<string, string>) => number,
  rateOf: (r: Record<string, string>) => number,
): PriceTier[] {
  const tiers: PriceTier[] = [];
  for (const r of rows) {
    const min = rangeMinOf(r);
    const rate = rateOf(r);
    if (!Number.isFinite(min) || min < 0) continue;
    if (!Number.isFinite(rate) || rate < 0) continue;
    const rawMax = r['EndingRange'] ?? r['Ending Range'];
    const maxNum = Number(rawMax);
    tiers.push({
      rangeMin: min,
      rangeMax: rawMax === 'Inf' || rawMax === undefined || rawMax === '' ? Number.POSITIVE_INFINITY : Number.isFinite(maxNum) ? maxNum : Number.POSITIVE_INFINITY,
      rate,
    });
  }
  return tiers;
}
