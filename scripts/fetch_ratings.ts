export {};

/**
 * Google Places ratings backfill.
 *
 * For every course in data/courses.db, ask the Google Places API (New) for its
 * rating + review count, verify the returned place is actually the course (name
 * similarity + geographic distance, not just "nearest golf-ish thing"), and
 * write the confirmed matches to data/seed/ratings_google_ma.json — the same
 * ratings_*.json override format scripts/seed.ts already merges by slug(name).
 *
 * Re-run scripts/seed.ts afterwards to fold the ratings in and re-score.
 *
 *   GOOGLE_MAPS_API_KEY=... npx tsx scripts/fetch_ratings.ts [flags]
 *
 * Flags:
 *   --all         re-query every course (default: only those missing a google_rating)
 *   --refresh     ignore the response cache and re-hit the API
 *   --limit N     stop after N API lookups (for testing / bill control)
 *   --dry-run     do everything except write the override file
 *
 * Raw responses are cached in data/seed/.ratings_cache.json so re-runs are free
 * and resumable — delete it (or pass --refresh) to force fresh lookups.
 */
import fs from 'fs';
import path from 'path';
import { allCourses } from '../lib/db';
import { haversineMiles } from '../lib/distance';
import type { Course } from '../lib/types';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;

const args = new Set(process.argv.slice(2));
const argVal = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ONLY_MISSING = !args.has('--all');
const REFRESH = args.has('--refresh');
const DRY_RUN = args.has('--dry-run');
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit')!, 10) : Infinity;

// A returned place must be within this radius of our known coordinates and share
// enough of the name to count as the same course. Roster stub coordinates are
// often town-level (miles off the real clubhouse), so the allowed distance scales
// with name confidence: a near-identical name carries a far-off point, while a
// weak name match must be almost on top of us. Name is the primary signal.
const STRONG_SIM = 0.6; // near-identical name → trust it up to STRONG_MILES away
const STRONG_MILES = 15.0;
const NAME_SIM_MIN = 0.34; // Jaccard over significant name tokens
const MEDIUM_MILES = 6.0; // medium name match must be within this
const CLOSE_MILES = 0.4; // very close hit: accept even on a weak name match
const STRONG_CONTAIN = 0.75; // one name is essentially a subset of the other
// When the name is a strong subset AND Google places it in the same state, trust
// it even if our stored coords are far off (many roster stubs have town-level or
// plain wrong coordinates). Capped so a same-named course statewide can't match.
const STATE_MILES = 80.0;

const seedDir = path.join(process.cwd(), 'data', 'seed');
// Cache lives outside the seed dir on purpose: seed.ts loads every file in
// data/seed as course data, so a stray non-course JSON there crashes it.
const cachePath = path.join(process.cwd(), 'data', '.ratings_cache.json');
const outPath = path.join(seedDir, 'ratings_google_ma.json');

// slug() must match scripts/seed.ts so our output keys line up with how the seed
// looks overrides up. Keep in sync if that one changes.
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

const STOP = new Set([
  'golf', 'club', 'course', 'country', 'the', 'at', 'links', 'cc', 'gc', 'and', 'of',
]);
function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
  );
}
export function intersect(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter;
}
export function nameSim(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = intersect(ta, tb);
  return inter / (ta.size + tb.size - inter); // Jaccard
}
// Overlap/containment coefficient: inter / smaller set. High when one name is
// essentially a subset of the other — e.g. "Norwood Country Club" vs Google's
// "Norwood Country Club & Driving Range", which Jaccard unfairly penalises.
export function nameContain(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  return intersect(ta, tb) / Math.min(ta.size, tb.size);
}

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  websiteUri?: string;
}
interface PlacesResponse {
  places?: PlacesPlace[];
  error?: { message?: string; status?: string };
}

type Cache = Record<string, PlacesResponse>;
const cache: Cache = (() => {
  if (REFRESH) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Cache;
  } catch {
    return {};
  }
})();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchPlaces(course: Course): Promise<PlacesResponse> {
  if (!REFRESH && cache[course.id]) return cache[course.id];

  // NB: do NOT set includedType:'golf_course' — it paradoxically drops the real
  // course from results (many courses' primary Google type isn't golf_course),
  // surfacing a wrong neighbour instead. The "golf" text + name gate disambiguate.
  const body = {
    textQuery: `${course.name} golf ${course.town} ${course.state}`,
    maxResultCount: 5,
    languageCode: 'en',
    locationBias: {
      circle: {
        center: { latitude: course.lat, longitude: course.lng },
        radius: 30000, // 30km — bias, not a hard filter
      },
    },
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY!,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.rating,places.userRatingCount,places.location,places.formattedAddress,places.websiteUri',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      const wait = 500 * 2 ** attempt;
      console.warn(`  rate/5xx (HTTP ${res.status}) — retry in ${wait}ms`);
      await sleep(wait);
      continue;
    }
    const json = (await res.json()) as PlacesResponse;
    if (!res.ok) {
      throw new Error(`Places HTTP ${res.status}: ${json.error?.message ?? 'unknown'}`);
    }
    cache[course.id] = json;
    return json;
  }
  throw new Error('Places API: exhausted retries');
}

