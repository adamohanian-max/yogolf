import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * GolfNow (golfnow.com) public tee-time search — the same POST the facility
 * search page's own calendar makes:
 *   POST /api/tee-times/tee-time-search-results
 * No auth/cookies/API key required (verified: plain fetch, no browser
 * session). Returns every bookable slot for one calendar day at a facility;
 * `hasMoreRates` on a slot means only the cheapest rate is included here —
 * good enough for price/availability, not every rate combination.
 *
 * provider_config: { facilityId: number, lat: number, lng: number }
 *   `facilityId` is GolfNow's tee-time-search id (NOT the "productReviewId"
 *   used in /courses/ review-page URLs — a different id space). lat/lng are
 *   required by the search payload (radius filter), reuse the course's own.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface RawMoney {
  value: number;
}

interface RawRate {
  holeCount: number;
  isCartIncluded: boolean;
  singlePlayerPrice: { greensFees: RawMoney };
}

interface RawTeeTime {
  time: { date: string }; // ISO, UTC
  displayRate: RawMoney;
  teeTimeRates: RawRate[];
}

function golfnowDate(date: string): string {
  // "2026-07-09" -> "Jul 09 2026" (what the search API expects)
  const d = new Date(date + 'T12:00:00');
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`;
}

export const golfnowAdapter: Adapter = {
  name: 'golfnow',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { facilityId?: number; lat?: number; lng?: number };
    if (cfg.facilityId == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const holesFilter = params.holes === 0 ? 'Any' : String(params.holes);
    const body = {
      pageSize: 200,
      teeTimeCount: 20,
      pageNumber: 0,
      date: golfnowDate(params.date),
      sortBy: 'Date',
      sortByRollup: 'Date.MinDate',
      sortDirection: 0,
      hotDealsOnly: false,
      golfPassPerksOnly: false,
      bestDealsOnly: false,
      promotedCampaignsOnly: false,
      priceMin: 0,
      priceMax: 10000,
      players: 0,
      timePeriod: 'Any',
      timeMin: 0,
      timeMax: 47, // half-hour buckets, 0..47 covers the full day
      holes: holesFilter,
      facilityType: 'GolfCourse',
      latitude: cfg.lat ?? course.lat,
      longitude: cfg.lng ?? course.lng,
      radius: 35,
      facilityId: cfg.facilityId,
      facilityIds: [],
      searchType: 'Facility',
      view: 'Grouping',
      excludeFeaturedFacilities: false,
      excludePrivateFacilities: false,
      rateType: 'all',
      currentClientDate: new Date().toISOString(),
      trackmanOnly: false,
    };
    const res = await fetch('https://www.golfnow.com/api/tee-times/tee-time-search-results', {
      method: 'POST',
      headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from golfnow`);
    const json = (await res.json()) as { ttResults?: { teeTimes?: RawTeeTime[] } };
    const raw = json.ttResults?.teeTimes;
    if (!Array.isArray(raw)) return { unavailable: true, bookingUrl: course.booking_url };

    const slots: TeeTimeSlot[] = [];
    for (const t of raw) {
      const rate = t.teeTimeRates[0];
      const holes: TeeTimeSlot['holes'] = rate?.holeCount === 9 ? 9 : 18;
      if (params.holes !== 0 && holes !== params.holes) continue;
      const cartRate = t.teeTimeRates.find((r) => r.isCartIncluded);
      slots.push({
        time: t.time.date,
        price: t.displayRate?.value ?? rate?.singlePlayerPrice?.greensFees?.value ?? null,
        cartPrice: cartRate?.singlePlayerPrice?.greensFees?.value ?? null,
        // GolfNow's search API doesn't expose a per-slot open-seat count
        // (playerRule is almost always "Any"); assume a full foursome is
        // bookable, same as the site itself does before you pick a group size.
        spots: 4,
        holes,
        bookingUrl: course.booking_url,
      });
    }
    return slots;
  },
};
