/**
 * Build data/seed/cps_ma.json from a curated list of discovered CPS courses,
 * reusing the id/coords/ratings of the matching existing seed record so the
 * course upgrades from a fallback link to a live `cps` provider (same id ⇒
 * seed.ts keeps this one, loaded before directory_/foreup_ files alphabetically).
 *
 *   npx tsx scripts/build_cps_seed.ts
 */
import fs from 'fs';
import path from 'path';

const seedDir = path.join(process.cwd(), 'data', 'seed');

// host, siteName, courseId (bookable 18-hole id), match name in existing seeds
const CPS: [string, string, number, string][] = [
  ['georgewright.cps.golf', 'georgewright', 1, 'William Devine Golf Course At Franklin Park'],
  ['gannon.cps.golf', 'gannon', 1, 'Gannon Municipal Golf Course'],
  ['blissfulmeadows.cps.golf', 'blissfulmeadows', 1, 'Blissful Meadows Golf Club'],
  ['butterbrook.cps.golf', 'butterbrook', 1, 'Butter Brook Golf Club'],
  ['heatherhill.cps.golf', 'heatherhill', 2, 'Heather Hill Country Club'],
  ['swansea.cps.golf', 'swansea', 3, 'Swansea Country Club'],
  ['westover.cps.golf', 'westover', 1, 'Westover Golf Course'],
  ['indianpond.cps.golf', 'indianpond', 1, 'Indian Pond Country Club'],
  ['veteransmemorial.cps.golf', 'veteransmemorial', 1, 'Veterans Memorial Golf Course'],
  ['redtailgc.cps.golf', 'redtailgc', 2, 'Red Tail Golf Club'],
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// Index every existing seed course by name slug.
type Rec = Record<string, unknown> & { id: string; name: string };
const byslug = new Map<string, Rec>();
for (const f of fs.readdirSync(seedDir)) {
  if (!f.endsWith('.json') || f.startsWith('ratings_') || f.startsWith('_') || f === 'cps_ma.json') continue;
  for (const r of JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')) as Rec[]) {
    byslug.set(slug(r.name), r);
  }
}

const out: Rec[] = [];
for (const [host, siteName, courseId, matchName] of CPS) {
  const base = byslug.get(slug(matchName));
  if (!base) {
    console.warn(`no existing record matches "${matchName}" — skipping`);
    continue;
  }
  out.push({
    ...base,
    provider: 'cps',
    provider_config: { host, siteName, courseId },
    booking_url: `https://${host}/onlineresweb/search-teetime`,
    notes: `cps ${siteName} course ${courseId}`,
  });
}

fs.writeFileSync(path.join(seedDir, 'cps_ma.json'), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} CPS courses → cps_ma.json`);
