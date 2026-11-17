"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@/shared/ui/notice";
import {
  CREATED_FROM_OFFER_LINK_LABEL,
  CREATED_FROM_OFFER_MESSAGE,
  TEAM_ANCHOR,
} from "./created-from-offer";

/*
 * Pekeren etter «Gjør om til oppdrag» (docs/funksjoner/fase2a-tilbud.md F5, A367, design avsnitt
 * 6). Neste steg er alltid å velge takstmann og befaringsdato, så kvitteringen lenker dit.
 */

/**
 * Kvitteringen «Oppdraget er laget.» med lenken «Velg takstmann og befaringsdato» til `#takstmann`.
 * Står bare når siden åpnes med `?fra=tilbud`. Parameteren tas bort fra adressen når kvitteringen
 * er vist (`router.replace`), så den ikke kommer tilbake ved omlasting (T-0089). Kvitteringen blir
 * stående til man går fra siden. Lenken flytter også fokus til seksjonen (`tabIndex=-1`), så
 * skjermleser og tastatur fortsetter der feltene står.
 */
export function CreatedFromOfferNotice({ show }: { show: boolean }) {
  const [visible] = useState(show);
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (show) router.replace(pathname, { scroll: false });
  }, [show, router, pathname]);
  useEffect(() => {
    const wrapper = ref.current;
    if (!wrapper) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest(`a[href="#${TEAM_ANCHOR}"]`)) return;
      // Etter at lenken har rullet til seksjonen.
      window.requestAnimationFrame(() => document.getElementById(TEAM_ANCHOR)?.focus());
    };
    wrapper.addEventListener("click", onClick);
    return () => wrapper.removeEventListener("click", onClick);
  }, [visible]);
  if (!visible) return null;
  return (
    <div ref={ref} className="mb-4">
      <Notice
        message={CREATED_FROM_OFFER_MESSAGE}
        link={{ href: `#${TEAM_ANCHOR}`, label: CREATED_FROM_OFFER_LINK_LABEL }}
      />
    </div>
  );
}
