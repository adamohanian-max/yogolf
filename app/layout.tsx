import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, Space_Mono } from "next/font/google";
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
  title: "YoGolf — every tee time, one search",
  description:
    "Search live tee times across every golf course near you. Filter by price, time, players, and holes.",
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
      <body>{children}</body>
    </html>
  );
}
