/**
 * Build data/seed/clubcaddie_ma.json from data/seed/_clubcaddie_ma.json,
 * reusing each matching existing record's id/coords/ratings (same id ⇒ seed.ts
 * keeps the clubcaddie version, which loads before directory_/foreup_ files).
 *
 *   npx tsx scripts/build_clubcaddie_seed.ts
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

type Rec = Record<string, unknown> & { id: string; name: string };
const byslug = new Map<string, Rec>();
for (const f of fs.readdirSync(seedDir)) {
  if (!f.endsWith('.json') || f.startsWith('ratings_') || f.startsWith('_') || f === 'clubcaddie_ma.json') continue;
  for (const r of JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')) as Rec[]) byslug.set(slug(r.name), r);
}

const cfg = JSON.parse(fs.readFileSync(path.join(seedDir, '_clubcaddie_ma.json'), 'utf8')) as {
  courses: { match: string; shard: string; apikey: string; courseId: number }[];
};

const out: Rec[] = [];
for (const c of cfg.courses) {
  const base = byslug.get(slug(c.match));
  if (!base) {
    console.warn(`no existing record for "${c.match}" — skipping`);
    continue;
  }
  out.push({
    ...base,
    provider: 'clubcaddie',
    provider_config: { shard: c.shard, apikey: c.apikey, courseId: c.courseId },
    booking_url: `https://apimanager-${c.shard}.clubcaddie.com/webapi/view/${c.apikey}`,
    notes: `clubcaddie ${c.shard} course ${c.courseId}`,
  });
}

fs.writeFileSync(path.join(seedDir, 'clubcaddie_ma.json'), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} Club Caddie courses → clubcaddie_ma.json`);
