'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { CourseResult, Ride, TeeTimeSlot } from '@/lib/types';
import { effectivePrice } from '@/lib/types';

type Sort = 'nearest' | 'price_asc' | 'price_desc' | 'best';
type Holes = 'both' | '9' | '18';

interface StreamMeta {
  total: number;
}

function todayStr(offset = 0): string {
  const d = new Date(Date.now() + offset * 86400_000);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fmtTime(iso: string): string {
  const hm = iso.slice(11, 16);
  const [h, m] = hm.split(':').map(Number);
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function fmtDateLabel(date: string): string {
  const d = new Date(date + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function cheapest(r: CourseResult, ride: Ride): number {
  const prices = r.slots.map((s) => effectivePrice(s, ride)).filter((p): p is number => p != null);
  return prices.length ? Math.min(...prices) : Infinity;
}

const TIME_OPTIONS: { v: string; label: string }[] = [];
for (let h = 5; h <= 20; h++) {
  for (const m of [0, 30]) {
    const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    TIME_OPTIONS.push({ v, label: `${h12}:${String(m).padStart(2, '0')} ${ampm}` });
  }
}

export default function Home() {
  const [zip, setZip] = useState('');
  const [useGeo, setUseGeo] = useState(false);
  const [radius, setRadius] = useState('25');
  const [players, setPlayers] = useState(2);
  const [holes, setHoles] = useState<Holes>('both');
  const [ride, setRide] = useState<Ride>('any');
  const [dateFrom, setDateFrom] = useState(todayStr(1));
  const [dateTo, setDateTo] = useState(todayStr(1));
  const [timeStart, setTimeStart] = useState('06:00');
  const [timeEnd, setTimeEnd] = useState('18:00');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState<Sort>('nearest');
  const [filter, setFilter] = useState('');

  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');
  const [results, setResults] = useState<CourseResult[]>([]);
  const [meta, setMeta] = useState<StreamMeta | null>(null);
  const [received, setReceived] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async () => {
    setError(null);

    let lat: number, lng: number;
    try {
      if (useGeo) {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } else {
        if (!/^\d{5}$/.test(zip.trim())) {
          setError('Enter a 5-digit zip code, or use your location.');
          return;
        }
        const r = await fetch(`/api/geocode?zip=${zip.trim()}`);
        if (!r.ok) {
          setError((await r.json()).error ?? 'Could not find that zip code.');
          return;
        }
        const loc = await r.json();
        lat = loc.lat;
        lng = loc.lng;
      }
    } catch {
      setError('Location unavailable. Enter a zip code instead.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('loading');
    setResults([]);
    setMeta(null);
    setReceived(0);

    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radius,
      players: String(players),
      holes,
      ride,
      dateFrom,
      dateTo: dateTo < dateFrom ? dateFrom : dateTo,
      timeStart,
      timeEnd,
      sort,
    });
    if (maxPrice) params.set('maxPrice', maxPrice);

    try {
      const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
      if (!res.ok || !res.body) {
        setError('Search failed. Try again.');
        setPhase('idle');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.type === 'meta') setMeta({ total: msg.total });
          else if (msg.type === 'course') {
            setReceived((n) => n + 1);
            setResults((prev) => [...prev, msg.result]);
          }
        }
      }
      setPhase('done');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError('Search failed. Try again.');
        setPhase('idle');
      }
    }
  }, [zip, useGeo, radius, players, holes, ride, dateFrom, dateTo, timeStart, timeEnd, maxPrice, sort]);

  const sorted = useMemo(() => {
    const withTimes = results.filter((r) => r.slots.length > 0);
    const without = results.filter((r) => r.slots.length === 0);
    const cmp: Record<Sort, (a: CourseResult, b: CourseResult) => number> = {
      nearest: (a, b) => a.distanceMiles - b.distanceMiles,
      price_asc: (a, b) => cheapest(a, ride) - cheapest(b, ride),
      price_desc: (a, b) => {
        const pa = cheapest(a, ride), pb = cheapest(b, ride);
        if (pa === Infinity && pb === Infinity) return 0;
        if (pa === Infinity) return 1;
        if (pb === Infinity) return -1;
        return pb - pa;
      },
      best: (a, b) => b.course.score - a.course.score,
    };
    withTimes.sort(cmp[sort]);
    without.sort((a, b) => a.distanceMiles - b.distanceMiles);
    return [...withTimes, ...without];
  }, [results, sort, ride]);

  const liveCount = results.filter((r) => r.slots.length > 0).length;
  const showDates = dateFrom !== dateTo;

  const q = filter.trim().toLowerCase();
  const shown = q
    ? sorted.filter(
        (r) => r.course.name.toLowerCase().includes(q) || r.course.town.toLowerCase().includes(q)
      )
    : sorted;

  return (
    <>
      <header className="topbar">
        <span className="wordmark">
          <span className="yo">Yo</span>Golf
        </span>
        <span className="topbar-tag">every tee time, one search</span>
      </header>

      <div className="shell">
        <aside className="panel">
          <h1>Find a tee time</h1>
          <p className="sub">Live availability from courses near you.</p>

          <div className="field">
            <label htmlFor="zip">Location</label>
            <div className="locrow">
              <input
                id="zip"
                className="control"
                placeholder="Zip code"
                inputMode="numeric"
                value={zip}
                disabled={useGeo}
                onChange={(e) => setZip(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <button
                type="button"
                className="iconbtn"
                data-active={useGeo}
                onClick={() => setUseGeo((v) => !v)}
                title="Use my location"
              >
                {useGeo ? '● My location' : '◎ Near me'}
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="radius">Search radius</label>
            <select id="radius" className="control" value={radius} onChange={(e) => setRadius(e.target.value)}>
              {['5', '10', '15', '25', '40', '60', '100'].map((r) => (
                <option key={r} value={r}>
                  {r} miles
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Date</label>
            <div className="row2">
              <input
                type="date"
                className="control"
                value={dateFrom}
                min={todayStr()}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <input
                type="date"
                className="control"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
            </div>
          </div>

          <div className="field">
            <label>Players</label>
            <div className="seg" role="group" aria-label="Number of players">
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" data-on={players === n} onClick={() => setPlayers(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Holes</label>
            <div className="seg" role="group" aria-label="Holes">
              {(['9', 'both', '18'] as const).map((h) => (
                <button key={h} type="button" data-on={holes === h} onClick={() => setHoles(h)}>
                  {h === 'both' ? '9 or 18' : h}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Getting around</label>
            <div className="seg" role="group" aria-label="Walking or cart">
              {([['any', 'Any'], ['walking', 'Walk'], ['cart', 'Cart']] as const).map(([v, lbl]) => (
                <button key={v} type="button" data-on={ride === v} onClick={() => setRide(v)}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Tee-off between</label>
            <div className="row2">
              <select className="control" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} aria-label="Earliest time">
                {TIME_OPTIONS.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select className="control" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} aria-label="Latest time">
                {TIME_OPTIONS.filter((t) => t.v > timeStart).map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="maxprice">Max price per player</label>
            <input
              id="maxprice"
              className="control"
              placeholder="Any"
              inputMode="numeric"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>

          <button className="searchbtn" onClick={runSearch} disabled={phase === 'loading'}>
            {phase === 'loading' ? 'Searching…' : 'Search tee times'}
          </button>

          {error && <p className="panel-err">{error}</p>}
        </aside>

        <main className="results">
          {phase === 'idle' && !error && (
            <div className="intro">
              <div className="mark">
                <span className="yo">Yo</span>Golf
              </div>
              <p>
                One search across every course near you — live tee times, real prices, no tab
                juggling. Set your criteria and hit search.
              </p>
            </div>
          )}

          {phase !== 'idle' && (
            <>
              {results.length > 0 && (
                <div className="resultsearch">
                  <span className="rs-icon" aria-hidden>⌕</span>
                  <input
                    className="control"
                    type="search"
                    placeholder={`Filter ${results.length} courses by name or town…`}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    aria-label="Filter courses"
                  />
                </div>
              )}

              <div className="results-head">
                <span className="count">
                  {phase === 'loading' && meta
                    ? `Checking ${meta.total} courses… ${received} in`
                    : phase === 'loading'
                      ? 'Searching…'
                      : liveCount > 0
                        ? <><strong>{liveCount}</strong> with live tee times · <strong>{meta?.total ?? results.length}</strong> public courses nearby</>
                        : ''}
                </span>
                <div className="sortrow">
                  <label htmlFor="sort">Sort</label>
                  <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    <option value="nearest">Nearest</option>
                    <option value="price_asc">Price: low to high</option>
                    <option value="price_desc">Price: high to low</option>
                    <option value="best">Best course</option>
                  </select>
                </div>
              </div>

              {phase === 'loading' && meta && meta.total > 0 && (
                <div className="progress">
                  <div style={{ width: `${(received / meta.total) * 100}%` }} />
                </div>
              )}

              {shown.map((r) => (
                <CourseCard key={r.course.id} r={r} showDates={showDates} ride={ride} />
              ))}

              {q && shown.length === 0 && results.length > 0 && (
                <div className="empty">
                  <p>
                    <strong>No courses match “{filter.trim()}”.</strong>
                  </p>
                  <p>Clear the filter to see all {results.length} nearby courses.</p>
                </div>
              )}

              {phase === 'loading' &&
                Array.from({ length: Math.max(0, 3 - sorted.length) }).map((_, i) => (
                  <div className="skel" key={i}>
                    <div className="bar" style={{ width: '40%' }} />
                    <div className="bar" style={{ width: '70%' }} />
                  </div>
                ))}

              {phase === 'done' && meta?.total === 0 && (
                <div className="empty">
                  <p>
                    <strong>No courses in range yet.</strong>
                  </p>
                  <p>Widen the radius — YoGolf currently covers Massachusetts.</p>
                </div>
              )}

              {phase === 'done' && (meta?.total ?? 0) > 0 && liveCount === 0 && (
                <div className="empty">
                  <p>
                    <strong>No open tee times match.</strong>
                  </p>
                  <p>Try a wider time window, another date, or a bigger radius.</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}

function CourseCard({ r, showDates, ride }: { r: CourseResult; showDates: boolean; ride: Ride }) {
  const [expanded, setExpanded] = useState(false);
  const byDate = useMemo(() => {
    const m = new Map<string, TeeTimeSlot[]>();
    for (const s of r.slots) {
      const d = s.time.slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(s);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [r.slots]);

  if (r.slots.length === 0) {
    return (
      <div className="card">
        <div className="card-fallback">
          <div>
            <div className="card-title">{r.course.name}</div>
            <div className="card-meta">
              <span>
                {r.course.town} · {r.distanceMiles} mi
              </span>
              {r.course.google_rating && (
                <span className="rating">
                  <span className="star">★</span> {r.course.google_rating.toFixed(1)}
                  {r.course.google_reviews ? ` (${r.course.google_reviews.toLocaleString()})` : ''}
                </span>
              )}
              {!r.unavailable && <span className="nolive">No open times right now</span>}
            </div>
          </div>
          {(r.course.booking_url || r.course.website) && (
            <a
              className="linkout"
              href={r.course.booking_url || r.course.website || '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              Check availability →
            </a>
          )}
        </div>
      </div>
    );
  }

  const LIMIT = 12;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <a href={r.course.booking_url || r.course.website || '#'} target="_blank" rel="noopener noreferrer">
              {r.course.name}
            </a>
          </div>
          <div className="card-meta">
            <span className="livedot" title="Live availability">Live</span>
            <span>
              {r.course.town} · {r.distanceMiles} mi
            </span>
            {r.course.google_rating && (
              <span className="rating">
                <span className="star">★</span> {r.course.google_rating.toFixed(1)}
                {r.course.google_reviews ? ` (${r.course.google_reviews.toLocaleString()})` : ''}
              </span>
            )}
          </div>
        </div>
        <span className="scorepill" title="YoGolf course score">{Math.round(r.course.score)} / 100</span>
      </div>

      {byDate.map(([date, slots]) => {
        const visible = expanded ? slots : slots.slice(0, LIMIT);
        return (
          <div key={date}>
            {showDates && <div className="datelabel">{fmtDateLabel(date)}</div>}
            {!showDates && <div style={{ height: 10 }} />}
            <div className="chiprail">
              {visible.map((s, i) => (
                <a
                  key={`${s.time}-${s.holes}-${i}`}
                  className="chip"
                  href={s.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="t">{fmtTime(s.time)}</span>
                  {(() => {
                    const p = effectivePrice(s, ride);
                    return (
                      <span className={p != null ? 'p' : 'p unknown'}>
                        {p != null ? `$${Math.round(p)}` : 'see price'}
                      </span>
                    );
                  })()}
                  <span className="s">
                    {ride === 'cart' ? (s.cartPrice != null ? 'w/ cart · ' : 'walk rate · ') : ''}
                    {s.holes === 0 ? '9/18' : s.holes}h · {s.spots} spots
                  </span>
                </a>
              ))}
              {slots.length > LIMIT && (
                <button className="morechips" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? 'Show fewer' : `+${slots.length - LIMIT} more`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
