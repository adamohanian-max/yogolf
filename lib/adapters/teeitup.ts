import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { fetchJson } from './http';

/**
 * TeeItUp (Kenna/Troon-family booking) public API.
 *
 * provider_config: {
 *   alias: string,        // x-be-alias header, from {alias}.book.teeitup.com
 *   facilityIds: number[],
 * }
 */

interface TeeItUpRate {
  greenFeeWalking?: number;
  greenFeeCart?: number;
  holes?: number;
  name?: string;
  [key: string]: unknown;
}

interface TeeItUpTime {
  teetime: string; // ISO UTC
  players?: number;
  maxPlayers?: number;
  rates?: TeeItUpRate[];
  courseId?: number;
  [key: string]: unknown;
}

interface TeeItUpDay {
  dayInfo?: unknown;
  teetimes?: TeeItUpTime[];
  [key: string]: unknown;
}

function centsToDollars(v: number | undefined): number | null {
  if (typeof v !== 'number' || v <= 0) return null;
  // TeeItUp returns cents
  return v >= 1000 ? v / 100 : v;
}

export const teeitupAdapter: Adapter = {
  name: 'teeitup',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { alias?: string; facilityIds?: number[] };
    if (!cfg.alias || !cfg.facilityIds?.length) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const url = `https://phx-api-be-east-1b.kenna.io/v2/tee-times?date=${params.date}&facilityIds=${cfg.facilityIds.join(',')}`;
    const data = await fetchJson<TeeItUpDay[]>(url, {
      headers: { 'x-be-alias': cfg.alias },
    });
    const slots: TeeTimeSlot[] = [];
    for (const day of data ?? []) {
      for (const t of day.teetimes ?? []) {
        const open = t.maxPlayers ?? t.players ?? 0;
        if (open < params.players) continue;
        const rates = (t.rates ?? []).filter(
          (r) => params.holes === 0 || Number(r.holes ?? 18) === params.holes
        );
        if (params.holes !== 0 && rates.length === 0 && (t.rates ?? []).length > 0) continue;
        const prices = rates
          .map((r) => centsToDollars(r.greenFeeWalking) ?? centsToDollars(r.greenFeeCart))
          .filter((p): p is number => p != null);
        const holes: TeeTimeSlot['holes'] =
          params.holes !== 0
            ? params.holes
            : rates.length && rates.every((r) => Number(r.holes) === 9)
              ? 9
              : 18;
        slots.push({
          time: t.teetime, // ISO; UI renders in course-local zone (ET for MA)
          price: prices.length ? Math.min(...prices) : null,
          spots: open,
          holes,
          bookingUrl: course.booking_url,
        });
      }
    }
    return slots;
  },
};
