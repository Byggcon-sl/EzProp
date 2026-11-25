import { describe, expect, it } from "vitest";
import { OUTCOME_MATCH_TEXTS, osloClock, SUGGESTION_MESSAGES } from "./room-messages";

/*
 * Faste meldinger når et regelforslag og avviket det laget, henger sammen (oppgavekortet
 * «Faste tekster», testplanen FA-L27). Tekstene sjekkes eksakt. Klokkeslettet er norsk tid, også
 * over sommer- og vintertid, uansett tidssonen testen kjører i.
 * Støtter hovedmål: færre reklamasjoner (TG3 faller ikke stille ut) og de ansatte (to vinduer gir
 * ikke dobbelt arbeid).
 */

describe("meldingene for forslag og avvik", () => {
  it("FA-L27 «Fjern avviket» på avvik fra forslag sier at forslaget er åpent igjen", () => {
    expect(SUGGESTION_MESSAGES.suggestionReopened(3)).toBe(
      "Avviket er fjernet. Forslaget om TG3 er åpent igjen.",
    );
    expect(SUGGESTION_MESSAGES.suggestionReopened(2)).toBe(
      "Avviket er fjernet. Forslaget om TG2 er åpent igjen.",
    );
  });

  it("FA-L27 «velg TG2 eller TG3» og forslag uten TG gir teksten uten TG", () => {
    expect(SUGGESTION_MESSAGES.suggestionReopened("choose")).toBe(
      "Avviket er fjernet. Forslaget er åpent igjen.",
    );
    expect(SUGGESTION_MESSAGES.suggestionReopened(null)).toBe(
      "Avviket er fjernet. Forslaget er åpent igjen.",
    );
  });

  it("FA-L27 avgjort i et annet vindu: hva og når, aldri hvem", () => {
    const at = "2026-11-23T09:42:00.000Z";
    expect(SUGGESTION_MESSAGES.alreadyDecided("accepted", "3", at)).toBe(
      "Godtatt i et annet vindu kl. 10.42: TG3",
    );
    expect(SUGGESTION_MESSAGES.alreadyDecided("changed", "2", at)).toBe(
      "Endret i et annet vindu kl. 10.42: TG2",
    );
    expect(SUGGESTION_MESSAGES.alreadyDecided("rejected", null, at)).toBe(
      "Avvist i et annet vindu kl. 10.42",
    );
    expect(SUGGESTION_MESSAGES.alreadyDecided("accepted", "IU", at)).toBe(
      "Godtatt i et annet vindu kl. 10.42: TGIU",
    );
  });

  it("FA-L27 klokkeslettet er norsk tid over sommer- og vintertid, med to sifre og punktum", () => {
    expect(osloClock("2026-07-01T08:42:00Z")).toBe("10.42");
    expect(osloClock("2026-11-23T09:42:00Z")).toBe("10.42");
    expect(osloClock("2026-11-23T23:05:00Z")).toBe("00.05");
    expect(osloClock("2026-03-29T00:59:00Z")).toBe("01.59");
    expect(osloClock("2026-03-29T01:00:00Z")).toBe("03.00");
  });

  it("FA-L27 «Angre» etter ny beslutning og lenken til forslaget", () => {
    expect(SUGGESTION_MESSAGES.newerDecision).toBe(
      "Forslaget er avgjort på nytt etter at avviket ble fjernet. Avviket hentes ikke tilbake.",
    );
    expect(SUGGESTION_MESSAGES.goToSuggestion).toBe("Gå til forslaget");
    expect(SUGGESTION_MESSAGES.reasonMissing).toBe("Velg en grunn for å endre TG fra forslaget.");
  });

  it("FA-L27 ingen gjetteord i meldingene", () => {
    const texts = [
      SUGGESTION_MESSAGES.suggestionReopened(3),
      SUGGESTION_MESSAGES.suggestionReopened(null),
      SUGGESTION_MESSAGES.alreadyDecided("changed", "2", "2026-11-23T09:42:00Z"),
      SUGGESTION_MESSAGES.newerDecision,
    ];
    for (const text of texts) expect(text).not.toMatch(/antas|trolig|sannsynligvis/i);
  });
});

