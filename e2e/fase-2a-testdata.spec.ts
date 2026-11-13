import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { TESTDATA_ORDERS, TESTDATA_STREETS } from "../src/db/seed/testdata.data";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  e2eDatabaseUrl,
  logIn,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  seedTestdataForE2e,
} from "./helpers";

/*
 * Testdata som ligner en ekte arbeidshverdag, i appen (fase 2a). Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 7. Kjører i prosjektene pc og
 * ipad; «uten nett» bare i ipad.
 *
 * `beforeAll` legger inn testdataene med inngangen til `pnpm db:seed:testdata` (idempotent), etter
 * at databasen er sjekket med `assertLocalOrTestDatabase`. De oppdiktede ansatte kan ikke logge
 * inn (`.invalid`), så testene logger inn med de faste e2e-brukerne i Byggcon og bruker «Alle»
 * (`mine=0`). Testene sjekker på TD-nøkler og adresser fra databasen, aldri på faste antall, fordi
 * andre tester deler databasen. Alle data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (arbeidskø, ordre, oppdrag, reklamasjoner og tidsstatistikk er
 * fylt med en gang i testmiljøet, også på iPad) og færre reklamasjoner (lange lister prøves).
 */

type TdAssignment = {
  ref: string;
  id: string;
  status: "ordered" | "in_progress" | "completed" | "invoiced";
  address: string;
  inspection_date: string | null;
  ownership_form: string;
  gnr: string;
  bnr: string;
  managing_agent: string | null;
};

const STATUSES = ["ordered", "in_progress", "completed", "invoiced"] as const;
const PORTRAIT = { width: 834, height: 1194 } as const;

let anchor = "";
let assignments: TdAssignment[] = [];

test.beforeAll(async () => {
  test.setTimeout(240_000);
  seedTestdataForE2e();
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [admin] = await sql<{ organization_id: string }[]>`
      select e.organization_id from employees e join users u on u.id = e.user_id
      join organizations o on o.id = e.organization_id
      where u.email = ${ADMIN_EMAIL} and coalesce(o.settings ->> 'sampleData', 'false') <> 'true'
        and e.deleted_at is null
      limit 1`;
    if (!admin) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    const organizationId = admin.organization_id;
    const [first] = await sql<{ day: string }[]>`
      select to_char((created_at at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD') as day
      from orders where organization_id = ${organizationId} and external_ref = 'TD-0001'`;
    if (!first) throw new Error("Fant ikke TD-0001 etter pnpm db:seed:testdata");
    anchor = first.day;
    assignments = await sql<TdAssignment[]>`
      select o.external_ref as ref, a.id::text as id, a.status, p.address,
        to_char((a.inspection_at at time zone 'Europe/Oslo')::date, 'YYYY-MM-DD') as inspection_date,
        p.ownership_form, cu.gnr, cu.bnr,
        (select c.managing_agent from common_areas c where c.assignment_id = a.id and c.deleted_at is null limit 1) as managing_agent
      from orders o join assignments a on a.id = o.assignment_id
      join properties p on p.id = a.property_id join cadastral_units cu on cu.property_id = p.id
      where o.organization_id = ${organizationId} and o.external_ref like 'TD-%'
        and o.deleted_at is null and a.deleted_at is null
      order by o.external_ref`;
    if (assignments.length === 0) throw new Error("Ingen TD-oppdrag etter pnpm db:seed:testdata");
  } finally {
    await sql.end();
  }
});

async function dbRows<T extends object>(query: (sql: postgres.Sql) => Promise<T[]>): Promise<T[]> {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    return await query(sql);
  } finally {
    await sql.end();
  }
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mandag og søndag i uken ankeret ligger i. */
function anchorWeek(): { monday: string; sunday: string } {
  const weekday = (new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(anchor, -weekday);
  return { monday, sunday: addDays(monday, 6) };
}

function byStatus(status: TdAssignment["status"]): TdAssignment {
  const found = assignments.find((item) => item.status === status);
  if (!found) throw new Error(`Ingen TD-oppdrag med status ${status}`);
  return found;
}

function cards(page: Page) {
  return page.getByTestId("work-queue-card");
}

function queueUrl(status: string, query = ""): string {
  return `/arbeidskoe?status=${status}&mine=0&q=${encodeURIComponent(query)}`;
}

/** Lett sjekk av universell utforming uten ny pakke: språk, h1, navn på lenker og knapper, unike id-er. */
async function expectBasicAccessibility(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    if (!document.documentElement.lang.startsWith("nb")) found.push("html lang er ikke nb");
    if (document.querySelectorAll("h1").length !== 1) found.push("ikke nøyaktig én h1");
    if (!document.querySelector("main")) found.push("mangler main");
    for (const element of Array.from(document.querySelectorAll("a[href], button"))) {
      const el = element as HTMLElement;
      if (el.closest("[hidden], [aria-hidden='true']")) continue;
      const name =
        el.getAttribute("aria-label") ??
        (el.getAttribute("aria-labelledby")
          ? document.getElementById(el.getAttribute("aria-labelledby")!)?.textContent
          : null) ??
        el.textContent;
      if (!name || name.trim() === "") found.push(`uten navn: ${el.outerHTML.slice(0, 80)}`);
    }
    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) found.push(`doble id-er: ${[...new Set(duplicates)].join(", ")}`);
    for (const input of Array.from(
      document.querySelectorAll("input:not([type=hidden]), textarea, select"),
    )) {
      const el = input as HTMLInputElement;
      const labelled =
        el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
      if (!labelled) found.push(`felt uten etikett: ${el.outerHTML.slice(0, 80)}`);
    }
    return found;
  });
  expect(problems, where).toEqual([]);
}

