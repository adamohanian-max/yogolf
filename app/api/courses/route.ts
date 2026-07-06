import { catalogCourses } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Whole-catalog course list for client-side name/town search. */
export async function GET() {
  const courses = catalogCourses();
  return new Response(JSON.stringify({ courses }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
