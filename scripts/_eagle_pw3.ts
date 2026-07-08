import { chromium } from '@playwright/test';
async function main() {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const b = await chromium.launch();
  const p = await b.newPage({ userAgent: UA });
  p.on('request', (r) => {
    const u = r.url();
    if (/OnlineCourseRetrieve|OnlineAppointmentRetrieve|OnlineTheRestRetrieve/.test(u)) {
      console.log('URL:', u);
      console.log('METHOD:', r.method());
      console.log('POSTDATA:', r.postData());
      console.log('---');
    }
  });
  p.on('response', async (r) => {
    const u = r.url();
    if (/OnlineCourseRetrieve|OnlineAppointmentRetrieve/.test(u)) {
      try { const body = await r.text(); console.log('RESPONSE for', u.split('/').pop(), ':', body.slice(0, 500)); } catch {}
    }
  });
  await p.goto('https://player.eagleclubsystems.online/#/tee-slot?dbname=gc20220515', { waitUntil: 'load', timeout: 15000 }).catch((e) => console.log('goto err', e.message));
  await p.waitForTimeout(5000);
  await b.close();
}
main().catch(e => { console.log('fatal', e.message); process.exit(1); });
export {};
