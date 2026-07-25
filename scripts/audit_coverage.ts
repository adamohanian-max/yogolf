/**
 * Coverage gate: reconcile the built catalog against the authoritative roster.
 *
 *   npx tsx scripts/audit_coverage.ts
 *
 * Every public / semi-private / municipal course in data/seed/authoritative_ma.tsv
 * must be either present in data/courses.db OR listed in data/seed/_exclude_ma.json
 * with a reason (privateClubs / closed / knownGap). Any roster course that is
 * neither covered nor excused → this script prints it and exits 1, failing the
 * build. This is the mechanism that keeps "no MA course is ever missing" true:
 * the catalog cannot regress without the gate turning red.
 *
 * A reverse check (non-fatal) reports catalog courses absent from the roster —
 * usually a stale entry or a name/town the roster spells differently.
 */
import fs from 'fs';
import path from 'path';
import { allCourses } from '../lib/db';
import type { Course } from '../lib/types';
import { sameCourse } from '../lib/dedupe';

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

const seedDir = path.join(process.cwd(), 'data', 'seed');
const REQUIRED = new Set(['public', 'semi', 'muni']);

// Authoritative roster.
interface RosterRow {
  name: string;
  town: string;
  access: string;
  lat: number;
  lng: number;
  address: string;
}
const roster: RosterRow[] = fs
  .readFileSync(path.join(seedDir, 'authoritative_ma.tsv'), 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map((l) => {
    const [name, town, access, lat, lng, address] = l.split('\t');
    return { name, town, access, lat: parseFloat(lat), lng: parseFloat(lng), address: address ?? '' };
  });

// Reasoned exemptions from _exclude_ma.json.
interface Exempt {
  junkPatterns?: string[];
  privateClubs?: string[];
  closed?: ({ name: string; reason?: string } | string)[];
  knownGap?: ({ name: string; reason?: string } | string)[];
}
const exempt = JSON.parse(fs.readFileSync(path.join(seedDir, '_exclude_ma.json'), 'utf8')) as Exempt;
const excused = new Map<string, string>();
for (const n of exempt.privateClubs ?? []) excused.set(slug(n), 'private (members-only)');
for (const key of ['closed', 'knownGap'] as const) {
  for (const e of exempt[key] ?? []) {
    const name = typeof e === 'string' ? e : e.name;
    const reason = typeof e === 'string' ? key : e.reason ?? key;
    excused.set(slug(name), `${key}: ${reason}`);
  }
}
// Anything seed.ts drops as junk (indoor complexes, "^old " dup spellings, etc.)
// is by definition not a course we ship — excuse it here so the audit stays
// consistent with the seeder rather than flagging what the seeder deliberately drops.
const junkRe = (exempt.junkPatterns ?? []).map((p) => new RegExp(p, 'i'));

// Built catalog.
const catalog = allCourses();
const covered = new Set(catalog.map((c) => slug(c.name)));
// Catalog grouped by town, for the same-course fallback match (a roster course
// the seeder merged into a differently-named live record still counts covered).
const catalogByTown = new Map<string, Course[]>();
for (const c of catalog) {
  const t = (c.town ?? '').toLowerCase().trim();
  (catalogByTown.get(t) ?? catalogByTown.set(t, []).get(t)!).push(c);
}
function coveredByDuplicate(row: RosterRow): boolean {
  const peers = catalogByTown.get(row.town.toLowerCase().trim()) ?? [];
  return peers.some((c) => sameCourse(row, c));
}

const missing: RosterRow[] = [];
let excusedCount = 0;
for (const row of roster) {
  if (!REQUIRED.has(row.access)) continue;
  const s = slug(row.name);
  if (covered.has(s) || coveredByDuplicate(row)) continue;
  if (excused.has(s) || junkRe.some((re) => re.test(row.name))) {
    excusedCount++;
    continue;
  }
  missing.push(row);
}

// Roster scrape failures: dropdown names build_authoritative couldn't resolve to
// a detail page (checked-in roster_failures.tsv). They carry no row — no town,
// crucially no access type — so we can't know if a failure is a public course we
// must ship (like Four Oaks was) or just a members-only club with a stub page
// (most of them are). We can't hard-fail without knowing access, so surface every
// untriaged failure as a loud WARNING each run: it can never vanish silently, and
// a human resolves it by either shipping the course or excusing it in
// _exclude_ma.json (which then drops it from this list).
const failPath = path.join(seedDir, 'roster_failures.tsv');
const failedNames = fs.existsSync(failPath)
  ? fs.readFileSync(failPath, 'utf8').split('\n').slice(1).map((l) => l.trim()).filter(Boolean)
  : [];
const untriagedFailures = failedNames.filter((n) => {
  const s = slug(n);
  return !covered.has(s) && !excused.has(s) && !junkRe.some((re) => re.test(n));
});

// Reverse: catalog courses not in the roster (informational only).
// MA-scoped: the roster is MA-only, so a non-MA catalog course is not an orphan,
// it's simply out of this audit's scope (the catalog is national).
const rosterSlugs = new Set(roster.map((r) => slug(r.name)));
const orphan = catalog.filter((c) => c.state === 'MA' && c.is_public && !rosterSlugs.has(slug(c.name)));

const required = roster.filter((r) => REQUIRED.has(r.access)).length;
console.log(
  `Coverage: ${required} roster courses required, ${covered.size} in catalog, ` +
    `${excusedCount} excused, ${missing.length} MISSING, ${orphan.length} catalog orphans.`
);

if (orphan.length) {
  console.log(`\n${orphan.length} catalog course(s) not in roster (check spelling/classification):`);
  for (const c of orphan.slice(0, 40)) console.log(`  - ${c.name} (${c.town})`);
}

if (untriagedFailures.length) {
  console.warn(
    `\n⚠ ${untriagedFailures.length} directory name(s) in roster_failures.tsv untriaged ` +
      '(scraped no detail page, neither shipped nor excused):'
  );
  for (const n of untriagedFailures) console.warn(`  - ${n}`);
  console.warn(
    '\nThe golfmassachusetts directory lists these but build_authoritative could not fetch a ' +
      'detail page (usually an unguessed URL slug). Triage each: if public, add it to a provider ' +
      'seed; if members-only/closed, add it to _exclude_ma.json (privateClubs/closed/knownGap). ' +
      'Non-fatal — access is unknown for an unscraped course — but it will nag until resolved.'
  );
}

if (missing.length) {
  console.error(`\n✗ ${missing.length} roster course(s) neither covered nor excused:`);
  for (const m of missing) console.error(`  - ${m.name} (${m.town}) [${m.access}]`);
  console.error(
    '\nFix by rebuilding data (npm run build:data adds fallbacks automatically) or, if a ' +
      'course is genuinely uncoverable/closed, add it to _exclude_ma.json closed/knownGap with a reason.'
  );
  process.exit(1);
}

console.log('\n✓ Every required MA course is covered or excused.');
