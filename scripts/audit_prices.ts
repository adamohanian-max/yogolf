/**
 * Price audit: call each live course's booking adapter and flag displayed prices
 * that look wrong — specifically an 18-hole slot priced under $30, or an 18-hole
 * price implausibly low next to the course's own 9-hole rate (a mislabel signal:
 * a 9-hole / twilight / lowest rate leaking into an 18-hole-labeled slot).
 *
 *   npx tsx scripts/audit_prices.ts [--date YYYY-MM-DD] [--state MA] [--limit N]
 *
 * Read-only: hits provider APIs, writes nothing. TeeTimeSlot.price is whole-USD,
 * per player, walking green fee (lib/types.ts) — there is no normalization layer,
 * so whatever an adapter returns is what the UI shows.
 */
import { allCourses } from '../lib/db';
import { getAdapter } from '../lib/adapters';
import { representativePrice } from '../lib/types';
import type { Course, TeeTimeSlot } from '../lib/types';

const SUB = 30; // "suspiciously low" threshold for an 18-hole green fee

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// A near Saturday (weekend rates are the most complete). Date.now() is fine here —
// this is a live one-off script, not a resumable workflow.
function nextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

interface Row {
  name: string;
  town: string;
  provider: string;
  min18: number | null;
  min9: number | null;
  flags: string[];
}

async function priceOf(course: Course, holes: 9 | 18 | 0, date: string): Promise<TeeTimeSlot[]> {
  try {
    const res = await getAdapter(course.provider).fetchTeeTimes(course, { date, players: 1, holes });
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

function minPrice(slots: TeeTimeSlot[], holes: 9 | 18): number | null {
  const ps = slots
    .filter((s) => s.holes === holes || s.holes === 0)
    .map((s) => s.price)
    .filter((p): p is number => p != null && p > 0);
  return ps.length ? Math.min(...ps) : null;
}

async function main() {
  const date = arg('--date') ?? nextSaturday();
  const state = arg('--state');
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;

  let courses = allCourses().filter((c) => c.provider && c.provider !== 'fallback');
  if (state) courses = courses.filter((c) => c.state === state);
  console.log(`Auditing ${Math.min(courses.length, limit)} live course(s) for ${date} (players=1)…\n`);

  const rows: Row[] = [];
  const CONC = 8;
  const queue = courses.slice(0, limit);
  let i = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (i < queue.length) {
        const c = queue[i++];
        // s0 = the default "both" view the UI actually renders; s18 = 18-only.
        const [s0, s18, s9] = await Promise.all([
          priceOf(c, 0, date),
          priceOf(c, 18, date),
          priceOf(c, 9, date),
        ]);
        const min18 = minPrice(s18, 18);
        const min9 = minPrice(s9, 9);
        const flags: string[] = [];
        // Definite bug: the both-view representative price is far below the 18-only
        // representative → a 9-hole/twilight rate is being labeled/sorted as 18-hole
        // (the teeitup holes=0 conflation this script was written to catch).
        const bothRep = representativePrice(s0, 'any');
        const rep18 = representativePrice(s18, 'any');
        if (Number.isFinite(bothRep) && Number.isFinite(rep18) && bothRep < rep18 * 0.75) {
          flags.push(`CONFLATION both=$${Math.round(bothRep)} vs 18=$${Math.round(rep18)}`);
        }
        // Informational: a genuinely low 18-hole rate (cheap muni / twilight). Not a
        // bug on its own — listed so a human can eyeball it.
        if (min18 != null && min18 < SUB) flags.push(`18h < $${SUB} (verify)`);
        if (flags.length) rows.push({ name: c.name, town: c.town, provider: c.provider, min18, min9, flags });
      }
    })
  );

  rows.sort((a, b) => a.provider.localeCompare(b.provider) || (a.min18 ?? 0) - (b.min18 ?? 0));
  if (!rows.length) {
    console.log('✓ No suspicious sub-$30 / mislabeled 18-hole prices found.');
    return;
  }
  console.log(`⚠ ${rows.length} course(s) with suspicious pricing:\n`);
  console.log('provider     18h    9h    course (town) — flags');
  for (const r of rows) {
    const p18 = r.min18 != null ? `$${r.min18}` : '—';
    const p9 = r.min9 != null ? `$${r.min9}` : '—';
    console.log(`${r.provider.padEnd(11)} ${p18.padStart(5)} ${p9.padStart(5)}  ${r.name} (${r.town}) — ${r.flags.join(', ')}`);
  }
  // Per-provider tally so offenders cluster.
  const byProv = new Map<string, number>();
  for (const r of rows) byProv.set(r.provider, (byProv.get(r.provider) ?? 0) + 1);
  console.log('\nby provider: ' + [...byProv.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}=${n}`).join('  '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
