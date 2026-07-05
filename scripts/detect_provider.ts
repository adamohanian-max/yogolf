/**
 * Detect the booking provider for courses by fetching their website + the
 * pages its "book tee time" links point to, and matching known signatures.
 *
 *   npx tsx scripts/detect_provider.ts            # all fallback courses w/ website
 *   npx tsx scripts/detect_provider.ts <url...>   # ad-hoc
 */
import Database from 'better-sqlite3';
import path from 'path';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SIGS: [RegExp, string][] = [
  [/foreupsoftware\.com/i, 'foreup'],
  [/\bcps\.golf/i, 'cps'],
  [/chronogolf\.(com|ca)/i, 'chronogolf'],
  [/book\.teeitup|teeitup\.golf|teeitup\.com/i, 'teeitup'],
  [/golfnow\.com|gngated|gncircuit/i, 'golfnow'],
  [/teesnap\.(net|com)/i, 'teesnap'],
  [/clubcaddie|club-caddie/i, 'clubcaddie'],
  [/teecommerce|lightspeedhq|lightspeed\.app/i, 'teecommerce'],
  [/ezlinks|teewire|golfrev/i, 'ezlinks'],
  [/membersports\.com/i, 'membersports'],
  [/golfgenius\.com/i, 'golfgenius'],
  [/quick18\.com/i, 'quick18'],
  [/teequest/i, 'teequest'],
  [/jonasclub|foretees/i, 'foretees'],
  [/tee(-|\s)?on\.com|teeon/i, 'teeon'],
  [/golfback\.com/i, 'golfback'],
  [/1\.golf|proshopsolutions|golfnow/i, 'golfnow'],
];

async function fetchText(url: string): Promise<string> {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

function classify(html: string): string | null {
  for (const [re, name] of SIGS) if (re.test(html)) return name;
  return null;
}

function bookingLinks(html: string, base: string): string[] {
  const links = new Set<string>();
  const re = /href=["']([^"']*(?:book|tee|reserv|golf)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = m[1];
    if (href.startsWith('//')) href = 'https:' + href;
    else if (href.startsWith('/')) {
      try { href = new URL(href, base.startsWith('http') ? base : `https://${base}`).href; } catch { continue; }
    } else if (!href.startsWith('http')) continue;
    links.add(href);
  }
  return [...links].slice(0, 8);
}

export async function detect(website: string): Promise<{ provider: string | null; via: string }> {
  const html = await fetchText(website);
  if (!html) return { provider: null, via: 'no-fetch' };
  const direct = classify(html);
  if (direct) return { provider: direct, via: 'homepage' };
  // Follow booking-ish links one level.
  for (const link of bookingLinks(html, website)) {
    const p = classify(link);
    if (p) return { provider: p, via: `link ${link.slice(0, 60)}` };
    const sub = await fetchText(link);
    const ps = classify(sub);
    if (ps) return { provider: ps, via: `page ${link.slice(0, 60)}` };
  }
  return { provider: null, via: 'unknown' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length) {
    for (const url of args) console.log(url, '→', JSON.stringify(await detect(url)));
    return;
  }
  const db = new Database(path.join(process.cwd(), 'data', 'courses.db'), { readonly: true });
  const rows = db.prepare("SELECT id, name, website FROM courses WHERE state='MA' AND provider='fallback' AND website IS NOT NULL AND website != ''").all() as { id: string; name: string; website: string }[];
  for (const r of rows) {
    const { provider, via } = await detect(r.website);
    console.log(`${(provider ?? 'UNKNOWN').padEnd(12)} ${r.id.padEnd(38)} ${via}`);
  }
}
main();
