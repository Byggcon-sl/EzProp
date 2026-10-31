import Link from "next/link";
import type { ReactNode } from "react";
import { listOrganizationsForActor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { brand } from "@/shared/config/brand";
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

/**
 * Rammen (design A «Fjord», docs/funksjoner/fase0b-grunnlayout-fjord-skisse.md) rundt alle sidene
 * for innloggede ansatte: topplinje, meny og innholdsflate. Menyen står fast til venstre fra `lg`
 * (PC og iPad liggende) og som rad under topplinjen på smalere skjermer (iPad stående).
 * Topplinjen er ikke sticky og rammen har ingen egen rulling, så statuslinjen i /prove virker som
 * før. Sidene har selv `<main>`.
 */
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const organizations = await listOrganizationsForActor(actor);
  const worksFor = organizationLabel(organizations);
  const displayName = actor.name.trim() || actor.email;

  return (
    <>
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
          {worksFor !== null && (
            <p className="basis-full text-sm text-slate-600 lg:mt-auto lg:basis-auto lg:rounded-xl lg:bg-white lg:px-3 lg:py-2.5 lg:shadow-card">
              <span className="lg:block lg:text-xs">Du jobber for</span>{" "}
              <span className="font-medium text-slate-900 lg:block lg:text-sm lg:font-bold">
                {worksFor}
              </span>
            </p>
          )}
        </nav>
        <div className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-6xl px-5 py-6 lg:px-8 lg:py-8">{children}</div>
        </div>
      </div>
    </>
  );
}
