import { chromium } from '@playwright/test';
async function main() {
  const [zip='02184', out='scripts/shot.png', width='1280', mode='search'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: 940 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  if (mode!=='idle') {
    await page.fill('#zip', zip);
    await page.selectOption('#radius', '40');
    await page.fill('input[aria-label="From date"]', '2026-07-08');
    await page.fill('input[aria-label="To date"]', '2026-07-08');
    await page.click('.searchbtn');
    await page.waitForSelector('.chip', { timeout: 25000 });
    await page.waitForTimeout(1800);
  }
  await page.screenshot({ path: out, fullPage: mode==='full' });
  console.log('saved', out); await browser.close();
}
main();
