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
  sort: 'nearest' | 'price_asc' | 'price_desc' | 'best';
}

export interface CourseResult {
  course: Pick<
    Course,
    'id' | 'name' | 'town' | 'state' | 'lat' | 'lng' | 'website' | 'booking_url' | 'google_rating' | 'google_reviews' | 'score' | 'holes_total' | 'provider'
  >;
  distanceMiles: number;
  slots: TeeTimeSlot[];
  unavailable: boolean; // true = no live adapter, show booking link
  error?: string;
}
