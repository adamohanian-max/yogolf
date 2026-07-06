import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';
import { cacheGet, cacheSet } from '../cache';

/**
 * CPS Golf (cps.golf) online reservation API — the flow the Angular booking
 * SPA performs: short-lived token → GetAllOptions (for webSiteId) →
 * RegisterTransactionId → TeeTimes.
 *
 * provider_config: {
 *   host: string,      // e.g. "georgewright.cps.golf"
 *   siteName: string,  // e.g. "georgewright"
 *   courseId: number,  // CPS course id within the site (a site may host several)
 * }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface CpsRatePrice {
  shItemCode?: string; // "GreenFee18" | "GreenFee9" | ...
  price?: number;
  displayPrice?: number;
  taxInclusivePrice?: number;
}

interface CpsTeeTime {
  startTime: string; // "2026-07-05T15:20:00" (course-local)
  participants?: number;
  holes?: number;
  courseId?: number;
  shItemPrices?: CpsRatePrice[];
}

async function getToken(host: string): Promise<string> {
  const key = `cps-token:${host}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;
  const form = new URLSearchParams();
  form.set('client_id', 'onlinereswebshortlived');
  const res = await fetch(`https://${host}/identityapi/myconnect/token/short`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`CPS token HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  cacheSet(key, json.access_token, 8 * 60_000);
  return json.access_token;
}

async function getWebsiteId(host: string, siteName: string, token: string): Promise<string> {
  const key = `cps-wid:${host}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;
  const headers = cpsHeaders(token, '00000000-0000-0000-0000-000000000000');
  const res = await fetch(
    `https://${host}/onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/${siteName}?version=1&product=3`,
    { headers }
  );
  if (!res.ok) throw new Error(`CPS options HTTP ${res.status}`);
  const json = (await res.json()) as { webSiteId?: string };
  const wid = json.webSiteId ?? '00000000-0000-0000-0000-000000000000';
  cacheSet(key, wid, 30 * 60_000);
  return wid;
}

function cpsHeaders(token: string, websiteId: string): Record<string, string> {
  return {
    'User-Agent': UA,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'x-componentid': '1',
    'x-productid': '1',
    'x-siteid': '1',
    'x-terminalid': '3',
    'x-websiteid': websiteId,
  };
}

function cpsDate(date: string): string {
  // "2026-07-05" → "Sun Jul 05 2026" (what the API expects)
  const d = new Date(date + 'T12:00:00');
  return d.toDateString();
}

function itemPrice(p: CpsRatePrice | undefined): number | null {
  const v = p?.displayPrice ?? p?.price ?? p?.taxInclusivePrice;
  return typeof v === 'number' && v > 0 ? v : null;
}

function priceFor(prices: CpsRatePrice[] | undefined, holes: 9 | 18 | 0): number | null {
  if (!prices?.length) return null;
  const want = holes === 9 ? 'GreenFee9' : 'GreenFee18';
  return itemPrice(prices.find((p) => p.shItemCode === want) ?? prices.find((p) => p.shItemCode?.startsWith('GreenFee')));
}

// CPS lists the cart as a separate HalfCart18/HalfCart9 line item.
function cartPriceFor(prices: CpsRatePrice[] | undefined, holes: 9 | 18 | 0): number | null {
  const green = priceFor(prices, holes);
  if (green == null || !prices?.length) return null;
  const want = holes === 9 ? 'HalfCart9' : 'HalfCart18';
  const cart = itemPrice(prices.find((p) => p.shItemCode === want) ?? prices.find((p) => /cart/i.test(p.shItemCode ?? '')));
  return cart != null ? green + cart : null;
}

export const cpsAdapter: Adapter = {
  name: 'cps',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { host?: string; siteName?: string; courseId?: number };
    if (!cfg.host || !cfg.siteName || cfg.courseId == null) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const token = await getToken(cfg.host);
    const websiteId = await getWebsiteId(cfg.host, cfg.siteName, token);
    const headers = cpsHeaders(token, websiteId);

    const txn =
      globalThis.crypto?.randomUUID?.() ??
      '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0');
    await fetch(`https://${cfg.host}/onlineres/onlineapi/api/v1/onlinereservation/RegisterTransactionId`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId: txn }),
    });

    const holesParam = params.holes === 0 ? 0 : params.holes;
    const qs = new URLSearchParams({
      searchDate: cpsDate(params.date),
      holes: String(holesParam),
      numberOfPlayer: String(params.players),
      courseIds: String(cfg.courseId),
      searchTimeType: '0',
      transactionId: txn,
    });
    const res = await fetch(
      `https://${cfg.host}/onlineres/onlineapi/api/v1/onlinereservation/TeeTimes?${qs}`,
      { headers }
    );
    if (!res.ok) throw new Error(`CPS teetimes HTTP ${res.status}`);
    const json = (await res.json()) as { isSuccess?: boolean; content?: CpsTeeTime[] };
    if (!json.isSuccess || !Array.isArray(json.content)) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }

    const slots: TeeTimeSlot[] = json.content
      .filter((t) => (t.participants ?? 0) >= params.players)
      .map((t) => {
        const holes: TeeTimeSlot['holes'] = Number(t.holes) === 9 ? 9 : 18;
        return {
          time: t.startTime,
          price: priceFor(t.shItemPrices, params.holes),
          cartPrice: cartPriceFor(t.shItemPrices, params.holes),
          spots: Number(t.participants ?? 0),
          holes,
          bookingUrl: course.booking_url,
        };
      });
    return slots;
  },
};
