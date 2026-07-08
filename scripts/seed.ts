/**
 * Rebuild data/courses.db from data/seed/*.json.
 *
 * Course files are arrays of course records (see lib/types Course, minus
 * `score`). Files named ratings_*.json are override tables keyed by course
 * name+town; their values (golfpass_rating, google_rating, review counts,
 * list_bonus) are merged onto matching course records before scoring.
 *
 *   npx tsx scripts/seed.ts
 */
import fs from 'fs';
import path from 'path';
import { getDb, upsertCourse } from '../lib/db';
import { computeScore } from '../lib/score';
import { sameCourse } from '../lib/dedupe';
import type { Course } from '../lib/types';

type SeedCourse = Omit<Course, 'score'> & { list_bonuses?: number };

interface RatingOverride {
  name: string;
  town?: string;
  google_rating?: number;
  google_reviews?: number;
  golfpass_rating?: number;
  list_bonus?: number;
  website?: string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// ---- Duplicate detection ------------------------------------------------
// Distinct records can describe the same physical course under different names
// or from different providers (e.g. "Merrimack Valley Golf Course" via TeeItUp
// and "Merrimack Golf Course" as a directory fallback). We collapse those,
// always keeping the live/easy-to-book record over a booking-link-only fallback.
// The same-course test lives in lib/dedupe (shared with the coverage audit).

/** Higher wins when two records collapse. Live tee times beat fallback links. */
function keepScore(r: SeedCourse): number {
  let s = 0;
  if (r.provider !== 'fallback') s += 100; // easy-to-book live course stays
  if (r.address) s += 10;
  if (r.google_rating != null || r.golfpass_rating != null) s += 5;
  if (r.website) s += 2;
  return s;
}
/** Fill blanks on the kept record from a dropped duplicate — lose no data. */
function backfill(keep: SeedCourse, drop: SeedCourse): void {
  keep.address ??= drop.address ?? null;
  keep.phone ??= drop.phone ?? null;
  keep.website ??= drop.website ?? null;
  keep.zip ??= drop.zip ?? null;
  if (keep.google_rating == null && drop.google_rating != null) {
    keep.google_rating = drop.google_rating;
    keep.google_reviews = drop.google_reviews ?? keep.google_reviews;
  }
  if (keep.golfpass_rating == null && drop.golfpass_rating != null) keep.golfpass_rating = drop.golfpass_rating;
}

const seedDir = path.join(process.cwd(), 'data', 'seed');
const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json'));

// Public-courses-only enforcement: junk/test/duplicate accounts and known
// members-only clubs are dropped here regardless of which seed file they came
// from. Semi-private courses that sell public tee times are kept.
interface ExcludeConfig {
  junkPatterns: string[];
  duplicateIds: string[];
  privateClubs: string[];
}
let exclude: ExcludeConfig = { junkPatterns: [], duplicateIds: [], privateClubs: [] };
const excludePath = path.join(seedDir, '_exclude_ma.json');
if (fs.existsSync(excludePath)) exclude = JSON.parse(fs.readFileSync(excludePath, 'utf8'));
const junkRe = exclude.junkPatterns.map((p) => new RegExp(p, 'i'));
const privateSet = new Set(exclude.privateClubs.map((n) => n.toLowerCase().trim()));
const duplicateIdSet = new Set(exclude.duplicateIds);

function excludedReason(rec: { id: string; name: string }): string | null {
  if (duplicateIdSet.has(rec.id)) return 'duplicate';
  if (privateSet.has(rec.name.toLowerCase().trim())) return 'private';
  for (const re of junkRe) if (re.test(rec.name)) return `junk (${re.source})`;
  return null;
}

// Load rating overrides first.
const overrides = new Map<string, RatingOverride>();
for (const file of files) {
  if (!file.startsWith('ratings_')) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8')) as {
    courses: RatingOverride[];
  };
  // Merge per-field: a later file must not wipe fields it doesn't carry
  // (e.g. ratings_ma.json has only golfpass fields and would otherwise
  // discard google_rating loaded from ratings_google_ma.json).
  for (const o of doc.courses ?? []) {
    const key = slug(o.name);
    overrides.set(key, { ...overrides.get(key), ...o });
  }
}

