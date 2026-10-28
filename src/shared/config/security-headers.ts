/*
 * Sikkerhetshoder på alle sider og filer (som i Optiplan, se
 * docs/06-arkitektur.md). Settes i next.config.ts.
 *
 * Innholdsreglene (CSP) er bevisst enkle: de bestemmer hvem som kan vise løsningen i en ramme,
 * hvor skjemaer kan sendes og at gamle innebygde programtillegg ikke lastes. Hvilke skript og
 * stiler som kan kjøres, er ikke begrenset ennå; det krever en «nonce» per side, som kan
 * stoppe Next.js og PDF-ene. Forslaget står i docs/06-arkitektur.md.
 */

export const contentSecurityPolicy = [
  // Ingen andre nettsteder kan vise løsningen i en ramme (klikk-kapring)
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export const securityHeaders: { key: string; value: string }[] = [
  // Bare https i ett år, også når noen skriver adressen uten https (nettleseren husker det)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Andre nettsteder får bare vite domenet, ikke hele adressen (den kan ha id-er i seg)
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Kamera bare for løsningen selv (bilder fra befaringen); resten trengs ikke
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
];
