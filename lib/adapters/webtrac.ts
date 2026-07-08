import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { cacheGet, cacheSet } from '../cache';

/**
 * Vermont Systems WebTrac ("3.1 WEB") municipal recreation booking system —
 * used by many MA towns for their golf module (module=GR). The public search
 * page (`/web/search.html`) renders a results TABLE server-side without
 * login: each `<tr>` is one tee time slot with a `data-title="Status"` cell
 * containing one `<span class="itemstatus itemstatus--available|unavailable">`
 * per open player-slot in that block (max 4). The row's own "Item Action" /
 * cart button is ALWAYS "Unavailable" for anonymous users (booking itself
 * needs a WebTrac account) — but the Status spans are real, so availability
 * is fully scrapable even though completing a booking isn't. Confirmed live
 * on Cambridge's Fresh Pond Golf Course.
 *
 * Session flow: GET the search page once to obtain a session cookie + a
 * fresh `_csrf_token` (tied to that cookie), then GET search.html again with
 * `Action=Start` and the search fields as query params.
 *
 * provider_config: {
 *   host: string,          // e.g. "secure.cambridgema.gov"
 *   secondarycode: string, // course id within the WebTrac site's GR module
 * }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface Session {
  cookie: string;
  csrf: string;
}

async function getSession(host: string): Promise<Session> {
  const key = `webtrac-session:${host}`;
  const cached = cacheGet<Session>(key);
  if (cached) return cached;
  const res = await fetch(`https://${host}/webtrac/web/search.html?module=GR`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(9000),
  });
  const cookie = (res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .filter((c) => /=/.test(c))
    .join('; ');
  const html = await res.text();
  const csrf = /_csrf_token"\s+value="([^"]*)"/.exec(html)?.[1];
  if (!cookie || !csrf) throw new Error('webtrac session HTTP ' + res.status);
  const session = { cookie, csrf };
  cacheSet(key, session, 4 * 60_000);
  return session;
}

interface RawSlot {
  time: string; // " 9:40 am"
  date: string; // "07/09/2026"
  holes: number;
  available: number; // count of itemstatus--available spans in this row
}

function parseRows(html: string): RawSlot[] {
  const slots: RawSlot[] = [];
  const rowRe = /<tr >([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const time = /data-title="Time">\s*([^<]+)</.exec(row)?.[1]?.trim();
    const date = /data-title="Date">\s*([^<]+)</.exec(row)?.[1]?.trim();
    const holesRaw = /data-title="Holes">\s*([^<]+)</.exec(row)?.[1]?.trim();
    if (!time || !date || !holesRaw) continue;
    const holes = parseInt(holesRaw, 10);
    const available = (row.match(/itemstatus--available/g) ?? []).length;
    slots.push({ time, date, holes, available });
  }
  return slots;
}

/** "07/09/2026" + " 9:40 am" -> "2026-07-09T09:40:00" */
function toIso(date: string, time: string): string | null {
  const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  const tm = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(time);
  if (!dm || !tm) return null;
  const [, mo, d, y] = dm;
  let [, hh, mm, ap] = tm;
  let h = parseInt(hh, 10) % 12;
  if (ap.toLowerCase() === 'pm') h += 12;
  return `${y}-${mo}-${d}T${String(h).padStart(2, '0')}:${mm}:00`;
}

export const webtracAdapter: Adapter = {
  name: 'webtrac',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { host?: string; secondarycode?: string };
    if (!cfg.host || !cfg.secondarycode) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const session = await getSession(cfg.host);
    const [y, mo, d] = params.date.split('-');
    // Query with numberofplayers=1 to get every row with >=1 open slot; the
    // real remaining capacity is read per-row from the Status spans, and
    // search.ts's own filterSlots() drops rows with spots < c.players.
    // numberofholes is a fixed attribute of the course's tee sheet (a hidden
    // form field, not a golfer-facing filter) — sending '' (for holes=0/any)
    // breaks the search entirely, so always send the course's own holes count.
    const qs = new URLSearchParams({
      Action: 'Start',
      _csrf_token: session.csrf,
      module: 'GR',
      secondarycode: cfg.secondarycode,
      numberofplayers: '1',
      begindate: `${mo}/${d}/${y}`,
      begintime: ' 5:00AM',
      numberofholes: String(course.holes_total),
    });
    const res = await fetch(`https://${cfg.host}/webtrac/web/search.html?${qs}`, {
      headers: { 'User-Agent': UA, Cookie: session.cookie },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`WebTrac HTTP ${res.status}`);
    const html = await res.text();
    const raw = parseRows(html);
    if (!raw.length && !/itemstatus--/.test(html)) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }

    const slots: TeeTimeSlot[] = [];
    for (const s of raw) {
      if (s.available <= 0) continue;
      const time = toIso(s.date, s.time);
      if (!time) continue;
      const holes: TeeTimeSlot['holes'] = s.holes === 9 ? 9 : s.holes === 18 ? 18 : 0;
      slots.push({
        time,
        price: null, // WebTrac shows price only after login/add-to-cart
        cartPrice: null,
        spots: s.available,
        holes,
        bookingUrl: course.booking_url,
      });
    }
    return slots;
  },
};
