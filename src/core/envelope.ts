import type { Component, Currency, PriceSource, ProviderId } from './types.js';

export interface CompareRowInput {
  provider: ProviderId;
  providerName: string;
  region: string;
  regionName: string;
  monthly: number | null;
  monthlyVat: number | null;
  currency: Currency;
  components: Record<string, Component> | null;
  warnings: string[];
  error: string | null;
}

export interface CompareEnvelope {
  input: Record<string, unknown>;
  currency: Currency;
  vat: boolean;
  hours: number;
  rows: {
    provider: ProviderId;
    providerName: string;
    region: string;
    regionName: string;
    monthly: number | null;
    monthlyVat: number | null;
    currency: Currency;
    components: Record<string, { monthly: number; source: PriceSource; skuRef?: string }> | null;
    warnings: string[];
    error: string | null;
  }[];
}

/**
 * The single JSON contract every `compare` command emits. Consumers can parse
 * any compare output the same way; per-row errors never abort the rest.
 */
export function compareEnvelope(
  input: Record<string, unknown>,
  opts: { currency: Currency; vat: boolean; hours: number },
  rows: CompareRowInput[],
): CompareEnvelope {
  return {
    input,
    currency: opts.currency,
    vat: opts.vat,
    hours: opts.hours,
    rows: rows.map((r) => ({
      provider: r.provider,
      providerName: r.providerName,
      region: r.region,
      regionName: r.regionName,
      monthly: r.monthly,
      monthlyVat: r.monthlyVat,
      currency: opts.currency,
      components:
        r.components === null
          ? null
          : Object.fromEntries(
              Object.entries(r.components).map(([k, c]) => [k, { monthly: c.monthly, source: c.source, skuRef: c.skuRef }]),
            ),
      warnings: r.warnings,
      error: r.error,
    })),
  };
}
