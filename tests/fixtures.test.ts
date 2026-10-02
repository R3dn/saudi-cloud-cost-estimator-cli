import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paygTiers, paygRate, tieredCost } from '../src/providers/ociCatalog.js';
import { awsTiers } from '../src/core/tiers.js';
import type { OciProduct } from '../src/providers/ociCatalog.js';

/**
 * Contract tests against recorded fixtures of the real provider APIs
 * (captured 2026-10-02). These pin the parsers to the actual wire shapes —
 * a provider-side schema change fails here before it can misprice anything.
 */

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8')) as T;
}

describe('OCI price list fixture (real API capture)', () => {
  const items = loadFixture<OciProduct[]>('oci-price-list.json');

  function part(pn: string): OciProduct {
    const p = items.find((x) => x.partNumber === pn);
    if (!p) throw new Error(`fixture missing part ${pn}`);
    return p;
  }

  it('contains all parts the estimators reference', () => {
    for (const pn of [
      'B93113', 'B93114', 'B95909', 'B91628', 'B91961', 'B89057', 'B93456',
      'B93030', 'B112725', 'B111584', 'B109356', 'B107952', 'B96545',
    ]) {
      expect(part(pn).partNumber).toBe(pn);
    }
  });

  it('parses the LB part with the verified free allowance: 744 LB-hours/month', () => {
    const tiers = paygTiers(part('B93030'), 'SAR');
    expect(tiers).toHaveLength(2);
    expect(tiers[0]!.rangeMin).toBe(0);
    expect(tiers[0]!.rangeMax).toBe(744);
    expect(tiers[0]!.rate).toBe(0);
    expect(tiers[1]!.rate).toBeCloseTo(0.04237952, 8);
    // A single always-on LB (730 h) is free; two LBs bill only the excess.
    expect(tieredCost(tiers, 730)).toBeCloseTo(0, 6);
    expect(tieredCost(tiers, 1460)).toBeCloseTo((1460 - 744) * 0.04237952, 6);
  });

  it('parses the MEA egress part with the verified 10 TB free allowance', () => {
    const tiers = paygTiers(part('B93456'), 'SAR');
    expect(tiers[0]!.rangeMax).toBe(10240);
    expect(tiers[0]!.rate).toBe(0);
    expect(tieredCost(tiers, 10240)).toBeCloseTo(0, 6);
    expect(tieredCost(tiers, 11000)).toBeCloseTo(760 * 0.18752, 4);
  });

  it('object storage keeps the 10 GB free tier', () => {
    const tiers = paygTiers(part('B91628'), 'SAR');
    expect(tieredCost(tiers, 10)).toBeCloseTo(0, 6);
    expect(tieredCost(tiers, 50)).toBeCloseTo(40 * 0.0956352, 6);
  });

  it('flat parts price at the headline rate (no phantom tiers)', () => {
    expect(paygRate(part('B93113'), 'SAR')).toBeCloseTo(0.09376, 8);
    expect(paygRate(part('B93113'), 'USD')).toBeCloseTo(0.025, 8);
    expect(paygRate(part('B96545'), 'USD')).toBeCloseTo(0.1, 8);
  });

  it('compute parts expose native SAR prices (no USD conversion needed)', () => {
    const sar = part('B93113').currencyCodeLocalizations.find((c) => c.currencyCode === 'SAR');
    expect(sar?.prices[0]!.value).toBeCloseTo(0.09376, 8);
  });
});

describe('AWS bulk CSV rows fixture (real me-south-1 capture)', () => {
  const rows = loadFixture<Record<string, string>[]>('aws-me-south-1-rows.json');

  it('uses camelCase range columns the estimators read', () => {
    expect(rows.some((r) => 'StartingRange' in r)).toBe(true);
    expect(rows.some((r) => 'usageType' in r)).toBe(true);
  });

  it('contains the four real egress volume tiers for DataTransfer-Out-Bytes', () => {
    const egress = rows.filter(
      (r) =>
        r['Product Family'] === 'Data Transfer' &&
        r['Transfer Type'] === 'AWS Outbound' &&
        r['To Location'] === 'External' &&
        r['Unit'] === 'GB' &&
        /^[\w-]*DataTransfer-Out-Bytes$/i.test(r['usageType'] ?? ''),
    );
    expect(egress.length).toBeGreaterThanOrEqual(4);
    const tiers = awsTiers(egress, (r) => Number(r['StartingRange'] ?? 0), (r) => Number(r['PricePerUnit']));
    expect(tiers.find((t) => t.rangeMin === 0)!.rate).toBeCloseTo(0.117, 6);
    expect(tiers.find((t) => t.rangeMin === 10240)!.rate).toBeCloseTo(0.1105, 6);
    expect(tiers.find((t) => t.rangeMin === 153600)!.rate).toBeCloseTo(0.065, 6);
  });

  it('the Global 100 GB free row exists in the data (the estimator excludes it as Free Tier)', () => {
    const global = rows.find((r) => r['usageType'] === 'Global-DataTransfer-Out-Bytes');
    expect(global).toBeDefined();
    expect(Number(global!['PricePerUnit'])).toBe(0);
  });

  it('application LB hours exist under Load Balancer-Application, distinct from classic', () => {
    const alb = rows.find((r) => r['Product Family'] === 'Load Balancer-Application' && /LoadBalancerUsage/i.test(r['usageType'] ?? ''));
    const classic = rows.find((r) => r['Product Family'] === 'Load Balancer' && /LoadBalancerUsage/i.test(r['usageType'] ?? ''));
    expect(alb).toBeDefined();
    expect(classic).toBeDefined();
    expect(Number(alb!['PricePerUnit'])).toBeCloseTo(0.02772, 6);
    expect(Number(classic!['PricePerUnit'])).toBeCloseTo(0.0308, 6);
  });

  it('S3 general purpose has three descending volume tiers', () => {
    const s3 = rows.filter(
      (r) => r['Product Family'] === 'Storage' && (r['Storage Class'] ?? '').toLowerCase().includes('general purpose'),
    );
    const tiers = awsTiers(s3, (r) => Number(r['StartingRange'] ?? 0), (r) => Number(r['PricePerUnit']));
    expect(tiers.find((t) => t.rangeMin === 0)!.rate).toBeCloseTo(0.025, 6);
    expect(tiers.find((t) => t.rangeMin === 51200)!.rate).toBeCloseTo(0.024, 6);
    expect(tiers.find((t) => t.rangeMin === 512000)!.rate).toBeCloseTo(0.023, 6);
  });
});
