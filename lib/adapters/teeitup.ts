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

/**
 * TeeItUp returns tee times in UTC ("…Z"); every other adapter (and the UI's
 * time-range filter + date grouping) works in course-local wall-clock time.
 * Convert the instant to the course's zone and emit a local ISO with no Z.
 */
function toCourseLocalISO(utcIso: string, timeZone: string): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return utcIso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  let hour = g('hour');
  if (hour === '24') hour = '00';
  return `${g('year')}-${g('month')}-${g('day')}T${hour}:${g('minute')}:${g('second')}`;
}

export const teeitupAdapter: Adapter = {
  name: 'teeitup',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { alias?: string; facilityIds?: number[]; timeZone?: string };
    if (!cfg.alias || !cfg.facilityIds?.length) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const tz = cfg.timeZone ?? 'America/New_York';
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
          time: toCourseLocalISO(t.teetime, tz), // UTC → course-local wall clock
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
