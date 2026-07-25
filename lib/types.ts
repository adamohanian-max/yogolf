export interface Course {
  id: string;
  name: string;
  address: string | null;
  town: string;
  state: string;
  zip: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  website: string | null;
  holes_total: number;
  provider: string;
  provider_config: Record<string, unknown>;
  booking_url: string;
  google_rating: number | null;
  google_reviews: number | null;
  golfpass_rating: number | null;
  other_ratings: Record<string, number> | null;
  score: number;
  is_public: number;
  notes: string | null;
}

export interface TeeTimeSlot {
  time: string; // ISO datetime, course-local
  price: number | null; // USD walking green fee (base rate), null if unknown
  cartPrice: number | null; // USD rate riding a cart (green fee + cart), null if unknown/unavailable
  spots: number; // open player slots
  holes: 9 | 18 | 0; // 0 = both/either
  bookingUrl: string;
}

export type Ride = 'any' | 'walking' | 'cart';

/** The price a golfer pays for the selected ride mode (cart-inclusive when riding). */
export function effectivePrice(slot: TeeTimeSlot, ride: Ride): number | null {
  if (ride === 'cart') return slot.cartPrice ?? slot.price;
  return slot.price;
}

/**
 * A single number that represents a course's price for SORTING and summaries —
 * distinct from the honest per-slot prices shown in the grid.
 *
 * Using the absolute cheapest slot (Math.min over everything) misrepresents a
 * course: an off-peak twilight or a 9-hole rate makes a $50 18-hole course look
 * like a $15 course. Instead take the MEDIAN of the 18-hole rates (falling back
 * to 9-hole, then anything) so the low tail (twilight/junior/senior) and any high
 * outliers don't stand in for the course. Returns Infinity when no price is known
 * (so priced courses sort ahead of "see price" ones).
 */
export function representativePrice(slots: TeeTimeSlot[], ride: Ride): number {
  const pricesFor = (holes: readonly (9 | 18 | 0)[]): number[] =>
    slots
      .filter((s) => holes.includes(s.holes))
      .map((s) => effectivePrice(s, ride))
      .filter((p): p is number => p != null);
  // Prefer full-round (18 or unspecified) rates; fall back to 9-hole, then any.
  let prices = pricesFor([18, 0]);
  if (!prices.length) prices = pricesFor([9]);
  if (!prices.length) prices = pricesFor([9, 18, 0]);
  if (!prices.length) return Infinity;
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
}

export interface AdapterUnavailable {
  unavailable: true;
  bookingUrl: string;
}

export type AdapterResult = TeeTimeSlot[] | AdapterUnavailable;

export interface FetchParams {
  date: string; // YYYY-MM-DD
  players: number; // 1-4
  holes: 9 | 18 | 0; // 0 = both
}

export interface Adapter {
  name: string;
  fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult>;
}

export interface SearchCriteria {
  lat: number;
  lng: number;
  radiusMiles: number;
  players: number;
  dates: string[]; // YYYY-MM-DD, expanded from range
  timeStart: string; // "HH:MM" 24h
  timeEnd: string;
  maxPrice: number | null;
  holes: 9 | 18 | 0;
  ride: Ride;
  // 'best' (score sort) is dormant while the scoring algorithm is reworked; the
  // score is still computed/stored (lib/score.ts, DB), just not exposed as a sort.
  sort: 'nearest' | 'drive' | 'price_asc' | 'price_desc';
}

export interface CourseResult {
  course: Pick<
    Course,
    'id' | 'name' | 'town' | 'state' | 'lat' | 'lng' | 'website' | 'booking_url' | 'google_rating' | 'google_reviews' | 'score' | 'holes_total' | 'provider'
  >;
  distanceMiles: number;
  driveMinutes: number | null; // road driving time (OSRM), null if unavailable
  slots: TeeTimeSlot[];
  unavailable: boolean; // true = no live adapter, show booking link
  error?: string;
}
