import { chromium } from '@playwright/test';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  const page = await browser.newPage({ userAgent: UA });
  page.on('response', (res) => {
    if (res.url().includes('/marketplace/clubs/') || res.url().includes('/api/')) console.log('CALL', res.status(), res.url());
  });
  await page.goto('https://www.chronogolf.com/club/woburn-country-club', { waitUntil: 'networkidle', timeout: 20000 }).catch((e)=>console.log('nav err', e.message));
  await page.waitForTimeout(5000);
  console.log('TITLE', await page.title());
  await browser.close();
})();
