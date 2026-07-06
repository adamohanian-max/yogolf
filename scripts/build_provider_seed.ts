/**
 * Generic seed builder: reads data/seed/_<provider>_ma.json ({courses:[{match,...cfg}]})
 * and writes <provider>_ma.json, reusing the matching existing record's
 * id/coords/ratings and setting provider + provider_config.
 *
 *   npx tsx scripts/build_provider_seed.ts <provider> <bookingUrlTemplate>
 *   bookingUrlTemplate uses {field} placeholders from the cfg entry.
 */
import fs from 'fs';
import path from 'path';

const provider = process.argv[2];
const urlTemplate = process.argv[3];
const seedDir = path.join(process.cwd(), 'data', 'seed');

function slug(s: string): string {
  return s.toLowerCase().replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of)\b/g, '').replace(/[^a-z0-9]+/g, '').trim();
}

type Rec = Record<string, unknown> & { id: string; name: string };
const byslug = new Map<string, Rec>();
// Index other seed files first, then this provider's own previous output LAST
// as a fallback base — so courses that now live only in <provider>_ma.json
// (migrated in from another platform) keep their coords/ratings on rebuild.
const ownFile = `${provider}_ma.json`;
const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json') && !f.startsWith('ratings_') && !f.startsWith('_'));
for (const f of [...files.filter((f) => f !== ownFile), ...files.filter((f) => f === ownFile)]) {
  for (const r of JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8')) as Rec[]) {
    if (!byslug.has(slug(r.name))) byslug.set(slug(r.name), r);
  }
}

const cfg = JSON.parse(fs.readFileSync(path.join(seedDir, `_${provider}_ma.json`), 'utf8')) as { courses: Record<string, unknown>[] };
const out: Rec[] = [];
for (const c of cfg.courses) {
  const base = byslug.get(slug(String(c.match)));
  if (!base) { console.warn(`no record for "${c.match}"`); continue; }
  const { match, ...pc } = c;
  void match;
  let url = urlTemplate;
  for (const [k, v] of Object.entries(c)) url = url.replaceAll(`{${k}}`, String(v));
  out.push({ ...base, provider, provider_config: pc, booking_url: url, notes: `${provider} ${JSON.stringify(pc)}` });
}
fs.writeFileSync(path.join(seedDir, `${provider}_ma.json`), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} ${provider} courses → ${provider}_ma.json`);
