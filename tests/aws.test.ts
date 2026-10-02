import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { awsProvider } from '../src/providers/aws.js';
import { downloadResumable } from '../src/providers/awsDownload.js';
import { getCache } from '../src/core/cache.js';
import type { EstimateOptions } from '../src/core/types.js';

const OPTS: EstimateOptions = { currency: 'SAR', hours: 730, vat: true, noCache: true };

const HEADER =
  '"SKU","OfferTermCode","RateCode","TermType","PriceDescription","EffectiveDate","StartingRange","EndingRange","Unit","PricePerUnit","Currency","RelatedTo","LeaseContractLength","PurchaseOption","OfferingClass","Product Family","serviceCode","Location","Location Type","Instance Type","Current Generation","Instance Family","vCPU","Physical Processor","Clock Speed","Memory","Storage","Network Performance","Processor Architecture","Operating System","License Model","Tenancy","Pre Installed S/W","PreInstalled Software","CapacityStatus","CapacityReservation Service Code","Operation","Usage Type","Region Code","Region Name"';

function row(instanceType: string, price: string, overrides: Record<string, string> = {}): string {
  const cols = [
    'SKU1', 'JRTCKXETXF', 'RATE1', 'OnDemand', `desc ${instanceType}`, '2026-09-01', '0', 'Inf', 'Hrs', price, 'USD',
    '', '', '', '', 'Compute Instance', 'AmazonEC2', 'Middle East (Bahrain)', 'AWS Region', instanceType, 'Yes',
    'General purpose', '4', 'Intel', '3.5 GHz', '16 GiB', 'EBS only', 'Up to 12500 Megabit', '64-bit', 'Linux',
    'No License required', 'Shared', 'NA', 'NA', 'Used', 'NA', 'RunInstances', 'MES1-BoxUsage', 'me-south-1', 'Middle East (Bahrain)',
  ];
  const names = HEADER.split('","').map((c) => c.replace(/^"|"$/g, ''));
  for (const [k, v] of Object.entries(overrides)) {
    const idx = names.indexOf(k);
    if (idx >= 0) cols[idx] = v;
  }
  return cols.map((c) => `"${c}"`).join(',');
}

/** Builds a realistic-size CSV: enough distinct instance types to pass the truncation guard. */
function bigCsv(extraRows: string[], fillerCount = 550): string {
  const lines = [
    '"FormatVersion","v1.0"',
    '"Disclaimer","..."',
    '"Publication Date","2026-09-25T17:45:21Z"',
    '"Version","20260925174521"',
    '"OfferCode","AmazonEC2"',
    HEADER,
  ];
  for (let i = 0; i < fillerCount; i++) {
    lines.push(row(`gen-${i}`, (0.01 + i / 10000).toFixed(10)));
  }
  lines.push(...extraRows);
  return lines.join('\n');
}

function mockAwsDownload(csv: string): ReturnType<typeof vi.fn> {
  const buf = Buffer.from(csv, 'utf8');
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'HEAD') {
      return {
        ok: true,
        headers: new Map([['content-length', String(buf.length)]]),
      };
    }
    if (u.endsWith('region_index.json')) {
      return {
        ok: true,
        json: async () => ({
          regions: { 'me-south-1': { currentVersionUrl: '/offers/v1.0/aws/AmazonEC2/20260925174521/me-south-1/index.json' } },
        }),
      };
    }
    const range = init?.headers && typeof init.headers === 'object' && 'Range' in init.headers
      ? String((init.headers as Record<string, string>)['Range'])
      : null;
    if (range) {
      const [, startStr, endStr] = /bytes=(\d+)-(\d+)/.exec(range) ?? [];
      const start = Number(startStr ?? 0);
      const end = Number(endStr ?? buf.length - 1);
      const slice = buf.subarray(start, end + 1);
      return { ok: true, status: 206, arrayBuffer: async () => slice };
    }
    return { ok: true, text: async () => csv };
  });
}

