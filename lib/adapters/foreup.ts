import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { fetchJson } from './http';
import { foreupLogin } from '../credentials';
import { cacheGet, cacheSet } from '../cache';

/**
 * ForeUp online booking API (unofficial, same endpoint the booking widget calls).
 *
 * provider_config: {
 *   courseId: number,       // foreup course id (in booking URL)
 *   scheduleId?: number,    // teesheet id — omit for login-gated courses
 *   bookingClass?: number,  // some courses gate rates by booking class
 *   requiresAuth?: boolean, // login-gated: sign in with data/credentials.json, then discover the schedule
 * }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://foreupsoftware.com/index.php/api/booking';

interface ForeupTime {
  time: string; // "2026-07-05 07:00"
  available_spots: number;
  green_fee?: number;
  green_fee_18?: number;
  green_fee_9?: number;
  guest_green_fee?: number;
  cart_fee?: number;
  cart_fee_18?: number;
  cart_fee_9?: number;
  holes?: number | string;
  schedule_id?: number;
  course_id?: number;
  [key: string]: unknown;
}

interface ForeupSchedule {
  teesheet_id?: number;
  schedule_id?: number;
  id?: number;
  title?: string;
  name?: string;
  online_booking?: string | number;
  booking_classes?: { booking_class_id?: number; id?: number; name?: string }[];
}

function toIso(foreupTime: string): string {
  return foreupTime.replace(' ', 'T') + (foreupTime.length === 16 ? ':00' : '');
}

function slotPrice(t: ForeupTime, holes: 9 | 18 | 0): number | null {
  const candidates =
    holes === 9
      ? [t.green_fee_9, t.green_fee, t.guest_green_fee]
      : [t.green_fee_18, t.green_fee, t.guest_green_fee];
  for (const c of candidates) {
    if (typeof c === 'number' && c > 0) return c;
  }
  return null;
}

function slotCartPrice(t: ForeupTime, holes: 9 | 18 | 0): number | null {
  const green = slotPrice(t, holes);
  if (green == null) return null;
  const cart = holes === 9 ? (t.cart_fee_9 ?? t.cart_fee) : (t.cart_fee_18 ?? t.cart_fee);
  return typeof cart === 'number' && cart > 0 ? green + cart : null;
}

/** Log in and return the authenticated PHPSESSID cookie, cached ~20 min. */
async function login(courseId: number): Promise<string | null> {
  const key = `foreup-session:${courseId}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;
  const creds = foreupLogin(courseId);
  if (!creds) return null;

  const res = await fetch(`${BASE}/users/login`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Api-Key': 'no_limits',
    },
    body: new URLSearchParams({
      username: creds.username,
      password: creds.password,
      course_id: String(courseId),
    }),
    signal: AbortSignal.timeout(9000),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean };
  if (!json.success) return null;
  const sid = /PHPSESSID=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  if (!sid) return null;
  const cookie = `PHPSESSID=${sid}`;
  cacheSet(key, cookie, 20 * 60_000);
  return cookie;
}

/** Discover the default public schedule for an authenticated course. */
async function discoverSchedule(
  courseId: number,
  cookie: string
): Promise<{ scheduleId: number; bookingClass?: number } | null> {
  const key = `foreup-sched:${courseId}`;
  const cached = cacheGet<{ scheduleId: number; bookingClass?: number }>(key);
  if (cached) return cached;
  const res = await fetch(`${BASE}/courses/${courseId}/schedules`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Api-Key': 'no_limits', Cookie: cookie },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  const list = (await res.json().catch(() => [])) as ForeupSchedule[];
  const schedules = Array.isArray(list) ? list : [];
  const pick = schedules.find((s) => String(s.online_booking) === '1') ?? schedules[0];
  if (!pick) return null;
  const scheduleId = Number(pick.teesheet_id ?? pick.schedule_id ?? pick.id);
  if (!scheduleId) return null;
  const member = /member only|league|staff/i;
  const bc = pick.booking_classes?.find((b) => !member.test(b.name ?? ''));
  const result = { scheduleId, bookingClass: bc?.booking_class_id ?? bc?.id };
  cacheSet(key, result, 30 * 60_000);
  return result;
}

async function fetchTimes(
  scheduleId: number,
  bookingClass: number | undefined,
  params: FetchParams,
  cookie?: string
): Promise<ForeupTime[]> {
  const [y, m, d] = params.date.split('-');
  const qs = new URLSearchParams({
    time: 'all',
    date: `${m}-${d}-${y}`,
    holes: params.holes === 0 ? 'all' : String(params.holes),
    players: String(params.players),
    schedule_id: String(scheduleId),
    specials_only: '0',
    api_key: 'no_limits',
  });
  qs.append('schedule_ids[]', String(scheduleId));
  if (bookingClass) qs.set('booking_class', String(bookingClass));
  return fetchJson<ForeupTime[]>(`${BASE}/times?${qs}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) },
  });
}

export const foreupAdapter: Adapter = {
  name: 'foreup',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as {
      courseId?: number;
      scheduleId?: number;
      bookingClass?: number;
      requiresAuth?: boolean;
    };

    let scheduleId = cfg.scheduleId;
    let bookingClass = cfg.bookingClass;
    let cookie: string | undefined;

    // Login-gated course: sign in and discover the schedule.
    if (cfg.requiresAuth && cfg.courseId) {
      const session = await login(cfg.courseId);
      if (!session) return { unavailable: true, bookingUrl: course.booking_url }; // no creds → booking link
      cookie = session;
      if (!scheduleId) {
        const disc = await discoverSchedule(cfg.courseId, session);
        if (!disc) return { unavailable: true, bookingUrl: course.booking_url };
        scheduleId = disc.scheduleId;
        bookingClass = bookingClass ?? disc.bookingClass;
      }
    }

    if (!scheduleId) return { unavailable: true, bookingUrl: course.booking_url };

    let data: ForeupTime[];
    try {
      data = await fetchTimes(scheduleId, bookingClass, params, cookie);
    } catch (e) {
      if (/HTTP 40[13]/.test(String(e))) return { unavailable: true, bookingUrl: course.booking_url };
      throw e;
    }
    if (!Array.isArray(data)) return { unavailable: true, bookingUrl: course.booking_url };

    return data
      .filter((t) => t.time && (t.available_spots ?? 0) > 0)
      .map((t) => {
        const holes: TeeTimeSlot['holes'] = Number(t.holes ?? 18) === 9 ? 9 : 18;
        return {
          time: toIso(t.time),
          price: slotPrice(t, params.holes),
          cartPrice: slotCartPrice(t, params.holes),
          spots: Number(t.available_spots),
          holes,
          bookingUrl: course.booking_url,
        };
      });
  },
};
