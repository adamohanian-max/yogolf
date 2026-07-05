/**
 * Probe {slug}.teesnap.net candidates; for hits, find the courseId and print it.
 *   npx tsx scripts/teesnap_discover.ts candidates.txt
 */
import fs from 'fs';
import { chromium } from '@playwright/test';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function exists(sub: string): Promise<string | null> {
  // TeeSnap sites return the SPA shell; a bogus subdomain fails DNS/redirect.
  try {
    const res = await fetch(`https://${sub}.teesnap.net/`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(7000),
      redirect: 'manual',
    });
    if (res.status >= 200 && res.status < 400) {
      const body = res.status < 300 ? await res.text() : '';
      if (res.status >= 300 || /teesnap|ng-app|customer-api/i.test(body)) return sub;
    }
  } catch {
    /* DNS miss */
  }
  return null;
}

async function courseId(sub: string): Promise<number | null> {
  const b = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const p = await b.newPage({ userAgent: UA });
    let id: number | null = null;
    p.on('request', (r) => {
      const m = r.url().match(/teetimes-day\?course=(\d+)/);
      if (m) id = Number(m[1]);
    });
    await p.goto(`https://${sub}.teesnap.net/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(6000);
    return id;
  } finally {
    await b.close();
  }
}

async function main() {
  const slugs = [...new Set(fs.readFileSync(process.argv[2], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))];
  const hits: string[] = [];
  const CONC = 16;
  for (let i = 0; i < slugs.length; i += CONC) {
    const found = await Promise.all(slugs.slice(i, i + CONC).map(exists));
    for (const f of found) if (f) hits.push(f);
  }
  console.error(`teesnap subdomains resolving: ${hits.length}`);
  for (const sub of hits) {
    const id = await courseId(sub);
    console.log(JSON.stringify({ subdomain: sub, courseId: id }));
  }
}
main();
