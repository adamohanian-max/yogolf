import { chromium } from '@playwright/test';
async function main() {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const b = await chromium.launch();
  const p = await b.newPage({ userAgent: UA });
  const calls: string[] = [];
  p.on('request', (r) => {
    const u = r.url();
    if (!/\.(js|css|png|jpg|svg|woff|ico)(\?|$)/.test(u)) calls.push(r.method() + ' ' + u);
  });
  await p.goto('https://player.eagleclubsystems.online/#/tee-slot?dbname=gc20220515', { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => console.log('goto err', e.message));
  await p.waitForTimeout(5000);
  console.log('--- calls ---');
  for (const c of calls) console.log(c);
  await b.close();
}
main();
export {};
