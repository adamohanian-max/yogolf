/**
 * Build data/seed/chronogolf_ma.json from harvested Chronogolf clubs, reusing
 * the matching existing record's id/ratings and the harvested coordinates.
 *
 *   npx tsx scripts/chronogolf_harvest.ts <slugs...> > chrono.ndjson
 *   npx tsx scripts/build_chronogolf_seed.ts chrono.ndjson
 */
import fs from 'fs';
import path from 'path';
import type { ChronoHarvest } from './chronogolf_harvest';

const seedDir = path.join(process.cwd(), 'data', 'seed');

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\\u0026/g, 'and')
    .replace(/&/g, 'and')
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of|and)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
function decode(s: string): string {
  return s.replace(/\\u0026/g, '&').replace(/\\u[0-9a-fA-F]{4}/g, '');
}
function idSlug(s: string): string {
  return decode(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

type Rec = Record<string, unknown> & { id: string; name: string };
const byslug = new Map<string, Rec>();
for (const f of fs.readdirSync(seedDir)) {
  if (!f.endsWith('.json') || f.startsWith('ratings_') || f.startsWith('_') || f === 'chronogolf_ma.json') continue;
  for (const r of JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')) as Rec[]) byslug.set(slug(r.name), r);
}

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const out: Rec[] = [];
for (const line of lines) {
  const h = JSON.parse(line) as ChronoHarvest | null;
  if (!h || !h.clubId || !h.affiliationTypeId || !h.courses.length) continue;
  const name = decode(h.name);
  const base = byslug.get(slug(name));
  const id = base?.id ?? `ma-${idSlug(name)}`;
  out.push({
    id,
    name,
    address: base?.address ?? null,
    town: (base?.town as string) ?? h.town,
    state: 'MA',
    zip: base?.zip ?? null,
    lat: h.lat ?? (base?.lat as number),
    lng: h.lon ?? (base?.lng as number),
    phone: base?.phone ?? null,
    website: base?.website ?? null,
    holes_total: 18,
    provider: 'chronogolf',
    provider_config: { clubId: h.clubId, courses: h.courses, affiliationTypeId: h.affiliationTypeId },
    booking_url: `https://www.chronogolf.com/club/${h.slug}`,
    google_rating: base?.google_rating ?? null,
    google_reviews: base?.google_reviews ?? null,
    golfpass_rating: base?.golfpass_rating ?? null,
    other_ratings: null,
    is_public: 1,
    notes: `chronogolf club ${h.clubId}`,
  });
}

fs.writeFileSync(path.join(seedDir, 'chronogolf_ma.json'), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} Chronogolf courses → chronogolf_ma.json`);
