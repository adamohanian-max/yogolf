/**
 * Inspect a CPS golf site: list the courses it hosts (id, name, GUID) and its
 * webSiteId, so they can be added to the seed.
 *
 *   npx tsx scripts/cps_probe_site.ts georgewright.cps.golf brookline.cps.golf ...
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function probe(host: string) {
  const siteName = host.split('.')[0];
  try {
    const form = new URLSearchParams();
    form.set('client_id', 'onlinereswebshortlived');
    const tokRes = await fetch(`https://${host}/identityapi/myconnect/token/short`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!tokRes.ok) {
      console.log(`${host}: no CPS token (HTTP ${tokRes.status})`);
      return;
    }
    const token = (await tokRes.json()).access_token as string;
    const headers = {
      'User-Agent': UA,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'x-componentid': '1',
      'x-productid': '1',
      'x-siteid': '1',
      'x-terminalid': '1',
      'x-websiteid': '00000000-0000-0000-0000-000000000000',
    };
    const optRes = await fetch(
      `https://${host}/onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/${siteName}?version=1&product=3`,
      { headers }
    );
    if (!optRes.ok) {
      console.log(`${host}: options HTTP ${optRes.status}`);
      return;
    }
    const opt = (await optRes.json()) as {
      webSiteId?: string;
      courseOptions?: { courseId: number; courseName: string; courseGUID?: string }[];
    };
    console.log(`\n${host}  (webSiteId ${opt.webSiteId})`);
    for (const c of opt.courseOptions ?? []) {
      console.log(`  courseId ${c.courseId}  "${c.courseName}"`);
    }
    if (!opt.courseOptions?.length) console.log('  (no courses listed)');
  } catch (e) {
    console.log(`${host}: ${String(e)}`);
  }
}

async function main() {
  for (const host of process.argv.slice(2)) {
    await probe(host.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  }
}
main();
