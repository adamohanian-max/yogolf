import type { Adapter, AdapterResult, Course } from '../types';

/** Courses with no scrapeable live availability: surface the booking link. */
export const fallbackAdapter: Adapter = {
  name: 'fallback',
  async fetchTeeTimes(course: Course): Promise<AdapterResult> {
    return { unavailable: true, bookingUrl: course.booking_url || course.website || '' };
  },
};
