import fs from 'fs';
import path from 'path';

/**
 * Personal booking-site logins for gated courses, kept in a git-ignored file so
 * they never get committed. Shape:
 *
 * {
 *   "foreup":   { "<courseId>": { "username": "...", "password": "..." } },
 *   "chelsea":  { "<host>":     { "username": "...", "password": "..." } },
 *   "teequest": { "<siteName>": { "username": "...", "password": "..." } }
 * }
 *
 * Missing file / missing entry → the adapter falls back to a booking link, so
 * nothing breaks when credentials aren't present.
 */
export interface Credentials {
  foreup?: Record<string, { username: string; password: string }>;
  chelsea?: Record<string, { username: string; password: string }>;
  teequest?: Record<string, { username: string; password: string }>;
}

let cache: Credentials | null = null;
let loaded = false;

export function getCredentials(): Credentials {
  if (loaded) return cache ?? {};
  loaded = true;
  const file = process.env.YOGOLF_CREDENTIALS ?? path.join(process.cwd(), 'data', 'credentials.json');
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8')) as Credentials;
  } catch {
    cache = null;
  }
  return cache ?? {};
}

export function foreupLogin(courseId: number | string): { username: string; password: string } | null {
  return getCredentials().foreup?.[String(courseId)] ?? null;
}
