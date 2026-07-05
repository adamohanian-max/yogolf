/**
 * For each no-website fallback course, guess likely domains, find one that
 * resolves, then detect its booking provider. Prints a provider report.
 *
 *   npx tsx scripts/find_sites_detect.ts
 */
import Database from 'better-sqlite3';
import path from 'path';
import { detect } from './detect_provider';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function candidates(name: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(the|at|of|inc)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  const nospace = base.replace(/\s+/g, '');
  const noSuffix = base.replace(/\b(golf|club|course|country|links|municipal)\b/g, '').replace(/\s+/g, '');
  const set = new Set<string>();
  for (const stem of [nospace, noSuffix]) {
    if (!stem) continue;
    set.add(`${stem}.com`);
    set.add(`${stem}golf.com`);
    set.add(`${stem}gc.com`);
    set.add(`golf${stem}.com`);
    set.add(`${stem}cc.com`);
    set.add(`${stem}golfclub.com`);
  }
  return [...set];
}

async function resolves(domain: string): Promise<string | null> {
  for (const scheme of ['https', 'http']) {
    try {
      const res = await fetch(`${scheme}://${domain}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(7000),
        redirect: 'follow',
      });
      if (res.ok) {
        const text = await res.text();
        // crude "is this a golf course site" check to avoid domain squatters
        if (/golf|tee time|course|clubhouse|pro shop|book/i.test(text)) return `${scheme}://${domain}`;
      }
    } catch {
      /* miss */
    }
  }
  return null;
}

async function main() {
  const db = new Database(path.join(process.cwd(), 'data', 'courses.db'), { readonly: true });
  const rows = db
    .prepare("SELECT id, name FROM courses WHERE state='MA' AND provider='fallback' AND (website IS NULL OR website='') ORDER BY name")
    .all() as { id: string; name: string }[];

  for (const r of rows) {
    let site: string | null = null;
    for (const c of candidates(r.name)) {
      site = await resolves(c);
      if (site) break;
    }
    if (!site) {
      console.log(`NOSITE       ${r.id}`);
      continue;
    }
    const { provider } = await detect(site);
    console.log(`${(provider ?? 'UNKNOWN').padEnd(12)} ${r.id.padEnd(40)} ${site}`);
  }
}
main();
