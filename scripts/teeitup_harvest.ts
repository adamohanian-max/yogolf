/**
 * Harvest TeeItUp booking config from a course website: its book.teeitup
 * subdomain → alias → facilities (id + timezone) from the kenna.io API.
 *
 *   npx tsx scripts/teeitup_harvest.ts <course-website> [<website> ...]
 *
 * Prints {website, alias, facilityIds, timeZone, names}.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface TIUHarvest {
  website: string;
  alias: string | null;
  facilityIds: number[];
  timeZone: string | null;
  names: string[];
}

async function fetchText(url: string): Promise<string> {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return await (await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).text();
  } catch {
    return '';
  }
}

export async function harvestTeeItUp(website: string): Promise<TIUHarvest> {
  const out: TIUHarvest = { website, alias: null, facilityIds: [], timeZone: null, names: [] };
  const html = await fetchText(website);
  const m = html.match(/([a-z0-9-]+)\.book\.teeitup\.(?:com|golf)/i);
  if (!m) return out;
  // The subdomain may be the alias slug or a UUID; the alias the API wants is
  // the subdomain label (works for both slug and uuid forms).
  out.alias = m[1];

  try {
    const facilities = (await (
      await fetch(`https://phx-api-be-east-1b.kenna.io/alias/${out.alias}/facilities`, {
        headers: { 'User-Agent': UA, 'x-be-alias': out.alias },
        signal: AbortSignal.timeout(10000),
      })
    ).json()) as { id: number; name: string; timeZone?: string; isSimulator?: boolean }[];
    for (const f of facilities) {
      if (f.isSimulator) continue;
      out.facilityIds.push(f.id);
      out.names.push(f.name);
      if (!out.timeZone && f.timeZone) out.timeZone = f.timeZone;
    }
  } catch {
    /* alias not resolvable */
  }
  return out;
}

async function main() {
  for (const w of process.argv.slice(2)) console.log(JSON.stringify(await harvestTeeItUp(w)));
}
if (process.argv[1]?.endsWith('teeitup_harvest.ts')) main();
