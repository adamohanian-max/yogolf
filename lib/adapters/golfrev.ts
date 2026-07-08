import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * GolfRev (classic ASP, `golfrev.com`) public tee-sheet widget — the AJAX call
 * the "book a tee time" page's date picker makes:
 *   GET /go/tee_times/teetime_table_html.asp?c={courseId}&s={date}&h={htc}&specials=&reset=yes&snapshot=no
 * returns an HTML fragment, one `<div class="card ...">` per slot, with a
 * `showBooking(date, hid, hour, minute, maxPlayers, ...)` onclick and the
 * visible card text carrying the real price/holes/player-count — no login
 * needed to see availability. Confirmed live on Southborough Golf Club.
 *
 * provider_config: { courseId: number, htc: number }
 *   `htc` is the site's own "hometown course" id from the booking URL
 *   (…/tee_times/?htc={htc}&courseid={courseId}); both are per-club constants.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawSlot {
  time: string; // "6:00 AM"
  holes: number;
  players: number;
  price: number | null;
}

function parseCards(html: string): RawSlot[] {
  const slots: RawSlot[] = [];
  const cardRe = /showBooking\([\s\S]*?(?=showBooking\(|$)/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html))) {
    const block = m[0];
    const time = /card-title[^>]*>([^<]+)</.exec(block)?.[1]?.trim();
    const playersStr = /(\d+)\s*players?/.exec(block)?.[1];
    const holesStr = /data-bs-title="(\d+)\s*Hole"/.exec(block)?.[1];
    const priceStr = /\$([\d.]+)/.exec(block)?.[1];
    if (!time) continue;
    slots.push({
      time,
      holes: holesStr ? parseInt(holesStr, 10) : 18,
      players: playersStr ? parseInt(playersStr, 10) : 0,
      price: priceStr ? parseFloat(priceStr) : null,
    });
  }
  return slots;
}

/** "2026-07-09" + "6:09 AM" -> "2026-07-09T06:09:00" */
function toIso(date: string, time: string): string | null {
  const tm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time);
  if (!tm) return null;
  let [, hh, mm, ap] = tm;
  let h = parseInt(hh, 10) % 12;
  if (ap.toUpperCase() === 'PM') h += 12;
  return `${date}T${String(h).padStart(2, '0')}:${mm}:00`;
}

export const golfrevAdapter: Adapter = {
  name: 'golfrev',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { courseId?: number; htc?: number };
    if (cfg.courseId == null || cfg.htc == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const qs = new URLSearchParams({
      c: String(cfg.courseId),
      s: params.date,
      h: String(cfg.htc),
      specials: '',
      reset: 'yes',
      snapshot: 'no',
    });
    const res = await fetch(`https://www.golfrev.com/go/tee_times/teetime_table_html.asp?${qs}`, {
      headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from golfrev`);
    const html = await res.text();
    const raw = parseCards(html);
    if (!raw.length) return { unavailable: true, bookingUrl: course.booking_url };

    const slots: TeeTimeSlot[] = [];
    for (const s of raw) {
      if (s.players < params.players) continue;
      const time = toIso(params.date, s.time);
      if (!time) continue;
      const holes: TeeTimeSlot['holes'] = s.holes === 9 ? 9 : s.holes === 18 ? 18 : 0;
      if (params.holes !== 0 && holes !== 0 && holes !== params.holes) continue;
      slots.push({
        time,
        price: s.price,
        cartPrice: null,
        spots: s.players,
        holes,
        bookingUrl: course.booking_url,
      });
    }
    return slots;
  },
};
