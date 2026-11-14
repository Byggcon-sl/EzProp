import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  e2eDatabaseUrl,
  employeeByEmail,
  ensureInspector,
  INSPECTOR_EMAIL,
  logIn,
  logInAsInspector,
  logInAsOffice,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  signInWithCode,
  uniqueSuffix,
} from "./helpers";

/*
 * «Nytt oppdrag» er hovedveien (fase 2a). Kort: docs/funksjoner/fase2a-nytt-oppdrag.md, design:
 * fase2a-nytt-oppdrag-design.md, testplan: fase2a-nytt-oppdrag-testplan.md avsnitt 5. Kjører i
 * prosjektene pc og ipad; de siste testene bare i ipad.
 *
 * Organisasjonen er Byggcon fra seed (fem kontorer, blant dem «Bodø»). E2e-databasen tømmes ikke,
 * så hver test bruker en unik ending i adressen. Data er oppdiktet («Testveien 12 …»,
 * «Prøvegata 3 …», «Megler Testesen», gnr/bnr fra 90000 og opp).
 *
 * Støtter hovedmål: de ansatte (kø → skjema → lagret oppdrag med to trykk, på PC og iPad, og
 * ingenting som er skrevet går tapt uten nett), og færre reklamasjoner (dublettvarselet vises
 * mens man fyller ut, og rettelser på oppdraget har historikk).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})(\\?.*)?$`);
const ORDER_URL = new RegExp(`/ordre/(${UUID})(\\?.*)?$`);
const PORTRAIT = { width: 834, height: 1194 } as const;
const INSPECTOR_NAME = "Oppdiktet takstmann";
const OFFLINE = "Ikke lagret. Du er uten nett. Trykk Lagre når du har nett igjen.";
const CONFLICT = "Oppdraget er endret av en annen. Last siden på nytt.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const NO_ACCESS_HEADING = "Du har ikke tilgang til å lage oppdrag";

type AssignmentRow = {
  id: string;
  number: string;
  status: string;
  order_id: string | null;
  source: string;
  address_text: string;
  office_id: string;
};

function sql() {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  return postgres(databaseUrl, { max: 1, onnotice: () => {} });
}

/** Oppdragene (ikke slettet) med adressen. */
async function assignmentsWithAddress(address: string): Promise<AssignmentRow[]> {
  const db = sql();
  try {
    return await db<AssignmentRow[]>`
      select id, number, status, order_id, source, address_text, office_id from assignments
      where address_text = ${address} and deleted_at is null`;
  } finally {
    await db.end();
  }
}

