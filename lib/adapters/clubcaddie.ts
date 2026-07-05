import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * Club Caddie public booking widget API. The widget POSTs to
 * `apimanager-cc{N}.clubcaddie.com/webapi/TeeTimes` with the club's public
 * `apikey` (token) + `CourseId`; the response is HTML whose slot blocks embed
 * URL-encoded rate JSON plus hidden Date/fromtime inputs.
 *
 * provider_config: { shard: string (e.g. "cc31"), apikey: string, courseId: number }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawSlot {
  fromtime: string; // "12:20:00"
  date: string; // "2026-07-05"
  price9: number | null;
  price18: number | null;
}

function parseSlots(html: string): RawSlot[] {
  const slots: RawSlot[] = [];
  // Each slot: a URL-encoded JSON tail (…HoleRate_9…HoleRate_18…) immediately
  // followed by the hidden Date/fromtime inputs.
  const re =
    /LowestPriceHoleRate_18%22%3A(null|\d+(?:\.\d+)?)%2C%22LowestPriceHoleRate_9%22%3A(null|\d+(?:\.\d+)?)[\s\S]{0,400}?name="Date" value="(\d{4}-\d{2}-\d{2})">\s*<input type="hidden" name="fromtime" value="(\d{2}:\d{2}:\d{2})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    slots.push({
      price18: m[1] === 'null' ? null : parseFloat(m[1]),
      price9: m[2] === 'null' ? null : parseFloat(m[2]),
      date: m[3],
      fromtime: m[4],
    });
  }
  return slots;
}

export const clubcaddieAdapter: Adapter = {
  name: 'clubcaddie',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { shard?: string; apikey?: string; courseId?: number };
    if (!cfg.shard || !cfg.apikey || cfg.courseId == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const base = `https://apimanager-${cfg.shard}.clubcaddie.com`;

    // Establish a session (PHPSESSID) via the view page.
    const view = await fetch(`${base}/webapi/view/${cfg.apikey}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(9000),
    });
    const cookie = (view.headers.get('set-cookie') ?? '')
      .split(',')
      .map((c) => c.split(';')[0].trim())
      .filter((c) => /=/.test(c))
      .join('; ');

    const [y, mo, d] = params.date.split('-');
    const body = new URLSearchParams({
      date: `${mo}/${d}/${y}`,
      player: String(params.players),
      holes: params.holes === 0 ? 'any' : String(params.holes),
      fromtime: '4',
      totime: '23',
      minprice: '0',
      maxprice: '9999',
      ratetype: 'any',
      HoleGroup: 'front',
      CourseId: String(cfg.courseId),
      apikey: cfg.apikey,
    });

    const res = await fetch(`${base}/webapi/TeeTimes`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body,
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from clubcaddie`);
    const html = await res.text();

    const raw = parseSlots(html);
    const slots: TeeTimeSlot[] = [];
    for (const s of raw) {
      const time = `${s.date}T${s.fromtime}`;
      if (params.holes !== 9 && s.price18 != null) {
        slots.push({ time, price: s.price18, spots: params.players, holes: 18, bookingUrl: course.booking_url });
      }
      if (params.holes !== 18 && s.price9 != null) {
        slots.push({ time, price: s.price9, spots: params.players, holes: 9, bookingUrl: course.booking_url });
      }
      // No rate parsed but slot exists → still surface it (price unknown).
      if (s.price9 == null && s.price18 == null) {
        const holes: TeeTimeSlot['holes'] = params.holes === 9 ? 9 : 18;
        slots.push({ time, price: null, spots: params.players, holes, bookingUrl: course.booking_url });
      }
    }
    return slots;
  },
};
