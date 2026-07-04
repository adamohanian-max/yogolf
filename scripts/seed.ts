/**
 * Rebuild data/courses.db from data/seed/*.json.
 *
 * Each seed file is an array of course records (see lib/types Course, minus
 * `score` which is computed here).
 *
 *   npx tsx scripts/seed.ts
 */
import fs from 'fs';
import path from 'path';
import { getDb, upsertCourse } from '../lib/db';
import { computeScore } from '../lib/score';
import type { Course } from '../lib/types';

type SeedCourse = Omit<Course, 'score'> & { list_bonuses?: number };

const seedDir = path.join(process.cwd(), 'data', 'seed');
const files = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json'));

getDb();
let count = 0;
const ids = new Set<string>();

for (const file of files) {
  const records = JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8')) as SeedCourse[];
  for (const rec of records) {
    if (ids.has(rec.id)) {
      console.warn(`DUPLICATE id '${rec.id}' in ${file} — skipping`);
      continue;
    }
    ids.add(rec.id);
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

console.log(`Seeded ${count} courses from ${files.length} files → data/courses.db`);
