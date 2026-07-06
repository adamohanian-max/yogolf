import { NextRequest } from 'next/server';
import { getCourse } from '@/lib/db';
import { resolveCourse } from '@/lib/search';
import { haversineMiles } from '@/lib/distance';
import type { SearchCriteria } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_DATES = 7;

/**
 * Live tee times for a single course by id, regardless of location.
 * Backs whole-catalog course search (picking a course outside the radius results).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const id = q.get('id');
  if (!id) return json({ error: 'id required' }, 400);

  const course = getCourse(id);
  if (!course) return json({ error: 'course not found' }, 404);

  const players = Math.min(4, Math.max(1, parseInt(q.get('players') ?? '2', 10)));
  const holesRaw = q.get('holes') ?? 'both';
  const holes = holesRaw === '9' ? 9 : holesRaw === '18' ? 18 : 0;

  const dateFrom = q.get('dateFrom') ?? new Date().toISOString().slice(0, 10);
  const dateTo = q.get('dateTo') ?? dateFrom;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return json({ error: 'dates must be YYYY-MM-DD' }, 400);
  }
  const dates: string[] = [];
  const d = new Date(dateFrom + 'T12:00:00');
  const end = new Date(dateTo + 'T12:00:00');
  while (d <= end && dates.length < MAX_DATES) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  if (dates.length === 0) return json({ error: 'dateTo must be on/after dateFrom' }, 400);

  const timeStart = q.get('timeStart') ?? '05:00';
  const timeEnd = q.get('timeEnd') ?? '20:00';
  const maxPriceRaw = q.get('maxPrice');
  const maxPrice = maxPriceRaw ? parseFloat(maxPriceRaw) : null;
  const rideRaw = q.get('ride') ?? 'any';
  const ride = (['any', 'walking', 'cart'] as const).includes(rideRaw as never)
    ? (rideRaw as SearchCriteria['ride'])
    : 'any';

  const lat = parseFloat(q.get('lat') ?? '');
  const lng = parseFloat(q.get('lng') ?? '');
  const hasOrigin = isFinite(lat) && isFinite(lng);
  const distanceMiles = hasOrigin ? haversineMiles(lat, lng, course.lat, course.lng) : -1;

  const criteria: SearchCriteria = {
    lat: hasOrigin ? lat : course.lat,
    lng: hasOrigin ? lng : course.lng,
    radiusMiles: 1,
    players,
    dates,
    timeStart,
    timeEnd,
    maxPrice,
    holes,
    ride,
    sort: 'nearest',
  };

  const result = await resolveCourse({ course, distanceMiles }, criteria);
  return json({ result }, 200);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
