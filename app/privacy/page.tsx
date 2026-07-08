import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — YoGolf',
  description: 'How YoGolf handles your data.',
};

export default function PrivacyPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="wordmark">
          <span className="flagmark">⛳</span>Yo<span className="yo">Golf</span>
        </a>
      </header>
      <div className="panel" style={{ maxWidth: 640 }}>
        <h1>Privacy Policy</h1>
        <p className="sub">Last updated July 2026.</p>

        <p>
          YoGolf does not require an account and does not collect names, emails, or
          payment information. Here&apos;s what happens when you use the site:
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Location &amp; search</h2>
        <p>
          If you enter a zip code or use your device&apos;s location, that coordinate is
          sent to our server to find nearby courses and is used only to serve that
          search. We don&apos;t store search history tied to you.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Analytics</h2>
        <p>
          We use Vercel Analytics to see aggregate traffic (page views, rough location,
          referrers). It doesn&apos;t use cookies or track you across other sites.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Third-party booking sites</h2>
        <p>
          When you book a tee time, you leave YoGolf for the golf course&apos;s own
          booking platform (ForeUp, CPS, TeeItUp, Chronogolf, or the course&apos;s own
          site). Those sites have their own privacy policies — YoGolf never sees or
          handles your booking or payment details.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Advertising</h2>
        <p>
          YoGolf may show ads served by third parties (e.g. Google AdSense), which may
          use cookies to show relevant ads. You can control ad personalization via{' '}
          <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">
            Google Ads Settings
          </a>
          .
        </p>

        <h2 style={{ fontSize: 16, marginTop: 20 }}>Contact</h2>
        <p>
          Questions about this policy: <a href="mailto:hello@yogolf.net">hello@yogolf.net</a>.
        </p>
      </div>
    </div>
  );
}
