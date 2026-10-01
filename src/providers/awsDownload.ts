import { parse } from 'csv-parse/sync';

const CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_RETRIES = 3;

/**
 * Downloads a large file in ranged chunks with per-chunk retry and length
 * verification. Plain single-stream downloads of the ~72MB AWS pricing CSV
 * are frequently truncated by flaky network paths, which silently drops rows —
 * so there is deliberately no single-stream fallback.
 */
export async function downloadResumable(
  url: string,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
  if (!head.ok) throw new Error(`HEAD request failed (${head.status})`);
  let total = Number(head.headers.get('content-length') ?? '0');
  if (!Number.isFinite(total) || total <= 0) {
    const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(30_000) });
    if (probe.status !== 206) {
      throw new Error(`server does not support ranged downloads (probe got ${probe.status})`);
    }
    const contentRange = probe.headers.get('content-range') ?? '';
    const match = /\/(\d+)$/.exec(contentRange);
    if (!match) throw new Error(`could not determine download size (Content-Range: "${contentRange}")`);
    total = Number(match[1]);
    if (!Number.isFinite(total) || total <= 0) throw new Error('invalid download size from Content-Range');
  }

  const chunks: Buffer[] = [];
  let received = 0;
  while (received < total) {
    const start = received;
    const end = Math.min(start + CHUNK_SIZE, total) - 1;
    let done = false;
    for (let attempt = 1; attempt <= MAX_RETRIES && !done; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: AbortSignal.timeout(300_000),
        });
        if (res.status !== 206) {
          throw new Error(`expected 206 Partial Content, got ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== end - start + 1) {
          throw new Error(`chunk length mismatch: got ${buf.length}, expected ${end - start + 1}`);
        }
        chunks.push(buf);
        received += buf.length;
        onProgress?.(received, total);
        done = true;
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
      }
    }
  }
  const out = Buffer.concat(chunks);
  if (out.length !== total) {
    throw new Error(`download incomplete: got ${out.length} of ${total} bytes`);
  }
  return out.toString('utf8');
}

export function parseAwsCsvHeader(csv: string): { header: string[]; data: string } {
  const marker = '"SKU","OfferTermCode"';
  const headerStart = csv.indexOf(marker);
  if (headerStart === -1) throw new Error('Could not find header row in AWS pricing CSV');
  const headerEnd = csv.indexOf('\n', headerStart);
  const header = parse(csv.slice(headerStart, headerEnd), { skip_empty_lines: true })[0] as string[];
  return { header, data: csv.slice(headerEnd + 1) };
}

export function parseAwsCsvRows(csv: string): Record<string, string>[] {
  const { header, data } = parseAwsCsvHeader(csv);
  return parse(data, { columns: header, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
}
