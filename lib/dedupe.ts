/**
 * Shared duplicate-course detection, used by the seeder (to collapse records)
 * and the coverage audit (to treat a roster course as covered when the catalog
 * carries the same course under a different name).
 *
 * Distinct records can describe one physical course — e.g. "Merrimack Valley
 * Golf Course" (TeeItUp) and "Merrimack Golf Course" (directory) are the same
 * course at 210 Howe St, Methuen.
 */
import { haversineMiles } from './distance';

export interface CourseLike {
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
}

const STOP = new Set([
  'golf',
  'club',
  'course',
  'country',
  'the',
  'at',
  'of',
  'and',
  'municipal',
  'cc',
  'gc',
]);

export function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !STOP.has(t))
  );
}

export function normAddress(a: string | null | undefined): string {
  return (a ?? '')
    .toLowerCase()
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|court|ct|circle|cir)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size > b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/** Miles between two records, or Infinity if either lacks usable coordinates. */
function milesBetween(a: CourseLike, b: CourseLike): number {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return Infinity;
  }
  if ((a.lat === 0 && a.lng === 0) || (b.lat === 0 && b.lng === 0)) return Infinity;
  return haversineMiles(a.lat, a.lng, b.lat, b.lng);
}

/**
 * Do two records describe the same course? Callers should already know the two
 * are in the same town (dups are effectively always same-town), which keeps the
 * name-containment rule from merging like-named courses across the state.
 */
export function sameCourse(a: CourseLike, b: CourseLike): boolean {
  const addrA = normAddress(a.address);
  const addrB = normAddress(b.address);
  if (addrA && addrB) return addrA === addrB; // real street addresses are authoritative

  // One name's distinctive words fully contain the other's, sharing the same
  // root — "Merrimack" ⊆ "Merrimack Valley". A pure coordinate-proximity rule is
  // deliberately NOT used: fallback courses without their own coordinates all
  // inherit the same town centroid, so proximity would merge unrelated courses.
  // The distance below is only a guard against merging like-named courses at
  // opposite ends of a town — a real address match above already short-circuits.
  const ta = nameTokens(a.name);
  const tb = nameTokens(b.name);
  if (!isSubset(ta, tb) && !isSubset(tb, ta)) return false;
  const dist = milesBetween(a, b);
  return dist < 3 || dist === Infinity; // Infinity ⇒ a centroid/no-coord record; town+name is the signal
}