interface Match {
  place: PlacesPlace;
  distanceMiles: number;
  sim: number;
}
export function bestMatch(course: Course, resp: PlacesResponse): Match | null {
  let best: Match | null = null;
  for (const p of resp.places ?? []) {
    if (p.rating == null || p.userRatingCount == null) continue;
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (lat == null || lng == null) continue;
    const distanceMiles = haversineMiles(course.lat, course.lng, lat, lng);
    const name = p.displayName?.text ?? '';
    const sim = nameSim(course.name, name);
    const contain = nameContain(course.name, name);
    const inState = new RegExp(`,\\s*${course.state}\\b`).test(p.formattedAddress ?? '');
    const strongName = contain >= STRONG_CONTAIN;
    const accept =
      (strongName && inState && distanceMiles <= STATE_MILES) ||
      (sim >= STRONG_SIM && distanceMiles <= STRONG_MILES) ||
      (sim >= NAME_SIM_MIN && distanceMiles <= MEDIUM_MILES) ||
      (strongName && distanceMiles <= MEDIUM_MILES) ||
      distanceMiles <= CLOSE_MILES;
    if (!accept) continue;
    // Rank on best available name confidence, then proximity.
    const rank = Math.max(sim, contain);
    if (!best || rank > best.sim || (rank === best.sim && distanceMiles < best.distanceMiles)) {
      best = { place: p, distanceMiles, sim: rank };
    }
  }
  return best;
}

interface Override {
  name: string;
  town: string;
  google_rating: number;
  google_reviews: number;
  website?: string; // Places websiteUri — backfills course.website for provider detection
  _match?: string; // provenance, ignored by seed
}

async function main() {
  if (!API_KEY) {
    console.error(
      'Missing API key. Set GOOGLE_MAPS_API_KEY (Places API New must be enabled on the key).'
    );
    process.exit(1);
  }
  const courses = allCourses().filter((c) => c.state === 'MA');
  const targets = ONLY_MISSING ? courses.filter((c) => c.google_rating == null) : courses;
  console.log(
    `${courses.length} MA courses; ${targets.length} to look up (${ONLY_MISSING ? 'missing-only' : 'all'})` +
      (Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : '')
  );

  const overrides: Override[] = [];
  const seenSlug = new Map<string, string>(); // slug -> course name, collision guard
  const unmatched: string[] = [];
  let looked = 0;
  let consecutiveErrors = 0;

  for (const c of targets) {
    if (looked >= LIMIT) break;
    let resp: PlacesResponse;
    const cached = !REFRESH && !!cache[c.id];
    try {
      resp = await searchPlaces(c);
      consecutiveErrors = 0;
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`  ERR ${c.name} (${c.town}): ${msg}`);
      unmatched.push(`${c.name} — ${msg}`);
      // Bail on a misconfigured key/project instead of hammering all 235 courses:
      // auth/enablement failures (401/403) or invalid-key 400s won't fix themselves
      // mid-run, so five in a row means stop.
      if (/HTTP (401|403)\b/.test(msg) || /API key not valid/i.test(msg)) {
        if (++consecutiveErrors >= 5) {
          console.error(
            `\n✗ Aborting: ${consecutiveErrors} consecutive auth/config failures. Fix the key or ` +
              `enable Places API (New), then retry.`
          );
          break;
        }
      }
      continue;
    }
    if (!cached) {
      looked++;
      await sleep(120); // ~8 req/s, gentle on quota
    }

    const m = bestMatch(c, resp);
    if (!m) {
      unmatched.push(`${c.name} (${c.town})`);
      continue;
    }

    const sl = slug(c.name);
    if (seenSlug.has(sl)) {
      console.warn(`  SLUG COLLISION "${sl}": ${c.name} vs ${seenSlug.get(sl)} — skipping later`);
      unmatched.push(`${c.name} (${c.town}) — slug collision`);
      continue;
    }
    seenSlug.set(sl, c.name);

    overrides.push({
      name: c.name,
      town: c.town,
      google_rating: m.place.rating!,
      google_reviews: m.place.userRatingCount!,
      ...(m.place.websiteUri ? { website: m.place.websiteUri } : {}),
      _match: `${m.place.displayName?.text} @${m.distanceMiles.toFixed(2)}mi sim${m.sim.toFixed(2)}`,
    });
  }

  // Persist cache regardless, so partial progress is never lost.
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  console.log(
    `\nMatched ${overrides.length}/${targets.length}. Unmatched: ${unmatched.length}.` +
      (unmatched.length ? `\n  ${unmatched.slice(0, 40).join('\n  ')}` : '')
  );

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing override file.');
    return;
  }

  const doc = {
    _comment:
      'Google Places ratings, generated by scripts/fetch_ratings.ts. Merged by slug(name) in seed.ts. Regenerate; do not hand-edit.',
    generatedAt: new Date().toISOString(),
    courses: overrides,
  };
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  console.log(`Wrote ${overrides.length} overrides → ${path.relative(process.cwd(), outPath)}`);
  console.log('Next: npx tsx scripts/seed.ts');
}

// Only run the pipeline when invoked directly; importing the module (e.g. from a
// test) just pulls in the pure helpers above.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
