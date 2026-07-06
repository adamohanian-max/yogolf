import { coursesInBox } from './db';
import { haversineMiles, boundingBox } from './distance';
import { getAdapter } from './adapters';
import { cacheGet, cacheSet } from './cache';
import type { AdapterResult, Course, CourseResult, SearchCriteria, TeeTimeSlot } from './types';
import { effectivePrice } from './types';

const ADAPTER_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 120_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('adapter timeout')), ms)),
  ]);
}

async function fetchCourseDate(
  course: Course,
  date: string,
  players: number,
  holes: 9 | 18 | 0
): Promise<AdapterResult> {
  const key = `tt:${course.id}:${date}:${players}:${holes}`;
  const hit = cacheGet<AdapterResult>(key);
  if (hit !== undefined) return hit;
  const adapter = getAdapter(course.provider);
  const result = await withTimeout(
    adapter.fetchTeeTimes(course, { date, players, holes }),
    ADAPTER_TIMEOUT_MS
  );
  cacheSet(key, result, CACHE_TTL_MS);
  return result;
}

export function coursesForCriteria(c: SearchCriteria): { course: Course; distanceMiles: number }[] {
  const box = boundingBox(c.lat, c.lng, c.radiusMiles);
  return coursesInBox(box.minLat, box.maxLat, box.minLng, box.maxLng)
    .map((course) => ({
      course,
      distanceMiles: haversineMiles(c.lat, c.lng, course.lat, course.lng),
    }))
    .filter((x) => x.distanceMiles <= c.radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

function inTimeRange(iso: string, start: string, end: string): boolean {
  const hm = iso.slice(11, 16);
  return hm >= start && hm <= end;
}

export function filterSlots(slots: TeeTimeSlot[], c: SearchCriteria): TeeTimeSlot[] {
  return slots
    .filter((s) => s.spots >= c.players)
    .filter((s) => c.holes === 0 || s.holes === c.holes || s.holes === 0)
    .filter((s) => inTimeRange(s.time, c.timeStart, c.timeEnd))
    .filter((s) => {
      if (c.maxPrice == null) return true;
      const p = effectivePrice(s, c.ride);
      return p == null || p <= c.maxPrice; // price for the selected ride mode
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Fetch one course across all requested dates, merge + filter slots. */
export async function resolveCourse(
  entry: { course: Course; distanceMiles: number },
  c: SearchCriteria
): Promise<CourseResult> {
  const { course, distanceMiles } = entry;
  const base = {
    course: {
      id: course.id,
      name: course.name,
      town: course.town,
      state: course.state,
      lat: course.lat,
      lng: course.lng,
      website: course.website,
      booking_url: course.booking_url,
      google_rating: course.google_rating,
      google_reviews: course.google_reviews,
      score: course.score,
      holes_total: course.holes_total,
      provider: course.provider,
    },
    distanceMiles: Math.round(distanceMiles * 10) / 10,
  };

  if (course.provider === 'fallback') {
    return { ...base, slots: [], unavailable: true };
  }

  try {
    const results = await Promise.all(
      c.dates.map((d) => fetchCourseDate(course, d, c.players, c.holes))
    );
    const slots: TeeTimeSlot[] = [];
    let sawLive = false;
    for (const r of results) {
      if (Array.isArray(r)) {
        sawLive = true;
        slots.push(...r);
      }
    }
    if (!sawLive) return { ...base, slots: [], unavailable: true };
    return { ...base, slots: filterSlots(slots, c), unavailable: false };
  } catch (e) {
    return { ...base, slots: [], unavailable: true, error: String(e) };
  }
}

export function sortResults(
  results: CourseResult[],
  sort: SearchCriteria['sort'],
  ride: SearchCriteria['ride'] = 'any'
): CourseResult[] {
  const cheapest = (r: CourseResult) => {
    const prices = r.slots.map((s) => effectivePrice(s, ride)).filter((p): p is number => p != null);
    return prices.length ? Math.min(...prices) : Infinity;
  };
  const copy = [...results];
  switch (sort) {
    case 'nearest':
      return copy.sort((a, b) => a.distanceMiles - b.distanceMiles);
    case 'price_asc':
      return copy.sort((a, b) => cheapest(a) - cheapest(b));
    case 'price_desc':
      return copy.sort((a, b) => {
        const pa = cheapest(a);
        const pb = cheapest(b);
        if (pa === Infinity && pb === Infinity) return 0;
        if (pa === Infinity) return 1;
        if (pb === Infinity) return -1;
        return pb - pa;
      });
    case 'best':
      return copy.sort((a, b) => b.course.score - a.course.score);
  }
}
