/**
 * Second-source coverage cross-check: reconcile the catalog against golflink.com,
 * a directory INDEPENDENT of golfmassachusetts.com (our only roster source).
 *
 *   npx tsx scripts/second_source_audit.ts
 *
 * The forward audit can only guarantee coverage of courses the golfmassachusetts
 * roster lists — so a course that directory omits entirely is invisible to it
 * (this is exactly why Quail Ridge in Acton was missing for so long: Acton has no
 * golfmassachusetts listing at all). A second, independently-compiled directory
 * closes that blind spot: anything golflink lists that we don't ship and haven't
 * excused is a candidate gap a human should triage (add it, or excuse it as
 * private/closed/no-online-booking, the same way roster_failures.tsv is handled).
 *
 * golflink has no master town index, so we drive the crawl from data/ma_towns.tsv
 * (the same MA town list build_authoritative uses) — one city page per town. Live
 * and best-effort: a REPORT, not a build gate. Expect noise (private clubs,
 * driving ranges, closed courses, duplicate listings); triage, don't auto-add.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const root = process.cwd();
const seedDir = path.join(root, 'data', 'seed');

/** Normalized key for matching, identical to scripts/audit_coverage.ts slug(). */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function townSlug(t: string): string {
  return t.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

// ---- What we already ship / excuse -----------------------------------------
function shippedKeys(): Set<string> {
  const db = new Database(path.join(root, 'data', 'courses.db'), { readonly: true });
  try {
    const rows = db.prepare("SELECT name FROM courses WHERE state='MA'").all() as { name: string }[];
    return new Set(rows.map((r) => slug(r.name)));
  } finally {
    db.close();
  }
}

function excusedKeys(): Set<string> {
  const cfg = JSON.parse(fs.readFileSync(path.join(seedDir, '_exclude_ma.json'), 'utf8')) as {
    privateClubs?: string[];
    closed?: ({ name: string } | string)[];
    knownGap?: ({ name: string } | string)[];
  };
  const out = new Set<string>();
  for (const n of cfg.privateClubs ?? []) out.add(slug(n));
  for (const key of ['closed', 'knownGap'] as const)
    for (const e of cfg[key] ?? []) out.add(slug(typeof e === 'string' ? e : e.name));
  return out;
}

function maTowns(): string[] {
  return fs
    .readFileSync(path.join(root, 'data', 'ma_towns.tsv'), 'utf8')
    .split('\n')
    .map((l) => l.split('\t')[0]?.trim())
    .filter(Boolean);
}

async function main() {
  const shipped = shippedKeys();
  const excused = excusedKeys();
  const towns = maTowns();
  console.log(`Cross-checking golflink.com across ${towns.length} MA towns (catalog: ${shipped.size} shipped)…`);

  // town slug → set of course {name} found on golflink's page for that town.
  const found = new Map<string, { name: string; town: string }>();
  let pagesWithCourses = 0;

  await pool(towns, 10, async (town) => {
    const ts = townSlug(town);
    const html = await fetchText(`https://www.golflink.com/golf-courses/ma/${ts}`);
    if (!html) return;
    // Course-detail anchors on a city page: /golf-courses/ma/{town}/{slug} → name.
    const re = new RegExp(`href="/golf-courses/ma/${ts}/[a-z0-9-]+"[^>]*>([^<]{3,70})</a>`, 'g');
    let any = false;
    for (const m of html.matchAll(re)) {
      // golflink anchor text is "Club Name, Subcourse Course" — keep the club
      // name before the comma, else the trailing "…, X Course" defeats slug
      // matching (a shipped course reads as a false candidate).
      const name = m[1].replace(/&amp;/g, '&').split(',')[0].trim();
      // Skip golflink's own nav/utility links that slip through the pattern.
      if (/^(book|find|view|see|more|golf courses?|tee times?)\b/i.test(name)) continue;
      const k = slug(name);
      if (!k) continue;
      any = true;
      if (!found.has(k)) found.set(k, { name, town });
    }
    if (any) pagesWithCourses++;
  });

  console.log(`  ${found.size} distinct courses listed across ${pagesWithCourses} town pages with results`);

  // Candidates: golflink lists it, we neither ship nor excuse it.
  const candidates = [...found.values()]
    .filter((c) => !shipped.has(slug(c.name)) && !excused.has(slug(c.name)))
    .sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name));

  if (!candidates.length) {
    console.log('\n✓ Every golflink course is already shipped or excused.');
    return;
  }
  console.log(`\n⚠ ${candidates.length} golflink course(s) not in the catalog and not excused (triage — expect private/range/closed/duplicate noise):`);
  for (const c of candidates) console.log(`  - ${c.name} (${c.town})`);
  console.log(
    '\nFor each: if it is a public course with online booking, add it to a provider seed; ' +
      'otherwise excuse it in _exclude_ma.json (privateClubs/closed/knownGap) with a reason.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
