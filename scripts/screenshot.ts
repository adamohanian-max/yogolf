import { chromium } from '@playwright/test';
async function main() {
  const [zip = '01609', out = 'scripts/shot.png'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.fill('#zip', zip);
  await page.selectOption('#radius', '40');
  await page.fill('input[aria-label="From date"]', '2026-07-05');
  await page.fill('input[aria-label="To date"]', '2026-07-05');
  await page.selectOption('#sort', 'best').catch(()=>{});
  await page.click('.searchbtn');
  await page.waitForSelector('.chip', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out, fullPage: false });
  console.log('saved', out);
  await browser.close();
}
main();
