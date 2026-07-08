/**
 * Probe TeeQuest embed ids on bookateetime.teequest.com and print the course
 * name + composite courseId for each. TeeQuest is a NATIONAL platform (mostly
 * Midwest), so a name that looks like an MA course is NOT proof — confirm each
 * hit by checking that the course's own official website embeds that exact
 * `/course/{id}` before seeding it (that is how Easton=116 was verified).
 *
 *   npx tsx scripts/teequest_discover.ts 100 175      # scan an id range
 *   npx tsx scripts/teequest_discover.ts 116 116      # single id
 *
 * Prints one line per live embed: "<id> | <courseId> | <name>"
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOST = 'bookateetime.teequest.com';

export interface TeeQuestProbe {
  embedId: number;
  courseId: string | null;
  name: string;
}

export async function probe(embedId: number): Promise<TeeQuestProbe | null> {
  try {
    const res = await fetch(`https://${HOST}/course/${embedId}`, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const name = html.match(/I&#39;m an? ([^<]+?) member/i)?.[1]?.trim();
    if (!name) return null;
    const courseId = html.match(/name="selectedCourse"[^>]*value="([^"]+)"/)?.[1] ?? null;
    return { embedId, courseId, name };
  } catch {
    return null;
  }
}

async function main() {
  const lo = parseInt(process.argv[2] ?? '100', 10);
  const hi = parseInt(process.argv[3] ?? String(lo), 10);
  const ids: number[] = [];
  for (let n = lo; n <= hi; n++) ids.push(n);
  const CONC = 8;
  for (let i = 0; i < ids.length; i += CONC) {
    const batch = await Promise.all(ids.slice(i, i + CONC).map(probe));
    for (const b of batch) if (b) console.log(`${b.embedId} | ${b.courseId} | ${b.name}`);
  }
}
if (process.argv[1]?.endsWith('teequest_discover.ts')) main();
