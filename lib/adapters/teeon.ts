import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * TeeOn "cloud" guest tee-sheet API (`admin.teeon.com`) — the modern React
 * portal's read path. Confirmed via Playwright network capture: the portal
 * page (`/portal/{shortName}/teetimes/{shortName}`) calls
 *   GET /api/2024-04/guest/tee-time?facility_id={id}&date=YYYY-MM-DD&extended=true&turn_tee_time=true
 * with header `api-key: 12345` — a literal hardcoded placeholder the
 * frontend always sends, not a per-client secret; no cookies/session needed.
 * This is a DIFFERENT product from the legacy tee-on.com "PubGolf" stateful
 * servlet (that one really is login/session gated — do not confuse the two).
 * No price field is exposed by this endpoint (`display_online_pricing`
 * suggests it exists elsewhere, not found in the guest read path) — slots
 * carry availability only, price stays null.
 *
 * provider_config: { facilityId: number, host?: string }
 *   host defaults to "admin.teeon.com".
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawSlot {
  start_time: string; // "09:30"
  date: string; // "2026-07-09"
  quantity_remaining: number;
  course?: { holes?: number };
  facility?: { holes?: number };
}

export const teeonAdapter: Adapter = {
  name: 'teeon',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { facilityId?: number; host?: string };
    if (cfg.facilityId == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const host = cfg.host ?? 'admin.teeon.com';
    const qs = new URLSearchParams({
      facility_id: String(cfg.facilityId),
      date: params.date,
      extended: 'true',
      turn_tee_time: 'true',
    });
    const res = await fetch(`https://${host}/api/2024-04/guest/tee-time?${qs}`, {
      headers: { 'User-Agent': UA, 'api-key': '12345', Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (res.status === 401) return { unavailable: true, bookingUrl: course.booking_url };
    if (!res.ok) throw new Error(`HTTP ${res.status} from teeon`);
    const raw = (await res.json().catch(() => null)) as RawSlot[] | null;
    if (!Array.isArray(raw)) return { unavailable: true, bookingUrl: course.booking_url };

    const slots: TeeTimeSlot[] = [];
    for (const s of raw) {
      if (s.quantity_remaining < params.players) continue;
      const holesRaw = s.course?.holes ?? s.facility?.holes ?? 18;
      const holes: TeeTimeSlot['holes'] = holesRaw === 9 ? 9 : 18;
      if (params.holes !== 0 && holes !== params.holes) continue;
      slots.push({
        time: `${s.date}T${s.start_time}:00`,
        price: null, // not exposed by the guest read endpoint
        cartPrice: null,
        spots: s.quantity_remaining,
        holes,
        bookingUrl: course.booking_url,
      });
    }
    return slots;
  },
};
