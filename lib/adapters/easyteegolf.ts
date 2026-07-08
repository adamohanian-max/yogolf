import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * EasyTeeGolf (app.easyteegolf.com) public tee-sheet page — plain
 * server-rendered HTML, no login/JS/API key needed. Confirmed live on
 * Ellinwood Country Club.
 *
 *   GET /course/{slug}/?days={N}          -- 18-hole rates
 *   GET /course/{slug}/?days={N}&p=yes     -- same slots, 9-hole rates
 *
 * `days` is an offset from "today" in the course's local date (server-
 * rendered, so compute the offset in America/New_York -- the same slots are
 * listed at both p values, just re-priced/re-labeled per hole count (this
 * course sells the same tee time as either a 9 or 18 hole round).
 *
 * provider_config: { slug: string }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawSlot {
  time: string; // "7:00 AM"
  maxPlayers: number;
  price: number;
  holes: number;
}

function parseSlots(html: string): RawSlot[] {
  const slots: RawSlot[] = [];
  // Each slot is a "list-group-item" div; splitting on the marker (rather than
  // counting closing tags) is robust to the surrounding markup's exact nesting.
  const blocks = html.split('<div class="list-group-item">').slice(1);
  for (const block of blocks) {
    const time = /<h3 class="mb-1 font-weight-bold mt-0">([^<]+)<\/h3>/.exec(block)?.[1];
    const golfers = /<h6 class="text-muted">([^<]+)<\/h6>/.exec(block)?.[1];
    const price = /<h3 class="my-0">\$([\d.]+)<\/h3>/.exec(block)?.[1];
    const holes = /badge-success">(\d+)\s*Holes</.exec(block)?.[1];
    if (!time || !price) continue;
    const maxPlayers = golfers ? Number(golfers.match(/(\d+)(?!.*\d)/)?.[1] ?? 4) : 4;
    slots.push({ time, maxPlayers, price: parseFloat(price), holes: holes ? Number(holes) : 18 });
  }
  return slots;
}

function toIso(date: string, time: string): string | null {
  const tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!tm) return null;
  const [, hh, mm, ap] = tm;
  let h = parseInt(hh, 10) % 12;
  if (ap.toUpperCase() === 'PM') h += 12;
  return `${date}T${String(h).padStart(2, '0')}:${mm}:00`;
}

function daysOffset(date: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
  const today = fmt.format(new Date());
  const a = new Date(today + 'T12:00:00Z').getTime();
  const b = new Date(date + 'T12:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

export const easyteegolfAdapter: Adapter = {
  name: 'easyteegolf',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { slug?: string };
    if (!cfg.slug) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const days = daysOffset(params.date);
    if (days < 0) return [];

    const want9 = params.holes === 9;
    const qs = new URLSearchParams({ days: String(days), ...(want9 ? { p: 'yes' } : {}) });
    const res = await fetch(`https://app.easyteegolf.com/course/${cfg.slug}/?${qs}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from easyteegolf`);
    const html = await res.text();
    const raw = parseSlots(html);

    const slots: TeeTimeSlot[] = [];
    for (const s of raw) {
      if (s.maxPlayers < params.players) continue;
      const time = toIso(params.date, s.time);
      if (!time) continue;
      const holes: TeeTimeSlot['holes'] = s.holes === 9 ? 9 : 18;
      slots.push({
        time,
        price: s.price,
        cartPrice: null,
        spots: s.maxPlayers,
        holes,
        bookingUrl: course.booking_url,
      });
    }
    return slots;
  },
};