function applyOverride(rec: SeedCourse): RatingOverride | undefined {
  return overrides.get(slug(rec.name));
}

getDb();
// Rebuild from scratch: upsert alone can't remove rows that were dropped as
// duplicates/excludes since the last run, which would leave stale courses behind.
getDb().prepare('DELETE FROM courses').run();
let enriched = 0;
let excludedCount = 0;

// Collect every record, then dedupe by id preferring a live provider over a
// fallback (file order is alphabetical and shouldn't decide which wins).
const chosen = new Map<string, SeedCourse>();
const isFallback = (r: SeedCourse) => r.provider === 'fallback';
for (const file of files) {
  if (file.startsWith('ratings_') || file.startsWith('_') || file.startsWith('.')) continue;
  const records = JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8')) as SeedCourse[];
  for (const rec of records) {
    if (excludedReason(rec)) {
      excludedCount++;
      continue;
    }
    const existing = chosen.get(rec.id);
    if (!existing) {
      chosen.set(rec.id, rec);
    } else if (isFallback(existing) && !isFallback(rec)) {
      chosen.set(rec.id, rec); // upgrade fallback → live provider
    }
    // else keep existing (first live wins; fallback never overrides live)
  }
}

// Second-pass dedupe: collapse records that are the same physical course under
// different names/providers. Group by town (dups are effectively always in the
// same town) and greedily merge, keeping the higher-priority (live) record.
const byTown = new Map<string, SeedCourse[]>();
for (const rec of chosen.values()) {
  const t = (rec.town ?? '').toLowerCase().trim();
  (byTown.get(t) ?? byTown.set(t, []).get(t)!).push(rec);
}
const deduped: SeedCourse[] = [];
let mergedCount = 0;
for (const group of byTown.values()) {
  const kept: SeedCourse[] = [];
  for (const rec of group) {
    const match = kept.find((k) => sameCourse(k, rec));
    if (!match) {
      kept.push(rec);
      continue;
    }
    mergedCount++;
    // Decide winner; backfill its blanks from the loser, then swap in place if
    // the incoming record outranks the one already kept.
    if (keepScore(rec) > keepScore(match)) {
      backfill(rec, match);
      kept[kept.indexOf(match)] = rec;
      console.log(`  merged duplicate: kept "${rec.name}" over "${match.name}" (${rec.town})`);
    } else {
      backfill(match, rec);
      console.log(`  merged duplicate: kept "${match.name}" over "${rec.name}" (${rec.town})`);
    }
  }
  deduped.push(...kept);
}

let count = 0;
for (const rec of deduped) {
  const ov = applyOverride(rec);
  if (ov) {
    enriched++;
    if (ov.google_rating != null) rec.google_rating = ov.google_rating;
    if (ov.google_reviews != null) rec.google_reviews = ov.google_reviews;
    if (ov.golfpass_rating != null) rec.golfpass_rating = ov.golfpass_rating;
    if (ov.list_bonus != null) rec.list_bonuses = ov.list_bonus;
    // Only fill website when the course has none — a live provider's own URL wins.
    if (ov.website && !rec.website) rec.website = ov.website;
  }
  const score = computeScore({
    googleRating: rec.google_rating,
    googleReviews: rec.google_reviews,
    golfpassRating: rec.golfpass_rating,
    listBonuses: rec.list_bonuses ?? 0,
  });
  upsertCourse({ ...rec, score });
  count++;
}

console.log(
  `Seeded ${count} courses (${enriched} rating-enriched, ${excludedCount} excluded as private/junk/dup, ` +
    `${mergedCount} duplicates merged) from ${files.length} files → data/courses.db`
);
