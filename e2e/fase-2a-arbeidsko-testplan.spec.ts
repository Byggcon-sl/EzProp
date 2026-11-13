import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import { ADMIN_EMAIL, e2eDatabaseUrl, logIn, uniqueSuffix } from "./helpers";

/*
 * Siden /arbeidskoe med data lagt rett i databasen (docs/funksjoner/fase2a-arbeidsko-testplan.md
 * avsnitt 3.2). Utfyller e2e/fase-2a-arbeidsko.spec.ts (avsnitt 4), som lager oppdrag gjennom
 * skjermene: her trengs 51 oppdrag og frister i fortiden, og det går ikke å lage raskt for hånd.
 * Kjører i prosjektene pc og ipad.
 *
 * Bare lokal database eller testdatabasen (`assertLocalOrTestDatabase`). Hver test lager egne
 * oppdrag med en unik ending i nummer og adresse og søker på den, fordi e2e-databasen ikke tømmes.
 * Ingenting slettes permanent: oppdragene «kanselleres» med `deleted_at`, som i appen. Data er
 * oppdiktet («Grenseveien 1, 8000 Bodø»).
 *
 * Støtter hovedmål: reklamasjoner («Forfalt», «Befaring ikke avtalt» og «Ingen ansvarlig» synes,
 * og ingen oppdrag forsvinner stille over grensen på 50) og tid (teksten sier at søket finner resten).
 */

type Sql = ReturnType<typeof postgres>;

