import { getCourse } from '../lib/db';
import { resolveCourse } from '../lib/search';
async function main() {
  const c = getCourse('ma-greenock-country-club')!;
  console.log('provider:', c.provider);
  const date = new Date(Date.now() + 2*864e5).toISOString().slice(0,10);
  const r = await resolveCourse({ course: c, distanceMiles: 5 }, {
    lat: c.lat, lng: c.lng, radiusMiles: 25, players: 2, dates: [date],
    timeStart: '05:00', timeEnd: '20:00', maxPrice: null, holes: 0, ride: 'any', sort: 'nearest',
  } as any);
  console.log('unavailable:', r.unavailable, '| slots:', r.slots.length);
  console.log('first:', JSON.stringify(r.slots[0]));
}
main();
export {};