/*
 * «Skriv det du ser» (skissen avsnitt 7, testplanen S6 og S9.6). Tekstene sjekkes eksakt der
 * skjermen og e2e leter etter dem, og samlet for gjetteord, modellnavn og diktering.
 * Støtter hovedmål: KI i bunnen (KI foreslår, du velger) og færre reklamasjoner (ingen gjetteord).
 */
describe("tekstene for «Skriv det du ser»", () => {
  const all = (): string[] =>
    Object.values(OUTCOME_MATCH_TEXTS).flatMap((value) =>
      typeof value === "function" ? [value(1, 500), value(3, 500)] : [value],
    );

  it("faste tekster i feltet, gruppen og meldingene", () => {
    expect(OUTCOME_MATCH_TEXTS.fieldLabel).toBe("Skriv hva du ser, eller søk");
    expect(OUTCOME_MATCH_TEXTS.find).toBe("Finn med KI");
    expect(OUTCOME_MATCH_TEXTS.groupHeading).toBe("Forslag fra KI (velg ett)");
    expect(OUTCOME_MATCH_TEXTS.groupHelp).toBe(
      "KI foreslår, du velger. Ingen er valgt på forhånd.",
    );
    expect(OUTCOME_MATCH_TEXTS.ranked(1)).toBe("1 forslag fra KI.");
    expect(OUTCOME_MATCH_TEXTS.ranked(3)).toBe("3 forslag fra KI. Ingen er valgt.");
    expect(OUTCOME_MATCH_TEXTS.noMatch).toBe("Ingen utfall passer. Bruk søket eller punktlisten.");
    expect(OUTCOME_MATCH_TEXTS.aiError).toBe("KI svarte ikke. Bruk søket.");
    expect(OUTCOME_MATCH_TEXTS.offline).toBe("Uten nett: bare tekstsøk.");
    expect(OUTCOME_MATCH_TEXTS.outdated).toBe(
      "Forslagene er utdatert. Trykk «Finn med KI» på nytt.",
    );
    expect(OUTCOME_MATCH_TEXTS.nearestHeading).toBe("Nærmeste treff (uten KI)");
    expect(OUTCOME_MATCH_TEXTS.opensDeviation(2)).toBe("Åpner avvik 2.");
    expect(OUTCOME_MATCH_TEXTS.noteCount(412, 500)).toBe("412 av 500 tegn");
    expect(OUTCOME_MATCH_TEXTS.addNote).toBe("Legg notatet til");
    expect(OUTCOME_MATCH_TEXTS.useNoteOnly).toBe("Bruk bare notatet");
    expect(OUTCOME_MATCH_TEXTS.undo).toBe("Angre");
  });

  it("«Ingen utfall passer» sier ikke at det ikke er avvik og nevner ikke TG", () => {
    expect(OUTCOME_MATCH_TEXTS.noMatch).not.toMatch(/TG|ikke avvik|ingen avvik/i);
  });

  it("meldingen om fødselsnummer gjengir ingen sifre", () => {
    expect(OUTCOME_MATCH_TEXTS.nationalId).not.toMatch(/\d/);
  });

  it("ingen gjetteord i tekstene", () => {
    for (const text of all()) expect(text).not.toMatch(/antas|trolig|sannsynligvis|kanskje/i);
  });

  it("ingen modellnavn i tekstene", () => {
    const parts = [
      ["cla", "ude"],
      ["g", "pt"],
      ["son", "net"],
      ["ha", "iku"],
    ];
    const model = new RegExp(parts.map((p) => p.join("")).join("|"), "i");
    for (const text of all()) expect(text).not.toMatch(model);
  });

  it("S9.6 ingen tekst nevner eller oppfordrer til diktering, mikrofon eller tale (spørsmål 121)", () => {
    for (const text of all()) expect(text).not.toMatch(/dikt|mikrofon|\btale\b|snakk|stemme/i);
  });
});
