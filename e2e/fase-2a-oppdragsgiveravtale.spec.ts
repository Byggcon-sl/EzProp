import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  assignmentEventCount,
  e2eDatabaseUrl,
  fakeValidOrgNumber,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  uniqueSuffix,
} from "./helpers";

/*
 * Avtale med oppdragsgiver (fase 2a).
 * Testplan: docs/funksjoner/fase2a-oppdragsgiveravtale-testplan.md avsnitt 9.
 * Kjører i prosjektene pc og ipad. iPad-sjekkene (9.8) bare i ipad, stående 834 × 1194.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. e2e-databasen tømmes ikke, så hver test
 * lager sitt eget firma med unik ending og gyldig oppdiktet org.nr. Da ser forslaget aldri to
 * avtaler fra andre tester. Firma, ordre og oppdrag legges rett i databasen der skjermene for
 * dem er testet før (bare lokal database eller testdatabasen). Ingen e2e uten nett: oppdragssiden
 * og admin brukes med nett. Data er oppdiktet («Testforsikring», «Premiss for test»).
 *
 * Støtter hovedmål: tid (forslaget og «Bruk avtalen» er ett trykk, også på iPad) og reklamasjoner
 * (feil periode stoppes, fjernet avtale vises med merke, bare admin endrer avtalene).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const PORTRAIT = { width: 834, height: 1194 } as const;
const EVENT = "assignment.agreement_changed";
const PREMISE = "Premiss for test. Ikke ekte tekst.";

type Sql = ReturnType<typeof postgres>;

function connect(): Sql {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** Organisasjonen og kontoret «Bodø» til admin fra seed. */
async function seedOrganization(sql: Sql): Promise<{ organizationId: string; officeId: string }> {
  const [row] = await sql<{ organization_id: string; office_id: string }[]>`
    select e.organization_id, o.id as office_id
    from employees e
    join users u on u.id = e.user_id
    join offices o on o.organization_id = e.organization_id and o.deleted_at is null
    where u.email = ${ADMIN_EMAIL} and e.deleted_at is null and e.deactivated_at is null
    order by (o.name = 'Bodø') desc, o.created_at
    limit 1`;
  if (!row) throw new Error("Fant ikke admin og kontor fra seed (kjør pnpm db:seed)");
  return { organizationId: row.organization_id, officeId: row.office_id };
}

/** Dagens dato i norsk tid pluss `days`, som «ÅÅÅÅ-MM-DD». */
function osloDate(days = 0): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(at);
}

/** Et oppdiktet forsikringsselskap i firmaregisteret. Gir id og navn. */
async function insertFirm(suffix: string): Promise<{ id: string; name: string }> {
  return withSql(async (sql) => {
    const { organizationId } = await seedOrganization(sql);
    const id = randomUUID();
    const name = `Testforsikring ${suffix} AS`;
    await sql`
      insert into firms (id, organization_id, name, org_number, firm_type)
      values (${id}, ${organizationId}, ${name}, ${fakeValidOrgNumber()}, 'insurer')`;
    return { id, name };
  });
}

/** En avtale lagt rett i databasen (gyldig fra i dag, løpende). */
async function insertAgreement(firmId: string, name: string): Promise<string> {
  return withSql(async (sql) => {
    const { organizationId } = await seedOrganization(sql);
    const id = randomUUID();
    await sql`
      insert into client_agreements (id, organization_id, firm_id, name, valid_from)
      values (${id}, ${organizationId}, ${firmId}, ${name}, ${osloDate(0)}::date)`;
    return id;
  });
}

/** En mottatt ordre med bestillerfirma (eller uten). Gir id-en. */
async function insertOrder(suffix: string, firmId: string | null): Promise<string> {
  return withSql(async (sql) => {
    const { organizationId } = await seedOrganization(sql);
    const id = randomUUID();
    await sql`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, ordered_by_firm_id)
      values (${id}, ${organizationId}, ${`Avtaleveien 1 ${suffix}, 8000 Bodø`}, now(), 'manual',
        'received', 'condition_report', ${firmId})`;
    return id;
  });
}

