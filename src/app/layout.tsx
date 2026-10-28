import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { brand } from "@/shared/config/brand";
import "./globals.css";
import { ServiceWorkerRegistration } from "./service-worker-registration";

// Roboto fra prosjektets egne filer. Ingen kall til Google, så byggingen virker uten internett.
const roboto = localFont({
  src: [
    { path: "../../public/fonts/Roboto-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Roboto-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Roboto-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-roboto",
  display: "swap",
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
    <html lang="nb" className={roboto.variable}>
      <body>
        <div className="aurora-bar" aria-hidden="true" />
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
