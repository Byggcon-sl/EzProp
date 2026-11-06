import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  claimRowsFor,
  createAssignmentWithParty,
  insertClaimRow,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  uniqueSuffix,
} from "./helpers";

/*
 * Reklamasjoner med enkelt skjema (fase 2a).
 * Testplan: docs/funksjoner/fase2a-reklamasjoner-testplan.md avsnitt 5 (sakene 1–11). Kjører i
 * prosjektene pc og ipad; sak 10 bare i ipad, sak 11 bare i pc.
 *
 * Lederen er `logInAsManager` (rollen `manager`), så testene viser at rettigheten gjelder leder og
 * ikke bare admin. Hver test lager sitt eget oppdrag med én part (kjøper «Kjøper Test …») med
 * `uniqueSuffix()`. Data er oppdiktet: «Kjøper Test», «Fukt i kjeller ikke nevnt», «Kjeller,
 * yttervegg». Ingen e2e uten nett: sidene er lederarbeid på PC (kortet «Skjermer»).
 *
 * Lokatorene følger kortet: delen «Reklamasjoner» (landemerke) på oppdraget, knappen «Registrer
 * reklamasjon», merket «Åpen» eller «Lukket (utfall)», hovedhandlingen «Lagre», «Fjern» med
 * bekreftelse, og hjelpeteksten under beskrivelsen.
 *
 * Støtter hovedmål: reklamasjoner (sakene registreres og lukkes på oppdraget, takstmann og kontor
 * ser dem aldri) og tid (fem felt, virker med trykk på iPad og med tastatur på PC).
 */

const HINT = "Skriv kort hva som påstås. Ikke skriv fødselsnummer eller helseopplysninger.";
const DESCRIPTION = "Fukt i kjeller ikke nevnt";
const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;

/** Dagens dato i Norge (`YYYY-MM-DD`), som appen bruker (`todayInOslo`). */
function todayInOslo(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

/** «2026-11-06» blir «06.11.2026». */
function norwegianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

function claimsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Reklamasjoner", exact: true });
}

function registerButton(page: Page): Locator {
  return page.getByRole("link", { name: "Registrer reklamasjon", exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre", exact: true });
}

function claimantField(page: Page): Locator {
  return page.getByLabel(/^Hvem klaget/);
}

function descriptionField(page: Page): Locator {
  return page.getByLabel(/^Beskrivelse/);
}

function partyField(page: Page): Locator {
  return page.getByLabel(/^Part/);
}

function outcomeField(page: Page): Locator {
  return page.getByLabel(/^Utfall/);
}

function amountField(page: Page): Locator {
  return page.getByLabel(/^Beløp/);
}

function notFoundHeading(page: Page): Locator {
  return page.getByRole("heading", { name: "Fant ikke siden", level: 1 });
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling på ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

async function expectOnAssignment(page: Page, assignmentId: string) {
  await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}$`));
  await expect(claimsSection(page)).toBeVisible();
}

/** Linjen for en sak i listen, funnet på beskrivelsen. */
function claimLine(page: Page, description: string): Locator {
  return claimsSection(page).getByRole("link").filter({ hasText: description });
}

/** Leder registrerer en sak med parten som klager (sak 1). Gir id-en til oppdraget. */
async function registerWithParty(
  page: Page,
  description: string,
  tap = false,
): Promise<{ assignmentId: string; partyName: string }> {
  const { assignmentId, partyId, partyName } = await createAssignmentWithParty(uniqueSuffix());
  await page.goto(`/oppdrag/${assignmentId}`);
  await expect(claimsSection(page)).toBeVisible();
  if (tap) await registerButton(page).tap();
  else await registerButton(page).click();
  await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}/reklamasjoner/ny$`));

  await expect(page.getByLabel(/^Mottatt/)).toHaveValue(todayInOslo());
  await partyField(page).selectOption(partyId);
  await descriptionField(page).fill(description);
  if (tap) await saveButton(page).tap();
  else await saveButton(page).click();
  await expectOnAssignment(page, assignmentId);
  return { assignmentId, partyName };
}