/** Antall oppdrag (også slettede) der adressen eller bestilleren har merket. */
async function assignmentCountWithMarker(marker: string): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from assignments
      where address_text like ${`%${marker}%`} or ordered_by_text like ${`%${marker}%`}`;
    return row?.n ?? 0;
  } finally {
    await db.end();
  }
}

/** Kontoret til den ansatte med e-posten (eller `null`), og setter det til «Bodø». */
async function setOfficeToBodo(email: string): Promise<string | null> {
  const db = sql();
  try {
    const [row] = await db<{ id: string; office_id: string | null }[]>`
      select e.id, e.office_id from employees e join users u on u.id = e.user_id
      where u.email = ${email} and e.deleted_at is null
        and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
      limit 1`;
    if (!row) throw new Error(`Fant ikke den ansatte (${email})`);
    await db`
      update employees set office_id = (
        select o.id from offices o
        where o.organization_id = employees.organization_id and o.name = 'Bodø' and o.deleted_at is null
        order by o.created_at limit 1)
      where id = ${row.id}`;
    return row.office_id;
  } finally {
    await db.end();
  }
}

async function restoreOffice(email: string, officeId: string | null) {
  const db = sql();
  try {
    await db`
      update employees set office_id = ${officeId}
      where id = (select e.id from employees e join users u on u.id = e.user_id
        where u.email = ${email} and e.deleted_at is null
          and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
        limit 1)`;
  } finally {
    await db.end();
  }
}

/** Oppdiktet innlogging uten ansattrad. Bare lokal database eller testdatabasen. */
async function createUserWithoutEmployee(): Promise<string> {
  const db = sql();
  const email = `uten-ansatt-${uniqueSuffix()}@example.com`;
  try {
    await db`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, 'Oppdiktet uten ansattrad', ${email}, true)`;
  } finally {
    await db.end();
  }
  return email;
}

/** Unike gnr/bnr per test (oppdiktede, høye tall). */
function uniqueCadastre(): { gnr: string; bnr: string } {
  const base = 90000 + Math.floor(Math.random() * 9_000_000);
  return { gnr: String(base), bnr: String(1 + Math.floor(Math.random() * 9000)) };
}

function mainArea(page: Page): Locator {
  return page.getByRole("main");
}

function menu(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

function saveButton(page: Page): Locator {
  return mainArea(page).getByRole("button", { name: /^(Lagre|Lagrer …)$/ });
}

function addressField(page: Page): Locator {
  return mainArea(page).getByLabel("Adresse", { exact: true });
}

function officeRadio(page: Page, name = "Bodø"): Locator {
  return page
    .getByRole("group", { name: "Kontor", exact: true })
    .getByRole("radio", { name, exact: true });
}

function responsibleGroup(page: Page): Locator {
  return page.getByRole("group", { name: "Ansvarlig takstmann", exact: true });
}

function duplicateNotice(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: "Mulig dublett" });
}

function bookingSection(page: Page): Locator {
  return page.getByRole("region", { name: "Bestilling", exact: true });
}

/** Fyller adressen og velger «Bodø» og den oppdiktede takstmannen når de ikke er valgt. */
async function fillRequired(page: Page, address: string) {
  await addressField(page).fill(address);
  if (!(await officeRadio(page).isChecked())) await officeRadio(page).check();
  const inspector = responsibleGroup(page).getByRole("radio", {
    name: new RegExp(`^${INSPECTOR_NAME}( \\(deg\\))?$`),
  });
  if (!(await inspector.isChecked())) await inspector.check();
}

/** «Lagre» og venter på oppdraget. Gir id og nummer. */
async function saveAndOpen(page: Page): Promise<{ id: string; number: string }> {
  await saveButton(page).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  const id = ASSIGNMENT_URL.exec(page.url())![1]!;
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  const number = /\d{4}-\d{5}/.exec(heading)?.[0] ?? "";
  return { id, number };
}

/** Lager et oppdrag gjennom skjemaet som innlogget bruker. */
async function createViaForm(page: Page, address: string, extra?: (page: Page) => Promise<void>) {
  await page.goto("/oppdrag/ny");
  await fillRequired(page, address);
  if (extra) await extra(page);
  return await saveAndOpen(page);
}

async function expectAtLeast(target: Locator, name: string, min: number) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${min} px høy`).toBeGreaterThanOrEqual(min - 0.5);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

test.beforeAll(async () => {
  await ensureInspector();
});

