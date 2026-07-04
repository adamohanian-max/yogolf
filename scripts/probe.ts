/**
 * Probe a course's live adapter.
 *
 *   npx tsx scripts/probe.ts <course-id> [date=YYYY-MM-DD] [players=2] [holes=0|9|18]
 *   npx tsx scripts/probe.ts --all [date]           # probe every course, print pass/fail table
 */
import { allCourses, getCourse } from '../lib/db';
import { getAdapter } from '../lib/adapters';
import type { Course } from '../lib/types';

function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function probeOne(course: Course, date: string, players: number, holes: 0 | 9 | 18) {
  const adapter = getAdapter(course.provider);
  const started = Date.now();
  try {
    const result = await adapter.fetchTeeTimes(course, { date, players, holes });
    const ms = Date.now() - started;
    if (Array.isArray(result)) {
      return { course, ok: true, slots: result.length, ms, sample: result.slice(0, 3) };
    }
    return { course, ok: true, slots: -1, ms, sample: [] as unknown[] }; // fallback link
  } catch (e) {
    return { course, ok: false, slots: 0, ms: Date.now() - started, error: String(e) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? tomorrow();
  const players = Number(args.find((a) => /^players=/.test(a))?.split('=')[1] ?? 2);
  const holes = Number(args.find((a) => /^holes=/.test(a))?.split('=')[1] ?? 0) as 0 | 9 | 18;

  if (args[0] === '--all') {
    const courses = allCourses().filter((c) => c.provider !== 'fallback');
    let pass = 0;
    for (const c of courses) {
      const r = await probeOne(c, date, players, holes);
      const status = r.ok ? (r.slots > 0 ? `OK   ${String(r.slots).padStart(3)} slots` : r.slots === 0 ? 'OK     0 slots' : 'LINK') : 'FAIL';
      if (r.ok) pass++;
      console.log(`${status}  ${String(r.ms).padStart(5)}ms  [${c.provider.padEnd(10)}] ${c.id} — ${c.name}`);
      if (!r.ok) console.log(`      ${r.error}`);
    }
    console.log(`\n${pass}/${courses.length} adapters responded without error (date ${date})`);
    return;
  }

  const course = getCourse(args[0]);
  if (!course) {
    console.error(`No course '${args[0]}'. Known ids:`);
    for (const c of allCourses()) console.error(`  ${c.id}  [${c.provider}] ${c.name}`);
    process.exit(1);
  }
  console.log(`Probing ${course.name} [${course.provider}] for ${date}, ${players} players, holes=${holes || 'both'}`);
  const r = await probeOne(course, date, players, holes);
  if (!r.ok) {
    console.error(`FAIL after ${r.ms}ms: ${r.error}`);
    process.exit(1);
  }
  if (r.slots === -1) {
    console.log(`Fallback link only → ${course.booking_url}`);
  } else {
    console.log(`${r.slots} open slots in ${r.ms}ms`);
    console.log(JSON.stringify(r.sample, null, 2));
  }
}

main();
