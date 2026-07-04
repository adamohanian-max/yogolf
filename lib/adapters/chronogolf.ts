import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { fetchJson } from './http';

/**
 * Chronogolf (Lightspeed Golf) marketplace API — the JSON the booking widget
 * calls: GET /marketplace/clubs/{clubId}/teetimes with the club's default
 * affiliation type repeated once per player.
 *
 * provider_config: {
 *   clubId: number,
 *   courses: { id: number; holes: number[] }[],  // 18/9 course variants
 *   affiliationTypeId: number,
 * }
 */

interface ChronoGreenFee {
  green_fee?: number;
  price?: number;
  subtotal?: number;
}
interface ChronoTeetime {
  start_time: string; // "07:20"
  date?: string;
  hole?: number;
  out_of_capacity?: boolean;
  frozen?: boolean;
  green_fees?: ChronoGreenFee[];
}

export const chronogolfAdapter: Adapter = {
  name: 'chronogolf',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as {
      clubId?: number;
      courses?: { id: number; holes: number[] }[];
      affiliationTypeId?: number;
    };
    if (!cfg.clubId || !cfg.courses?.length || !cfg.affiliationTypeId) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }

    const wantHoles: (9 | 18)[] = params.holes === 0 ? [18, 9] : [params.holes];
    const slots: TeeTimeSlot[] = [];
    let anyResponse = false;

    for (const c of cfg.courses) {
      for (const holes of wantHoles) {
        if (!c.holes.includes(holes)) continue;
        const qs = new URLSearchParams({
          date: params.date,
          course_id: String(c.id),
          nb_holes: String(holes),
        });
        for (let i = 0; i < params.players; i++) {
          qs.append('affiliation_type_ids[]', String(cfg.affiliationTypeId));
        }
        const url = `https://www.chronogolf.com/marketplace/clubs/${cfg.clubId}/teetimes?${qs}`;
        try {
          const data = await fetchJson<ChronoTeetime[]>(url);
          anyResponse = true;
          if (!Array.isArray(data)) continue;
          for (const t of data) {
            if (t.out_of_capacity || t.frozen) continue;
            const prices = (t.green_fees ?? [])
              .map((g) => g.green_fee ?? g.price)
              .filter((p): p is number => typeof p === 'number' && p > 0);
            const date = t.date ?? params.date;
            const hhmm = t.start_time.length === 5 ? `${t.start_time}:00` : t.start_time;
            slots.push({
              time: `${date}T${hhmm}`,
              price: prices.length ? Math.min(...prices) : null,
              spots: params.players, // API returns only times that fit the party
              holes,
              bookingUrl: course.booking_url,
            });
          }
        } catch {
          // one hole/course variant failing shouldn't kill the others
        }
      }
    }
    if (!anyResponse) return { unavailable: true, bookingUrl: course.booking_url };

    const seen = new Set<string>();
    return slots.filter((s) => {
      const k = `${s.time}|${s.holes}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
};
