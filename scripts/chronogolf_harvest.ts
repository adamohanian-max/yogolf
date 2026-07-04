/**
 * Harvest Chronogolf club/course/affiliation ids from a club page's embedded
 * Next.js data.
 *
 *   npx tsx scripts/chronogolf_harvest.ts <club-slug> [<club-slug> ...]
 *
 * Prints one JSON line per club: {slug, clubId, affiliationTypeId, courses:[{id,holes}], lat, lon, name, town}
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface ChronoHarvest {
  slug: string;
  clubId: number | null;
  affiliationTypeId: number | null;
  courses: { id: number; holes: number[] }[];
  lat: number | null;
  lon: number | null;
  name: string;
  town: string;
}

export async function harvest(slug: string): Promise<ChronoHarvest | null> {
  const res = await fetch(`https://www.chronogolf.com/club/${slug}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  const s = m[1];

  const aff = s.match(/defaultAffiliationTypeId":(\d+)/);
  const clubId = s.match(/"id":(\d+)[^}]*"slug":"[^"]*"/) || s.match(new RegExp(`"id":(\\d+)[^}]*"${slug.slice(0, 8)}`));
  const loc = s.match(/"location":\{"lat":([-\d.]+),"lon":([-\d.]+)/);
  const name = s.match(/"name":"([^"]+)"/);
  const town = s.match(/"city":"([^"]+)"/);

  // Course objects: {"id":N,"name":"...","holes":9,"teeBoxes":[...],"bookableHoles":[9,18],...}
  const courses: { id: number; holes: number[] }[] = [];
  const seen = new Set<number>();
  const re = /"id":(\d+),"name":"[^"]*","holes":\d+,"teeBoxes":\[[\s\S]*?\],"bookableHoles":\[([\d,]+)\]/g;
  let cm: RegExpExecArray | null;
  while ((cm = re.exec(s))) {
    const id = Number(cm[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    courses.push({ id, holes: cm[2].split(',').map(Number) });
  }

  return {
    slug,
    clubId: clubId ? Number(clubId[1]) : null,
    affiliationTypeId: aff ? Number(aff[1]) : null,
    courses,
    lat: loc ? Number(loc[1]) : null,
    lon: loc ? Number(loc[2]) : null,
    name: name ? name[1] : slug,
    town: town ? town[1] : '',
  };
}

async function main() {
  for (const slug of process.argv.slice(2)) {
    const r = await harvest(slug);
    console.log(JSON.stringify(r));
  }
}
if (process.argv[1]?.endsWith('chronogolf_harvest.ts')) main();
