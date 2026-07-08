import type { Adapter, AdapterResult, Course, FetchParams, TeeTimeSlot } from '../types';

/**
 * Eagle Club Systems (`api.eagleclubsystems.online`) — an Angular/SignalR
 * booking app (`player.eagleclubsystems.online/#/tee-slot?dbname={db}`).
 * Captured via Playwright network trace (plain curl only sees the SPA shell,
 * and static analysis of the JS bundle wasn't needed — the two POST calls
 * the widget makes are enough):
 *
 *   POST /api/online/OnlineCourseRetrieve   { ...BCC, StrDatabase }
 *     -> LstCourse[0].Master_TeePriceClassID, .Master_CarriageID (per-club
 *        constants the next call needs — no separate "harvest" step needed,
 *        this one call self-describes the club)
 *   POST /api/online/OnlineAppointmentRetrieve  { BCC, StrDate, StrTime,
 *        TeePriceClassID, Master_CarriageID, Master_TeePriceClassIDs, ... }
 *     -> LstAppointment[] — ONE call returns several days at once (governed
 *        by OnlineBookingMaxDays), so we fetch once and filter client-side
 *        by params.date rather than re-querying per day.
 *
 * No auth token — `IntOrganizationID`/`IntOperatorID` are fixed constants
 * (1/2) the anonymous web widget always sends, confirmed from real browser
 * traffic, not a per-client secret.
 *
 * provider_config: { dbname: string }
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const API = 'https://api.eagleclubsystems.online/api/online';

function bcc(dbname: string) {
  return {
    StrServer: 'GSERVER',
    StrURL: 'https://api.EagleClubSystems.online',
    StrDatabase: dbname,
    IntOrganizationID: 1,
    IntOperatorID: 2,
    EmailErrors: false,
    SignalRConnectionID: '',
    Information: '',
    PrinterName: '',
    CampaignMonitorMasterListName: '',
    CampaignMonitorApiKey: '',
    CampaignMonitorClientID: '',
    LsteInterfaceID: [],
    ipAddress: '',
    Version: '1.260630.0',
    FromProgram: 'BE',
  };
}

interface CourseInfo {
  Master_TeePriceClassID: number;
  Master_CarriageID: number;
}

interface Appointment {
  Date: string; // "20260707"
  Time: string; // "1140" (HHmm)
  NineFee: string;
  EighteenFee: string;
  CarriageNineFee: string;
  CarriageEighteenFee: string;
  Slots: number;
  LstPlayer: unknown[];
}

async function getCourseInfo(dbname: string): Promise<CourseInfo | null> {
  const res = await fetch(`${API}/OnlineCourseRetrieve`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify(bcc(dbname)),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { LstCourse?: CourseInfo[] };
  return json.LstCourse?.[0] ?? null;
}

function toIso(date: string, time: string): string {
  const hh = time.padStart(4, '0').slice(0, 2);
  const mm = time.padStart(4, '0').slice(2, 4);
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${hh}:${mm}:00`;
}

export const eagleclubAdapter: Adapter = {
  name: 'eagleclub',
  async fetchTeeTimes(course: Course, params: FetchParams): Promise<AdapterResult> {
    const cfg = course.provider_config as { dbname?: string };
    if (!cfg.dbname) {
      return { unavailable: true, bookingUrl: course.booking_url };
    }
    const info = await getCourseInfo(cfg.dbname);
    if (!info) return { unavailable: true, bookingUrl: course.booking_url };

    const body = {
      BCC: bcc(cfg.dbname),
      StrDate: params.date.replace(/-/g, ''),
      StrTime: '0000',
      TeePriceClassID: info.Master_TeePriceClassID,
      IncludeExisting: false,
      Master_CarriageID: info.Master_CarriageID,
      Master_TeePriceClassIDs: `,${info.Master_TeePriceClassID},`,
      OnlineBookingFormat: 0,
      OnlineBookingMaxDays: 7,
    };
    const res = await fetch(`${API}/OnlineAppointmentRetrieve`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from eagleclub`);
    const json = (await res.json()) as { LstAppointment?: Appointment[] };
    const list = (json.LstAppointment ?? []).filter((a) => a.Date === params.date.replace(/-/g, ''));

    const slots: TeeTimeSlot[] = [];
    for (const a of list) {
      const openSpots = a.Slots - (a.LstPlayer?.length ?? 0);
      if (openSpots < params.players) continue;
      const time = toIso(a.Date, a.Time);
      const nine = parseFloat(a.NineFee);
      const eighteen = parseFloat(a.EighteenFee);
      const cartNine = parseFloat(a.CarriageNineFee);
      const cartEighteen = parseFloat(a.CarriageEighteenFee);
      if (params.holes !== 9 && eighteen > 0) {
        slots.push({
          time,
          price: eighteen,
          cartPrice: cartEighteen > 0 ? eighteen + cartEighteen : null,
          spots: openSpots,
          holes: 18,
          bookingUrl: course.booking_url,
        });
      }
      if (params.holes !== 18 && nine > 0) {
        slots.push({
          time,
          price: nine,
          cartPrice: cartNine > 0 ? nine + cartNine : null,
          spots: openSpots,
          holes: 9,
          bookingUrl: course.booking_url,
        });
      }
    }
    return slots;
  },
};