/** Åpner saken fra listen, velger utfall og beløp og lagrer (sak 5). */
async function closeAsSettled(page: Page, description: string, tap = false) {
  if (tap) await claimLine(page, description).tap();
  else await claimLine(page, description).click();
  await expect(page).toHaveURL(/\/reklamasjoner\/[0-9a-f-]{36}$/);
  await outcomeField(page).selectOption({ label: "Forlik" });
  await amountField(page).fill("20 000");
  if (tap) await saveButton(page).tap();
  else await saveButton(page).click();
}

test.describe("reklamasjoner: leder (pc og ipad)", () => {
  test("1. leder registrerer en sak med part fra oppdraget; den står i listen som åpen", async ({
    page,
  }) => {
    await logInAsManager(page);
    const description = `${DESCRIPTION} ${uniqueSuffix()}`;
    const { assignmentId } = await registerWithParty(page, description);

    const line = claimLine(page, description);
    await expect(line).toBeVisible();
    await expect(line).toContainText(norwegianDate(todayInOslo()));
    await expect(line).toContainText("Reklamasjon");
    await expect(line).toContainText("Åpen");

    const rows = await claimRowsFor(assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.claimantPartyId).not.toBeNull();
    expect(rows[0]!.outcome).toBe("open");
  });

  test("2. hjelpeteksten vises under beskrivelsen", async ({ page }) => {
    await logInAsManager(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/ny`);
    await expect(page.getByText(HINT, { exact: true })).toBeVisible();
    // Hjelpeteksten hører til feltet (beskrivelsen peker på den)
    await expect(descriptionField(page)).toHaveAccessibleDescription(new RegExp(HINT));
  });

  test("3. «Lagre» uten klager og beskrivelse gir norske meldinger ved feltene; ingen sak lagres", async ({
    page,
  }) => {
    await logInAsManager(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/ny`);
    await claimantField(page).fill("");
    await descriptionField(page).fill("");
    await saveButton(page).click();

    await expect(descriptionField(page)).toHaveAttribute("aria-invalid", "true");
    // Feilen for klageren står ved «Hvem klaget» eller ved velgeren for part
    await expect(
      page
        .locator(
          '[name="claimantText"][aria-invalid="true"], [name="claimantPartyId"][aria-invalid="true"]',
        )
        .first(),
    ).toBeVisible();
    // Meldingene er norske, ikke Zods engelske standardtekst
    await expect(page.getByText(/Invalid|Required|Expected/)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${assignmentId}/reklamasjoner/ny$`));
    expect(await claimRowsFor(assignmentId)).toHaveLength(0);
  });

  test("4. fritekst i stedet for part: «Kjøper Test» lagres som klager", async ({ page }) => {
    await logInAsManager(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    const description = `${DESCRIPTION} ${uniqueSuffix()}`;
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/ny`);
    await claimantField(page).fill("Kjøper Test");
    await descriptionField(page).fill(description);
    await page.getByLabel(/^Bygningsdel/).fill("Kjeller, yttervegg");
    await saveButton(page).click();
    await expectOnAssignment(page, assignmentId);
    await expect(claimLine(page, description)).toBeVisible();

    const [row] = await claimRowsFor(assignmentId);
    expect(row?.claimantText).toBe("Kjøper Test");
    expect(row?.claimantPartyId).toBeNull();
  });

  test("5. lukke med utfall «Forlik» og 20 000: merket blir «Lukket (Forlik)»", async ({
    page,
  }) => {
    await logInAsManager(page);
    const description = `${DESCRIPTION} ${uniqueSuffix()}`;
    const { assignmentId } = await registerWithParty(page, description);
    await closeAsSettled(page, description);
    await expectOnAssignment(page, assignmentId);
    await expect(claimLine(page, description)).toContainText("Lukket (Forlik)");

    const [row] = await claimRowsFor(assignmentId);
    expect(row?.outcome).toBe("settled");
    expect(row?.amount).toBe(20_000);
  });

  test("6. beløpsfeltet skjules ved «Åpen» og «Avvist», tømmes ved «Åpen»; gjenåpning lagres", async ({
    page,
  }) => {
    await logInAsManager(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    const description = `${DESCRIPTION} ${uniqueSuffix()}`;
    const claimId = await insertClaimRow(assignmentId, {
      description,
      outcome: "settled",
      amount: 20_000,
    });
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/${claimId}`);
    await expect(amountField(page)).toHaveValue(/20\s?000/);

    await outcomeField(page).selectOption({ label: "Avvist" });
    await expect(amountField(page)).toHaveCount(0);
    await outcomeField(page).selectOption({ label: "Åpen" });
    await expect(amountField(page)).toHaveCount(0);
    // Tilbake til forlik: feltet er tømt
    await outcomeField(page).selectOption({ label: "Forlik" });
    await expect(amountField(page)).toHaveValue("");
    await outcomeField(page).selectOption({ label: "Åpen" });

    await saveButton(page).click();
    await expectOnAssignment(page, assignmentId);
    await expect(claimLine(page, description)).toContainText("Åpen");
    const [row] = await claimRowsFor(assignmentId);
    expect(row?.outcome).toBe("open");
    expect(row?.amount).toBeNull();
  });

  test("7. «Fjern» med bekreftelse; «Avbryt» fjerner ingenting", async ({ page }) => {
    await logInAsManager(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    const description = `${DESCRIPTION} ${uniqueSuffix()}`;
    const claimId = await insertClaimRow(assignmentId, { description });
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/${claimId}`);

    await page.getByRole("button", { name: "Fjern", exact: true }).click();
    await page.getByRole("button", { name: "Avbryt", exact: true }).click();
    expect((await claimRowsFor(assignmentId))[0]?.deletedAt).toBeNull();

    await page.getByRole("button", { name: "Fjern", exact: true }).click();
    await page.getByRole("button", { name: /^(Ja, fjern|Fjern saken|Bekreft)/ }).click();
    await expectOnAssignment(page, assignmentId);
    await expect(claimLine(page, description)).toHaveCount(0);
    const rows = await claimRowsFor(assignmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();
  });
});

test.describe("reklamasjoner: takstmann og kontor ser ingenting (pc og ipad)", () => {
  async function expectNothingVisible(page: Page, assignmentId: string, claimId: string) {
    await page.goto(`/oppdrag/${assignmentId}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(claimsSection(page)).toHaveCount(0);
    await expect(page.getByText("Reklamasjoner", { exact: true })).toHaveCount(0);
    await expect(registerButton(page)).toHaveCount(0);
    await expect(page.getByText(DESCRIPTION)).toHaveCount(0);

    for (const path of [
      `/oppdrag/${assignmentId}/reklamasjoner/ny`,
      `/oppdrag/${assignmentId}/reklamasjoner/${claimId}`,
      `/oppdrag/${assignmentId}/reklamasjoner/${randomUUID()}`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} gir 404`).toBe(404);
      await expect(notFoundHeading(page)).toBeVisible();
      await expect(page.getByText(DESCRIPTION)).toHaveCount(0);
      await expect(saveButton(page)).toHaveCount(0);
    }
  }

  for (const editAll of [true, false]) {
    test(`8. takstmann (innstillingen ${editAll ? "på" : "av"}) ser ikke delen og får 404 på sidene`, async ({
      page,
    }) => {
      const previous = await setInspectorsEditAll(editAll);
      try {
        const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
        const claimId = await insertClaimRow(assignmentId);
        await logInAsInspector(page);
        await expectNothingVisible(page, assignmentId, claimId);
      } finally {
        await restoreInspectorsEditAll(previous);
      }
    });
  }

  test("9. kontor ser ikke delen og får 404 på sidene", async ({ page }) => {
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    const claimId = await insertClaimRow(assignmentId);
    await logInAsOffice(page);
    await expectNothingVisible(page, assignmentId, claimId);
  });
});

