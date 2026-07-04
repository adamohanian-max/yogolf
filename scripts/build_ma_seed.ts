/**
 * Convert a ForeUp id-scan (NDJSON from foreup_harvest --scan) into MA seed
 * records.
 *
 *   npx tsx scripts/build_ma_seed.ts <scan.ndjson> [state=MA]
 *
 * Courses with an embedded PUBLIC schedule → live `foreup` records.
 * Courses whose schedules are login-gated (empty) → `fallback` records that
 * still surface the booking link. Coordinates come from the zip centroid
 * (ForeUp exposes latitude but not longitude), so radius search works.
 *
 * Writes data/seed/foreup_<state>.json. Ratings are left null here and
 * enriched separately (data/seed/ratings_<state>.json overrides by id).
 */
import fs from 'fs';
import path from 'path';
import { zipToLatLng } from '../lib/geo';

interface Schedule {
  id: number;
  name: string;
  holes?: number;
  bookingClasses: { id: number; name: string }[];
}
interface Harvest {
  courseId: number;
  name: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  phone: string;
  website: string;
  courseType: string;
  schedules: Schedule[];
}

const PUBLIC_RE = /public|guest|online|non.?member|daily|resident/i;
const MEMBER_RE = /member|league|staff|employee|twilight only/i;
// Indoor simulators / ranges / lessons are not real courses — exclude them.
const NON_COURSE_RE = /simulator|indoor|lounge|igolf|driving range|\brange\b|lesson|academy|topgolf|entertainment/i;
// ForeUp's own demo/template accounts (placeholder city "Boston", these demo sites).
const DEMO_SITE_RE = /heronridge|vbnational|riverfrontgolf|foreupsoftware\.com/i;
const DEMO_NAME_RE = /\bdemo\b|aberdeen ridge|fenway ridge|kenmore square|berklee creek/i;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function pickSchedule(h: Harvest): { schedule: Schedule; bookingClass?: number } | null {
  if (!h.schedules.length) return null;
  // Prefer a schedule whose name matches this course (not a sibling in an aggregate site).
  const nameKey = slug(h.name).split('-')[0];
  const scored = h.schedules
    .map((s) => {
      const publicClass = s.bookingClasses.find(
        (b) => PUBLIC_RE.test(b.name) && !MEMBER_RE.test(b.name)
      );
      const anyPublic = s.bookingClasses.length === 0 || publicClass;
      const matchesName = slug(s.name).includes(nameKey) || slug(h.city) === slug(s.name).split('-')[0];
      return { s, publicClass, hasPublic: !!anyPublic, matchesName };
    })
    .filter((x) => x.hasPublic);
  if (!scored.length) return null;
  scored.sort((a, b) => Number(b.matchesName) - Number(a.matchesName));
  const best = scored[0];
  return { schedule: best.s, bookingClass: best.publicClass?.id };
}

function main() {
  const [scanFile, state = 'MA'] = process.argv.slice(2);
  const lines = fs.readFileSync(scanFile, 'utf8').split('\n').filter(Boolean);
  const seen = new Set<string>();
  const records: Record<string, unknown>[] = [];
  let live = 0;
  let fallback = 0;
  let skippedNoGeo = 0;
  let skippedPrivate = 0;

  for (const line of lines) {
    let h: Harvest;
    try {
      h = JSON.parse(line);
    } catch {
      continue;
    }
    if (h.state !== state) continue;
    if (NON_COURSE_RE.test(h.name)) continue;
    if (DEMO_NAME_RE.test(h.name) || DEMO_SITE_RE.test(h.website ?? '')) continue;
    if (/private|semi-private members/i.test(h.courseType)) {
      skippedPrivate++;
      continue;
    }
    const geo = h.zip ? zipToLatLng(h.zip) : null;
    if (!geo) {
      skippedNoGeo++;
      continue;
    }
    let id = `${state.toLowerCase()}-${slug(h.name)}`;
    if (seen.has(id)) id = `${id}-${h.courseId}`;
    seen.add(id);

    const picked = pickSchedule(h);
    const base = {
      id,
      name: h.name,
      address: null,
      town: h.city || 'Massachusetts',
      state,
      zip: h.zip || null,
      lat: h.lat && Math.abs(h.lat) > 1 ? h.lat : geo.lat,
      lng: geo.lng,
      phone: h.phone || null,
      website: h.website || null,
      holes_total: picked?.schedule.holes ?? 18,
      google_rating: null,
      google_reviews: null,
      golfpass_rating: null,
      other_ratings: null,
      is_public: 1,
      notes: `foreup course ${h.courseId}`,
    };

    if (picked) {
      records.push({
        ...base,
        provider: 'foreup',
        provider_config: {
          courseId: h.courseId,
          scheduleId: picked.schedule.id,
          ...(picked.bookingClass ? { bookingClass: picked.bookingClass } : {}),
        },
        booking_url: `https://foreupsoftware.com/index.php/booking/${h.courseId}/${picked.schedule.id}`,
      });
      live++;
    } else {
      records.push({
        ...base,
        provider: 'fallback',
        provider_config: {},
        booking_url: `https://foreupsoftware.com/index.php/booking/${h.courseId}`,
      });
      fallback++;
    }
  }

  const out = path.join(process.cwd(), 'data', 'seed', `foreup_${state.toLowerCase()}.json`);
  fs.writeFileSync(out, JSON.stringify(records, null, 2));
  console.log(
    `Wrote ${records.length} ${state} records → ${path.relative(process.cwd(), out)}\n` +
      `  live foreup: ${live}\n  fallback: ${fallback}\n  skipped (no geo): ${skippedNoGeo}\n  skipped (private): ${skippedPrivate}`
  );
}

main();
