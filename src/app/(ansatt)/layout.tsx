import Link from "next/link";
import type { ReactNode } from "react";
import { listOrganizationsForActor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { findAdminOrganizationId } from "@/core/organization";
import { brand } from "@/shared/config/brand";
import { getEmployeeContext } from "./employee-context";
import { LogOutButton } from "./log-out-button";
import { NavLink } from "./nav-link";
import { organizationLabel } from "./organization-label";

/** Første bokstav i de to første ordene i navnet. Tomt navn: første bokstav i e-posten. */
function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = words.map((word) => word[0]).join("");
  return (letters || email.slice(0, 1)).toUpperCase();
}

function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H6v18h12V7z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5.5 5h13L21 13v6H3v-6z" />
    </svg>
  );
}

function ContactIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 21V4h11v17" />
      <path d="M15 9h5v12" />
      <path d="M3 21h18" />
      <path d="M8 8h3M8 12h3M8 16h3" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3" />
      <path d="M6.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="5" cy="10" r="2" />
      <path d="M1.5 18a3.5 3.5 0 0 1 5-3.2" />
      <circle cx="19" cy="10" r="2" />
      <path d="M22.5 18a3.5 3.5 0 0 0-5-3.2" />
    </svg>
  );
}

/**
 * Rammen (design A «Fjord», docs/funksjoner/fase0b-grunnlayout-fjord-skisse.md) rundt alle sidene
 * for innloggede ansatte: topplinje, meny og innholdsflate. Menyen står fast til venstre fra `lg`
 * (PC og iPad liggende) og som rad under topplinjen på smalere skjermer (iPad stående).
 * Topplinjen er ikke sticky og rammen har ingen egen rulling, så statuslinjen i /prove virker som
 * før. Sidene har selv `<main>`. Hopplenken «Hopp til hovedinnhold» er første fokuserbare element.
 */
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const [organizations, adminOrganizationId, employee] = await Promise.all([
    listOrganizationsForActor(actor),
    findAdminOrganizationId(actor),
    getEmployeeContext(),
  ]);
  const worksFor = organizationLabel(organizations);
  const displayName = actor.name.trim() || actor.email;

  return (
    <>
      <a
        href="#hovedinnhold"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-full focus:bg-night focus:px-5 focus:font-semibold focus:text-white"
      >
        Hopp til hovedinnhold
      </a>
      <header className="flex h-14 items-center gap-4 border-b border-slate-200 bg-white px-5">
        <Link
          href="/arbeidskoe"
          className="inline-flex min-h-11 min-w-11 items-center gap-2.5 text-lg font-bold tracking-tight text-brand-900"
        >
          <span
            aria-hidden="true"
            className="flex size-[30px] items-center justify-center rounded-lg bg-brand-600 text-[15px] font-bold text-white"
          >
            {brand.productName.slice(0, 2)}
          </span>
          {brand.productName}
        </Link>
        <div className="flex-1" />
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white"
        >
          {initials(actor.name, actor.email)}
        </span>
        <span className="sr-only">Innlogget som {displayName}</span>
        <LogOutButton />
      </header>
      <div className="lg:flex">
        <nav
          aria-label="Hovedmeny"
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3 lg:min-h-[calc(100dvh-60px)] lg:w-58 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0.5 lg:border-b-0 lg:px-3 lg:py-4"
        >
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
            <li>
              <NavLink href="/arbeidskoe">
                <HomeIcon />
                Arbeidskø
              </NavLink>
            </li>
            {organizations.length > 0 && (
              <li>
                <NavLink href="/ordre" matchChildren>
                  <InboxIcon />
                  Ordre
                </NavLink>
              </li>
            )}
            {organizations.length > 0 && (
              <li>
                <NavLink href="/kontakter" matchChildren>
                  <ContactIcon />
                  Kontakter
                </NavLink>
              </li>
            )}
            {organizations.length > 0 && (
              <li>
                <NavLink href="/firma" matchChildren>
                  <BuildingIcon />
                  Firma
                </NavLink>
              </li>
            )}
            {employee?.canReadStatistics && (
              <li>
                <NavLink href="/statistikk/tid" matchChildren>
                  <ChartIcon />
                  Statistikk
                </NavLink>
              </li>
            )}
          </ul>
          <p
            id="nav-group-trials"
            className="text-sm text-slate-600 lg:px-3 lg:pt-3.5 lg:pb-1.5 lg:text-xs lg:tracking-wider lg:uppercase"
          >
            Prøver<span className="lg:hidden">:</span>
          </p>
          <ul
            aria-labelledby="nav-group-trials"
            className="flex flex-wrap gap-2 lg:flex-col lg:gap-0.5"
          >
            <li>
              <NavLink href="/prove/testskjema" matchChildren>
                <DocumentIcon />
                Testskjema uten nett
              </NavLink>
            </li>
          </ul>
          {adminOrganizationId !== null && (
            <>
              <p
                id="nav-group-organization"
                className="text-sm text-slate-600 lg:px-3 lg:pt-3.5 lg:pb-1.5 lg:text-xs lg:tracking-wider lg:uppercase"
              >
                Organisasjon<span className="lg:hidden">:</span>
              </p>
              <ul
                aria-labelledby="nav-group-organization"
                className="flex flex-wrap gap-2 lg:flex-col lg:gap-0.5"
              >
                <li>
                  <NavLink href="/admin" matchChildren>
                    <PeopleIcon />
                    Admin
                  </NavLink>
                </li>
              </ul>
            </>
          )}
          {worksFor !== null && (
            <p className="basis-full text-sm text-slate-600 lg:mt-auto lg:basis-auto lg:rounded-xl lg:bg-white lg:px-3 lg:py-2.5 lg:ring-1 lg:ring-line">
              <span className="lg:block lg:text-xs">Du jobber for</span>{" "}
              <span className="font-medium text-slate-900 lg:block lg:text-sm lg:font-bold">
                {worksFor}
              </span>
            </p>
          )}
        </nav>
        {/* Målet for hopplenken. Sidene har selv `<main>`, så målet er rammen rundt (ikke en main til). */}
        <div id="hovedinnhold" tabIndex={-1} className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-5 py-6 lg:px-8 lg:py-8">{children}</div>
        </div>
      </div>
    </>
  );
}
