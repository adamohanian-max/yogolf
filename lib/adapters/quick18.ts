import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * Quick18 (`{subdomain}.quick18.com`) public tee-sheet matrix — the "Book a
 * Tee Time" page's date-nav links reveal the real query:
 *   GET /teetimes/searchmatrix?teedate=YYYYMMDD
 * which server-renders an HTML table with no login required. Each `<tr>` is
 * one tee time; the first cell (`td.mtrxTeeTimes`) holds the time text, and
 * up to 4 rate-tier cells follow in fixed column order — 18 Holes, 9 Holes,
 * Member 18 Holes, Member 9 Holes (only the first two are public rates).
 * An active (bookable) cell has `class="matrixsched "` (NOT `mtrxInactive`)
 * and contains a `sexybutton teebutton` link to
 * `/teetimes/course/{courseId}/teetime/{YYYYMMDDHHmm}`.
 *
 * provider_config: { subdomain: string, courseId: number }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawSlot {
  hhmm: string; // "06:10"
  ampm: string; // "AM"
  maxPlayers: number;
  holes: 9 | 18;
  price: number;
  cellCourseId: string;
}

function parseRows(html: string): RawSlot[] {
  const slots: RawSlot[] = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const timeMatch = /mtrxTeeTimes">\s*(\d{1,2}):(\d{2})<div class="be_tee_time_ampm">(AM|PM)</.exec(row);
    if (!timeMatch) continue;
    const [, hh, mm, ampm] = timeMatch;
    const playersMatch = /matrixPlayers">(\d+) to (\d+) players/.exec(row);
    const maxPlayers = playersMatch ? parseInt(playersMatch[2], 10) : 4;

    // The first two `matrixsched` cells are the public 18-hole / 9-hole rates
    // (columns 3 and 4 are Member-only rates — skip those).
    const cellRe = /<td class="matrixsched\s*(mtrxInactive)?">([\s\S]*?)<\/td>/g;
    let cm: RegExpExecArray | null;
    let col = 0;
    while ((cm = cellRe.exec(row)) && col < 2) {
      const inactive = !!cm[1];
      const cell = cm[2];
      if (!inactive) {
        const priceMatch = /mtrxPrice">\$([\d.]+)</.exec(cell);
        const hrefMatch = /teetimes\/course\/(\d+)\/teetime\/(\d{12})(?:\?[^"]*)?"/.exec(cell);
        if (priceMatch && hrefMatch && parseFloat(priceMatch[1]) > 0) {
          slots.push({
            hhmm: `${hh.padStart(2, '0')}:${mm}`,
            ampm,
            maxPlayers,
            holes: col === 0 ? 18 : 9,
            price: parseFloat(priceMatch[1]),
            cellCourseId: hrefMatch[1],
          });
        }
      }
      col++;
    }
  }
  return slots;
}

/** "06" + "10" + "AM" + date "2026-07-09" -> "2026-07-09T06:10:00" */
function toIso(date: string, hhmm: string, ampm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10) % 12;
  if (ampm === 'PM') h += 12;
  return `${date}T${String(h).padStart(2, '0')}:${mStr}:00`;
}

export const quick18Adapter: Adapter = {
  name: 'quick18',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { subdomain?: string; courseId?: number };
    if (!cfg.subdomain || cfg.courseId == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const [y, mo, d] = params.date.split('-');
    const teedate = `${y}${mo}${d}`;
    const res = await fetch(`https://${cfg.subdomain}.quick18.com/teetimes/searchmatrix?teedate=${teedate}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from quick18`);
    const html = await res.text();
    const raw = parseRows(html).filter((s) => String(cfg.courseId) === s.cellCourseId);
    if (!raw.length && !/mtrxTeeTimes/.test(html)) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }

    const slots: TeeTimeSlot[] = [];
    for (const s of raw) {
      if (s.maxPlayers < params.players) continue;
      if (params.holes !== 0 && s.holes !== params.holes) continue;
      slots.push({
        time: toIso(params.date, s.hhmm, s.ampm),
        price: s.price,
        cartPrice: null,
        spots: s.maxPlayers,
        holes: s.holes,
        bookingUrl: course.booking_url,
      });
    }
    return slots;
  },
};
