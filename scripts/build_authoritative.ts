/**
 * Build the authoritative roster of MA golf courses — the ground truth that the
 * coverage audit (scripts/audit_coverage.ts) reconciles the catalog against.
 *
 *   npx tsx scripts/build_authoritative.ts
 *
 * Primary source is the golfmassachusetts.com directory, which enumerates every
 * MA course with its town, coordinates, and Course Type (Public / Semi-Private /
 * Municipal / Private / Resort / Military). We also union in any name already in
 * data/seed/directory_ma.tsv or the built DB that the directory happens to miss,
 * so the roster is a superset, never a subset, of what we already ship.
 *
 * Output: data/seed/authoritative_ma.tsv — a REVIEWED, checked-in artifact
 * (columns: name, town, access, lat, lng, source). Scraping is flaky, so this is
 * regenerated and diffed by a human, not fetched at build time. `access` is one
 * of public|semi|muni|private|military|resort; the audit requires every
 * public|semi|muni row to be covered or explicitly excluded.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import Database from 'better-sqlite3';

const DIR = 'https://www.golfmassachusetts.com/golfcourses/';
const seedDir = path.join(process.cwd(), 'data', 'seed');
const outPath = path.join(seedDir, 'authoritative_ma.tsv');

// Known MA towns, used to reject slug collisions that resolve to another state
// (e.g. a "Crosswinds" page that is actually Savannah, GA).
const maTowns = new Set(
  fs
    .readFileSync(path.join(process.cwd(), 'data', 'ma_towns.tsv'), 'utf8')
    .split('\n')
    .map((l) => l.split('\t')[0]?.toLowerCase().trim())
    .filter(Boolean)
);

// golfmassachusetts.com's TLS chain doesn't validate in Node; the data is public.
const agent = new https.Agent({ rejectUnauthorized: false });

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { agent, headers: { 'User-Agent': 'yogolf-roster/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(fetchText(new URL(res.headers.location, url).toString()));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

/** Match the directory's own URL slugs, e.g. "Amesbury Golf & Country Club" → amesbury-golf-country-club. */
function siteSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Candidate slugs to try for a name, in order. The directory sometimes shortens
 * slugs by dropping a trailing designation ("Granite Links Golf Club" →
 * granite-links), so fall back to progressively trimmed forms.
 */
function slugVariants(name: string): string[] {
  const full = siteSlug(name);
  const variants = [full];
  for (const suffix of [
    '-golf-club',
    '-golf-course',
    '-country-club',
    '-golf-links',
    '-golf',
    '-club',
    '-course',
  ]) {
    if (full.endsWith(suffix)) variants.push(full.slice(0, -suffix.length));
  }
  return [...new Set(variants)];
}

/** Normalized key for cross-source dedup (mirrors scripts/build_directory_seed.ts slug). */
function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(golf|club|course|country|the|at|links|cc|gc|municipal|of)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

type Access = 'public' | 'semi' | 'muni' | 'private' | 'resort' | 'military';
function classify(name: string, courseType: string): Access {
  const t = courseType.toLowerCase();
  if (/\bmunicipal\b/i.test(name)) return 'muni';
  if (t.includes('semi')) return 'semi';
  if (t.includes('private')) return 'private';
  if (t.includes('military')) return 'military';
  if (t.includes('resort')) return 'resort';
  // Directory lumps town-owned munis under "Public"; keep them public unless the
  // name flags municipal (handled above). Everything else public.
  return 'public';
}

interface Row {
  name: string;
  town: string;
  access: Access;
  lat: string;
  lng: string;
  address: string;
  source: string;
}

// The marker embedded in each detail page:
//   "id","Name","Addr <br> City STATE ZIP","lat","lng","","Course Type"
const MARKER = /"(\d+)","([^"]+)","([^"]*?)","(-?\d+\.\d+)","(-?\d+\.\d+)","[^"]*","([^"]*)"/;

function parseTown(addr: string): string {
  // "62 High Bank Rd <br> South Yarmouth MA 02664" → "South Yarmouth"
  const after = addr.split(/<br\s*\/?>/i).pop() ?? addr;
  // MA zips begin with 0; the source sometimes drops the leading zero (01451 →
  // "1451"), so accept a 4- or 5-digit zip. Strip a trailing " MA <zip>" if
  // present, otherwise fall back to whatever precedes a bare " MA".
  const m = after.match(/^\s*(.+?)\s+MA(?:\s+\d{4,5})?\s*$/i);
  return (m ? m[1] : after).replace(/\s+/g, ' ').trim();
}

function parseStreet(addr: string): string {
  // "62 High Bank Rd <br> South Yarmouth MA 02664" → "62 High Bank Rd"
  const before = addr.split(/<br\s*\/?>/i)[0] ?? '';
  return before.replace(/\s+/g, ' ').trim();
}

type Parsed = Omit<Row, 'source'>;

/**
 * Pull a course off its detail page. Prefer the embedded map marker (has name,
 * address, coordinates, and Course Type); fall back to the page title +
 * "Course Type:" line for stub pages that carry no marker.
 */
function parseDetail(html: string, fallbackName: string): Parsed | null {
  const m = html.match(MARKER);
  if (m) {
    // Marker carries a real "… MA <zip>" address, so trust its town verbatim
    // (many valid courses sit in villages not in the town-centroid list).
    const [, , markerName, addr, lat, lng, courseType] = m;
    const name = markerName.replace(/&amp;/g, '&').trim() || fallbackName;
    return {
      name,
      town: parseTown(addr),
      access: classify(name, courseType),
      lat,
      lng,
      address: parseStreet(addr),
    };
  }
  // Stub page with no marker: "<title>Name - Golf in Town, Massachusetts</title>".
  // These are riskier (a bad slug can resolve to another state's course whose
  // page still says "Massachusetts"), so require the town to be a known MA town.
  const title = html.match(/<title>(.+?)\s*-\s*Golf in\s*(.+?),\s*Massachusetts/i);
  if (!title) return null;
  const name = title[1].replace(/&amp;/g, '&').trim();
  const town = title[2].replace(/\s+/g, ' ').trim();
  if (!maTowns.has(town.toLowerCase())) return null;
  const ct = html.match(/Course Type:\s*([^<]+)</i);
  return {
    name,
    town,
    access: classify(name, ct ? ct[1].trim() : 'Public'),
    lat: '',
    lng: '',
    address: '',
  };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    })
  );
}

