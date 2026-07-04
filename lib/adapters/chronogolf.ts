import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { fetchJson } from './http';

/**
 * Chronogolf (Lightspeed Golf) marketplace API — the JSON the widget on
 * chronogolf.com club pages calls.
 *
 * provider_config: {
 *   clubId: number,
 *   courseIds: number[],            // one club can host multiple courses (18/9)
 *   affiliationTypeId?: number,     // "green fee" affiliation type, repeated per player
 * }
 */

interface ChronoTeetime {
  start_time: string; // "07:30"
  date?: string;
  hole?: number;
  round?: string;
  green_fee?: number;
  out_of_capacity?: boolean;
  restrictions?: unknown[];
  green_fees?: { green_fee: number; affiliation_type_id?: number }[];
  [key: string]: unknown;
}

export const chronogolfAdapter: Adapter = {
  name: 'chronogolf',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as {
      clubId?: number;
      courseIds?: number[];
      affiliationTypeId?: number;
    };
    if (!cfg.clubId || !cfg.courseIds?.length) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }

    const holesList: (9 | 18)[] = params.holes === 0 ? [18, 9] : [params.holes];
    const slots: TeeTimeSlot[] = [];

    for (const courseId of cfg.courseIds) {
      for (const holes of holesList) {
        const qs = new URLSearchParams({
          date: params.date,
          course_id: String(courseId),
          nb_holes: String(holes),
        });
        for (let i = 0; i < params.players; i++) {
          qs.append('affiliation_type_ids[]', String(cfg.affiliationTypeId ?? ''));
        }
        const url = `https://www.chronogolf.com/marketplace/clubs/${cfg.clubId}/teetimes?${qs}`;
        try {
          const data = await fetchJson<ChronoTeetime[]>(url);
          if (!Array.isArray(data)) continue;
          for (const t of data) {
            if (t.out_of_capacity) continue;
            const date = t.date ?? params.date;
            const price =
              t.green_fees?.length
                ? Math.min(...t.green_fees.map((g) => g.green_fee))
                : typeof t.green_fee === 'number'
                  ? t.green_fee
                  : null;
            slots.push({
              time: `${date}T${t.start_time.length === 5 ? t.start_time + ':00' : t.start_time}`,
              price,
              spots: params.players, // API already filtered by requested party size
              holes,
              bookingUrl: course.booking_url,
            });
          }
        } catch {
          // one hole-variant failing shouldn't kill the other
        }
      }
    }
    // De-dup identical time+holes rows that can appear across course ids
    const seen = new Set<string>();
    return slots.filter((s) => {
      const k = `${s.time}|${s.holes}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
};