function connect(): Sql {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Organisasjonen og kontoret «Bodø» til admin fra seed. */
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

type NewAssignment = {
  status?: string;
  dueDate?: string | null;
  inspectionAt?: Date | null;
};

/** Ordre og oppdrag med adressen fra ordren. Nummeret og adressen har endingen i seg. */
async function insertAssignments(
  sql: Sql,
  suffix: string,
  rows: NewAssignment[],
): Promise<{ id: string; number: string; address: string }[]> {
  const { organizationId, officeId } = await seedOrganization(sql);
  const created: { id: string; number: string; address: string }[] = [];
  for (const [index, row] of rows.entries()) {
    const orderId = randomUUID();
    const id = randomUUID();
    const address = `Grenseveien ${index + 1} ${suffix}, 8000 Bodø`;
    const number = `E2E-${suffix}-${String(index + 1).padStart(3, "0")}`;
    await sql`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type)
      values (${orderId}, ${organizationId}, ${address}, now(), 'manual', 'received',
        'condition_report')`;
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, due_date, inspection_at)
      values (${id}, ${organizationId}, ${number}, ${officeId}, 'condition_report',
        ${row.status ?? "in_progress"}, ${orderId}, ${row.dueDate ?? null},
        ${row.inspectionAt ?? null})`;
    created.push({ id, number, address });
  }
  return created;
}

/** Dagens dato i norsk tid pluss `days`, som «ÅÅÅÅ-MM-DD». */
function osloDate(days = 0): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(at);
}

function queueUrl(status: string, query: string): string {
  return `/arbeidskoe?status=${status}&mine=0&q=${encodeURIComponent(query)}`;
}

function cards(page: Page): Locator {
  return page.getByTestId("work-queue-card");
}

function cardFor(page: Page, number: string): Locator {
  return cards(page).filter({ hasText: number });
}

const LIMIT_TEXT = "Viser 50 av 51. Bruk søket for å finne flere.";

test.describe("arbeidskøen med data fra databasen (pc og ipad)", () => {
  test("3.2.1 51 oppdrag gir 50 kort og teksten; 50 gir ingen tekst", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = `gr${uniqueSuffix()}`;
    const sql = connect();
    try {
      const created = await insertAssignments(
        sql,
        suffix,
        Array.from({ length: 51 }, () => ({ status: "in_progress" })),
      );
      await logIn(page);
      await page.goto(queueUrl("in_progress", suffix));
      await expect(cards(page)).toHaveCount(50);
      await expect(page.getByText(LIMIT_TEXT)).toBeVisible();
      await expect(page.getByTestId("work-queue-count-in_progress")).toHaveText("51");

      // Kanseller ett (myk sletting, som i appen): 50 igjen, ingen tekst
      await sql`update assignments set deleted_at = now() where id = ${created[0]!.id}`;
      await page.reload();
      await expect(cards(page)).toHaveCount(50);
      await expect(page.getByText(/Viser \d+ av \d+/)).toHaveCount(0);
      await expect(page.getByTestId("work-queue-count-in_progress")).toHaveText("50");
      await expect(cardFor(page, created[0]!.number)).toHaveCount(0);
    } finally {
      await sql.end();
    }
  });

  test("3.2.4 merkene følger dataene: Forfalt, Befaring ikke avtalt og Ingen ansvarlig", async ({
    page,
  }) => {
    const suffix = `mk${uniqueSuffix()}`;
    const sql = connect();
    try {
      const [overdue, today, done] = await insertAssignments(sql, suffix, [
        { status: "in_progress", dueDate: osloDate(-1) },
        { status: "in_progress", dueDate: osloDate(0), inspectionAt: new Date() },
        { status: "completed", dueDate: osloDate(-1) },
      ]);
      await logIn(page);

      await page.goto(queueUrl("in_progress", suffix));
      await expect(cards(page)).toHaveCount(2);
      const overdueCard = cardFor(page, overdue!.number);
      await expect(overdueCard).toContainText(overdue!.address);
      await expect(overdueCard.getByText("Forfalt", { exact: true })).toBeVisible();
      await expect(overdueCard).toContainText("Befaring ikke avtalt");
      await expect(overdueCard).toContainText("Ingen ansvarlig");

      // Frist i dag er ikke forfalt; befaring er avtalt
      const todayCard = cardFor(page, today!.number);
      await expect(todayCard.getByText("Forfalt", { exact: true })).toHaveCount(0);
      await expect(todayCard).not.toContainText("Befaring ikke avtalt");

      // Ferdig med frist i går er ikke forfalt
      await page.goto(queueUrl("completed", suffix));
      const doneCard = cardFor(page, done!.number);
      await expect(doneCard).toHaveCount(1);
      await expect(doneCard.getByText("Forfalt", { exact: true })).toHaveCount(0);

      // Kortet lenker til oppdraget
      await page.goto(queueUrl("in_progress", suffix));
      await expect(
        cardFor(page, overdue!.number).getByRole("link", { name: overdue!.address }),
      ).toHaveAttribute("href", `/oppdrag/${overdue!.id}`);
    } finally {
      await sql.end();
    }
  });

  test("3.2.2 tom fane uten Ny ordre i Under arbeid", async ({ page }) => {
    await logIn(page);
    await page.goto(queueUrl("in_progress", `finnes-ikke-${uniqueSuffix()}`));
    const empty = page.getByTestId("work-queue-empty");
    await expect(empty).toContainText("Ingen oppdrag med status Under arbeid.");
    await expect(empty.getByRole("link", { name: "Ny ordre" })).toHaveCount(0);
  });

  test("3.2.3 kvitteringen etter kansellering vises fortsatt", async ({ page }) => {
    await logIn(page);
    await page.goto("/arbeidskoe?kansellert=2026-00001");
    await expect(page.getByText("Oppdrag 2026-00001 er kansellert.")).toBeVisible();
    await expect(page.getByTestId("work-queue-count-in_progress")).toHaveText(/^\d+$/);
  });

  // Admin fra seed har ikke takstmann-rollen, så standarden er «Alle» (T-0029,
  // docs/funksjoner/fase2a-sok-ordre-arbeidsko.md). Ugyldig `mine` gir standarden.
  test("1.2 ugyldige parametre gir Under arbeid og standarden Alle, aldri feilside", async ({
    page,
  }) => {
    await logIn(page);
    const response = await page.goto("/arbeidskoe?status=cancelled&mine=ja&q=%25");
    expect(response?.status()).toBe(200);
    const tabs = page.getByRole("navigation", { name: "Status" });
    await expect(tabs.getByRole("link", { name: /^Under arbeid/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("navigation", { name: "Filter" }).getByRole("link", { name: "Alle" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("2.9 organizationId i adressen bytter ikke organisasjon", async ({ page }) => {
    const suffix = `org${uniqueSuffix()}`;
    const sql = connect();
    try {
      await insertAssignments(sql, suffix, [{ status: "in_progress" }]);
      await logIn(page);
      await page.goto(`${queueUrl("in_progress", suffix)}&organizationId=${randomUUID()}`);
      await expect(cards(page)).toHaveCount(1);
    } finally {
      await sql.end();
    }
  });
});
