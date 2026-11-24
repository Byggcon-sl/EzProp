import type { PdfTgExplanation } from "@/core/pdf";
import { tgFullLabel } from "./logic/labels";

/*
 * Forklaringen av TG i PDF-en (docs/funksjoner/fase2a-pdf-badet.md Omfang 4, A533). Innhold, ikke
 * profil: samme tekst i alle PDF-utgaver. Følger kravene i regelverk-krav.md avsnitt 2 med egne
 * ord, uten tekst fra NS 3600, IVIT eller SmartTakst, og uten gjetteord.
 *
 * Tekststatus er utkast, ikke godkjent av fagrådet (`textStatus: "draft"`). Merket står bare i
 * dataene og skrives aldri i PDF-en. Når fagrådet har godkjent teksten, settes statusen til
 * `approved`.
 */

/** Tekststatusen sagt med ord, til admin og dokumentasjon. Står aldri i PDF-en. */
export const TG_EXPLANATION_STATUS_TEXT = "utkast, ikke godkjent av fagrådet";

export const TG_EXPLANATION: PdfTgExplanation = {
  title: "Slik leser du TG",
  items: [
    {
      tg: "0",
      label: tgFullLabel("0"),
      text: "Ingen avvik er funnet. Dette gjelder normalt en bygningsdel som er tilnærmet ny, og der utførelsen er dokumentert.",
    },
    {
      tg: "1",
      label: tgFullLabel("1"),
      text: "Mindre avvik eller normal slitasje. Gjelder også en bygningsdel som er ny eller nyere, men der utførelsen ikke er dokumentert.",
    },
    {
      tg: "2",
      label: tgFullLabel("2"),
      text: "Vesentlige avvik. Gjelder tegn på skade, behov for tiltak innen kort tid, eller en alder som gjør funksjonen usikker.",
    },
    {
      tg: "3",
      label: tgFullLabel("3"),
      text: "Store eller alvorlige avvik. Gjelder svikt i funksjon eller fare for liv og helse. Rapporten gir et kostnadsanslag for utbedringen.",
    },
    {
      tg: "IU",
      label: tgFullLabel("IU"),
      text: "Bygningsdelen er ikke undersøkt. Rapporten sier hva som ikke er undersøkt, og hvorfor.",
    },
  ],
  hmsText: "Forhold som gjelder helse, miljø og sikkerhet (HMS), beskrives uten tilstandsgrad.",
  textStatus: "draft",
};
