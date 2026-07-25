/**
 * Reverse coverage audit: for every provider ACCOUNT we already seed, ask the
 * provider for the full list of facilities/courses under that account and flag
 * any we don't ship.
 *
 *   npx tsx scripts/reverse_audit_providers.ts
 *
 * The forward audit (scripts/audit_coverage.ts) only guarantees coverage of
 * courses the golfmassachusetts roster knows about — a single, flaky source. This
 * complements it from the other direction: a booking account we've already
 * touched is ground truth we control, so a sibling course sharing that account
 * (a second 18 at the same CPS site, an extra facility under one TeeItUp alias)
 * that we never seeded is a real, discoverable gap. Live/network, so this is a
 * REPORT, not a build gate — run it periodically and reconcile the output.
 */
import fs from 'fs';
import path from 'path';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const seedDir = path.join(process.cwd(), 'data', 'seed');

interface SeedRec {
  provider?: string;
  provider_config?: { siteName?: string; courseId?: number; alias?: string; facilityIds?: number[] };
}

function loadSeeds(): SeedRec[] {
  const out: SeedRec[] = [];
  for (const f of fs.readdirSync(seedDir)) {
    if (!f.endsWith('.json') || f.startsWith('_') || f.startsWith('ratings_')) continue;
    let recs: unknown;
    try {
      recs = JSON.parse(fs.readFileSync(path.join(seedDir, f), 'utf8'));
    } catch {
      continue;
    }
    if (Array.isArray(recs)) out.push(...(recs as SeedRec[]));
  }
  return out;
}

// ---- CPS: GetAllOptions lists every course at a site -----------------------
// GetAllOptions is a public read; the v4 x-apikey flow works for both CPS
// generations, whereas the older short-lived-token flow now 404s on the many
// sites that migrated to v4. Use the apikey path so this stays reachable.
const CPS_V4_APIKEY = '8ea2914e-cac2-48a7-a3e5-e0f41350bf3a';
async function cpsCourses(site: string): Promise<{ courseId: number; courseName: string }[] | null> {
  try {
    const res = await fetch(
      `https://${site}.cps.golf/onlineres/onlineapi/api/v1/onlinereservation/GetAllOptions/${site}?version=1&product=3`,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'x-apikey': CPS_V4_APIKEY,
          'x-componentid': '1',
          'x-productid': '1',
          'x-siteid': '1',
          'x-terminalid': '3',
          'x-moduleid': '7',
          'x-websiteid': '00000000-0000-0000-0000-000000000000',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const opt = (await res.json()) as { courseOptions?: { courseId: number; courseName: string }[] };
    return opt.courseOptions ?? null;
  } catch {
    return null;
  }
}

// ---- TeeItUp: alias/{alias}/facilities lists every facility ----------------
async function teeitupFacilities(alias: string): Promise<{ id: number; name: string; isSimulator?: boolean }[] | null> {
  try {
    const res = await fetch(`https://phx-api-be-east-1b.kenna.io/alias/${alias}/facilities`, {
      headers: { 'User-Agent': UA, 'x-be-alias': alias },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const facs = (await res.json()) as { id: number; name: string; isSimulator?: boolean }[];
    return Array.isArray(facs) ? facs : null;
  } catch {
    return null;
  }
}

async function main() {
  const seeds = loadSeeds();

  // What we ship, keyed per provider.
  const cpsSites = new Set<string>();
  const cpsHave = new Set<string>(); // `${site}:${courseId}`
  const tiuAliases = new Set<string>();
  const tiuHave = new Set<number>(); // facilityId
  for (const r of seeds) {
    const pc = r.provider_config ?? {};
    if (r.provider === 'cps' && pc.siteName) {
      cpsSites.add(pc.siteName);
      if (pc.courseId != null) cpsHave.add(`${pc.siteName}:${pc.courseId}`);
    }
    if (r.provider === 'teeitup' && pc.alias) {
      tiuAliases.add(pc.alias);
      for (const id of pc.facilityIds ?? []) tiuHave.add(id);
    }
  }

  // Triaged 2026-07-25: these `${site}:${courseId}` are the individual nines /
  // "book all 18" virtual course of an 18-hole course we already ship under a
  // different id (e.g. beverlygolf we ship as "2,3", so its Front 9 / Back 9 /
  // combined courseId 1 are the same holes). Not gaps — suppress so the report
  // only surfaces genuinely-new facilities.
  const KNOWN_SPLITS = new Set<string>([
    'beverlygolf:1', // "Beverly Golf and Tennis Club" — combined 18, we ship the 2,3 nines
    'beverlygolf:2', // Front 9
    'beverlygolf:3', // Back 9
    'shakerfarms:2', // Shaker Farms Back 9 — we ship courseId 1 (18)
    'yarmouthpublic:2', // Bayberry Red — nine of Bayberry Hills (courseId 4)
    'yarmouthpublic:3', // Bayberry White — nine of Bayberry Hills (courseId 4)
    'yarmouthpublic:9', // Bass River Back 9 — nine of Bass River (courseId 5)
  ]);

  const gaps: string[] = [];

  console.log(`CPS: probing ${cpsSites.size} site(s)…`);
  for (const site of [...cpsSites].sort()) {
    const courses = await cpsCourses(site);
    if (!courses) {
      console.log(`  ${site}: unreachable (skip)`);
      continue;
    }
    for (const c of courses) {
      const k = `${site}:${c.courseId}`;
      if (!cpsHave.has(k) && !KNOWN_SPLITS.has(k)) {
        gaps.push(`cps  ${site} courseId=${c.courseId}  "${c.courseName}"`);
      }
    }
  }

  console.log(`TeeItUp: probing ${tiuAliases.size} alias(es)…`);
  for (const alias of [...tiuAliases].sort()) {
    const facs = await teeitupFacilities(alias);
    if (!facs) {
      console.log(`  ${alias}: unreachable (skip)`);
      continue;
    }
    for (const f of facs) {
      if (f.isSimulator) continue;
      if (!tiuHave.has(f.id)) {
        gaps.push(`teeitup  ${alias} facilityId=${f.id}  "${f.name}"`);
      }
    }
  }

  if (gaps.length) {
    console.log(`\n⚠ ${gaps.length} facility(ies) under accounts we already seed but do NOT ship:`);
    for (const g of gaps) console.log(`  - ${g}`);
    console.log('\nAdd the real ones to their provider seed; ignore simulators/duplicates.');
  } else {
    console.log('\n✓ Every facility under a seeded provider account is already shipped.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
