import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Space_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import "./globals.css";

// Display — course names, wordmark, headings. Printed-form character.
const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

// Body — labels, meta, copy.
const hanken = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
});

// Numerals — tee times & prices, penciled-scorecard feel.
const spaceMono = Space_Mono({
  variable: "--font-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://yogolf.net"),
  title: "YoGolf — every tee time, one search",
  description:
    "Search live tee times across every golf course near you. Filter by price, time, players, and holes.",
  openGraph: {
    title: "YoGolf — every tee time, one search",
    description:
      "Search live tee times across every golf course near you. Filter by price, time, players, and holes.",
    url: "https://yogolf.net",
    siteName: "YoGolf",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "YoGolf — every tee time, one search",
    description:
      "Search live tee times across every golf course near you. Filter by price, time, players, and holes.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${hanken.variable} ${spaceMono.variable}`}
    >
      <body>
        {children}
        <Analytics />
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1832367628724761"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
