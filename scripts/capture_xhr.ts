/**
 * Load a page in headless chromium, print every XHR/fetch URL + status and
 * dump JSON bodies of interesting responses.
 *
 *   npx tsx scripts/capture_xhr.ts <url> [match-substring] [wait-ms]
 */
import { chromium } from '@playwright/test';

async function main() {
  const [url, match = '', waitMsArg = '8000'] = process.argv.slice(2);
  const waitMs = Number(waitMsArg);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('response', async (res) => {
    const req = res.request();
    if (!['xhr', 'fetch'].includes(req.resourceType())) return;
    const u = res.url();
    console.log(`${res.status()} ${req.method()} ${u}`);
    if (match && u.includes(match)) {
      const headers = req.headers();
      console.log('  REQ HEADERS:', JSON.stringify(headers));
      const post = req.postData();
      if (post) console.log('  REQ BODY:', post.slice(0, 500));
      try {
        const body = await res.text();
        console.log('  RES BODY:', body.slice(0, 2000));
      } catch {
        /* body may be unavailable */
      }
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);
  await browser.close();
}

main();
