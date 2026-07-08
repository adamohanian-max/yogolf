import Database from 'better-sqlite3';
import path from 'path';
import type { Course } from './types';

const DB_PATH = path.join(process.cwd(), 'data', 'courses.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // The seed script (build time) needs write access; the deployed app only
    // reads. On a serverless host the filesystem is read-only, so opening
    // read/write + WAL there would crash — gate writes behind an explicit env.
    const writable = process.env.YOGOLF_DB_WRITABLE === '1';
    db = new Database(DB_PATH, { readonly: !writable, fileMustExist: !writable });
    if (writable) {
      // Not WAL: the seed script is a one-shot bulk write, and WAL leaves the
      // shipped .db requiring -wal/-shm sidecar files to open — impossible on
      // read-only serverless filesystems, where the db is opened readonly.
      db.pragma('journal_mode = DELETE');
      ensureSchema(db);
    }
  }
  return db;
}

export function ensureSchema(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      town TEXT NOT NULL,
      state TEXT NOT NULL,
      zip TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      phone TEXT,
      website TEXT,
      holes_total INTEGER NOT NULL DEFAULT 18,
      provider TEXT NOT NULL DEFAULT 'fallback',
      provider_config TEXT NOT NULL DEFAULT '{}',
      booking_url TEXT NOT NULL DEFAULT '',
      google_rating REAL,
      google_reviews INTEGER,
      golfpass_rating REAL,
      other_ratings TEXT,
      score REAL NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_courses_state ON courses(state);
    CREATE INDEX IF NOT EXISTS idx_courses_latlng ON courses(lat, lng);
  `);
}

interface CourseRow extends Omit<Course, 'provider_config' | 'other_ratings'> {
  provider_config: string;
  other_ratings: string | null;
}

function rowToCourse(row: CourseRow): Course {
  return {
    ...row,
    provider_config: JSON.parse(row.provider_config || '{}'),
    other_ratings: row.other_ratings ? JSON.parse(row.other_ratings) : null,
  };
}

export function coursesInBox(minLat: number, maxLat: number, minLng: number, maxLng: number, publicOnly = true): Course[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM courses WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?${publicOnly ? ' AND is_public = 1' : ''}`
    )
    .all(minLat, maxLat, minLng, maxLng) as CourseRow[];
  return rows.map(rowToCourse);
}

export function getCourse(id: string): Course | null {
  const row = getDb().prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined;
  return row ? rowToCourse(row) : null;
}

export interface CatalogCourse {
  id: string;
  name: string;
  town: string;
  state: string;
  lat: number;
  lng: number;
  google_rating: number | null;
  google_reviews: number | null;
  score: number;
  booking_url: string;
  website: string | null;
}

/** Lightweight list of every public course, for whole-catalog name search. */
export function catalogCourses(): CatalogCourse[] {
  return getDb()
    .prepare(
      `SELECT id, name, town, state, lat, lng, google_rating, google_reviews, score, booking_url, website
       FROM courses WHERE is_public = 1 ORDER BY name`
    )
    .all() as CatalogCourse[];
}

export function allCourses(): Course[] {
  const rows = getDb().prepare('SELECT * FROM courses ORDER BY name').all() as CourseRow[];
  return rows.map(rowToCourse);
}

export function upsertCourse(c: Course) {
  getDb()
    .prepare(
      `INSERT INTO courses (id, name, address, town, state, zip, lat, lng, phone, website, holes_total,
        provider, provider_config, booking_url, google_rating, google_reviews, golfpass_rating,
        other_ratings, score, is_public, notes)
       VALUES (@id, @name, @address, @town, @state, @zip, @lat, @lng, @phone, @website, @holes_total,
        @provider, @provider_config, @booking_url, @google_rating, @google_reviews, @golfpass_rating,
        @other_ratings, @score, @is_public, @notes)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, address=excluded.address, town=excluded.town, state=excluded.state,
        zip=excluded.zip, lat=excluded.lat, lng=excluded.lng, phone=excluded.phone,
        website=excluded.website, holes_total=excluded.holes_total, provider=excluded.provider,
        provider_config=excluded.provider_config, booking_url=excluded.booking_url,
        google_rating=excluded.google_rating, google_reviews=excluded.google_reviews,
        golfpass_rating=excluded.golfpass_rating, other_ratings=excluded.other_ratings,
        score=excluded.score, is_public=excluded.is_public, notes=excluded.notes`
    )
    .run({
      ...c,
      provider_config: JSON.stringify(c.provider_config ?? {}),
      other_ratings: c.other_ratings ? JSON.stringify(c.other_ratings) : null,
    });
}
