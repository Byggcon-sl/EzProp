import { vi } from "vitest";

/*
 * Fremtvinger en feil fra `new RegExp` i vasken (docs/funksjoner/fase2a-evalueringssett-testplan.md
 * E6.1–E6.2). Et mønster med svært mange eller lange kjente verdier kan gi «Regular expression too
 * large», og meldingen fra V8 har hele mønsteret med verdiene. Her byttes den globale `RegExp` med
 * en innpakning som kaster akkurat en slik melding når mønsteret har `marker`. Alle andre mønstre
 * lages som vanlig. Bare i testene; husk `vi.unstubAllGlobals()`.
 */
export function stubFailingRegExp(marker: string): void {
  const Real = RegExp;
  const Failing = new Proxy(Real, {
    construct(target, args: unknown[], newTarget) {
      const pattern = args[0];
      const source = pattern instanceof Real ? pattern.source : String(pattern);
      if (source.includes(marker)) {
        throw new SyntaxError(
          `Invalid regular expression: /${source}/giu: Regular expression too large`,
        );
      }
      return Reflect.construct(target, args, newTarget) as object;
    },
  });
  vi.stubGlobal("RegExp", Failing);
}
