/*
 * Utlogging med tømming av KI-køen på enheten (docs/funksjoner/fase2a-ki-ko.md Omfang 6).
 * Ren funksjon: køen og innloggingen gis inn, så den kan testes uten nettleser. Feil ved tømming
 * stopper aldri utloggingen, og ingenting fra feilen logges (den kan inneholde tekst fra køen).
 * Ble tømmingen ikke fullført, rydder eiersjekken i køen ved neste lesing.
 * Støtter hovedmål: de ansatte (ingen ser en annens tekst på en delt iPad).
 */
export async function logOutAndClear(deps: {
  clearQueue: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
}): Promise<void> {
  try {
    await deps.clearQueue();
  } catch {
    // Bevisst tom: utloggingen skal gå videre, og feilen kan inneholde tekst fra køen.
  }
  await deps.signOut();
}
