/**
 * Verify a ForeUp login works and reveals tee times for a gated course.
 * Add your account to data/credentials.json first, then:
 *
 *   npx tsx scripts/foreup_login_test.ts <foreupCourseId> [date=YYYY-MM-DD]
 *
 * Walks the same steps the adapter does (login → discover schedule → fetch
 * times) with verbose output so you can see exactly where it succeeds or fails.
 */
import { foreupLogin } from '../lib/credentials';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const BASE = 'https://foreupsoftware.com/index.php/api/booking';

async function main() {
  const courseId = process.argv[2];
  const date = process.argv[3] ?? new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  if (!courseId) {
    console.error('usage: npx tsx scripts/foreup_login_test.ts <foreupCourseId> [YYYY-MM-DD]');
    process.exit(1);
  }
  const creds = foreupLogin(courseId);
  if (!creds) {
    console.error(`No credentials for course ${courseId} in data/credentials.json (foreup.${courseId}).`);
    process.exit(1);
  }
  console.log(`1) Logging in as ${creds.username} at course ${courseId}…`);
  const loginRes = await fetch(`${BASE}/users/login`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', 'Api-Key': 'no_limits' },
    body: new URLSearchParams({ username: creds.username, password: creds.password, course_id: courseId }),
  });
  const loginJson = (await loginRes.json().catch(() => ({}))) as { success?: boolean; msg?: string };
  if (!loginJson.success) {
    console.error(`   ✗ login failed: ${loginJson.msg ?? 'unknown'} (is the account registered + email verified at this course?)`);
    process.exit(1);
  }
  const cookie = 'PHPSESSID=' + (/PHPSESSID=([^;]+)/.exec(loginRes.headers.get('set-cookie') ?? '')?.[1] ?? '');
  console.log('   ✓ logged in');

  console.log('2) Fetching schedules…');
  const schedRes = await fetch(`${BASE}/courses/${courseId}/schedules`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Api-Key': 'no_limits', Cookie: cookie },
  });
  const schedules = (await schedRes.json().catch(() => [])) as { teesheet_id?: number; schedule_id?: number; id?: number; title?: string; name?: string }[];
  if (!Array.isArray(schedules) || !schedules.length) {
    console.error(`   ✗ no schedules returned (HTTP ${schedRes.status})`);
    process.exit(1);
  }
  const pick = schedules[0];
  const scheduleId = pick.teesheet_id ?? pick.schedule_id ?? pick.id;
  console.log(`   ✓ ${schedules.length} schedule(s); using ${scheduleId} "${pick.title ?? pick.name ?? ''}"`);

  console.log(`3) Fetching tee times for ${date}…`);
  const [y, m, d] = date.split('-');
  const qs = new URLSearchParams({ time: 'all', date: `${m}-${d}-${y}`, holes: 'all', players: '2', schedule_id: String(scheduleId), specials_only: '0', api_key: 'no_limits' });
  qs.append('schedule_ids[]', String(scheduleId));
  const timesRes = await fetch(`${BASE}/times?${qs}`, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Cookie: cookie } });
  const times = (await timesRes.json().catch(() => [])) as { time: string; available_spots: number; green_fee_18?: number }[];
  if (!Array.isArray(times)) {
    console.error(`   ✗ times call did not return a list (HTTP ${timesRes.status})`);
    process.exit(1);
  }
  console.log(`   ✓ ${times.length} tee times`);
  for (const t of times.slice(0, 4)) console.log(`      ${t.time}  ${t.available_spots} spots  ${t.green_fee_18 ? '$' + t.green_fee_18 : ''}`);
  console.log('\n✅ This course will show live in YoGolf.');
}

main();
