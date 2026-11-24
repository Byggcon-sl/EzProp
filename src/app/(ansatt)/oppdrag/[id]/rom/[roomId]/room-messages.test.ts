import { describe, expect, it } from "vitest";
import { osloClock, SUGGESTION_MESSAGES } from "./room-messages";

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
