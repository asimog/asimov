import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/shell/Footer";
import { Nav } from "@/components/shell/Nav";
import "./globals.css";
import "./instruments.css";
import "./rooms.css";

// docs/12: Plex Mono for labels and data, Plex Sans Condensed for KPI numerals, Plex Sans for body. Self-hosted by next/font.
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-sans", display: "swap" });
const cond = IBM_Plex_Sans_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-cond", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Asimog", template: "%s · Asimog" },
  description: "An autonomous firm trading Pump.fun callouts in public. Every motion on this page is a real event.",
};

export const viewport: Viewport = { themeColor: "#1d1813", colorScheme: "dark light" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-mode="night" className={`${mono.variable} ${sans.variable} ${cond.variable}`} suppressHydrationWarning>
      <head>
        {/* the instrument's mode before first paint: the Field is night, every other room is paper (docs/12) */}
        <script dangerouslySetInnerHTML={{ __html: `document.documentElement.dataset.mode=location.pathname==="/"?"night":"paper"` }} />
      </head>
      <body>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
