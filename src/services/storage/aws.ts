import type { Currency } from '../../core/types.js';
import type { StorageInput } from './types.js';
import { fetchAwsOfferRows, bestPrice } from '../../providers/awsCatalog.js';

/**
 * AWS storage monthly rates: S3 general purpose, EBS gp3, EFS standard — all from the
 * official bulk-pricing CSVs for the region. No silent fallbacks: failures throw.
 */
export async function awsStorageRates(
  input: StorageInput,
  opts: { currency: Currency; noCache: boolean },
): Promise<{
  objectPerGbMonth: number;
  blockPerGbMonth: number;
  filePerGbMonth: number;
  listedCurrency: Currency;
  skuRefs: { object: string; block: string; file: string };
}> {
  const isGbMo = (r: Record<string, string>) => {
    const unit = (r['Unit'] ?? '').toLowerCase();
    return unit.includes('gb') && (unit.includes('mo') || unit.includes('month'));
  };

  const [s3Rows, ec2Rows, efsRows] = await Promise.all([
    fetchAwsOfferRows('AmazonS3', input.region, opts.noCache),
    fetchAwsOfferRows('AmazonEC2', input.region, opts.noCache),
    fetchAwsOfferRows('AmazonEFS', input.region, opts.noCache),
  ]);

  const object = bestPrice(
    s3Rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Storage' &&
      isGbMo(r) &&
      (r['Storage Class'] ?? '').toLowerCase().includes('general purpose'),
  );
  const block = bestPrice(
    ec2Rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Storage' &&
      isGbMo(r) &&
      (/\(gp3\)/i.test(r['PriceDescription'] ?? '') || /gp3/i.test(r['UsageType'] ?? '')),
  );
  const file = bestPrice(
    efsRows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      isGbMo(r) &&
      /Standard storage/i.test(r['PriceDescription'] ?? ''),
  );

  if (object === null) throw new Error(`AWS S3 general purpose storage price not found in ${input.region}`);
  if (block === null) throw new Error(`AWS EBS gp3 storage price not found in ${input.region}`);
  if (file === null) throw new Error(`AWS EFS standard storage price not found in ${input.region}`);

  return {
    objectPerGbMonth: object,
    blockPerGbMonth: block,
    filePerGbMonth: file,
    listedCurrency: 'USD',
    skuRefs: { object: 'AmazonS3 general purpose', block: 'AmazonEC2 gp3', file: 'AmazonEFS standard' },
  };
}
