import { chromium } from '@playwright/test';
async function main() {
  const [url = 'http://localhost:3000', out = 'scripts/shot.png', actions = ''] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (actions === 'search') {
    await page.fill('#zip', '43016');
    await page.fill('input[aria-label="From date"]', '2026-07-05');
    await page.fill('input[aria-label="To date"]', '2026-07-05');
    await page.click('.searchbtn');
    await page.waitForSelector('.chip', { timeout: 20000 });
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: out, fullPage: false });
  console.log('saved', out);
  await browser.close();
}
main();
