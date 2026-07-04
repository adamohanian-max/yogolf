/**
 * Bulk-probe candidate {slug}.cps.golf hosts (one slug per line on argv[2] file)
 * and print the ones that resolve to a real CPS site with courses.
 *
 *   npx tsx scripts/cps_discover.ts candidates.txt
 */
import fs from 'fs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function probe(slug: string) {
  const host = `${slug}.cps.golf`;
  try {
    const form = new URLSearchParams();
    form.set('client_id', 'onlinereswebshortlived');
    const tokRes = await fetch(`https://${host}/identityapi/myconnect/token/short`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(6000),
    });
    if (!tokRes.ok) return;
    const token = (await tokRes.json()).access_token as string;
    if (!token) return;
    const optRes = await fetch(
      `https://${host}/onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/${slug}?version=1&product=3`,
      {
        headers: {
          'User-Agent': UA,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'x-componentid': '1',
          'x-productid': '1',
          'x-siteid': '1',
          'x-terminalid': '1',
          'x-websiteid': '00000000-0000-0000-0000-000000000000',
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!optRes.ok) return;
    const opt = (await optRes.json()) as {
      webSiteId?: string;
      courseOptions?: { courseId: number; courseName: string }[];
    };
    if (!opt.courseOptions?.length) return;
    for (const c of opt.courseOptions) {
      console.log(JSON.stringify({ host, siteName: slug, courseId: c.courseId, courseName: c.courseName, webSiteId: opt.webSiteId }));
    }
  } catch {
    // DNS miss / timeout — not a CPS site
  }
}

async function main() {
  const slugs = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const CONCURRENCY = 12;
  for (let i = 0; i < slugs.length; i += CONCURRENCY) {
    await Promise.all(slugs.slice(i, i + CONCURRENCY).map(probe));
  }
}
main();
