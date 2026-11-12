import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { brand } from "@/shared/config/brand";
import "./globals.css";
import { ServiceWorkerRegistration } from "./service-worker-registration";

// Skriftene fra prosjektets egne filer (public/fonts). Ingen kall til Google, så byggingen virker
// uten internett, og sw.js legger filene i bufferen for bruk uten nett på iPaden.
// Inter (brødtekst og knapper) lastes på forhånd; Schibsted Grotesk (overskrifter) ved behov.
const inter = localFont({
  src: [
    { path: "../../public/fonts/Inter-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Inter-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Inter-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/Inter-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  preload: true,
});

const schibsted = localFont({
  src: [
    { path: "../../public/fonts/SchibstedGrotesk-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/SchibstedGrotesk-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/SchibstedGrotesk-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-schibsted",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: brand.productName, template: `%s – ${brand.productName}` },
  description: `${brand.productName} fra ${brand.companyName}: tilstandsrapporter for takstingeniører.`,
  // Appen lagt på hjemskjermen i Safari åpnes uten adresselinje
  appleWebApp: { capable: true, title: brand.productName, statusBarStyle: "default" },
  // Next.js skriver bare den nye «mobile-web-app-capable»; Safari på iPad leser fortsatt den gamle
  other: { "apple-mobile-web-app-capable": "yes" },
};

// iPad: ingen zoom-sprang i skjemafelt, og appen fyller skjermen når den ligger på hjemskjermen
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: brand.color,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nb" className={`${inter.variable} ${schibsted.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