async function main() {
  console.log('Fetching golfmassachusetts.com directory index…');
  const index = await fetchText(DIR);
  const sel = index.match(/<select name="CourseName"[\s\S]*?<\/select>/);
  if (!sel) throw new Error('CourseName dropdown not found — site layout changed');
  const names = [
    ...sel[0].matchAll(/<option[^>]*value="([^"]*)"[^>]*>/g),
  ]
    .map((m) => m[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
  console.log(`  ${names.length} course names in directory`);

  const rows = new Map<string, Row>();
  let ok = 0;
  const failed: string[] = [];

  await pool(names, 8, async (name) => {
    for (const slug of slugVariants(name)) {
      try {
        const parsed = parseDetail(await fetchText(DIR + slug), name);
        if (parsed) {
          rows.set(key(parsed.name), { ...parsed, source: 'golfmassachusetts' });
          ok++;
          return;
        }
      } catch {
        // try next variant
      }
    }
    failed.push(name);
  });
  console.log(`  parsed ${ok} detail pages, ${failed.length} failed`);

  // Union: any name we already ship (directory_ma.tsv or the built DB) that the
  // directory missed — added so the roster can never be a subset of the catalog.
  const privateSet = loadPrivateSet();
  let unioned = 0;
  for (const { name, town, address } of localNames()) {
    const k = key(name);
    if (rows.has(k)) continue;
    rows.set(k, {
      name,
      town,
      access: privateSet.has(name.toLowerCase().trim()) ? 'private' : 'public',
      lat: '',
      lng: '',
      address: address ?? '',
      source: 'local',
    });
    unioned++;
  }
  console.log(`  unioned ${unioned} local-only names not in the directory`);

  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  const header = 'name\ttown\taccess\tlat\tlng\taddress\tsource';
  const body = sorted
    .map((r) => [r.name, r.town, r.access, r.lat, r.lng, r.address, r.source].join('\t'))
    .join('\n');
  fs.writeFileSync(outPath, header + '\n' + body + '\n');

  const byAccess = sorted.reduce<Record<string, number>>((acc, r) => {
    acc[r.access] = (acc[r.access] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Wrote ${sorted.length} courses → ${path.relative(process.cwd(), outPath)}\n  ` +
      Object.entries(byAccess)
        .map(([a, n]) => `${a}: ${n}`)
        .join('  ')
  );
  if (failed.length) console.log(`  detail-page failures: ${failed.slice(0, 20).join(', ')}`);
}

function loadPrivateSet(): Set<string> {
  const p = path.join(seedDir, '_exclude_ma.json');
  if (!fs.existsSync(p)) return new Set();
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8')) as { privateClubs?: string[] };
  return new Set((cfg.privateClubs ?? []).map((n) => n.toLowerCase().trim()));
}

function localNames(): { name: string; town: string; address?: string }[] {
  const out: { name: string; town: string; address?: string }[] = [];
  const tsv = path.join(seedDir, 'directory_ma.tsv');
  if (fs.existsSync(tsv)) {
    for (const line of fs.readFileSync(tsv, 'utf8').split('\n')) {
      const [name, town] = line.split('\t');
      if (name && town) out.push({ name: name.trim(), town: town.trim() });
    }
  }
  const db = path.join(process.cwd(), 'data', 'courses.db');
  if (fs.existsSync(db)) {
    const conn = new Database(db, { readonly: true });
    try {
      for (const r of conn.prepare('SELECT name, town, address FROM courses').all() as {
        name: string;
        town: string;
        address: string | null;
      }[]) {
        out.push({ name: r.name, town: r.town, address: r.address ?? '' });
      }
    } finally {
      conn.close();
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
