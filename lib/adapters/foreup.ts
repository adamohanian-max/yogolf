import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { fetchJson } from './http';

/**
 * ForeUp online booking API (unofficial, same endpoint the booking widget calls).
 *
 * provider_config: {
 *   courseId: number,      // foreup course id (in booking URL)
 *   scheduleId: number,    // teesheet/schedule id
 *   bookingClass?: number, // some courses gate rates by booking class
 * }
 */

interface ForeupTime {
  time: string; // "2026-07-05 07:00"
  available_spots: number;
  green_fee?: number;
  green_fee_18?: number;
  green_fee_9?: number;
  guest_green_fee?: number;
  cart_fee?: number;
  cart_fee_18?: number;
  holes?: number | string;
  schedule_id?: number;
  course_id?: number;
  [key: string]: unknown;
}

function toIso(foreupTime: string): string {
  // "2026-07-05 07:00" → "2026-07-05T07:00:00"
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

export const foreupAdapter: Adapter = {
  name: 'foreup',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as {
      courseId?: number;
      scheduleId?: number;
      bookingClass?: number;
    };
    if (!cfg.scheduleId) return { unavailable: true, bookingUrl: course.booking_url };

    const [y, m, d] = params.date.split('-');
    const holesParam = params.holes === 0 ? 'all' : String(params.holes);
    const qs = new URLSearchParams({
      time: 'all',
      date: `${m}-${d}-${y}`,
      holes: holesParam,
      players: String(params.players),
      schedule_id: String(cfg.scheduleId),
      specials_only: '0',
      api_key: 'no_limits',
    });
    qs.append('schedule_ids[]', String(cfg.scheduleId));
    if (cfg.bookingClass) qs.set('booking_class', String(cfg.bookingClass));

    const url = `https://foreupsoftware.com/index.php/api/booking/times?${qs}`;
    const data = await fetchJson<ForeupTime[]>(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!Array.isArray(data)) return { unavailable: true, bookingUrl: course.booking_url };

    const slots: TeeTimeSlot[] = data
      .filter((t) => t.time && (t.available_spots ?? 0) > 0)
      .map((t) => {
        const rawHoles = Number(t.holes ?? 18);
        const holes: TeeTimeSlot['holes'] = rawHoles === 9 ? 9 : 18;
        return {
          time: toIso(t.time),
          price: slotPrice(t, params.holes),
          spots: Number(t.available_spots),
          holes,
          bookingUrl: course.booking_url,
        };
      });
    return slots;
  },
};
