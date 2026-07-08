/**
 * Auto-fill fallback coverage from the authoritative roster.
 *
 * Reads data/seed/authoritative_ma.tsv (the ground-truth list of every MA course
 * — see scripts/build_authoritative.ts) and, for every public/semi-private/
 * municipal course NOT already covered by a live provider seed, emits a
 * `fallback` record with a "Check availability" booking deep-link. This is what
 * guarantees the catalog is never missing a course: worst case a course is
 * present with a booking link, and seed.ts upgrades it to a live record
 * automatically once a provider harvester finds its booking platform.
 *
 *   npx tsx scripts/build_directory_seed.ts
 *
 * Output: data/seed/directory_fallback_ma.json
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

// Existing course name slugs from all non-directory course seed files (live
// providers + manual). A roster course matching one of these is already covered,
// so we don't emit a duplicate fallback for it.
const existing = new Set<string>();
for (const f of fs.readdirSync(seedDir)) {
  if (!f.endsWith('.json') || f.startsWith('ratings_') || f.startsWith('_')) continue;
  if (f === 'directory_fallback_ma.json') continue; // don't dedup against our own output
  const recs = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')) as { name: string }[];
  for (const r of recs) existing.add(slug(r.name));
}

// MA town centroids, used when the roster row has no coordinates of its own.
const towns = new Map<string, { lat: number; lng: number }>();
for (const line of fs.readFileSync(path.join(process.cwd(), 'data', 'ma_towns.tsv'), 'utf8').split('\n')) {
  const [name, lat, lng] = line.split('\t');
  if (name) towns.set(name.toLowerCase(), { lat: parseFloat(lat), lng: parseFloat(lng) });
}

interface RosterRow {
  name: string;
  town: string;
  access: string;
  lat: string;
  lng: string;
  address: string;
}
const rosterPath = path.join(seedDir, 'authoritative_ma.tsv');
const roster: RosterRow[] = fs
  .readFileSync(rosterPath, 'utf8')
  .split('\n')
  .slice(1) // header
  .filter(Boolean)
  .map((l) => {
    const [name, town, access, lat, lng, address] = l.split('\t');
    return { name, town, access, lat, lng, address: address ?? '' };
  });

// Only public / semi-private / municipal courses need to be present in the app.
const REQUIRED = new Set(['public', 'semi', 'muni']);

const records: Record<string, unknown>[] = [];
const seenIds = new Set<string>();
let added = 0;
let skippedExisting = 0;
let skippedNotRequired = 0;
let skippedNoGeo = 0;

for (const row of roster) {
  if (!REQUIRED.has(row.access)) {
    skippedNotRequired++;
    continue;
  }
  if (existing.has(slug(row.name))) {
    skippedExisting++;
    continue;
  }
  // Prefer the roster's own coordinates; fall back to the town centroid.
  let lat = parseFloat(row.lat);
  let lng = parseFloat(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const geo = towns.get(row.town.toLowerCase());
    if (!geo) {
      skippedNoGeo++;
      console.warn(`no coordinates and no centroid for "${row.name}" (${row.town})`);
      continue;
    }
    lat = geo.lat;
    lng = geo.lng;
  }
  let id = `ma-${idSlug(row.name)}`;
  if (seenIds.has(id)) id = `${id}-${idSlug(row.town)}`;
  seenIds.add(id);
  records.push({
    id,
    name: row.name,
    address: row.address || null,
    town: row.town,
    state: 'MA',
    zip: null,
    lat,
    lng,
    phone: null,
    website: null,
    holes_total: 18,
    provider: 'fallback',
    provider_config: {},
    booking_url: `https://www.google.com/search?q=${encodeURIComponent(row.name + ' ' + row.town + ' MA golf tee times')}`,
    google_rating: null,
    google_reviews: null,
    golfpass_rating: null,
    other_ratings: null,
    is_public: 1,
    notes: 'directory fallback (authoritative roster)',
  });
  added++;
}

fs.writeFileSync(path.join(seedDir, 'directory_fallback_ma.json'), JSON.stringify(records, null, 2));
console.log(
  `Directory: +${added} fallback courses, ${skippedExisting} already live, ` +
    `${skippedNotRequired} not required (private/military/resort), ${skippedNoGeo} no geo ` +
    `→ directory_fallback_ma.json`
);
