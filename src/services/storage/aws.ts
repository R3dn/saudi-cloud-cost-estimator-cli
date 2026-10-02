import type { Currency } from '../../core/types.js';
import type { PriceTier } from '../../core/types.js';
import type { StorageInput } from './types.js';
import { awsTiers } from '../../core/tiers.js';
import { fetchAwsOfferRows, bestPrice } from '../../providers/awsCatalog.js';

/**
 * AWS storage monthly rates: S3 general purpose, EBS gp3, EFS standard — all from the
 * official bulk-pricing CSVs for the region. S3 is volume-tiered
 * (StartingRange/EndingRange, e.g. first 50 TB then cheaper), so the object cost
 * is computed per tier. No silent fallbacks: failures throw.
 */
export async function awsStorageRates(
  input: StorageInput,
  opts: { currency: Currency; noCache: boolean },
): Promise<{
  objectPerGbMonth: number;
  blockPerGbMonth: number;
  filePerGbMonth: number;
  objectTiers: PriceTier[];
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

  const objectTierRows = s3Rows.filter(
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Storage' &&
      isGbMo(r) &&
      (r['Storage Class'] ?? '').toLowerCase().includes('general purpose'),
  );
  const objectTiers = awsTiers(
    objectTierRows,
    (r) => Number(r['StartingRange'] ?? r['Starting Range'] ?? 0),
    (r) => Number(r['PricePerUnit']),
  );
  const block = bestPrice(
    ec2Rows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      r['Product Family'] === 'Storage' &&
      isGbMo(r) &&
      (/\(gp3\)/i.test(r['PriceDescription'] ?? '') || /gp3/i.test(r['usageType'] ?? r['Usage Type'] ?? '')),
  );
  const file = bestPrice(
    efsRows,
    (r) =>
      r['TermType'] === 'OnDemand' &&
      isGbMo(r) &&
      /Standard storage/i.test(r['PriceDescription'] ?? ''),
  );

  if (objectTiers.length === 0) throw new Error(`AWS S3 general purpose storage price not found in ${input.region}`);
  if (block === null) throw new Error(`AWS EBS gp3 storage price not found in ${input.region}`);
  if (file === null) throw new Error(`AWS EFS standard storage price not found in ${input.region}`);

  return {
    objectPerGbMonth: objectTiers[0]!.rate,
    blockPerGbMonth: block,
    filePerGbMonth: file,
    objectTiers,
    listedCurrency: 'USD',
    skuRefs: { object: 'AmazonS3 general purpose (tiered per GB-month)', block: 'AmazonEC2 gp3', file: 'AmazonEFS standard' },
  };
}
