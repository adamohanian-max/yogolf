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
import type { Course } from '../lib/types';

type SeedCourse = Omit<Course, 'score'> & { list_bonuses?: number };

interface RatingOverride {
  name: string;
  town?: string;
  google_rating?: number;
  google_reviews?: number;
  golfpass_rating?: number;
  list_bonus?: number;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

const seedDir = path.join(process.cwd(), 'data', 'seed');
const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json'));

// Load rating overrides first.
const overrides = new Map<string, RatingOverride>();
for (const file of files) {
  if (!file.startsWith('ratings_')) continue;
  const doc = JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8')) as {
    courses: RatingOverride[];
  };
  for (const o of doc.courses ?? []) overrides.set(slug(o.name), o);
}

function applyOverride(rec: SeedCourse): RatingOverride | undefined {
  return overrides.get(slug(rec.name));
}

getDb();
let count = 0;
let enriched = 0;
const ids = new Set<string>();

for (const file of files) {
  if (file.startsWith('ratings_') || file.startsWith('_')) continue;
  const records = JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8')) as SeedCourse[];
  for (const rec of records) {
    if (ids.has(rec.id)) {
      console.warn(`DUPLICATE id '${rec.id}' in ${file} — skipping`);
      continue;
    }
    ids.add(rec.id);

    const ov = applyOverride(rec);
    if (ov) {
      enriched++;
      if (ov.google_rating != null) rec.google_rating = ov.google_rating;
      if (ov.google_reviews != null) rec.google_reviews = ov.google_reviews;
      if (ov.golfpass_rating != null) rec.golfpass_rating = ov.golfpass_rating;
      if (ov.list_bonus != null) rec.list_bonuses = ov.list_bonus;
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
}

console.log(
  `Seeded ${count} courses (${enriched} rating-enriched) from ${files.length} files → data/courses.db`
);
