import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  e2eDatabaseUrl,
  employeeByEmail,
  ensureInspector,
  INSPECTOR_EMAIL,
  logIn,
  logInAsInspector,
  logInAsManager,
  uniqueSuffix,
} from "./helpers";

/*
 * Tidsmåling per oppdrag og fase (fase 2a).
 * Testplan: docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 11. Kjører i prosjektene pc og
 * ipad; iPad stående (11.7) bare i ipad. Ingen e2e uten nett (måling på iPad uten nett er fase 2b).
 *
 * e2e-databasen tømmes ikke og andre spesifikasjoner kan lage ferdige oppdrag, så antallet i
 * statistikken sjekkes som endring (før og etter), aldri som fast tall. Oppdrag legges rett i
 * databasen (oppdragssiden er testet før), med unik ending. Ingen testhjelper-endepunkt. Testene
 * deler bryteren «Mål tid», så hele filen kjøres i serie, og bryteren og nullpunktet settes
 * tilbake i `afterAll`. Data er oppdiktet («Tidsveien 1», «Oppdiktet måling, 3 oppdrag»).
 *
 * Støtter hovedmål: tid (tiden måles uten et eneste trykk) og arbeidsmiljøloven kapittel 9
 * (tallene vises bare samlet, aldri per person).
 */

const STATS_URL = "/statistikk/tid";
const PORTRAIT = { width: 834, height: 1194 } as const;
const PRIVACY_TEXT = "Tallene vises bare samlet, aldri per person.";
const EMPTY_TEXT = "Ingen ferdige oppdrag med målt tid ennå.";
const SOURCE = "Oppdiktet måling, 3 oppdrag";
const ENABLED_KEY = "time_tracking.enabled";
const BASELINE_KEY = "time_tracking.baseline";
const PHASE_LABELS = ["Forberedelse", "Befaring", "Kontorarbeid", "Levering"] as const;

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

/** Et oppdrag under arbeid uten befaringsdato (fasen «forberedelse»), rett i databasen. */
async function insertAssignment(): Promise<string> {
  const suffix = uniqueSuffix();
  return withSql(async (sql) => {
    const { organizationId, officeId } = await seedOrganization(sql);
    const id = randomUUID();
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        address_text, received_at, source)
      values (${id}, ${organizationId}, ${`E2E-TID-${suffix}`}, ${officeId}, 'condition_report',
        'in_progress', ${`Tidsveien 1 ${suffix}, 8000 Bodø`}, now(), 'manual')`;
    return id;
  });
}

async function sessionCount(assignmentId: string): Promise<number> {
  return withSql(async (sql) => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from work_sessions
      where assignment_id = ${assignmentId} and deleted_at is null`;
    return row?.n ?? 0;
  });
}

type SavedSettings = {
  enabled: unknown;
  baseline: unknown;
  hadEnabled: boolean;
  hadBaseline: boolean;
};

async function readTimeSettings(): Promise<SavedSettings> {
  return withSql(async (sql) => {
    const { organizationId } = await seedOrganization(sql);
    const [row] = await sql<{ settings: Record<string, unknown> | null }[]>`
      select settings from organizations where id = ${organizationId}`;
    const settings = row?.settings ?? {};
    return {
      enabled: settings[ENABLED_KEY],
      baseline: settings[BASELINE_KEY],
      hadEnabled: ENABLED_KEY in settings,
      hadBaseline: BASELINE_KEY in settings,
    };
  });
}

/** Setter tilbake nøklene som de var. Rører ingen andre nøkler. */
async function restoreTimeSettings(saved: SavedSettings) {
  await withSql(async (sql) => {
    const { organizationId } = await seedOrganization(sql);
    await sql`
      update organizations set settings = (settings - ${ENABLED_KEY}::text) - ${BASELINE_KEY}::text
      where id = ${organizationId}`;
    const patch: Record<string, unknown> = {};
    // Bryteren skal alltid være på etter testene
    patch[ENABLED_KEY] = saved.hadEnabled && saved.enabled !== false ? saved.enabled : true;
    if (saved.hadBaseline) patch[BASELINE_KEY] = saved.baseline;
    await sql`
      update organizations set settings = settings || ${sql.json(patch as never)}
      where id = ${organizationId}`;
  });
}

