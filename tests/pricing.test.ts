import { describe, expect, it } from 'vitest';
import { applyVat, vatAmount } from '../src/core/vat.js';
import { normalizeQuote } from '../src/core/pricing.js';
import { usdToSar, FALLBACK_SAR_PER_USD } from '../src/core/fx.js';

describe('vat', () => {
  it('applies 15% VAT', () => {
    expect(applyVat(100)).toBeCloseTo(115);
    expect(vatAmount(100)).toBeCloseTo(15);
  });

  it('supports custom rates', () => {
    expect(applyVat(200, 0.05)).toBeCloseTo(210);
  });
});

describe('fx', () => {
  it('converts USD to SAR', () => {
    expect(usdToSar(2, FALLBACK_SAR_PER_USD)).toBeCloseTo(7.5);
  });
});

describe('normalizeQuote', () => {
  it('converts a USD quote to SAR with VAT', () => {
    const result = normalizeQuote(
      {
        quote: {
          provider: 'aws',
          region: 'me-south-1',
          instance: 'm6i.xlarge',
          hourly: 0.235,
          listedCurrency: 'USD',
          vcpu: 4,
          gb: 16,
        },
        providerName: 'AWS',
        regionName: 'Bahrain',
        currency: 'SAR',
        hours: 730,
        sarPerUsd: 3.75,
      },
      true,
    );
    expect(result.hourlyDisplay).toBeCloseTo(0.88125);
    expect(result.monthly).toBeCloseTo(643.3125);
    expect(result.monthlyVat).toBeCloseTo(739.809375);
    expect(result.nativeSar).toBe(false);
  });

  it('keeps native SAR untouched', () => {
    const result = normalizeQuote(
      {
        quote: {
          provider: 'oci',
          region: 'me-riyadh-1',
          instance: 'VM.Standard.E4.Flex',
          hourly: 0.44205,
          listedCurrency: 'SAR',
          vcpu: 4,
          gb: 16,
        },
        providerName: 'OCI',
        regionName: 'Riyadh',
        currency: 'SAR',
        hours: 730,
        sarPerUsd: 3.75,
      },
      false,
    );
    expect(result.hourlyDisplay).toBeCloseTo(0.44205);
    expect(result.monthlyVat).toBeCloseTo(322.6965);
    expect(result.nativeSar).toBe(true);
  });

  it('converts SAR-native to USD display', () => {
    const result = normalizeQuote(
      {
        quote: {
          provider: 'oci',
          region: 'me-riyadh-1',
          instance: 'VM.Standard.E4.Flex',
          hourly: 3.75,
          listedCurrency: 'SAR',
          vcpu: 4,
          gb: 16,
        },
        providerName: 'OCI',
        regionName: 'Riyadh',
        currency: 'USD',
        hours: 100,
        sarPerUsd: 3.75,
      },
      true,
    );
    expect(result.hourlyDisplay).toBeCloseTo(1.0);
    expect(result.monthlyVat).toBeCloseTo(115);
    expect(result.monthly).toBeCloseTo(100);
  });

  it('computes altHourly (USD when displaying SAR, SAR when displaying USD)', () => {
    const sarResult = normalizeQuote(
      {
        quote: {
          provider: 'oci',
          region: 'me-riyadh-1',
          instance: 'VM.Standard.E4.Flex',
          hourly: 3.75,
          listedCurrency: 'SAR',
          vcpu: 4,
          gb: 16,
        },
        providerName: 'OCI',
        regionName: 'Riyadh',
        currency: 'SAR',
        hours: 100,
        sarPerUsd: 3.75,
      },
      false,
    );
    expect(sarResult.altHourly).toBeCloseTo(1.0); // 3.75 SAR / 3.75 = 1.0 USD

    const usdResult = normalizeQuote(
      {
        quote: {
          provider: 'aws',
          region: 'me-south-1',
          instance: 'm6i.xlarge',
          hourly: 0.235,
          listedCurrency: 'USD',
          vcpu: 4,
          gb: 16,
        },
        providerName: 'AWS',
        regionName: 'Bahrain',
        currency: 'USD',
        hours: 730,
        sarPerUsd: 3.75,
      },
      false,
    );
    expect(usdResult.altHourly).toBeCloseTo(0.88125); // 0.235 USD * 3.75 = 0.88125 SAR
  });
});
