import { chromium } from '@playwright/test';
async function main() {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const b = await chromium.launch();
  const ctx = await b.newContext({ userAgent: UA });
  const p = await ctx.newPage();
  const calls: string[] = [];
  p.on('request', (r) => { calls.push(r.method() + ' ' + r.url()); });
  await p.goto('https://admin.teeon.com/portal/grotoncountryclub/teetimes/grotoncountryclub', { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => console.log('goto err', e.message));
  await p.waitForTimeout(4000);
  console.log('--- all admin.teeon.com calls ---');
  for (const c of calls) if (c.includes('admin.teeon.com')) console.log(c);
  console.log('--- cookies ---');
  console.log(JSON.stringify(await ctx.cookies(), null, 1));
  await b.close();
}
main();
export {};
