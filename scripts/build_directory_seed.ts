/**
 * Add courses from a name+town directory (data/seed/directory_ma.tsv) as
 * fallback records, skipping any already covered by a live provider seed.
 * Ensures the app lists ~every notable MA public course even where live tee
 * times aren't scrapable — each gets a "Check availability" booking link
 * (a Google search deep-link that lands on the course's own booking page).
 *
 *   npx tsx scripts/build_directory_seed.ts
 */
import fs from 'fs';
import path from 'path';

const seedDir = path.join(process.cwd(), 'data', 'seed');

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
function idSlug(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Existing course name slugs from all non-directory course seed files.
const existing = new Set<string>();
for (const f of fs.readdirSync(seedDir)) {
  if (!f.endsWith('.json') || f.startsWith('ratings_') || f.startsWith('_')) continue;
  if (f === 'directory_fallback_ma.json') continue; // don't dedup against our own output
  const recs = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')) as { name: string }[];
  for (const r of recs) existing.add(slug(r.name));
}

// MA town centroids.
const towns = new Map<string, { lat: number; lng: number }>();
for (const line of fs.readFileSync(path.join(process.cwd(), 'data', 'ma_towns.tsv'), 'utf8').split('\n')) {
  const [name, lat, lng] = line.split('\t');
  if (name) towns.set(name.toLowerCase(), { lat: parseFloat(lat), lng: parseFloat(lng) });
}

const dir = fs
  .readFileSync(path.join(seedDir, 'directory_ma.tsv'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'));

const records: Record<string, unknown>[] = [];
const seenIds = new Set<string>();
let added = 0;
let skippedExisting = 0;
let skippedNoGeo = 0;

for (const [name, town] of dir) {
  if (existing.has(slug(name))) {
    skippedExisting++;
    continue;
  }
  const geo = towns.get(town.toLowerCase());
  if (!geo) {
    skippedNoGeo++;
    console.warn(`no centroid for town "${town}" (${name})`);
    continue;
  }
  let id = `ma-${idSlug(name)}`;
  if (seenIds.has(id)) id = `${id}-${idSlug(town)}`;
  seenIds.add(id);
  records.push({
    id,
    name,
    address: null,
    town,
    state: 'MA',
    zip: null,
    lat: geo.lat,
    lng: geo.lng,
    phone: null,
    website: null,
    holes_total: 18,
    provider: 'fallback',
    provider_config: {},
    booking_url: `https://www.google.com/search?q=${encodeURIComponent(name + ' ' + town + ' MA golf tee times')}`,
    google_rating: null,
    google_reviews: null,
    golfpass_rating: null,
    other_ratings: null,
    is_public: 1,
    notes: 'directory fallback (town centroid)',
  });
  added++;
}

fs.writeFileSync(path.join(seedDir, 'directory_fallback_ma.json'), JSON.stringify(records, null, 2));
console.log(
  `Directory: +${added} fallback courses, ${skippedExisting} already live, ${skippedNoGeo} no geo → directory_fallback_ma.json`
);
