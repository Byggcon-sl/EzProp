import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import { ADMIN_EMAIL, e2eDatabaseUrl, logInAsOffice, uniqueSuffix } from "./helpers";

/*
 * Søk i ordrelisten og i arbeidskøen (T2).
 * Testplan: docs/funksjoner/fase2a-sok-ordre-arbeidsko-testplan.md avsnitt 7.1–7.6. Kjører i
 * prosjektene pc og ipad; 7.6 bare i ipad.
 *
 * Kontoret (rollen `office`, uten takstmann-rolle) brukes, fordi det er kontoret som søker mens
 * megleren ringer, og fordi kontoret skal starte på «Alle». Data legges rett i databasen med en
 * unik ending, fordi e2e-databasen ikke tømmes. Bare lokal database eller testdatabasen
 * (`assertLocalOrTestDatabase`). Testdata er oppdiktet («Søkeveien 1», «Megler Søkesen»).
 *
 * Søket trenger nett (listene hentes fra serveren). Befaringen og synken berøres ikke, så det er
 * ingen test uten nett.
 *
 * Støtter hovedmål: de ansatte (ett søk og to trykk til ordren eller oppdraget, «Treff i: …» når
 * treffet ligger i en annen fane, og «Mine» huskes) og reklamasjoner (raden viser meglerens
 * ordrenummer, så kontoret ser at det har funnet riktig ordre).
 */

const SEARCH_LABEL = "Søk på adresse, nummer, megler eller gnr/bnr";
const PORTRAIT = { width: 834, height: 1194 } as const;

type Sql = ReturnType<typeof postgres>;

function connect(): Sql {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Organisasjonen og et kontor til admin fra seed. */
async function seedOrganization(sql: Sql): Promise<{ organizationId: string; officeId: string }> {
  const [row] = await sql<{ organization_id: string; office_id: string }[]>`
    select e.organization_id, o.id as office_id
    from employees e
    join users u on u.id = e.user_id
    join offices o on o.organization_id = e.organization_id and o.deleted_at is null
    where u.email = ${ADMIN_EMAIL} and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true') and e.deleted_at is null and e.deactivated_at is null
    order by (o.name = 'Bodø') desc, o.created_at
    limit 1`;
  if (!row) throw new Error("Fant ikke admin og kontor fra seed (kjør pnpm db:seed)");
  return { organizationId: row.organization_id, officeId: row.office_id };
}

/** En ordre som ikke er gjort om. Mottatt nå, så den står øverst i ordrelisten. */
async function insertOrder(
  sql: Sql,
  input: { address: string; externalRef: string; orderedBy: string },
): Promise<string> {
  const { organizationId } = await seedOrganization(sql);
  const id = randomUUID();
  await sql`
    insert into orders (id, organization_id, address_text, received_at, source, status,
      requested_report_type, external_ref, ordered_by_text)
    values (${id}, ${organizationId}, ${input.address}, now(), 'manual', 'received',
      'condition_report', ${input.externalRef}, ${input.orderedBy})`;
  return id;
}

/** Ordre og oppdrag (koblet begge veier) med én part. Gir oppdragets id og nummer. */
async function insertAssignment(
  sql: Sql,
  input: { suffix: string; address: string; status: string; partyName?: string },
): Promise<{ id: string; number: string }> {
  const { organizationId, officeId } = await seedOrganization(sql);
  const orderId = randomUUID();
  const id = randomUUID();
  const number = `E2E-SOK-${input.suffix}`;
  await sql`
    insert into orders (id, organization_id, address_text, received_at, source, status,
      requested_report_type)
    values (${orderId}, ${organizationId}, ${input.address}, now(), 'manual', 'received',
      'condition_report')`;
  await sql`
    insert into assignments (id, organization_id, number, office_id, assignment_type, status,
      order_id, address_text, received_at, source)
    values (${id}, ${organizationId}, ${number}, ${officeId}, 'condition_report',
      ${input.status}, ${orderId}, ${input.address}, now(), 'manual')`;
  await sql`
    update orders set status = 'converted', assignment_id = ${id}
    where id = ${orderId} and organization_id = ${organizationId}`;
  if (input.partyName) {
    await sql`
      insert into assignment_parties (organization_id, assignment_id, role, name)
      values (${organizationId}, ${id}, 'broker', ${input.partyName})`;
  }
  return { id, number };
}

function searchBox(page: Page): Locator {
  return page.getByRole("searchbox", { name: SEARCH_LABEL });
}

async function submitSearch(page: Page, text: string) {
  await searchBox(page).fill(text);
  await page.getByRole("button", { name: "Søk", exact: true }).click();
}

function statusNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Status" });
}