describe('awsProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads the CSV, filters on-demand Linux shared prices', async () => {
    const csv = bigCsv([
      row('m6i.xlarge', '0.2640000000'),
      row('m6i.xlarge', '0.9', { TermType: 'Reserved' }),
      row('m6i.xlarge', '0.9', { 'Operating System': 'Windows' }),
      row('m6i.xlarge', '0.9', { Tenancy: 'Host' }),
      row('m6i.xlarge', '0.9', { CapacityStatus: 'UnusedCapacityReservation' }),
      row('m6i.xlarge', '0.9', { 'Pre Installed S/W': 'SQL Ent' }),
      row('m6i.large', '0.1320000000'),
    ]);
    vi.stubGlobal('fetch', mockAwsDownload(csv));

    const quote = await awsProvider.getHourlyPrice('me-south-1', {
      profile: 'medium',
      vcpu: 4,
      gb: 16,
      instance: 'm6i.xlarge',
    }, OPTS);
    expect(quote.hourly).toBeCloseTo(0.264);
    expect(quote.listedCurrency).toBe('USD');
  });

  it('throws when the instance type is missing', async () => {
    vi.stubGlobal('fetch', mockAwsDownload(bigCsv([row('m6i.large', '0.1320000000')])));
    await expect(
      awsProvider.getHourlyPrice('me-south-1', {
        profile: 'medium',
        vcpu: 4,
        gb: 16,
        instance: 'm6i.xlarge',
      }, OPTS),
    ).rejects.toThrow(/not found/);
  });

  it('refuses truncated parses and does not cache them', async () => {
    const csv = ['', '', '', '', '', HEADER, row('m6i.large', '0.1320000000')].join('\n');
    vi.stubGlobal('fetch', mockAwsDownload(csv));
    await expect(
      awsProvider.getHourlyPrice('me-south-1', {
        profile: 'medium',
        vcpu: 4,
        gb: 16,
        instance: 'm6i.large',
      }, OPTS),
    ).rejects.toThrow(/refusing to use it/);
  });

  it('never writes cache when noCache is set', async () => {
    const csv = bigCsv([row('m6i.xlarge', '0.2640000000')]);
    vi.stubGlobal('fetch', mockAwsDownload(csv));
    const quote = await awsProvider.getHourlyPrice('me-south-1', {
      profile: 'medium',
      vcpu: 4,
      gb: 16,
      instance: 'm6i.xlarge',
    }, OPTS);
    expect(quote.hourly).toBeCloseTo(0.264);
    expect(getCache('aws-rows-v2-AmazonEC2-me-south-1')).toBeNull();
  });

  it('caches the projected OnDemand rows on a normal run', async () => {
    const csv = bigCsv([row('m6i.xlarge', '0.2640000000')]);
    vi.stubGlobal('fetch', mockAwsDownload(csv));
    await awsProvider.getHourlyPrice('me-south-1', {
      profile: 'medium',
      vcpu: 4,
      gb: 16,
      instance: 'm6i.xlarge',
    }, { ...OPTS, noCache: false });
    const cached = getCache<Record<string, string>[]>('aws-rows-v2-AmazonEC2-me-south-1');
    expect(cached).not.toBeNull();
    // Every filler row is OnDemand + Compute Instance, so all rows survive the projection.
    expect(cached!.length).toBeGreaterThan(500);
    // Projection keeps only the columns estimators read — no LeaseContractLength etc.
    for (const r of cached!) {
      expect(r['LeaseContractLength']).toBeUndefined();
      expect(r['TermType']).toBe('OnDemand');
    }
  });

  it('reads vCPU/memory/GPU specs from the CSV for a custom --instance sku', async () => {
    const csv = bigCsv([row('g4dn.xlarge', '0.6450000000', { 'Instance Family': 'GPU instance', vCPU: '4', Memory: '16 GiB', GPU: '1', 'GPU Model': 'T4' })]);
    vi.stubGlobal('fetch', mockAwsDownload(csv));
    const quote = await awsProvider.getHourlyPrice(
      'me-south-1',
      { vcpu: 0, gb: 0, instance: 'g4dn.xlarge' },
      OPTS,
    );
    expect(quote.hourly).toBeCloseTo(0.645);
    expect(quote.vcpu).toBe(4);
    expect(quote.gb).toBe(16);
  });

  it('prices the 2xlarge general profile (m6i.8xlarge)', async () => {
    const csv = bigCsv([row('m6i.8xlarge', '2.1120000000', { vCPU: '32', Memory: '128 GiB' })]);
    vi.stubGlobal('fetch', mockAwsDownload(csv));
    const quote = await awsProvider.getHourlyPrice(
      'me-south-1',
      { profile: '2xlarge', vcpu: 32, gb: 128, instance: 'm6i.8xlarge' },
      OPTS,
    );
    expect(quote.hourly).toBeCloseTo(2.112);
    expect(quote.vcpu).toBe(32);
    expect(quote.gb).toBe(128);
  });
});

describe('downloadResumable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reassembles ranged chunks and verifies lengths', async () => {
    const payload = 'x'.repeat(1024);
    const buf = Buffer.from(payload, 'utf8');
    let calls = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return { ok: true, headers: new Map([['content-length', String(buf.length)]]) };
      }
      calls++;
      const range = String((init?.headers as Record<string, string>)['Range']);
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => buf.subarray(Number(s), Number(e) + 1),
      };
    });

    const result = await downloadResumable('https://example.com/data');
    expect(result.length).toBe(1024);
    expect(calls).toBe(1);
  });

  it('retries failed chunks and eventually succeeds', async () => {
    const payload = 'y'.repeat(512);
    const buf = Buffer.from(payload, 'utf8');
    let call = 0;
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return { ok: true, headers: new Map([['content-length', String(buf.length)]]) };
      }
      call++;
      if (call === 1) throw new Error('network hiccup');
      const range = String((init?.headers as Record<string, string>)['Range']);
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => buf.subarray(Number(s), Number(e) + 1),
      };
    });
    const result = await downloadResumable('https://example.com/data');
    expect(result.length).toBe(512);
    expect(call).toBe(2);
  });

  it('probes total size via Content-Range when HEAD omits Content-Length', async () => {
    const buf = Buffer.from('z'.repeat(2048), 'utf8');
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        requests.push('HEAD');
        return { ok: true, headers: new Map() };
      }
      const range = String((init?.headers as Record<string, string>)['Range']);
      requests.push(range);
      if (range === 'bytes=0-0') {
        return {
          ok: true,
          status: 206,
          headers: new Map([['content-range', `bytes 0-0/${buf.length}`]]),
          arrayBuffer: async () => buf.subarray(0, 1),
        };
      }
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => buf.subarray(Number(s), Number(e) + 1),
      };
    });
    const result = await downloadResumable('https://example.com/data');
    expect(result.length).toBe(2048);
    expect(requests[1]).toBe('bytes=0-0');
  });

  it('throws instead of single-streaming when the server has no range support', async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return { ok: true, headers: new Map() };
      }
      return { ok: true, status: 200, text: async () => 'would-be-truncated-data' };
    });
    await expect(downloadResumable('https://example.com/data')).rejects.toThrow(
      /does not support ranged downloads/,
    );
  });
});
