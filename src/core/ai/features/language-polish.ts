import type { AiFeatureDefinition } from "../types";

/*
 * Prøvefunksjonen i 2a-1 (A159): språkvask av én tekst. Egen formulering, ingen tekst fra
 * NS 3600, IVIT eller SmartTakst. KI setter aldri TG, så ingen TG-felt er mål.
 */

const INSTRUCTIONS = [
  "Rett språket i teksten under. Bruk norsk bokmål, korte setninger og et enkelt og konkret språk.",
  "Behold innholdet og fagordene. Legg ikke til opplysninger, og fjern ingen.",
  "Bruk ikke ord som uttrykker gjetning. Svar bare med den rettede teksten.",
].join("\n");

export const languagePolish: AiFeatureDefinition = {
  code: "language_polish",
  permission: "report.edit",
  allowedFields: ["text"],
  allowedTargets: [{ type: "answer", fieldKey: "text" }],
  promptVersion: "language_polish.v1",
  instructions: INSTRUCTIONS,
  buildPrompt(fields) {
    return `${INSTRUCTIONS}\n\n${fields.text ?? ""}`;
  },
};
