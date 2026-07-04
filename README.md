# YoGolf

Every tee time, one search. YoGolf aggregates **live** tee-time availability
from golf courses onto a single map-free search page — filter by location,
radius, date range, players, tee-off window, price, and 9/18 holes; sort by
nearest, price, or best course.

Phase 1 covers **Massachusetts**: 148 public courses, 61 on live-availability
providers (the rest appear with a booking link). Private / members-only clubs
are deliberately excluded — every course shown is open to the public.

![search results](docs/results.png)

## How it works

There is no national tee-time API. Courses sit on a handful of booking
platforms, several of which expose the same JSON their own booking widgets
call. YoGolf hits those directly through per-provider **adapters** and merges
the results. Courses on platforms we can't read live (or that gate their tee
sheet behind login) fall back to a "Check availability" booking deep-link, so
they still appear in search.

```
Browser ──► /api/search (NDJSON stream)
                │  radius filter (SQLite + haversine)
                │  fan-out to adapters, 9s timeout each, 2-min cache
                ▼
        ┌───────────────┬───────────────┬──────────┬──────────┐
     ForeUp        Chronogolf        TeeItUp       CPS      fallback
   (live JSON)   (marketplace)   (kenna.io)   (cps.golf)  (book link)
```

### Providers

| Provider | Status | Notes |
|----------|--------|-------|
| **ForeUp** | ✅ live | `foreupsoftware.com` booking API. 39 MA courses. |
| **CPS Golf** | ✅ live | `*.cps.golf` (token → options → txn → teetimes). 10 MA courses inc. Boston municipals. |
| **Chronogolf** | ✅ live | Lightspeed marketplace (`/marketplace/clubs/{id}/teetimes` with the club's affiliation id). 12 MA courses. |
| **TeeItUp** | ⚙️ built | `kenna.io` API; adapter ready — little MA public presence to onboard. |
| **fallback** | ✅ | Any course with no readable live sheet → booking deep-link (ForeUp page or a course-booking search). |

61 of 148 MA courses resolve live tee times; the remainder are bookable links.
Discovery/onboarding scripts per provider: `foreup_harvest.ts`,
`cps_discover.ts` / `cps_probe_site.ts`, `chronogolf_harvest.ts`, and the
matching `build_*_seed.ts`.

## Run it

```bash
npm install
npx tsx scripts/seed.ts     # build data/courses.db from data/seed/*.json
npm run dev                 # http://localhost:3000
```

Tests (drives real searches through the UI with a live dev server):

```bash
npx playwright test
```

## Project layout

```
app/
  page.tsx              search UI (streaming results, client-side sort)
  api/search/route.ts   radius filter → adapter fan-out → NDJSON stream
  api/geocode/route.ts  zip → lat/lng (bundled dataset)
lib/
  adapters/             one file per booking platform + registry
  search.ts             fan-out, per-adapter timeout, cache, sort
  db.ts distance.ts score.ts cache.ts geo.ts
data/
  seed/*.json           course records (committed); ratings_*.json overrides
  zips.csv ma_towns.tsv geocoding datasets
scripts/
  seed.ts               (re)build courses.db
  probe.ts              probe one course or --all live; pass/fail table
  foreup_harvest.ts     scan ForeUp ids → course metadata + schedule ids
  build_ma_seed.ts      scan NDJSON → MA seed records
  build_directory_seed.ts  add directory courses as bookable fallbacks
  cps_probe_site.ts     list courses hosted on a cps.golf site
```

## "Best course" score

`lib/score.ts` shrinks a course's Google rating toward the statewide mean
(Bayesian prior, so a 5.0 with 12 reviews doesn't outrank a 4.6 with 2,000),
blends GolfPass's Golfers' Choice rating when present, and adds a bounded bonus
for editorial top-list appearances. Rankings currently seeded from GolfPass
Golfers' Choice 2026 (`data/seed/ratings_ma.json`).

## Adding courses (the coverage sweep)

The goal is that **every** public course a golfer would find on Google appears
in YoGolf. To extend coverage:

1. **Find candidates** — course directories + `web search "golf near {town}"`.
2. **Identify the booking provider** — open the course's "Book tee time" link.
   - ForeUp (`foreupsoftware.com/booking/{id}`) → `npx tsx scripts/foreup_harvest.ts {id}` for schedule ids, add a `foreup` record.
   - `*.cps.golf` → `npx tsx scripts/cps_probe_site.ts {host}` for course ids, add a `cps` record.
   - `chronogolf.com/club/{slug}` → `npx tsx scripts/chronogolf_harvest.ts {slug}` for club/course/affiliation ids, add a `chronogolf` record.
   - Otherwise → a `fallback` record (booking link).
3. **Public only** — `data/seed/_exclude_ma.json` drops members-only clubs and
   ForeUp test/demo accounts. Semi-private courses that sell public tee times
   are kept. Add newly found private clubs there.
4. **Verify** — `npx tsx scripts/probe.ts {course-id}` should return live slots
   (or `--all` for the whole DB). `npx tsx scripts/verify_search.ts` checks the
   filters against a running server.
5. `npx tsx scripts/seed.ts` and re-run.

To grow beyond MA, drop new `data/seed/*.json` files for the target state; the
zip dataset (`data/zips.csv`) is already national.

## Honest limitations

- Provider endpoints are unofficial and per-course config varies; the probe
  script + per-course `provider_config` absorb the differences.
- Some ForeUp courses hide green-fee rates until login → slots show "see price".
- The ~90 fallback courses (GolfNow, TeeCommerce, muni-custom, or login-gated
  ForeUp sheets) appear with a booking link rather than live times.
- Google ratings are enriched for a subset; the "best course" score falls back
  to a statewide-mean prior for the rest.
