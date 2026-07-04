export {};

/**
 * End-to-end verification of the /api/search filters against the live server.
 * Asserts each filter actually constrains results. Run with `npm run dev` up.
 *
 *   npx tsx scripts/verify_search.ts
 */
const BASE = 'http://localhost:3000';
const BOSTON = { lat: 42.3496, lng: -71.1003 }; // Allston-ish

function nextWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 4);
  return d.toISOString().slice(0, 10);
}
const DATE = nextWeekday();

interface Slot { time: string; price: number | null; spots: number; holes: number }
interface Result { course: { name: string; score: number }; distanceMiles: number; slots: Slot[]; unavailable: boolean }

async function search(params: Record<string, string>): Promise<{ total: number; results: Result[] }> {
  const qs = new URLSearchParams({ lat: String(BOSTON.lat), lng: String(BOSTON.lng), ...params });
  const res = await fetch(`${BASE}/api/search?${qs}`);
  const text = await res.text();
  let total = 0;
  const results: Result[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'meta') total = msg.total;
    else if (msg.type === 'course') results.push(msg.result);
  }
  return { total, results };
}

const checks: { name: string; run: () => Promise<string | null> }[] = [];
function check(name: string, run: () => Promise<string | null>) { checks.push({ name, run }); }

const liveOf = (r: { results: Result[] }) => r.results.filter((x) => x.slots.length > 0);

check('radius: 10mi ⊆ 40mi and all within radius', async () => {
  const r10 = await search({ radius: '10', dateFrom: DATE });
  const r40 = await search({ radius: '40', dateFrom: DATE });
  if (r40.total <= r10.total) return `expected more courses at 40mi (${r40.total}) than 10mi (${r10.total})`;
  const over = r40.results.find((x) => x.distanceMiles > 40.5);
  if (over) return `course beyond radius: ${over.course.name} @ ${over.distanceMiles}mi`;
  return null;
});

check('maxPrice: no live slot exceeds cap', async () => {
  const cap = 45;
  const r = await search({ radius: '40', dateFrom: DATE, maxPrice: String(cap) });
  for (const c of liveOf(r)) for (const s of c.slots) {
    if (s.price != null && s.price > cap) return `${c.course.name} slot $${s.price} > $${cap}`;
  }
  return null;
});

check('time range: all slots within 12:00–15:00', async () => {
  const r = await search({ radius: '40', dateFrom: DATE, timeStart: '12:00', timeEnd: '15:00' });
  for (const c of liveOf(r)) for (const s of c.slots) {
    const hm = s.time.slice(11, 16);
    if (hm < '12:00' || hm > '15:00') return `${c.course.name} slot at ${hm} outside window`;
  }
  return null;
});

check('holes=9: every slot is 9 or flexible', async () => {
  const r = await search({ radius: '40', dateFrom: DATE, holes: '9' });
  for (const c of liveOf(r)) for (const s of c.slots) {
    if (s.holes !== 9 && s.holes !== 0) return `${c.course.name} returned ${s.holes}h for a 9-hole search`;
  }
  return liveOf(r).length === 0 ? 'no 9-hole live slots found (soft)' : null;
});

check('players=4: every slot has ≥4 spots', async () => {
  const r = await search({ radius: '40', dateFrom: DATE, players: '4' });
  for (const c of liveOf(r)) for (const s of c.slots) {
    if (s.spots < 4) return `${c.course.name} slot has ${s.spots} spots for a 4-player search`;
  }
  return null;
});

check('date range: slots span multiple days', async () => {
  const d0 = new Date(DATE + 'T12:00:00');
  const d2 = new Date(d0); d2.setDate(d2.getDate() + 2);
  const r = await search({ radius: '40', dateFrom: DATE, dateTo: d2.toISOString().slice(0, 10) });
  const days = new Set<string>();
  for (const c of liveOf(r)) for (const s of c.slots) days.add(s.time.slice(0, 10));
  if (days.size < 2) return `only ${days.size} distinct day(s) across a 3-day range`;
  return null;
});

// Sorting is applied client-side over the streamed (completion-order) results;
// the UI sort is asserted in the Playwright e2e. Here we verify the underlying
// DATA supports each sort: scores are numeric and live prices are present.
check('sort data: every live course has a numeric score, and prices exist', async () => {
  const r = await search({ radius: '40', dateFrom: DATE, sort: 'best' });
  const live = liveOf(r);
  const noScore = live.find((c) => typeof c.course.score !== 'number' || Number.isNaN(c.course.score));
  if (noScore) return `${noScore.course.name} has no numeric score`;
  const withPrice = live.filter((c) => c.slots.some((s) => s.price != null));
  if (withPrice.length < 3) return `only ${withPrice.length} live courses expose a price (need ≥3 for price sort)`;
  return null;
});

check('public-only: no known private club appears', async () => {
  const priv = ['andover country club', 'country club of billerica', 'stockbridge golf club', 'whitinsville golf club', 'lexington golf club', 'nabnasset lake country club'];
  const r = await search({ radius: '100', dateFrom: DATE });
  const hit = r.results.find((c) => priv.includes(c.course.name.toLowerCase()));
  return hit ? `private club present: ${hit.course.name}` : null;
});

async function main() {
  let pass = 0;
  for (const c of checks) {
    try {
      const msg = await c.run();
      if (msg && msg.endsWith('(soft)')) { console.log(`~ SOFT ${c.name} — ${msg}`); pass++; }
      else if (msg) console.log(`✗ FAIL ${c.name} — ${msg}`);
      else { console.log(`✓ PASS ${c.name}`); pass++; }
    } catch (e) {
      console.log(`✗ ERROR ${c.name} — ${e}`);
    }
  }
  console.log(`\n${pass}/${checks.length} checks passed`);
  process.exit(pass === checks.length ? 0 : 1);
}
main();