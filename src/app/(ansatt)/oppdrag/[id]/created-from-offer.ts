/*
 * Det oppdragssiden og kvitteringen etter omgjøring har felles (docs/funksjoner/fase2a-tilbud.md
 * F5 og T-0075). Ingen «use client»: brukes både av serversiden og av klientdelen.
 */

/** Adressen har `?fra=tilbud` når oppdraget nettopp er laget fra et tilbud. */
export const FROM_OFFER_PARAM = "fra";
export const FROM_OFFER_VALUE = "tilbud";

export const CREATED_FROM_OFFER_MESSAGE = "Oppdraget er laget.";
export const CREATED_FROM_OFFER_LINK_LABEL = "Velg takstmann og befaringsdato";

/** Ankeret på seksjonen «Team» (A368): omgjøringen setter ikke ansvarlig takstmann. */
export const TEAM_ANCHOR = "takstmann";

/**
 * T-0075: tilbudet og oppdraget har hver sin kopi av bestillingen (ADR 0011 punkt 3, ADR 0012).
 * «Bestilling» på oppdraget endrer bare oppdraget, og «Endre tilbudet» endrer bare tilbudet.
 */
export const OWN_BOOKING_COPY_TEXT =
  "Oppdraget har sin egen kopi av bestillingen. Endringer her endrer ikke tilbudet.";
