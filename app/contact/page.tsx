import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contact — YoGolf',
  description: 'Get in touch with YoGolf.',
};

export default function ContactPage() {
  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="wordmark">
          <span className="flagmark">⛳</span>Yo<span className="yo">Golf</span>
        </a>
      </header>
      <div className="panel" style={{ maxWidth: 640 }}>
        <h1>Contact</h1>
        <p className="sub">Course listings, corrections, partnerships, feedback.</p>
        <p>
          Email <a href="mailto:hello@yogolf.net">hello@yogolf.net</a> and we&apos;ll get
          back to you.
        </p>
        <p>
          Run a golf course and want a corrected listing, a booking-link fix, or a
          featured placement? Include the course name and town.
        </p>
      </div>
    </div>
  );
}
