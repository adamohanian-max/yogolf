/**
 * Harvest Club Caddie booking config from a course website: the apimanager
 * shard + public token from its booking link, then the CourseId(s) from the
 * rendered widget.
 *
 *   npx tsx scripts/clubcaddie_harvest.ts <course-website> [<website> ...]
 *
 * Prints one JSON line per course: {website, shard, apikey, courses:[{courseId,name}]}
 */
import { chromium } from '@playwright/test';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface CCHarvest {
  website: string;
  shard: string | null;
  apikey: string | null;
  courses: { courseId: number; name: string }[];
}

export async function harvestClubCaddie(website: string): Promise<CCHarvest> {
  const out: CCHarvest = { website, shard: null, apikey: null, courses: [] };
  const url = website.startsWith('http') ? website : `https://${website}`;
  let html = '';
  try {
    html = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })).text();
  } catch {
    return out;
  }
  const link = html.match(/apimanager-(cc\d+)\.clubcaddie\.com\/webapi\/view\/([a-z0-9]+)/i);
  if (!link) return out;
  out.shard = link[1];
  out.apikey = link[2];

  // Render the widget to read CourseId(s) from the DOM.
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page
      .goto(`https://apimanager-${out.shard}.clubcaddie.com/webapi/view/${out.apikey}`, { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await page.waitForTimeout(6000);
    const found = await page.evaluate(() => {
      const seen = new Map<string, string>();
      document.querySelectorAll('input[name="CourseId"]').forEach((e) => {
        const v = (e as HTMLInputElement).value;
        if (/^\d+$/.test(v)) seen.set(v, seen.get(v) ?? '');
      });
      document.querySelectorAll('select option').forEach((o) => {
        const v = (o as HTMLOptionElement).value;
        if (/^\d{5,7}$/.test(v)) seen.set(v, (o.textContent || '').trim());
      });
      return [...seen.entries()].map(([courseId, name]) => ({ courseId: Number(courseId), name }));
    });
    out.courses = found;
  } finally {
    await browser.close();
  }
  return out;
}

async function main() {
  for (const w of process.argv.slice(2)) {
    console.log(JSON.stringify(await harvestClubCaddie(w)));
  }
}
if (process.argv[1]?.endsWith('clubcaddie_harvest.ts')) main();
