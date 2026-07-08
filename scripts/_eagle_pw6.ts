import { chromium } from '@playwright/test';
async function main() {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const b = await chromium.launch();
  const p = await b.newPage({ userAgent: UA });
  p.on('response', async (r) => {
    const u = r.url();
    if (/OnlineAppointmentRetrieve/.test(u)) {
      try {
        const body = await r.text();
        const j = JSON.parse(body);
        const dates = new Set(j.LstAppointment?.map((a: any) => a.Date));
        console.log('distinct dates:', [...dates]);
        const withPlayers = j.LstAppointment?.filter((a: any) => a.LstPlayer?.length > 0);
        console.log('records with players booked:', withPlayers?.length);
        if (withPlayers?.[0]) console.log('booked sample:', JSON.stringify(withPlayers[0]).slice(0,300));
      } catch (e) { console.log('err', e); }
    }
  });
  await p.goto('https://player.eagleclubsystems.online/#/tee-slot?dbname=gc20220515', { waitUntil: 'load', timeout: 15000 }).catch((e) => console.log('goto err', e.message));
  await p.waitForTimeout(5000);
  await b.close();
}
main().catch(e => { console.log('fatal', e.message); process.exit(1); });
export {};
