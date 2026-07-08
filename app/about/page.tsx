import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — YoGolf',
  description: 'What YoGolf is and how it works.',
};

export default function AboutPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="wordmark">
          <span className="flagmark">⛳</span>Yo<span className="yo">Golf</span>
        </a>
      </header>
      <div className="panel" style={{ maxWidth: 640 }}>
        <h1>About YoGolf</h1>
        <p className="sub">One search across every course near you.</p>
        <p>
          YoGolf searches live tee-time availability across public and semi-public golf
          courses and brings the results together in one place, sorted by distance, drive
          time, price, or course rating. When you find a time you want, YoGolf sends you
          straight to that course&apos;s own booking page to complete the reservation —
          we don&apos;t take payments or hold your booking.
        </p>
        <p>
          Phase one covers Massachusetts. We&apos;re expanding coverage over time.
        </p>
        <p>
          Questions or want your course listed or featured? <a href="/contact">Contact us</a>.
        </p>
      </div>
    </div>
  );
}
