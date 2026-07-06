import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * TeeSnap public customer API.
 *   GET https://{subdomain}.teesnap.net/customer-api/teetimes-day
 *       ?course={courseId}&date=YYYY-MM-DD&players=N&holes={9|18}&addons=on
 *
 * provider_config: { subdomain: string, courseId: number }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface TSPrice { roundType?: string; price?: string; priceWithAddOn?: string }
interface TSTeeTime { teeTime: string; prices?: TSPrice[]; shotgun?: boolean }

function priceFor(prices: TSPrice[] | undefined, holes: 9 | 18): number | null {
  const want = holes === 9 ? 'NINE_HOLE' : 'EIGHTEEN_HOLE';
  const p = prices?.find((x) => x.roundType === want);
  const v = p?.price ? parseFloat(p.price) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

// priceWithAddOn includes the cart add-on (TeeSnap's "addons=on").
function cartPriceFor(prices: TSPrice[] | undefined, holes: 9 | 18): number | null {
  const want = holes === 9 ? 'NINE_HOLE' : 'EIGHTEEN_HOLE';
  const p = prices?.find((x) => x.roundType === want);
  const v = p?.priceWithAddOn ? parseFloat(p.priceWithAddOn) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const teesnapAdapter: Adapter = {
  name: 'teesnap',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { subdomain?: string; courseId?: number };
    if (!cfg.subdomain || cfg.courseId == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const holesReq = params.holes === 9 ? 9 : 18; // request 18 for "both"; prices[] carries both
    const base = `https://${cfg.subdomain}.teesnap.net`;
    const url = `${base}/customer-api/teetimes-day?course=${cfg.courseId}&date=${params.date}&players=${params.players}&holes=${holesReq}&addons=on`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${base}/`,
      },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from teesnap`);
    const data = (await res.json()) as { teeTimes?: { teeTimes?: TSTeeTime[] } };
    const list = data.teeTimes?.teeTimes ?? [];

    const slots: TeeTimeSlot[] = [];
    for (const t of list) {
      if (t.shotgun || !t.teeTime) continue;
      if (params.holes !== 9) {
        const p18 = priceFor(t.prices, 18);
        if (p18 != null || params.holes === 18)
          slots.push({ time: t.teeTime, price: p18, cartPrice: cartPriceFor(t.prices, 18), spots: params.players, holes: 18, bookingUrl: course.booking_url });
      }
      if (params.holes !== 18) {
        const p9 = priceFor(t.prices, 9);
        if (p9 != null)
          slots.push({ time: t.teeTime, price: p9, cartPrice: cartPriceFor(t.prices, 9), spots: params.players, holes: 9, bookingUrl: course.booking_url });
      }
    }
    return slots;
  },
};
