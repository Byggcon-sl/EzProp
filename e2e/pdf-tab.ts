import { expect, type Locator, type Page, type Request, type Response } from "@playwright/test";

/*
 * Trykk som åpner en PDF-rute i ny fane (fase 2a-2, docs/funksjoner/fase2a-pdf-badet-testplan.md
 * avsnitt 7 og 10.2.5).
 *
 * Full Chromium viser PDF-en i en innebygd viser i fanen. Playwrights standard headless Chromium
 * (headless shell, brukt i CI) gjør i stedet navigasjonen til en nedlasting: fanen får tom
 * `url()`, `waitForURL` gir `net::ERR_ABORTED`, og `response.finished()` blir aldri ferdig.
 * Hjelperen leser derfor adressen, status og hoder fra forespørselen fanen gjør, som er lik i
 * begge. Bytene hentes med `page.request.get` mot samme adresse og samme økt (11.9.1).
 */

export type PdfTab = {
  /** Den nye fanen (popup-hendelsen). */
  popup: Page;
  /** Forespørselen fanen gjorde mot PDF-ruten. */
  request: Request;
  /** Svaret på forespørselen (status og hoder). */
  response: Response;
  /** Stien fanen spurte etter, for eksempel `/oppdrag/<id>/pdf`. */
  path: string;
};

/**
 * Venter på at fanen spør etter en PDF-rute. Start ventingen før trykket. Forespørselen må komme
 * fra en annen fane enn `page`, slik at et trykk som navigerer originalfanen ikke godtas.
 */
export function waitForPdfTab(
  page: Page,
  path: RegExp,
  options: { timeout?: number } = {},
): () => Promise<PdfTab> {
  const context = page.context();
  const popup = context.waitForEvent("page", { timeout: options.timeout });
  const request = context.waitForEvent("request", {
    predicate: (r) => r.method() === "GET" && path.test(new URL(r.url()).pathname),
    timeout: options.timeout,
  });
  // Unngår uhåndtert avvisning hvis trykket feiler før ventingen hentes
  popup.catch(() => undefined);
  request.catch(() => undefined);
  return async () => {
    const [tab, sent] = await Promise.all([popup, request]);
    expect(tab, "trykket åpner en ny fane").not.toBe(page);
    expect(sent.frame().page(), "forespørselen kommer fra den nye fanen").toBe(tab);
    expect(sent.isNavigationRequest(), "fanen navigerer til PDF-ruten").toBe(true);
    const response = await sent.response();
    expect(response, "PDF-ruten svarer").not.toBeNull();
    return { popup: tab, request: sent, response: response!, path: new URL(sent.url()).pathname };
  };
}

/** Trykker på kontrollen og venter på fanen som spør etter PDF-ruten. */
export async function clickToPdfTab(
  page: Page,
  target: Locator,
  path: RegExp,
  options: { timeout?: number } = {},
): Promise<PdfTab> {
  const opened = waitForPdfTab(page, path, options);
  await target.click();
  return opened();
}

/**
 * Sjekker at svaret i fanen er en PDF, og henter bytene fra samme adresse med samme økt. Fanen kan
 * ikke gi bytene: full Chromium bytter ut innholdet med viseren, headless shell laster dem ned.
 */
export async function pdfTabBytes(page: Page, tab: PdfTab): Promise<Uint8Array> {
  expect(tab.response.status()).toBe(200);
  expect(tab.response.headers()["content-type"]).toMatch(/^application\/pdf/);
  const again = await page.request.get(tab.request.url());
  expect(again.status()).toBe(200);
  expect(again.headers()["content-type"]).toMatch(/^application\/pdf/);
  return new Uint8Array(await again.body());
}