function filterLink(page: Page, label: "Mine" | "Alle"): Locator {
  return page.getByRole("navigation", { name: "Filter" }).getByRole("link", { name: label });
}

function tab(page: Page, label: string): Locator {
  return statusNav(page).getByRole("link", { name: new RegExp(`^${label}`) });
}

function cards(page: Page): Locator {
  return page.getByTestId("work-queue-card");
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, "ingen vannrett rulling").toBeLessThanOrEqual(overflow.clientWidth);
}

test.describe("søk i ordrelisten (pc og ipad)", () => {
  test("7.1 søk på ordrenummeret, åpne ordren, og «Tøm søk» viser hele listen", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const externalRef = `ORD-${suffix}`;
    const sql = connect();
    let orderId: string;
    try {
      orderId = await insertOrder(sql, {
        address: `Søkeveien 1 ${suffix}, 8000 Bodø`,
        externalRef,
        orderedBy: `Megler Søkesen ${suffix}`,
      });
    } finally {
      await sql.end();
    }

    await logInAsOffice(page);
    await page.goto("/ordre");
    await expect(searchBox(page)).toBeVisible();
    await expect(
      searchBox(page),
      "ingen autofokus (tastaturet spretter ikke opp)",
    ).not.toBeFocused();

    // Søk med små bokstaver på meglerens ordrenummer
    await submitSearch(page, externalRef.toLowerCase());
    await expect(page).toHaveURL(/\/ordre\?q=/);
    const rows = page.getByRole("main").getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(externalRef);
    await expect(searchBox(page)).toHaveValue(externalRef.toLowerCase());

    await rows.first().getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/ordre/${orderId}$`));

    // Tilbake, så «Tøm søk»
    await page.goto(`/ordre?q=${encodeURIComponent(externalRef)}`);
    await page.getByRole("link", { name: "Tøm søk", exact: true }).click();
    await expect(page).toHaveURL(/\/ordre$/);
    await expect(searchBox(page)).toHaveValue("");
    await expect(page.getByRole("link", { name: "Tøm søk", exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("listitem").first()).toBeVisible();
    expect(await page.getByRole("main").getByRole("listitem").count()).toBeLessThanOrEqual(50);
  });

  test("7.2 ingen treff: «Ingen ordre passer søket.»", async ({ page }) => {
    await logInAsOffice(page);
    await page.goto("/ordre");
    await submitSearch(page, `finnesikke${uniqueSuffix()}`);
    await expect(page.getByText("Ingen ordre passer søket.", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(0);
  });
});

test.describe("søk i arbeidskøen (pc og ipad)", () => {
  test("7.3 kontoret starter på «Alle» og finner oppdraget på partsnavnet", async ({ page }) => {
    const suffix = uniqueSuffix();
    const partyName = `Megler Søkesen ${suffix}`;
    const sql = connect();
    let created: { id: string; number: string };
    try {
      created = await insertAssignment(sql, {
        suffix,
        address: `Søkeveien 3 ${suffix}, 8000 Bodø`,
        status: "in_progress",
        partyName,
      });
    } finally {
      await sql.end();
    }

    await logInAsOffice(page);
    await page.goto("/arbeidskoe");
    await expect(filterLink(page, "Alle")).toHaveAttribute("aria-current", "page");
    await expect(filterLink(page, "Mine")).not.toHaveAttribute("aria-current", "page");
    await expect(searchBox(page)).not.toBeFocused();

    await submitSearch(page, `søkesen ${suffix}`);
    await expect(page).toHaveURL(/mine=0/);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(created.number);
    await expect(cards(page).first().getByRole("link").first()).toHaveAttribute(
      "href",
      `/oppdrag/${created.id}`,
    );
  });

  test("7.4 tom fane med treff i Ferdig: lenken «Ferdig (1)» åpner fanen med søket", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const sql = connect();
    let created: { id: string; number: string };
    try {
      created = await insertAssignment(sql, {
        suffix,
        address: `Ferdigveien 4 ${suffix}, 8000 Bodø`,
        status: "completed",
      });
    } finally {
      await sql.end();
    }

    await logInAsOffice(page);
    await page.goto("/arbeidskoe?status=in_progress");
    await submitSearch(page, `Ferdigveien 4 ${suffix}`);
    await expect(tab(page, "Under arbeid")).toHaveAttribute("aria-current", "page");
    await expect(cards(page)).toHaveCount(0);

    const empty = page.getByTestId("work-queue-empty");
    await expect(empty).toContainText("Ingen treff i denne fanen. Treff i: Ferdig (1).");
    await empty.getByRole("link", { name: "Ferdig (1)" }).click();

    await expect(page).toHaveURL(/status=completed/);
    await expect(tab(page, "Ferdig")).toHaveAttribute("aria-current", "page");
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText(created.number);
    await expect(searchBox(page)).toHaveValue(`Ferdigveien 4 ${suffix}`);
  });

  test("7.5 «Mine» huskes når kontoret søker og bytter fane", async ({ page }) => {
    await logInAsOffice(page);
    await page.goto("/arbeidskoe");
    await expect(filterLink(page, "Alle")).toHaveAttribute("aria-current", "page");

    await filterLink(page, "Mine").click();
    await expect(page).toHaveURL(/mine=1/);
    await expect(filterLink(page, "Mine")).toHaveAttribute("aria-current", "page");

    await submitSearch(page, `fjordgata${uniqueSuffix()}`);
    await expect(page).toHaveURL(/mine=1/);
    await expect(filterLink(page, "Mine")).toHaveAttribute("aria-current", "page");

    await tab(page, "Bestilt").click();
    await expect(page).toHaveURL(/status=ordered/);
    await expect(page).toHaveURL(/mine=1/);
    await expect(filterLink(page, "Mine")).toHaveAttribute("aria-current", "page");
    await expect(searchBox(page)).toHaveValue(/^fjordgata/);
  });

  test("7.6 iPad: «Treff i: …» og «Tøm søk» er minst 44 px, ingen vannrett rulling", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare iPad");
    const suffix = uniqueSuffix();
    const sql = connect();
    try {
      await insertAssignment(sql, {
        suffix,
        address: `Ipadveien 6 ${suffix}, 8000 Bodø`,
        status: "completed",
      });
    } finally {
      await sql.end();
    }

    await logInAsOffice(page);
    for (const viewport of [undefined, PORTRAIT]) {
      if (viewport) await page.setViewportSize(viewport);
      const query = encodeURIComponent(`Ipadveien 6 ${suffix}`);

      await page.goto(`/arbeidskoe?status=in_progress&mine=0&q=${query}`);
      await expectNoHorizontalScroll(page);
      await expectAtLeast44(
        page.getByTestId("work-queue-empty").getByRole("link", { name: "Ferdig (1)" }),
        "lenken «Ferdig (1)»",
      );
      await expectAtLeast44(
        page.getByRole("link", { name: "Tøm søk", exact: true }),
        "«Tøm søk» i arbeidskøen",
      );

      await page.goto(`/ordre?q=${query}`);
      await expectNoHorizontalScroll(page);
      await expectAtLeast44(searchBox(page), "søkefeltet i ordrelisten");
      await expectAtLeast44(
        page.getByRole("link", { name: "Tøm søk", exact: true }),
        "«Tøm søk» i ordrelisten",
      );
    }
  });
});