/** Bytter bruker i samme side: logger ut (tømmer informasjonskapslene) og inn igjen. */
async function asAdmin(page: Page) {
  await page.context().clearCookies();
  await logIn(page);
}

async function asManager(page: Page) {
  await page.context().clearCookies();
  await logInAsManager(page);
}

async function asInspector(page: Page) {
  await page.context().clearCookies();
  await logInAsInspector(page);
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

/** Antall oppdrag som telles, slik siden viser det (0 når tabellen er tom). */
async function countedOnPage(page: Page): Promise<number> {
  const response = await page.goto(STATS_URL);
  expectNoServerError(response, STATS_URL);
  const main = page.getByRole("main");
  await expect(main).toContainText(PRIVACY_TEXT);
  const text = await main.innerText();
  if (text.includes(EMPTY_TEXT)) return 0;
  const match = /oppdrag[^\n\d]*?(\d+)/i.exec(text);
  expect(match, "siden viser antall oppdrag").not.toBeNull();
  return Number(match![1]);
}

/** Takstmannen åpner oppdraget og er aktiv (mus og tastatur). */
async function workInAssignment(page: Page, assignmentId: string) {
  const response = await page.goto(`/oppdrag/${assignmentId}`);
  expectNoServerError(response, `/oppdrag/${assignmentId}`);
  await page.mouse.move(200, 200);
  await page.mouse.move(260, 240);
  await page.keyboard.press("Shift");
}

/** «Sett til Ferdig» på oppdragssiden. */
async function completeAssignment(page: Page, assignmentId: string) {
  await page.goto(`/oppdrag/${assignmentId}`);
  const status = page.getByRole("region", { name: "Status", exact: true });
  await status.getByRole("button", { name: "Sett til Ferdig", exact: true }).click();
  await expect(status.getByText("Ferdig", { exact: true }).first()).toBeVisible();
  await expect(status.getByRole("button", { name: "Sett til Ferdig", exact: true })).toHaveCount(0);
}

function enabledSwitch(page: Page): Locator {
  return page.getByRole("checkbox", { name: /Mål tid/ });
}

function saveButton(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: "Lagre", exact: true });
}

function minutesField(page: Page, label: (typeof PHASE_LABELS)[number]): Locator {
  return page.getByRole("main").getByLabel(label, { exact: true });
}

/** Raden for fasen i tabellen. */
function phaseRow(page: Page, label: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
}

async function setEnabledViaForm(page: Page, enabled: boolean) {
  await asAdmin(page);
  await page.goto(STATS_URL);
  const toggle = enabledSwitch(page);
  if ((await toggle.isChecked()) !== enabled) await toggle.click();
  await saveButton(page).click();
  await page.waitForLoadState("networkidle");
  await page.goto(STATS_URL);
  await expect(enabledSwitch(page)).toBeChecked({ checked: enabled });
}

