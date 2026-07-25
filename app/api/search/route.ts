import { NextRequest } from 'next/server';
import { coursesForCriteria, resolveCourse, listCourse } from '@/lib/search';
import { driveMinutes } from '@/lib/drivetime';
import type { SearchCriteria } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_DATES = 7;
// Live tee-time lookups fan out one provider request per course per date, so we
// only do them for the nearest LIVE_FETCH courses. Every other course in radius
// (up to MAX_LISTED) is still returned as a booking-link listing, so a wider
// radius surfaces more courses instead of silently capping at the same set.
const LIVE_FETCH = 60;
const MAX_LISTED = 300;

function parseCriteria(req: NextRequest): SearchCriteria | { error: string } {
  const q = req.nextUrl.searchParams;
  const lat = parseFloat(q.get('lat') ?? '');
  const lng = parseFloat(q.get('lng') ?? '');
  if (!isFinite(lat) || !isFinite(lng)) return { error: 'lat/lng required' };

  const radiusMiles = Math.min(100, Math.max(1, parseFloat(q.get('radius') ?? '25')));
  const players = Math.min(4, Math.max(1, parseInt(q.get('players') ?? '2', 10)));
  const holesRaw = q.get('holes') ?? 'both';
  const holes = holesRaw === '9' ? 9 : holesRaw === '18' ? 18 : 0;

  const dateFrom = q.get('dateFrom') ?? new Date().toISOString().slice(0, 10);
  const dateTo = q.get('dateTo') ?? dateFrom;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return { error: 'dates must be YYYY-MM-DD' };
  }
  const dates: string[] = [];
  const d = new Date(dateFrom + 'T12:00:00');
  const end = new Date(dateTo + 'T12:00:00');
  while (d <= end && dates.length < MAX_DATES) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  if (dates.length === 0) return { error: 'dateTo must be on/after dateFrom' };

  const timeStart = q.get('timeStart') ?? '05:00';
  const timeEnd = q.get('timeEnd') ?? '20:00';
  const maxPriceRaw = q.get('maxPrice');
  const maxPrice = maxPriceRaw ? parseFloat(maxPriceRaw) : null;

  const sortRaw = q.get('sort') ?? 'nearest';
  const sort = (['nearest', 'drive', 'price_asc', 'price_desc'] as const).includes(
    sortRaw as never
  )
    ? (sortRaw as SearchCriteria['sort'])
    : 'nearest';

  const rideRaw = q.get('ride') ?? 'any';
  const ride = (['any', 'walking', 'cart'] as const).includes(rideRaw as never)
    ? (rideRaw as SearchCriteria['ride'])
    : 'any';

  return { lat, lng, radiusMiles, players, dates, timeStart, timeEnd, maxPrice, holes, ride, sort };
}

/**
 * Streams NDJSON: first line is {type:'meta', total}, then one
 * {type:'course', result} line per course as its adapters resolve.
 * The client sorts; streaming keeps first paint fast.
 */
export async function GET(req: NextRequest) {
  const criteria = parseCriteria(req);
  if ('error' in criteria) {
    return new Response(JSON.stringify({ error: criteria.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const inRadius = coursesForCriteria(criteria).slice(0, MAX_LISTED);
  const liveEntries = inRadius.slice(0, LIVE_FETCH);
  const listEntries = inRadius.slice(LIVE_FETCH);
  const encoder = new TextEncoder();

  // Road driving times for the live (nearest) set only — the listing-only
  // courses are booking links, so a drive time adds little and OSRM shouldn't be
  // asked for hundreds of points per search.
  const driveMapP = driveMinutes(
    { lat: criteria.lat, lng: criteria.lng },
    liveEntries.map((e) => ({ id: e.course.id, lat: e.course.lat, lng: e.course.lng }))
  );

  const stream = new ReadableStream({
    async start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      write({ type: 'meta', total: inRadius.length, criteria });

      // Listing-only courses need no provider call — emit them right away.
      for (const entry of listEntries) {
        write({ type: 'course', result: listCourse(entry) });
      }

      // Live tee-time courses resolve concurrently, emitted in completion order.
      await Promise.all(
        liveEntries.map(async (entry) => {
          const [result, driveMap] = await Promise.all([resolveCourse(entry, criteria), driveMapP]);
          result.driveMinutes = driveMap.get(entry.course.id) ?? null;
          write({ type: 'course', result });
        })
      );
      write({ type: 'done' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
