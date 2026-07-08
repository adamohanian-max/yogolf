import { cacheGet, cacheSet } from './cache';

/**
 * Road driving time (minutes) from an origin to each course, via the keyless
 * OSRM public table service — one request for the whole set. No live traffic,
 * so this is a typical free-flow drive time. Unroutable points (islands) and
 * any OSRM failure yield null / absent entries, so search never breaks.
 */

const OSRM = 'https://router.project-osrm.org/table/v1/driving';
const TTL_MS = 15 * 60_000;
const MAX_COORDS = 100; // keep the URL well under limits; chunk beyond this

interface LatLng {
  lat: number;
  lng: number;
}
interface CoursePoint extends LatLng {
  id: string;
}

async function osrmTable(origin: LatLng, courses: CoursePoint[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  // OSRM wants lng,lat; source index 0 is the origin.
  const coords = [origin, ...courses].map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM}/${coords}?sources=0&annotations=duration`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YoGolf/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return out;
    const json = (await res.json()) as { code?: string; durations?: (number | null)[][] };
    if (json.code !== 'Ok' || !json.durations?.[0]) return out;
    const row = json.durations[0]; // seconds from origin to [origin, ...courses]
    courses.forEach((c, i) => {
      const secs = row[i + 1]; // +1 skips the origin→origin (0) entry
      out.set(c.id, typeof secs === 'number' ? Math.round(secs / 60) : null);
    });
  } catch {
    // OSRM down / timeout → leave map empty; caller treats as "no drive time"
  }
  return out;
}

export async function driveMinutes(
  origin: LatLng,
  courses: CoursePoint[]
): Promise<Map<string, number | null>> {
  if (courses.length === 0) return new Map();

  const ids = courses.map((c) => c.id).sort();
  const key = `drive:${origin.lat.toFixed(3)}:${origin.lng.toFixed(3)}:${ids.length}:${ids[0]}:${ids[ids.length - 1]}`;
  const cached = cacheGet<Map<string, number | null>>(key);
  if (cached) return cached;

  const merged = new Map<string, number | null>();
  for (let i = 0; i < courses.length; i += MAX_COORDS) {
    const chunk = courses.slice(i, i + MAX_COORDS);
    const m = await osrmTable(origin, chunk);
    for (const [id, v] of m) merged.set(id, v);
  }
  cacheSet(key, merged, TTL_MS);
  return merged;
}
