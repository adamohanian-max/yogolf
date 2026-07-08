import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * TeeQuest public booking widget (bookateetime.teequest.com). The embed page
 * `/course/{embedId}` sets a tenant session cookie; the widget then GETs
 * `/search/{courseId}/{yyyy-mm-dd}?selectedPlayers=N&selectedHoles=H` and
 * server-renders one `<div class="tee-time" data-date-time data-price
 * data-available>` per slot. `courseId` is a composite like "116-1"
 * (embedId + tee-sheet index); `embedId` is the bare number in `/course/N`.
 *
 * provider_config: { host?: string; embedId: number; courseId: string }
 *   host defaults to "bookateetime.teequest.com".
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawSlot {
  dateTime: string; // "202607090737" (YYYYMMDDHHmm, course-local)
  price: number | null;
  available: number;
  bookPath: string | null; // "/teetime/116-1/202607090737/1/A/AO/2/18?walking=true"
}

/** One <div class="tee-time" …> block → its data-* attributes + book link. */
function parseSlots(html: string): RawSlot[] {
  const slots: RawSlot[] = [];
  const re = /<div class="tee-time"([^>]*)>([\s\S]*?class="[^"]*book-it-btn[^>]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const dt = /data-date-time="(\d{12})"/.exec(attrs)?.[1];
    if (!dt) continue;
    const priceStr = /data-price="([\d.]+)"/.exec(attrs)?.[1];
    const price = priceStr ? parseFloat(priceStr) : null;
    const available = parseInt(/data-available="(\d+)"/.exec(attrs)?.[1] ?? '0', 10);
    const bookPath = /href="(\/teetime\/[^"]+)"/.exec(m[2])?.[1] ?? null;
    slots.push({ dateTime: dt, price: price && price > 0 ? price : null, available, bookPath });
  }
  return slots;
}

/** "202607090737" → "2026-07-09T07:37:00" (course-local ISO). */
function toIso(dt: string): string {
  return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T${dt.slice(8, 10)}:${dt.slice(10, 12)}:00`;
}

async function search(
  host: string,
  cookie: string,
  courseId: string,
  embedId: number,
  date: string,
  players: number,
  holes: 9 | 18
): Promise<RawSlot[]> {
  const qs = new URLSearchParams({
    selectedPlayers: String(players),
    selectedHoles: String(holes),
  });
  const res = await fetch(`https://${host}/search/${courseId}/${date}?${qs}`, {
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://${host}/course/${embedId}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from teequest`);
  return parseSlots(await res.text());
}

export const teequestAdapter: Adapter = {
  name: 'teequest',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { host?: string; embedId?: number; courseId?: string };
    if (cfg.embedId == null || !cfg.courseId) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const host = cfg.host ?? 'bookateetime.teequest.com';

    // Establish the tenant session cookie via the embed page.
    const view = await fetch(`https://${host}/course/${cfg.embedId}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(9000),
    });
    const cookie = (view.headers.get('set-cookie') ?? '')
      .split(',')
      .map((c) => c.split(';')[0].trim())
      .filter((c) => /=/.test(c))
      .join('; ');

    const wantHoles: (9 | 18)[] = params.holes === 0 ? [18, 9] : [params.holes];
    const slots: TeeTimeSlot[] = [];
    const seen = new Set<string>();
    for (const holes of wantHoles) {
      const raw = await search(host, cookie, cfg.courseId, cfg.embedId, params.date, params.players, holes);
      for (const s of raw) {
        if (s.available < params.players) continue;
        const key = `${s.dateTime}|${holes}`;
        if (seen.has(key)) continue;
        seen.add(key);
        slots.push({
          time: toIso(s.dateTime),
          price: s.price,
          cartPrice: null, // widget quotes the walking rate; cart not itemized
          spots: s.available,
          holes,
          bookingUrl: s.bookPath ? `https://${host}${s.bookPath}` : course.booking_url,
        });
      }
    }
    return slots;
  },
};
