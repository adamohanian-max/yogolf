import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the SQLite DB into the serverless functions — Next won't trace a
  // data file that's only opened at runtime via a path, so include it explicitly.
  // Keys are exact route paths (matched with picomatch against the route),
  // not directory globs — '/api/**' does not reliably match literal routes.
  outputFileTracingIncludes: {
    '/api/course': ['./data/courses.db'],
    '/api/courses': ['./data/courses.db'],
    '/api/search': ['./data/courses.db'],
  },
};

export default nextConfig;
