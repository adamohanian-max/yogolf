/**
 * Harvest ForeUp course metadata + schedule ids from a booking page.
 *
 *   npx tsx scripts/foreup_harvest.ts 19166 20290 ...
 *   npx tsx scripts/foreup_harvest.ts --scan 18000 23000 --state MA   # id sweep
 *
 * Prints one JSON line per course: {courseId, name, city, state, zip, lat, lng,
 * phone, website, courseType, onlineBooking, schedules:[{id,name,holes,bookingClasses}]}
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface HarvestResult {
  courseId: number;
  name: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  website: string;
  timezone: string;
  courseType: string;
  onlineBooking: boolean;
  schedules: { id: number; name: string; holes?: number; bookingClasses: { id: number; name: string }[] }[];
}

function extractVar(html: string, name: string): unknown {
  // Matches `NAME = {...};` or `NAME = [...];` or `NAME = false;` on the page
  const re = new RegExp(`\\b${name}\\s*=\\s*(.*?);\\s*\\n`, 's');
  const m = html.match(re);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    return m[1];
  }
}

export async function harvestForeup(courseId: number): Promise<HarvestResult | null> {
  const res = await fetch(`https://foreupsoftware.com/index.php/booking/${courseId}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const course = extractVar(html, 'COURSE') as Record<string, unknown> | undefined;
  if (!course || typeof course !== 'object' || !course.name) return null;

  const schedulesRaw = extractVar(html, 'SCHEDULES');
  const schedules: HarvestResult['schedules'] = [];
  if (Array.isArray(schedulesRaw)) {
    for (const s of schedulesRaw as Record<string, unknown>[]) {
      const classes = Array.isArray(s.booking_classes)
        ? (s.booking_classes as Record<string, unknown>[]).map((b) => ({
            id: Number(b.booking_class_id ?? b.id),
            name: String(b.name ?? ''),
          }))
        : [];
      schedules.push({
        id: Number(s.teesheet_id ?? s.schedule_id ?? s.id),
        name: String(s.title ?? s.name ?? ''),
        holes: s.holes != null ? Number(s.holes) : undefined,
        bookingClasses: classes,
      });
    }
  }

  return {
    courseId,
    name: String(course.name),
    city: String(course.city ?? ''),
    state: String(course.state ?? ''),
    zip: String(course.zip ?? course.postal ?? ''),
    lat: course.latitude_centroid ? Number(course.latitude_centroid) : null,
    lng: course.longitude_centroid ? Number(course.longitude_centroid) : null,
    phone: String(course.phone ?? ''),
    website: String(course.website ?? ''),
    timezone: String(course.timezone ?? ''),
    courseType: String(course.course_type ?? ''),
    onlineBooking: course.online_booking === '1' || course.online_booking === 1,
    schedules,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--scan') {
    const start = Number(args[1]);
    const end = Number(args[2]);
    const stateIdx = args.indexOf('--state');
    const state = stateIdx > -1 ? args[stateIdx + 1] : null;
    const CONCURRENCY = 8;
    let inFlight: Promise<void>[] = [];
    for (let id = start; id <= end; id++) {
      const p = harvestForeup(id)
        .then((r) => {
          if (r && (!state || r.state === state)) console.log(JSON.stringify(r));
        })
        .catch(() => {});
      inFlight.push(p);
      if (inFlight.length >= CONCURRENCY) {
        await Promise.all(inFlight);
        inFlight = [];
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    await Promise.all(inFlight);
    return;
  }
  for (const idStr of args) {
    const r = await harvestForeup(Number(idStr));
    console.log(r ? JSON.stringify(r, null, 2) : `null for ${idStr}`);
  }
}

if (process.argv[1]?.endsWith('foreup_harvest.ts')) main();