test.describe("nytt oppdrag (pc og ipad)", () => {
  test("5.1 kontoret: kø → «Nytt oppdrag» → skjema → «Lagre» → oppdraget, og det står i køen som Bestilt", async ({
    page,
  }) => {
    const address = `Testveien 12 ny${uniqueSuffix()}, 8000 Bodø`;
    await logInAsOffice(page);
    await page.goto("/arbeidskoe");
    await mainArea(page).getByRole("link", { name: "Nytt oppdrag", exact: true }).click();
    await expect(page).toHaveURL(/\/oppdrag\/ny$/);
    await expect(page).toHaveTitle(/Nytt oppdrag/);

    await fillRequired(page, address);
    await mainArea(page)
      .getByLabel(/^Hvem bestilte/)
      .fill("Megler Testesen");
    const { id, number } = await saveAndOpen(page);

    const receipt = page.getByRole("status").filter({ hasText: `Oppdrag ${number} er lagret.` });
    await expect(receipt).toBeVisible();

    const rows = await assignmentsWithAddress(address);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      number,
      status: "ordered",
      order_id: null,
      source: "manual",
    });

    await expect(bookingSection(page)).toContainText(address);
    await expect(bookingSection(page)).toContainText("Megler Testesen");

    await page.goto(`/arbeidskoe?status=ordered&mine=0&q=${encodeURIComponent(number)}`);
    await expect(page.getByTestId("work-queue-card").filter({ hasText: number })).toHaveCount(1);
  });

  test("5.1 takstmann med kontor: to trykk fra køen når forhåndsvalgene holder", async ({
    page,
  }) => {
    const address = `Testveien 12 to${uniqueSuffix()}, 8000 Bodø`;
    const previousOffice = await setOfficeToBodo(INSPECTOR_EMAIL);
    try {
      await logInAsInspector(page);
      await page.goto("/arbeidskoe");
      await mainArea(page).getByRole("link", { name: "Nytt oppdrag", exact: true }).click(); // 1
      await addressField(page).fill(address);
      await saveButton(page).click(); // 2
      await expect(page).toHaveURL(ASSIGNMENT_URL);
      await expect(page.getByRole("status").filter({ hasText: /er lagret\./ })).toBeVisible();
      expect(await assignmentsWithAddress(address)).toHaveLength(1);
    } finally {
      await restoreOffice(INSPECTOR_EMAIL, previousOffice);
    }
  });

  test("5.2 «Nytt oppdrag» er første punkt i menyen, før «Arbeidskø», og åpner skjemaet", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/arbeidskoe");
    const links = menu(page).getByRole("link");
    await expect(links.nth(0)).toHaveText("Nytt oppdrag");
    await expect(links.nth(1)).toHaveText("Arbeidskø");
    await links.nth(0).click();
    await expect(page).toHaveURL(/\/oppdrag\/ny$/);
    await expect(links.nth(0)).toHaveAttribute("aria-current", "page");
  });

  test("5.3 tom fane «Bestilt»: «Nytt oppdrag» som sekundærknapp, ikke «Ny ordre»", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto(`/arbeidskoe?status=ordered&mine=0&q=finnes-ikke-${uniqueSuffix()}`);
    const empty = page.getByTestId("work-queue-empty");
    await expect(empty.getByRole("link", { name: "Ny ordre", exact: true })).toHaveCount(0);
    await empty.getByRole("link", { name: "Nytt oppdrag", exact: true }).click();
    await expect(page).toHaveURL(/\/oppdrag\/ny$/);
  });

  test("5.4 forhåndsvalg: takstmann ser seg selv og sitt kontor; kontoret må velge ansvarlig", async ({
    browser,
  }) => {
    const previousOffice = await setOfficeToBodo(INSPECTOR_EMAIL);
    const inspectorContext = await browser.newContext();
    const officeContext = await browser.newContext();
    try {
      const inspectorPage = await inspectorContext.newPage();
      await logInAsInspector(inspectorPage);
      await inspectorPage.goto("/oppdrag/ny");
      await expect(mainArea(inspectorPage)).toContainText("Rapporttype: Tilstandsrapport");
      await expect(officeRadio(inspectorPage)).toBeChecked();
      const self = responsibleGroup(inspectorPage).getByRole("radio", {
        name: `${INSPECTOR_NAME} (deg)`,
        exact: true,
      });
      await expect(self).toBeChecked();
      // Den innloggede står først i listen
      expect(
        await responsibleGroup(inspectorPage).getByRole("radio").first().getAttribute("value"),
      ).toBe(await self.getAttribute("value"));
      // Fokus flyttes ikke ved første visning (tastaturet skal ikke sprette opp på iPad)
      expect(await inspectorPage.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");

      const officePage = await officeContext.newPage();
      await logInAsOffice(officePage);
      await officePage.goto("/oppdrag/ny");
      await expect(responsibleGroup(officePage).getByRole("radio", { checked: true })).toHaveCount(
        0,
      );
      await expect(
        responsibleGroup(officePage).getByRole("radio", { name: INSPECTOR_NAME, exact: true }),
      ).toBeVisible();
      // Uten ansvarlig: feilen står ved gruppen
      await addressField(officePage).fill(`Testveien 12 fv${uniqueSuffix()}, 8000 Bodø`);
      if (!(await officeRadio(officePage).isChecked())) await officeRadio(officePage).check();
      await saveButton(officePage).click();
      await expect(responsibleGroup(officePage)).toContainText("Velg ansvarlig takstmann.");
      await expect(officePage).toHaveURL(/\/oppdrag\/ny$/);
    } finally {
      await inspectorContext.close();
      await officeContext.close();
      await restoreOffice(INSPECTOR_EMAIL, previousOffice);
    }
  });

  test("5.5 tom adresse og elleve sifre: melding ved feltet, fokus på første feil, ingenting lagres", async ({
    page,
  }) => {
    // Bokstav til slutt, så sifrene i merket ikke henger sammen med de elleve sifrene.
    const marker = `fnr${uniqueSuffix()}x`;
    await logIn(page);
    await page.goto("/oppdrag/ny");
    await officeRadio(page).check();
    await responsibleGroup(page).getByRole("radio", { name: INSPECTOR_NAME, exact: true }).check();
    await mainArea(page)
      .getByLabel(/^Hvem bestilte/)
      .fill(`Megler ${marker} 12345678901`);
    await saveButton(page).click();

    await expect(addressField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(mainArea(page)).toContainText("Skriv inn adressen.");
    await expect(mainArea(page)).toContainText(NATIONAL_ID);
    await expect(addressField(page)).toBeFocused();
    // Det som er skrevet, står igjen, og valgene står
    await expect(mainArea(page).getByLabel(/^Hvem bestilte/)).toHaveValue(
      `Megler ${marker} 12345678901`,
    );
    await expect(officeRadio(page)).toBeChecked();
    // Ingen samlemelding øverst
    await expect(mainArea(page).getByRole("alert")).toHaveCount(0);
    expect(await assignmentCountWithMarker(marker)).toBe(0);
  });

  test("5.6 dublettvarsel når adressefeltet forlates: lenke, ingen «Lagre likevel», POST uten adresse i URL, og «Lagre» virker", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const address = `Prøvegata 3 du${suffix}, 8006 Bodø`;
    await logIn(page);
    const first = await createViaForm(page, address);

    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    await page.goto("/oppdrag/ny");
    await addressField(page).fill(address);
    await addressField(page).press("Tab");

    const notice = duplicateNotice(page);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(`Oppdrag ${first.number}`);
    await expect(notice).toContainText("samme adresse");
    await expect(notice.getByRole("link")).toHaveAttribute("href", `/oppdrag/${first.id}`);
    await expect(mainArea(page).getByRole("button", { name: /likevel/i })).toHaveCount(0);
    // Varselet står over «Lagre»
    const noticeBox = await notice.boundingBox();
    const saveBox = await saveButton(page).boundingBox();
    expect(noticeBox!.y).toBeLessThan(saveBox!.y);
    for (const url of urls) expect(url, "adressen står aldri i en URL").not.toContain(suffix);

    await fillRequired(page, address);
    await saveAndOpen(page);
    expect(await assignmentsWithAddress(address)).toHaveLength(2);
    for (const url of urls) expect(url).not.toContain(suffix);
  });

  test("5.7 dublettvarsel på matrikkel: ulik adresse, samme gnr/bnr gir «samme matrikkel»", async ({
    page,
  }) => {
    const { gnr, bnr } = uniqueCadastre();
    await logIn(page);
    const first = await createViaForm(
      page,
      `Testveien 12 m1${uniqueSuffix()}, 8000 Bodø`,
      async (p) => {
        await p.getByLabel("Gårdsnummer", { exact: true }).fill(gnr);
        await p.getByLabel("Bruksnummer", { exact: true }).fill(bnr);
      },
    );

    await page.goto("/oppdrag/ny");
    await addressField(page).fill(`Prøvegata 3 m2${uniqueSuffix()}, 8006 Bodø`);
    await page.getByLabel("Gårdsnummer", { exact: true }).fill(gnr);
    await page.getByLabel("Bruksnummer", { exact: true }).fill(bnr);
    // Varselet hentes først når fokus forlater hele matrikkelgruppen
    await page.getByLabel("Seksjonsnummer", { exact: true }).focus();
    await page.getByLabel("Seksjonsnummer", { exact: true }).press("Tab");
    const notice = duplicateNotice(page);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("samme matrikkel");
    await expect(notice.getByRole("link")).toHaveAttribute("href", `/oppdrag/${first.id}`);
  });

  test("5.8 dublettvarsel på oppdragssiden etter lagring, med lenke til det andre", async ({
    page,
  }) => {
    const address = `Prøvegata 3 os${uniqueSuffix()}, 8006 Bodø`;
    await logIn(page);
    const first = await createViaForm(page, address);
    const second = await createViaForm(page, address);
    expect(second.id).not.toBe(first.id);
    const notice = duplicateNotice(page);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("link")).toHaveAttribute("href", `/oppdrag/${first.id}`);
  });

  test("5.9 «Endre bestillingen» → ny adresse → «Lagre»; «Endringer» viser hvem, når og feltet", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const old = `Testveien 12 en${suffix}, 8000 Bodø`;
    const next = `Prøvegata 3 en${suffix}, 8006 Bodø`;
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page);
    await createViaForm(page, old);

    const booking = bookingSection(page);
    await booking.getByRole("button", { name: "Endre bestillingen", exact: true }).click();
    await expect(booking.getByRole("heading", { name: "Endre bestillingen" })).toBeFocused();
    await booking.getByLabel("Adresse", { exact: true }).fill(next);
    await booking.getByRole("button", { name: "Lagre bestillingen", exact: true }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Endringene er lagret." }),
    ).toBeVisible();
    await expect(booking).toContainText(next);
    const changes = page.locator("details").filter({ hasText: /Endringer \(\d+\)/ });
    await changes.locator("summary").click();
    await expect(changes).toContainText("Endret");
    await expect(changes).toContainText(admin.name);
    await expect(changes).toContainText(`Adresse: ${old} → ${next}`);
    expect(await assignmentsWithAddress(next)).toHaveLength(1);
  });

  test("5.10 konflikt i to faner: konfliktmelding, teksten står, ingenting overskrevet", async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const old = `Testveien 12 kf${suffix}, 8000 Bodø`;
    const first = `Prøvegata 3 kf${suffix}, 8006 Bodø`;
    const second = `Prøvegata 5 kf${suffix}, 8006 Bodø`;
    await logIn(page);
    const { id } = await createViaForm(page, old);

    const other = await context.newPage();
    await other.goto(`/oppdrag/${id}`);
    for (const tab of [page, other]) {
      await tab.bringToFront();
      await bookingSection(tab).getByRole("button", { name: "Endre bestillingen" }).click();
    }
    await bookingSection(page).getByLabel("Adresse", { exact: true }).fill(first);
    await bookingSection(page)
      .getByRole("button", { name: "Lagre bestillingen", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Endringene er lagret." }),
    ).toBeVisible();

    await bookingSection(other).getByLabel("Adresse", { exact: true }).fill(second);
    await bookingSection(other)
      .getByRole("button", { name: "Lagre bestillingen", exact: true })
      .click();
    await expect(other.getByRole("alert").filter({ hasText: CONFLICT })).toBeVisible();
    await expect(bookingSection(other).getByLabel("Adresse", { exact: true })).toHaveValue(second);
    await expect(other.getByRole("button", { name: "Last siden på nytt" })).toBeVisible();

    expect(await assignmentsWithAddress(first)).toHaveLength(1);
    expect(await assignmentsWithAddress(second)).toHaveLength(0);
    await other.close();
  });

  test("5.11 uten nett: tydelig melding, alt står, ingenting lagres lokalt; med nett igjen gir «Lagre» ett oppdrag", async ({
    page,
    context,
  }) => {
    const suffix = uniqueSuffix();
    const address = `Testveien 12 un${suffix}, 8000 Bodø`;
    await logIn(page);
    await page.goto("/oppdrag/ny");
    await fillRequired(page, address);
    await mainArea(page)
      .getByLabel(/^Hvem bestilte/)
      .fill(`Megler Testesen ${suffix}`);

    await context.setOffline(true);
    try {
      await saveButton(page).click();
      await expect(page.getByRole("alert").filter({ hasText: OFFLINE })).toBeVisible();
      await expect(addressField(page)).toHaveValue(address);
      await expect(mainArea(page).getByLabel(/^Hvem bestilte/)).toHaveValue(
        `Megler Testesen ${suffix}`,
      );
      await expect(officeRadio(page)).toBeChecked();
      expect(await assignmentsWithAddress(address)).toHaveLength(0);

      const stored = await page.evaluate(async () => {
        const local = JSON.stringify({ ...localStorage });
        const session = JSON.stringify({ ...sessionStorage });
        const databases = (await indexedDB.databases()).map((db) => db.name ?? "");
        return { local, session, databases };
      });
      expect(stored.local).not.toContain(suffix);
      expect(stored.session).not.toContain(suffix);
      expect(stored.databases.join(",")).not.toContain("oppdrag");
    } finally {
      await context.setOffline(false);
    }

    await saveButton(page).click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    expect(await assignmentsWithAddress(address)).toHaveLength(1);
  });

  test("5.12 dobbelt trykk på «Lagre» med treg svartid gir ett oppdrag og ett nummer", async ({
    page,
  }) => {
    const address = `Testveien 12 dt${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await page.goto("/oppdrag/ny");
    await fillRequired(page, address);

    await page.route("**/oppdrag/ny", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await saveButton(page).dblclick();
    await expect(saveButton(page)).toBeDisabled();
    await expect(saveButton(page)).toHaveText("Lagrer …");
    await saveButton(page)
      .click({ force: true })
      .catch(() => {});
    await expect(page).toHaveURL(ASSIGNMENT_URL, { timeout: 15_000 });
    await page.unroute("**/oppdrag/ny");
    expect(await assignmentsWithAddress(address)).toHaveLength(1);
  });

  test("5.13 takstmann med «alle takstmenn kan endre» av: ingen knapp, ikke i menyen, og tydelig avvisning", async ({
    page,
  }) => {
    const previous = await setInspectorsEditAll(false);
    try {
      await logInAsInspector(page);
      await page.goto("/arbeidskoe");
      await expect(page.getByRole("heading", { name: "Arbeidskø", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Nytt oppdrag" })).toHaveCount(0);
      await page.goto("/oppdrag/ny");
      await expect(page.getByRole("heading", { name: NO_ACCESS_HEADING })).toBeVisible();
      await expect(mainArea(page)).toContainText("Spør kontoret eller en leder.");
      await expect(page.getByLabel("Adresse", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("radio")).toHaveCount(0);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("5.14 admin med innstillingen av ser knappen og lager oppdrag (regel 11)", async ({
    page,
  }) => {
    const previous = await setInspectorsEditAll(false);
    const address = `Testveien 12 ad${uniqueSuffix()}, 8000 Bodø`;
    try {
      await logIn(page);
      await page.goto("/arbeidskoe");
      await mainArea(page).getByRole("link", { name: "Nytt oppdrag", exact: true }).click();
      await fillRequired(page, address);
      await saveAndOpen(page);
      expect(await assignmentsWithAddress(address)).toHaveLength(1);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("5.15 bruker uten ansattrad får «Ingen tilgang» uten kontor- eller takstmannsliste", async ({
    page,
  }) => {
    const email = await createUserWithoutEmployee();
    await page.goto("/logg-inn");
    await signInWithCode(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"));
    await page.goto("/oppdrag/ny");
    await expect(page.getByRole("heading", { name: "Ingen tilgang", level: 1 })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByText("Bodø")).toHaveCount(0);
  });

  test("5.16 gjort-om ordre: «Endre ordren» viser at rettelser gjøres på oppdraget, med lenke dit", async ({
    page,
  }) => {
    const address = `Testveien 12 go${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await page.goto("/ordre/ny");
    await page.getByLabel(/^Adresse/).fill(address);
    await page.getByLabel(/^Hvem bestilte/).fill("Megler Testesen");
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page).toHaveURL(ORDER_URL);
    await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
    await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
    await expect(page.getByRole("link", { name: /^Gjort om til oppdrag/ })).toBeVisible();

    await page.getByRole("button", { name: "Endre ordren", exact: true }).click();
    await expect(
      page.getByText(
        "Rettelser for oppdraget gjøres på oppdraget. Endringer her flytter ikke oppdraget.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("link", { name: /^Gå til oppdrag \d{4}-\d{5}$/ }).click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    // 5.17 gammel vei: bestillingen er kopiert til oppdraget
    await expect(bookingSection(page)).toContainText(address);
    await expect(bookingSection(page)).toContainText("Megler Testesen");
  });

  test("5.18 tastatur: adresse, piltaster i radiogruppene og Enter lagrer; alle felt har etikett", async ({
    page,
  }) => {
    const address = `Testveien 12 ta${uniqueSuffix()}, 8000 Bodø`;
    await logIn(page);
    await page.goto("/oppdrag/ny");
    for (const label of [
      "Adresse",
      "Gårdsnummer",
      "Bruksnummer",
      "Seksjonsnummer",
      "Hvem bestilte (valgfritt)",
      "Avtalt befaring (valgfritt)",
      "Mottatt",
      "Meglerens ordrenummer (valgfritt)",
      "Borettslag eller sameie (valgfritt)",
    ]) {
      await expect(mainArea(page).getByLabel(label, { exact: true })).toHaveCount(1);
    }

    // Kontor: fokus på første radio og piltast ned velger neste, opp tilbake til «Bodø»
    const firstOffice = page.getByRole("group", { name: "Kontor" }).getByRole("radio").first();
    await firstOffice.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(firstOffice).toBeChecked();
    if (!(await officeRadio(page).isChecked())) await officeRadio(page).check();

    const inspector = responsibleGroup(page).getByRole("radio", {
      name: INSPECTOR_NAME,
      exact: true,
    });
    await inspector.focus();
    await page.keyboard.press("Space");
    await expect(inspector).toBeChecked();

    await addressField(page).focus();
    await page.keyboard.type(address);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    expect(await assignmentsWithAddress(address)).toHaveLength(1);
  });
});

