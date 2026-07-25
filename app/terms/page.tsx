import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — YoGolf',
  description: 'Terms for using YoGolf.',
};

export default function TermsPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="wordmark">
          <span className="flagmark">⛳</span>Yo<span className="yo">Golf</span>
        </a>
      </header>
      <div className="panel" style={{ maxWidth: 640 }}>
        <h1>Terms of Service</h1>
        <p className="sub">Last updated July 2026.</p>

        <p>
          YoGolf is a free search tool that aggregates publicly available tee-time
          listings from golf courses and third-party booking platforms. By using the
          site, you agree to the following:
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>No booking guarantee</h2>
        <p>
          YoGolf displays availability pulled from each course&apos;s own booking
          system. Prices, times, and availability can change or be inaccurate by the
          time you book. YoGolf does not process bookings or payments — all
          reservations happen on the course&apos;s own platform, subject to that
          platform&apos;s terms.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>No warranty</h2>
        <p>
          The site is provided &quot;as is,&quot; without warranty of any kind. YoGolf
          isn&apos;t liable for booking errors, missed tee times, or losses arising from
          use of the site.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Acceptable use</h2>
        <p>
          Don&apos;t scrape, automate, or abuse the site in a way that degrades it for
          other users.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Changes</h2>
        <p>These terms may change. Continued use of the site means you accept updates.</p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Contact</h2>
        <p>
          <a href="mailto:adamohanian@gmail.com">adamohanian@gmail.com</a>.
        </p>
      </div>
    </div>
  );
}