test.describe("reklamasjoner på iPad (bare ipad)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Bare iPad-størrelse");
  });

  for (const [name, viewport] of [
    ["liggende", LANDSCAPE],
    ["stående", PORTRAIT],
  ] as const) {
    test(`10. ${name}: skjemaet får plass, trykkflater minst 44 px, registrer og lukk med trykk`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await logInAsManager(page);
      const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());

      await page.goto(`/oppdrag/${assignmentId}`);
      await expectAtLeast44(registerButton(page), "«Registrer reklamasjon»");
      await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/ny`);
      await expectNoHorizontalScroll(page, "skjemaet");
      await expectAtLeast44(partyField(page), "velgeren for part");
      await expectAtLeast44(claimantField(page), "feltet «Hvem klaget»");
      await expectAtLeast44(saveButton(page), "«Lagre»");

      // «Lagre» er synlig rett etter beskrivelsen (tastaturet dekker nederste del av skjermen)
      await descriptionField(page).tap();
      await saveButton(page).scrollIntoViewIfNeeded();
      await expect(saveButton(page)).toBeInViewport();

      const description = `${DESCRIPTION} ${uniqueSuffix()}`;
      await registerWithParty(page, description, true);
      await expect(claimLine(page, description)).toContainText("Åpen");
      await expectAtLeast44(claimLine(page, description), "linjen for saken");

      await claimLine(page, description).tap();
      await expectNoHorizontalScroll(page, "endresiden");
      await expectAtLeast44(outcomeField(page), "velgeren for utfall");
      await page.goBack();
      await closeAsSettled(page, description, true);
      await expect(claimLine(page, description)).toContainText("Lukket (Forlik)");
    });
  }
});

test.describe("reklamasjoner med tastatur (bare pc)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "pc", "Bare PC");
  });

  /** Navnet på feltet som har fokus, eller teksten på knappen. */
  async function focused(page: Page): Promise<string> {
    return page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return "";
      return element.getAttribute("name") ?? element.textContent?.trim() ?? "";
    });
  }

  test("11. skjemaet fylles og lagres med Tab og Enter; fokus går til første feil", async ({
    page,
  }) => {
    await logInAsManager(page);
    const { assignmentId } = await createAssignmentWithParty(uniqueSuffix());
    await page.goto(`/oppdrag/${assignmentId}/reklamasjoner/ny`);

    // Først en feil: rett til «Lagre» med Tab og Enter
    await page.getByLabel(/^Type/).focus();
    for (let i = 0; i < 15 && (await focused(page)) !== "Lagre"; i += 1) {
      await page.keyboard.press("Tab");
    }
    expect(await focused(page)).toBe("Lagre");
    await page.keyboard.press("Enter");
    await expect(page.locator(":focus")).toHaveAttribute("aria-invalid", "true");
    expect(await claimRowsFor(assignmentId)).toHaveLength(0);

    // Så fylles feltene med tastaturet og lagres med Enter
    const description = `${DESCRIPTION} ${uniqueSuffix()}`;
    await page.getByLabel(/^Type/).focus();
    let filled = 0;
    for (let i = 0; i < 20 && (await focused(page)) !== "Lagre"; i += 1) {
      const name = await focused(page);
      if (name === "claimantText") {
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type("Kjøper Test");
        filled += 1;
      }
      if (name === "description") {
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.type(description);
        filled += 1;
      }
      await page.keyboard.press("Tab");
    }
    expect(filled, "klager og beskrivelse ble nådd med Tab").toBe(2);
    expect(await focused(page)).toBe("Lagre");
    await page.keyboard.press("Enter");
    await expectOnAssignment(page, assignmentId);
    await expect(claimLine(page, description)).toBeVisible();
  });
});
