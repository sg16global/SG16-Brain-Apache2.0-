import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sovereign SG16 Brain \u2014 Global AI Intelligence Network",
  description:
    "SG16-powered assistant gateway with a limited deterministic core, account storage, and operator-configured optional relays. Knowledge \u00B7 Diplomacy \u00B7 A Better Tomorrow.",
  keywords: ["Sovereign AI", "SG16 Brain", "self-hosted AI", "open AI", "privacy"],
  applicationName: "Sovereign SG16 Brain",
  creator: "SAIF TECH GLOBAL LLC",
  publisher: "SAIF TECH GLOBAL LLC",
  icons: { icon: "/images/emblem-v2.png", apple: "/images/emblem-v2.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* self-hosted fonts (public/fonts): no request leaves the site */}
        {/* eslint-disable-next-line @next/next/no-css-tags -- a static stylesheet in public/, loaded on every page */}
        <link href="/fonts/sg16-fonts.css" rel="stylesheet" />
      </head>
      <body className="min-h-screen antialiased">
        <div className="red-atmosphere" aria-hidden />
        <div className="red-horizon" aria-hidden />
        {children}
      </body>
    </html>
  );
}