test.describe("tidsmåling (pc og ipad)", () => {
  test.describe.configure({ mode: "serial" });

  let saved: SavedSettings;

  test.beforeAll(async () => {
    saved = await readTimeSettings();
    // Start alltid med målingen på
    await restoreTimeSettings({ ...saved, enabled: true, hadEnabled: true });
    await ensureInspector();
  });

  test.afterAll(async () => {
    await restoreTimeSettings(saved);
  });

  test("11.1 tiden måles uten trykk og vises bare samlet", async ({ page }) => {
    const assignmentId = await insertAssignment();
    const inspector = await employeeByEmail(INSPECTOR_EMAIL);

    await asManager(page);
    const before = await countedOnPage(page);

    await asInspector(page);
    await workInAssignment(page, assignmentId);
    await expect.poll(() => sessionCount(assignmentId), { timeout: 15_000 }).toBeGreaterThan(0);

    await asManager(page);
    await completeAssignment(page, assignmentId);
    const after = await countedOnPage(page);
    expect(after).toBe(before + 1);

    const main = page.getByRole("main");
    await expect(main).toContainText(PRIVACY_TEXT);
    await expect(main.getByRole("table")).toBeVisible();
    for (const label of [...PHASE_LABELS, "Totalt"]) {
      await expect(phaseRow(page, label)).toHaveCount(1);
    }
    const html = await page.content();
    expect(html).not.toContain(inspector.name);
    expect(html).not.toContain(INSPECTOR_EMAIL);
    expect(html).not.toContain(inspector.id);
  });

  test("11.3 takstmann ser ikke menylenken og får «Ingen tilgang»", async ({ page }) => {
    await asInspector(page);
    const start = await page.goto("/arbeidskoe");
    expect(start?.status(), "arbeidskøen åpnes").toBeLessThan(400);
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Statistikk", exact: true })).toHaveCount(0);

    const response = await page.goto(STATS_URL);
    expectNoServerError(response, STATS_URL);
    await expect(page.getByRole("heading", { name: "Ingen tilgang", level: 1 })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain(PRIVACY_TEXT);
    expect(html).not.toContain("Snitt minutter");
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(enabledSwitch(page)).toHaveCount(0);
  });

  test("11.3 leder ser menylenken «Statistikk»", async ({ page }) => {
    await asManager(page);
    const start = await page.goto("/arbeidskoe");
    expect(start?.status(), "arbeidskøen åpnes").toBeLessThan(400);
    await expect(page.getByRole("navigation").first()).toBeVisible();
    const link = page.getByRole("link", { name: "Statistikk", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${STATS_URL}$`));
  });

  test("11.6 leder ser tabellen, men ikke skjemaet for nullpunkt og bryter", async ({ page }) => {
    await asManager(page);
    await countedOnPage(page);
    await expect(page.getByRole("main")).toContainText(PRIVACY_TEXT);
    await expect(enabledSwitch(page)).toHaveCount(0);
    await expect(saveButton(page)).toHaveCount(0);
    await expect(minutesField(page, "Kontorarbeid")).toHaveCount(0);
  });

  test("11.4 admin lagrer nullpunkt; tallene står etter omlasting og forskjellen vises", async ({
    page,
  }) => {
    await asAdmin(page);
    await page.goto(STATS_URL);
    await minutesField(page, "Forberedelse").fill("60");
    await minutesField(page, "Befaring").fill("0");
    await minutesField(page, "Kontorarbeid").fill("120");
    await minutesField(page, "Levering").fill("30");
    await page
      .getByRole("main")
      .getByLabel(/^Kilde/)
      .fill(SOURCE);
    await saveButton(page).click();
    await page.waitForLoadState("networkidle");

    await page.reload();
    await expect(minutesField(page, "Forberedelse")).toHaveValue("60");
    await expect(minutesField(page, "Befaring")).toHaveValue("0");
    await expect(minutesField(page, "Kontorarbeid")).toHaveValue("120");
    await expect(minutesField(page, "Levering")).toHaveValue("30");
    await expect(page.getByRole("main").getByLabel(/^Kilde/)).toHaveValue(SOURCE);

    // 11.1 har laget minst ett ferdig oppdrag med målt tid, så tabellen vises
    const preparation = phaseRow(page, "Forberedelse");
    await expect(preparation).toContainText("60");
    await expect(preparation.getByRole("cell").last()).toHaveText(/^[+\-−]\d+ %$|^0 %$/);
    await expect(phaseRow(page, "Befaring").getByRole("cell").last()).toHaveText("–");
    await expect(phaseRow(page, "Totalt")).toContainText("210");

    const stored = await readTimeSettings();
    expect(stored.baseline).toEqual({
      preparation: 60,
      inspection: 0,
      office: 120,
      delivery: 30,
      source: SOURCE,
    });
  });

  for (const [label, value] of [
    ["10 001", "10001"],
    ["desimaltall", "12.5"],
    ["desimaltall med komma", "12,5"],
  ] as const) {
    test(`11.5 ugyldig nullpunkt (${label}) gir norsk melding ved feltet; ingenting lagres`, async ({
      page,
    }) => {
      const before = await readTimeSettings();
      await asAdmin(page);
      await page.goto(STATS_URL);
      const field = minutesField(page, "Kontorarbeid");
      await field.fill(value);
      await saveButton(page).click();

      await expect(field).toHaveAttribute("aria-invalid", "true");
      const describedBy = await field.getAttribute("aria-describedby");
      expect(describedBy, "feltet peker på meldingen").toBeTruthy();
      const messages = await Promise.all(
        describedBy!.split(/\s+/).map((id) =>
          page
            .locator(`[id="${id}"]`)
            .innerText()
            .catch(() => ""),
        ),
      );
      const message = messages.join(" ");
      expect(message).toMatch(/minutt|helt tall/i);
      expect(message).not.toMatch(/invalid|expected|too big/i);

      expect(await readTimeSettings()).toEqual(before);
    });
  }

  test("11.2 måling av: ingen ny økt, antallet er uendret; så på igjen", async ({ page }) => {
    const assignmentId = await insertAssignment();
    await setEnabledViaForm(page, false);
    expect((await readTimeSettings()).enabled).toBe(false);
    await expect(page.getByRole("main")).toContainText(PRIVACY_TEXT);

    await asManager(page);
    const before = await countedOnPage(page);

    await asInspector(page);
    await workInAssignment(page, assignmentId);
    // Måleren sender straks siden åpnes; gi den tid før vi sjekker at ingenting er lagret
    await page.waitForTimeout(3_000);
    expect(await sessionCount(assignmentId)).toBe(0);

    await asManager(page);
    await completeAssignment(page, assignmentId);
    expect(await sessionCount(assignmentId)).toBe(0);
    expect(await countedOnPage(page)).toBe(before);

    await setEnabledViaForm(page, true);
    expect((await readTimeSettings()).enabled).toBe(true);
  });

  test("11.8 oppdragssiden er uendret, også når serverhandlingen feiler", async ({ page }) => {
    const assignmentId = await insertAssignment();
    await asInspector(page);

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Serverhandlinger er POST mot sidens adresse med «next-action»-hodet
    let blocked = 0;
    await page.route(`**/oppdrag/${assignmentId}**`, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"]) {
        blocked += 1;
        await route.fulfill({ status: 500, body: "feil (test)" });
        return;
      }
      await route.continue();
    });

    const response = await page.goto(`/oppdrag/${assignmentId}`);
    expectNoServerError(response, `/oppdrag/${assignmentId}`);
    await page.mouse.move(200, 200);
    await page.keyboard.press("Shift");
    await page.waitForTimeout(2_000);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Status", exact: true })).toBeVisible();
    // Bare varsler i hovedinnholdet (Next har en egen, tom rute-melding med rollen alert)
    await expect(main.getByRole("alert")).toHaveCount(0);
    expect(blocked, "måleren prøvde å sende, og kallet ble stoppet").toBeGreaterThan(0);
    await expect(main).not.toContainText(/tidsmåling|feil i målingen/i);
    expect(errors).toEqual([]);
    expect(await sessionCount(assignmentId)).toBe(0);
  });

  test("11.7 iPad stående: ingen vannrett rulling, 44 px trykkflater", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare i prosjektet ipad");
    await page.setViewportSize(PORTRAIT);
    await asAdmin(page);
    const response = await page.goto(STATS_URL);
    expectNoServerError(response, STATS_URL);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, "ingen vannrett rulling").toBeLessThanOrEqual(
      overflow.clientWidth,
    );

    await expectAtLeast44(
      page.locator("label", { has: enabledSwitch(page) }),
      "bryteren «Mål tid»",
    );
    for (const label of PHASE_LABELS) {
      await expectAtLeast44(minutesField(page, label), `feltet ${label}`);
    }
    await expectAtLeast44(saveButton(page), "Lagre");

    // Tabellen er lesbar uten zoom: innenfor skjermen og minst 14 px tekst
    const table = page.getByRole("main").getByRole("table");
    if ((await table.count()) > 0) {
      const box = await table.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(PORTRAIT.width);
      const fontSize = await table.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      );
      expect(fontSize).toBeGreaterThanOrEqual(14);
    }
  });
});
