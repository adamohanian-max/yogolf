/**
 * Probe TeeItUp aliases (kenna.io) for candidate course slugs; print hits with
 * facility ids. Fast (no browser).
 *   npx tsx scripts/teeitup_discover.ts slug1 slug2 ...   (or reads names from DB)
 */
import Database from 'better-sqlite3';
import path from 'path';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function tryAlias(alias: string): Promise<{ alias: string; facilityIds: number[]; names: string[]; timeZone: string } | null> {
  try {
    const res = await fetch(`https://phx-api-be-east-1b.kenna.io/alias/${alias}/facilities`, {
      headers: { 'User-Agent': UA, 'x-be-alias': alias },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const facs = (await res.json()) as { id: number; name: string; timeZone?: string; isSimulator?: boolean; state?: string }[];
    if (!Array.isArray(facs) || facs.length === 0) return null;
    const kept = facs.filter((f) => !f.isSimulator);
    if (!kept.length) return null;
    return {
      alias,
      facilityIds: kept.map((f) => f.id),
      names: kept.map((f) => f.name),
      timeZone: kept.find((f) => f.timeZone)?.timeZone ?? 'America/New_York',
    };
  } catch {
    return null;
  }
}

function slugVariants(name: string): string[] {
  const clean = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').trim();
  const words = clean.split(/\s+/);
  const full = words.join('-');
  const noSuffix = words.filter((w) => !['golf', 'course', 'club', 'the'].includes(w)).join('-');
  const set = new Set([full, noSuffix, `${noSuffix}-golf-course`, `${noSuffix}-golf-club`, `${noSuffix}-country-club`, `${full}-golf`]);
  return [...set].filter(Boolean);
}

async function main() {
  let names: string[];
  const argv = process.argv.slice(2);
  if (argv.length) {
    names = argv;
  } else {
    const db = new Database(path.join(process.cwd(), 'data', 'courses.db'), { readonly: true });
    names = (db.prepare("SELECT name FROM courses WHERE state='MA' AND provider='fallback'").all() as { name: string }[]).map((r) => r.name);
  }
  const seenAlias = new Set<string>();
  for (const name of names) {
    for (const alias of slugVariants(name)) {
      if (seenAlias.has(alias)) continue;
      seenAlias.add(alias);
      const hit = await tryAlias(alias);
      if (hit) {
        console.log(JSON.stringify({ query: name, ...hit }));
        break; // first matching alias wins for this course
      }
    }
  }
}
main();