test.describe("nytt oppdrag (bare ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  async function forBothOrientations(page: Page, run: (where: string) => Promise<void>) {
    await run("liggende");
    await page.setViewportSize(PORTRAIT);
    await run("stående");
  }

  test("5.19–5.21 ingen nedtrekksliste, trykkflater og ingen vannrett rulling", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/oppdrag/ny");
    await forBothOrientations(page, async (where) => {
      await page.goto("/oppdrag/ny");
      await expect(mainArea(page).locator("select")).toHaveCount(0);
      await expectAtLeast(saveButton(page), `«Lagre» (${where})`, 56);
      await expectAtLeast(
        officeRadio(page).locator("xpath=ancestor::label"),
        `kontor (${where})`,
        44,
      );
      await expectAtLeast(
        mainArea(page).getByRole("link", { name: "Avbryt", exact: true }),
        `«Avbryt» (${where})`,
        44,
      );
      await expectNoHorizontalScroll(page, `på /oppdrag/ny (${where})`);

      await page.goto("/arbeidskoe");
      const button = mainArea(page).getByRole("link", { name: "Nytt oppdrag", exact: true });
      await expectAtLeast(button, `«Nytt oppdrag» (${where})`, 56);
      await expectNoHorizontalScroll(page, `på /arbeidskoe (${where})`);
    });
  });

  test("5.21 oppdragssiden med «Bestilling» åpent har ingen vannrett rulling i stående", async ({
    page,
  }) => {
    await logIn(page);
    await page.setViewportSize(PORTRAIT);
    await createViaForm(page, `Testveien 12 ip${uniqueSuffix()}, 8000 Bodø`);
    const booking = bookingSection(page);
    const edit = booking.getByRole("button", { name: "Endre bestillingen", exact: true });
    await expectAtLeast(edit, "«Endre bestillingen»", 44);
    await edit.click();
    await expectAtLeast(
      booking.getByRole("button", { name: "Lagre bestillingen", exact: true }),
      "«Lagre»",
      56,
    );
    await expectNoHorizontalScroll(page, "på /oppdrag/[id]");
  });
});