/** Ordre og oppdrag rett i databasen (oppdragssiden er testet før). Gir oppdragets id. */
async function insertAssignment(suffix: string, firmId: string | null): Promise<string> {
  const orderId = await insertOrder(suffix, firmId);
  return withSql(async (sql) => {
    const { organizationId, officeId } = await seedOrganization(sql);
    const id = randomUUID();
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id)
      values (${id}, ${organizationId}, ${`E2E-AV-${suffix}`}, ${officeId}, 'condition_report',
        'ordered', ${orderId})`;
    await sql`
      update orders set status = 'converted', assignment_id = ${id} where id = ${orderId}`;
    return id;
  });
}

async function setAssignmentAgreementInDb(assignmentId: string, agreementId: string) {
  await withSql(
    (sql) =>
      sql`update assignments set client_agreement_id = ${agreementId} where id = ${assignmentId}`,
  );
}

async function agreementsNamed(name: string): Promise<{ id: string; deleted: boolean }[]> {
  return withSql(async (sql) => {
    const rows = await sql<{ id: string; deleted: boolean }[]>`
      select id, deleted_at is not null as deleted from client_agreements where name = ${name}`;
    return [...rows];
  });
}

/** «Gjør om til oppdrag» (Bodø) på ordresiden → åpner oppdraget. Gir oppdragets id. */
async function convertViaUi(page: Page, orderId: string): Promise<string> {
  await page.goto(`/ordre/${orderId}`);
  await expect(page).toHaveURL(ORDER_URL);
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Gjort om til oppdrag");
  await page.getByRole("main").getByRole("link", { name: NUMBER }).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
}

function agreementCard(page: Page): Locator {
  return page.getByRole("region", { name: "Avtale", exact: true });
}

function saveAgreementButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre avtalen", exact: true });
}

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

function expectNoServerError(response: Response | null, url: string) {
  expect(response, `${url} svarer`).not.toBeNull();
  expect(response!.status(), `${url} gir ikke 500`).toBeLessThan(500);
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page, url: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling på ${url}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Fyller ut «Ny avtale». `validTo` tom betyr løpende. */
async function fillAgreementForm(
  page: Page,
  values: { firmName: string; name: string; validFrom: string; validTo?: string },
) {
  await page.getByLabel(/^Firma/).selectOption({ label: values.firmName });
  await page.getByLabel(/^Navn/).fill(values.name);
  await page.getByLabel(/^Gyldig fra/).fill(values.validFrom);
  await page.getByLabel(/^Gyldig til/).fill(values.validTo ?? "");
  await page.getByLabel(/^Premisstekst|^Premissetekst/).fill(PREMISE);
  await page.getByLabel(/^Rapportprofil/).fill("test-profil");
}

test.describe("avtale med oppdragsgiver (pc og ipad)", () => {
  test("9.1 hele flyten: admin lager avtale, forslaget vises, «Bruk avtalen» og «Fjern»", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale ${suffix}`;

    await logIn(page);
    await page.goto("/admin");
    await page.getByRole("link", { name: "Avtaler", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/avtaler$/);
    await page.getByRole("link", { name: "Ny avtale", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/avtaler\/ny$/);
    await fillAgreementForm(page, { firmName: firm.name, name, validFrom: osloDate(0) });
    await saveAgreementButton(page).click();
    await expect(page).toHaveURL(/\/admin\/avtaler(\?.*)?$/);
    await expect(page.getByRole("main")).toContainText(name);
    expect(await agreementsNamed(name)).toHaveLength(1);

    // Ordre med bestiller fra firmaet → oppdrag
    const orderId = await insertOrder(suffix, firm.id);
    const assignmentId = await convertViaUi(page, orderId);

    const card = agreementCard(page);
    await expect(card).toContainText(`Forslag: ${name} (bestilleren er fra ${firm.name})`);
    expect(await assignmentEventCount(assignmentId, EVENT)).toBe(0);

    await card.getByRole("button", { name: "Bruk avtalen", exact: true }).click();
    await expect(card.getByRole("button", { name: "Bruk avtalen", exact: true })).toHaveCount(0);
    await expect(card).toContainText(name);
    await expect(card.getByRole("button", { name: "Fjern", exact: true })).toBeVisible();
    await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(1);

    await card.getByRole("button", { name: "Fjern", exact: true }).click();
    await expect(card).toContainText("Ingen avtale");
    await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(2);
  });

  test("9.2 velg for hånd: oppdrag uten bestillerfirma, ingen forslag, velg i velgeren", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale hånd ${suffix}`;
    await insertAgreement(firm.id, name);
    const assignmentId = await insertAssignment(suffix, null);

    await logIn(page);
    await page.goto(`/oppdrag/${assignmentId}`);
    const card = agreementCard(page);
    await expect(card).toContainText("Ingen avtale");
    await expect(card).not.toContainText("Forslag:");

    await card.getByLabel(/^Avtale/).selectOption({ label: name });
    await card.getByRole("button", { name: /^(Lagre|Velg avtalen|Bruk)$/ }).click();
    await expect(card).toContainText(name);
    await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(1);
  });

  test("9.3 til-dato før fra-dato gir norsk feilmelding ved feltet; ingenting lagres", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale feil periode ${suffix}`;

    await logIn(page);
    await page.goto("/admin/avtaler/ny");
    await fillAgreementForm(page, {
      firmName: firm.name,
      name,
      validFrom: "2026-03-01",
      validTo: "2026-02-28",
    });
    await saveAgreementButton(page).click();

    const validTo = page.getByLabel(/^Gyldig til/);
    await expect(validTo).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await validTo.getAttribute("aria-describedby")) ?? "";
    const messages = await Promise.all(
      describedBy
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => page.locator(`[id="${id}"]`).innerText()),
    );
    expect(messages.join(" ")).toMatch(/dato/i);
    expect(messages.join(" ")).not.toMatch(/invalid|expected|must/i);
    await expect(page).toHaveURL(/\/admin\/avtaler\/ny$/);
    expect(await agreementsNamed(name)).toEqual([]);
  });

  test("9.4 «Fjern avtalen» med bekreftelse: borte fra listen, oppdraget viser «Slettet»", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale fjernes ${suffix}`;
    const agreementId = await insertAgreement(firm.id, name);
    const assignmentId = await insertAssignment(suffix, firm.id);
    await setAssignmentAgreementInDb(assignmentId, agreementId);

    await logIn(page);
    await page.goto(`/admin/avtaler/${agreementId}`);
    await page.getByRole("button", { name: "Fjern avtalen", exact: true }).click();
    // Bekreftelsen må komme før noe fjernes
    expect(await agreementsNamed(name)).toEqual([{ id: agreementId, deleted: false }]);
    await page.getByRole("button", { name: /^(Ja, fjern avtalen|Bekreft|Fjern)$/ }).click();
    await expect(page).toHaveURL(/\/admin\/avtaler(\?.*)?$/);
    await expect(page.getByRole("main")).not.toContainText(name);
    expect(await agreementsNamed(name)).toEqual([{ id: agreementId, deleted: true }]);

    await page.goto(`/oppdrag/${assignmentId}`);
    const card = agreementCard(page);
    await expect(card).toContainText(name);
    await expect(card).toContainText("Slettet");
  });

  test("9.5 takstmann: ingen «Lagre avtalen», og direkte POST til lagre-handlingen lager ingen avtale", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale takstmann ${suffix}`;

    // Fang opp en ekte lagring fra admin (handlingens id og innhold), uten å sende den
    await logIn(page);
    await page.goto("/admin/avtaler/ny");
    await fillAgreementForm(page, { firmName: firm.name, name, validFrom: osloDate(0) });
    let captured: { headers: Record<string, string>; body: Buffer; url: string } | null = null;
    await page.route("**/admin/avtaler/ny", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        captured = {
          headers: request.headers(),
          body: request.postDataBuffer() ?? Buffer.from(""),
          url: request.url(),
        };
        await route.abort();
        return;
      }
      await route.continue();
    });
    await saveAgreementButton(page).click();
    await expect.poll(() => captured !== null).toBe(true);
    expect(await agreementsNamed(name)).toEqual([]);

    const inspectorContext = await browser.newContext();
    try {
      const inspector = await inspectorContext.newPage();
      await logInAsInspector(inspector);
      const response = await inspector.goto("/admin/avtaler/ny");
      expectNoServerError(response, "/admin/avtaler/ny");
      await expect(saveAgreementButton(inspector)).toHaveCount(0);

      const { headers, body, url } = captured!;
      await inspector.request.post(url, {
        headers: {
          "next-action": headers["next-action"]!,
          "content-type": headers["content-type"]!,
          accept: headers["accept"] ?? "text/x-component",
          ...(headers["next-router-state-tree"] && {
            "next-router-state-tree": headers["next-router-state-tree"],
          }),
        },
        data: body,
        failOnStatusCode: false,
      });
      expect(await agreementsNamed(name)).toEqual([]);
    } finally {
      await inspectorContext.close();
    }
  });

  test("9.6 takstmann med innstillingen på kan bruke forslaget", async ({ page }) => {
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale forslag ${suffix}`;
    await insertAgreement(firm.id, name);
    const assignmentId = await insertAssignment(suffix, firm.id);

    const previous = await setInspectorsEditAll(true);
    try {
      await logInAsInspector(page);
      await page.goto(`/oppdrag/${assignmentId}`);
      const card = agreementCard(page);
      await expect(card).toContainText(`Forslag: ${name} (bestilleren er fra ${firm.name})`);
      await card.getByRole("button", { name: "Bruk avtalen", exact: true }).click();
      await expect(card.getByRole("button", { name: "Bruk avtalen", exact: true })).toHaveCount(0);
      await expect(card).toContainText(name);
      await expect.poll(() => assignmentEventCount(assignmentId, EVENT)).toBe(1);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("9.7 ukjent id på /admin/avtaler/… gir «Fant ikke siden» eller «Ingen tilgang», aldri 500", async ({
    page,
  }) => {
    await logIn(page);
    for (const url of [`/admin/avtaler/${randomUUID()}`, "/admin/avtaler/ikke-en-id"]) {
      const response = await page.goto(url);
      expectNoServerError(response, url);
      await expect(deniedHeading(page)).toBeVisible();
      await expect(saveAgreementButton(page)).toHaveCount(0);
    }
  });
});

test.describe("iPad stående (prosjektet ipad)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
    await page.setViewportSize(PORTRAIT);
  });

  test("9.8 ingen vannrett rulling, knappene minst 44 px, «Lagre avtalen» nås etter premisseteksten", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const firm = await insertFirm(suffix);
    const name = `Testavtale iPad ${suffix} med et ganske langt navn som må brytes pent på kortet`;
    await insertAgreement(firm.id, name);
    const other = `Testavtale iPad annen ${suffix}`;
    const otherFirm = await insertFirm(`${suffix}b`);
    await insertAgreement(otherFirm.id, other);
    const assignmentId = await insertAssignment(suffix, firm.id);

    await logIn(page);

    // Oppdragssiden med forslaget
    const assignmentUrl = `/oppdrag/${assignmentId}`;
    await page.goto(assignmentUrl);
    const card = agreementCard(page);
    await expect(card).toContainText("Forslag:");
    await expectNoHorizontalScroll(page, assignmentUrl);
    await expectAtLeast44(
      card.getByRole("button", { name: "Bruk avtalen", exact: true }),
      "Bruk avtalen",
    );
    await expectAtLeast44(card.getByLabel(/^Avtale/), "velgeren");

    await card.getByRole("button", { name: "Bruk avtalen", exact: true }).click();
    await expect(card.getByRole("button", { name: "Fjern", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, assignmentUrl);
    await expectAtLeast44(card.getByRole("button", { name: "Bytt", exact: true }), "Bytt");
    await expectAtLeast44(card.getByRole("button", { name: "Fjern", exact: true }), "Fjern");

    // Admin-skjemaet
    await page.goto("/admin/avtaler/ny");
    await expectNoHorizontalScroll(page, "/admin/avtaler/ny");
    const premise = page.getByLabel(/^Premisstekst|^Premissetekst/);
    await premise.click();
    await page.keyboard.type("Premiss for test. ".repeat(20));
    await expectNoHorizontalScroll(page, "/admin/avtaler/ny");
    const save = saveAgreementButton(page);
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport();
    await expectAtLeast44(save, "Lagre avtalen");
  });
});