test.describe("testdataene i appen (pc og ipad)", () => {
  test("7.1 arbeidskøen: TD-oppdrag med befaring denne uken, i alle fire faner, og søk på gatenavn", async ({
    page,
  }) => {
    const { monday, sunday } = anchorWeek();
    const thisWeek = assignments.filter(
      (item) =>
        item.status === "ordered" &&
        item.inspection_date !== null &&
        item.inspection_date >= monday &&
        item.inspection_date <= sunday,
    );
    expect(thisWeek.length, "TD-oppdrag med befaring i ankerets uke").toBeGreaterThan(0);

    await logInAsInspector(page);
    await page.goto(queueUrl("ordered", thisWeek[0]!.address));
    await expect(cards(page).filter({ hasText: thisWeek[0]!.address })).toHaveCount(1);

    for (const status of STATUSES) {
      const item = byStatus(status);
      await page.goto(queueUrl(status, item.address));
      await expect(cards(page).filter({ hasText: item.address }), status).toHaveCount(1);
    }

    const street = TESTDATA_STREETS.find((name) =>
      assignments.some((item) => item.address.startsWith(name)),
    )!;
    await page.goto(queueUrl("invoiced", street));
    await expect(cards(page).first()).toBeVisible();
    for (const text of await cards(page).allInnerTexts()) expect(text).toContain(street);
  });

  test("7.2 ordrelisten viser TD-ordre i begge ordrestatuser og teksten om at ikke alle vises; statusfilteret i køen virker", async ({
    page,
  }) => {
    await logInAsOffice(page);
    await page.goto("/ordre");
    await expect(
      page.getByText(/^Viser 50 av \d+\. Bruk søket for å finne flere\.$/),
    ).toBeVisible();

    await page.goto(`/ordre?q=${encodeURIComponent("TD-")}`);
    const main = page.getByRole("main");
    await expect(main.getByText("Mottatt", { exact: true }).first()).toBeVisible();
    await expect(main.getByText("Gjort om til oppdrag", { exact: true }).first()).toBeVisible();
    const orderOnly = TESTDATA_ORDERS.find((order) => order.target === "order_only")!;
    await expect(
      main.getByText(`Ordrenr. ${orderOnly.externalRef}`, { exact: false }).first(),
    ).toBeVisible();

    // Statusfilteret (fanene i arbeidskøen): et ferdig oppdrag vises bare under «Ferdig»
    const completed = byStatus("completed");
    await page.goto(queueUrl("completed", completed.address));
    await expect(cards(page).filter({ hasText: completed.address })).toHaveCount(1);
    for (const status of STATUSES.filter((value) => value !== "completed")) {
      await page.goto(queueUrl(status, completed.address));
      await expect(cards(page).filter({ hasText: completed.address }), status).toHaveCount(0);
    }
  });

  test("7.3 oppdragssiden for et befart TD-oppdrag i sameie viser team, parter, matrikkel, fellesdeler og bygninger", async ({
    page,
  }) => {
    const item = assignments.find(
      (row) =>
        (row.status === "completed" || row.status === "in_progress") &&
        (row.ownership_form === "section" || row.ownership_form === "cooperative") &&
        row.managing_agent,
    );
    expect(item, "befart TD-oppdrag i sameie eller borettslag").toBeDefined();
    const [team] = await dbRows(
      (sql) =>
        sql<{ name: string }[]>`
        select e.name from assignment_team_members t join employees e on e.id = t.employee_id
        where t.assignment_id = ${item!.id} and t.team_role = 'responsible' and t.to_at is null`,
    );
    const [party] = await dbRows(
      (sql) =>
        sql<{ name: string }[]>`
        select name from assignment_parties where assignment_id = ${item!.id} and role = 'seller'
          and deleted_at is null order by name limit 1`,
    );
    const [room] = await dbRows(
      (sql) =>
        sql<{ floor: string; room: string }[]>`
        select f.name as floor, r.name as room from rooms r join floors f on f.id = r.floor_id
        join report_buildings b on b.id = f.report_building_id
        where b.assignment_id = ${item!.id} and r.deleted_at is null order by f.level desc, r.name limit 1`,
    );

    await logIn(page);
    await page.goto(`/oppdrag/${item!.id}`);
    const gnr = Number(item!.gnr);
    expect(gnr).toBeGreaterThanOrEqual(9001);
    expect(gnr).toBeLessThanOrEqual(9099);
    // Admin kan endre, så eiendom og fellesdeler vises som skjema med verdiene i feltene
    const property = page.getByRole("region", { name: "Eiendom", exact: true });
    await expect(property.getByLabel(/^Gårdsnummer/)).toHaveValue(item!.gnr);
    await expect(property.getByLabel(/^Bruksnummer/)).toHaveValue(item!.bnr);
    await expect(
      page
        .getByRole("region", { name: "Fellesdeler", exact: true })
        .getByLabel(/^Forretningsfører/),
    ).toHaveValue(item!.managing_agent!);
    await expect(page.getByRole("region", { name: "Team", exact: true })).toContainText(team!.name);
    await expect(page.getByRole("region", { name: "Parter", exact: true })).toContainText(
      party!.name,
    );

    await page.getByRole("link", { name: "Bygninger, areal og rom" }).click();
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${item!.id}/bygninger$`));
    await expect(page.getByRole("main")).toContainText(room!.floor);
    await expect(page.getByRole("main")).toContainText(room!.room);
  });

  test("7.4 leder ser reklamasjonene på et ferdig TD-oppdrag; takstmannen ser ikke delen og får 404", async ({
    page,
  }) => {
    const [claim] = await dbRows(
      (sql) =>
        sql<{ id: string; assignment_id: string }[]>`
        select c.id::text as id, c.assignment_id::text as assignment_id from claims c
        join orders o on o.assignment_id = c.assignment_id
        where o.external_ref like 'TD-%' and c.deleted_at is null
        order by o.external_ref limit 1`,
    );
    expect(claim, "TD-reklamasjon").toBeDefined();
    const claimUrl = `/oppdrag/${claim!.assignment_id}/reklamasjoner/${claim!.id}`;

    await logInAsManager(page);
    await page.goto(`/oppdrag/${claim!.assignment_id}`);
    const region = page.getByRole("region", { name: "Reklamasjoner", exact: true });
    await expect(region).toBeVisible();
    await region.locator(`a[href="${claimUrl}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${claimUrl}$`));

    await page.context().clearCookies();
    await logInAsInspector(page);
    await page.goto(`/oppdrag/${claim!.assignment_id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reklamasjoner", exact: true })).toHaveCount(0);
    const response = await page.goto(claimUrl);
    expect(response?.status()).toBe(404);
  });

  test("7.5 tidsstatistikken viser tall for de ferdige TD-oppdragene", async ({ page }) => {
    await logInAsManager(page);
    await page.goto("/statistikk/tid");
    await expect(page.getByRole("heading", { level: 1, name: "Tid per oppdrag" })).toBeVisible();
    const count = page.getByText(/^Ferdige oppdrag med målt tid:/);
    await expect(count).toBeVisible();
    const value = Number((await count.locator("span").innerText()).trim());
    expect(value).toBeGreaterThanOrEqual(
      assignments.filter((item) => item.status === "completed" || item.status === "invoiced")
        .length,
    );
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("7.7 universell utforming på arbeidskøen og ordrelisten med full testdata", async ({
    page,
  }) => {
    await logInAsOffice(page);
    await page.goto("/arbeidskoe?status=invoiced&mine=0");
    await expect(cards(page).first()).toBeVisible();
    await expectBasicAccessibility(page, "arbeidskøen");
    await page.goto("/ordre");
    await expect(page.getByRole("heading", { level: 1, name: "Ordre" })).toBeVisible();
    await expectBasicAccessibility(page, "ordrelisten");
  });
});

test.describe("testdataene uten nett (bare ipad)", () => {
  test("7.6 arbeidskøen med TD-oppdrag vises fra hurtiglageret uten nett", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Uten nett prøves på iPad-størrelse");
    await logInAsInspector(page);
    await page.goto("/arbeidskoe?status=ordered&mine=0");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Ny visning med service workeren som kontrollerer siden, så svaret havner i hurtiglageret
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);
    await page.reload();
    const shown = await cards(page).allInnerTexts();
    const tdShown = assignments.filter((item) => shown.some((text) => text.includes(item.address)));
    expect(tdShown.length, "TD-oppdrag i køen på nett").toBeGreaterThan(0);

    try {
      await context.setOffline(true);
      await page.reload();
      await expect(cards(page).filter({ hasText: tdShown[0]!.address })).toHaveCount(1);
    } finally {
      await context.setOffline(false);
    }
  });

  test("7.6 iPad stående: TD-kortene får plass uten vannrett rulling", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Bare iPad");
    await page.setViewportSize(PORTRAIT);
    await logInAsInspector(page);
    await page.goto("/arbeidskoe?status=invoiced&mine=0");
    await expect(cards(page).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
