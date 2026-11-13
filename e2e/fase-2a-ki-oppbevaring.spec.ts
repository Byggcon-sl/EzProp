import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import { ADMIN_EMAIL, e2eDatabaseUrl, logIn, logInAsInspector, logInAsManager } from "./helpers";

/*
 * Oppbevaringstid for avviste KI-forslag på /admin/ki (K7).
 * Testplan: docs/agenter/oppgaver/ki-oppbevaring-avviste-testplan.md avsnitt 6 (E1–E6). Kjører
 * i prosjektene pc og ipad; E6 bare i ipad.
 *
 * Testene deler innstillingen `ai.rejected_retention_years` i organisasjonen til admin fra seed,
 * så filen kjøres i serie. Verdien (rå JSON) leses før og settes tilbake i `afterAll`. Ingen
 * testhjelper-endepunkt; databasen leses og skrives bare via vakten (lokal database eller
 * testdatabasen).
 *
 * Uten nett: ikke aktuelt. /admin/ki er en admin-side som bare brukes på nett (oppgavekortet).
 *
 * Støtter hovedmål: de ansatte (admin endrer tallet selv på PC og iPad, med tydelig feilmelding
 * og kvittering) og KI i bunnen (hjelpeteksten lover ikke sletting).
 */

const KEY = "ai.rejected_retention_years";
const URL = "/admin/ki";
const LABEL = "Oppbevar avviste KI-forslag minst (år)";
const FIELD_ERROR = "Skriv et helt antall år fra 1 til 10.";
const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;

type Sql = ReturnType<typeof postgres>;

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** Organisasjonen til admin fra seed (ikke prøveorganisasjonen). */
async function adminOrganizationId(sql: Sql): Promise<string> {
  const [row] = await sql<{ organization_id: string }[]>`
    select e.organization_id from employees e join users u on u.id = e.user_id
    where u.email = ${ADMIN_EMAIL}
      and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
      and e.deleted_at is null
    limit 1`;
  if (!row) throw new Error("Fant ikke organisasjonen til admin fra seed (kjør pnpm db:seed)");
  return row.organization_id;
}

type Stored = { present: boolean; json: string | null; type: string | null };

async function readSetting(): Promise<Stored> {
  return withSql(async (sql) => {
    const id = await adminOrganizationId(sql);
    const [row] = await sql<{ present: boolean; json: string | null; type: string | null }[]>`
      select settings ? ${KEY} as present, (settings -> ${KEY})::text as json,
             jsonb_typeof(settings -> ${KEY}) as type
      from organizations where id = ${id}`;
    return row ?? { present: false, json: null, type: null };
  });
}

/** Setter innstillingen rått (JSON-tekst), eller fjerner den med `null`. */
async function writeSetting(json: string | null): Promise<void> {
  await withSql(async (sql) => {
    const id = await adminOrganizationId(sql);
    if (json === null) {
      await sql`update organizations set settings = settings - ${KEY} where id = ${id}`;
    } else {
      await sql`
        update organizations
        set settings = settings || jsonb_build_object(${KEY}::text, (${json}::text)::jsonb)
        where id = ${id}`;
    }
  });
}

function yearsField(page: Page) {
  return page.getByLabel(LABEL);
}

function kiTab(page: Page) {
  return page
    .getByRole("navigation", { name: "Admin" })
    .getByRole("link", { name: "KI", exact: true });
}

test.describe.configure({ mode: "serial" });

let original: Stored | null = null;

test.beforeAll(async () => {
  original = await readSetting();
});

test.afterAll(async () => {
  if (!original) return;
  await writeSetting(original.present ? original.json : null);
});

test.describe("K7 /admin/ki: oppbevaring av avviste KI-forslag", () => {
  test("E1 admin ser fanen «KI» og hjelpeteksten", async ({ page }) => {
    await logIn(page);
    await page.goto("/admin/ansatte");
    await expect(kiTab(page)).toBeVisible();
    await kiTab(page).click();
    await expect(page).toHaveURL(new RegExp(`${URL}(\\?|$)`));

    const field = yearsField(page);
    await expect(field).toBeVisible();
    await expect(field).toHaveAccessibleDescription(/minst/);
    const main = page.getByRole("main");
    await expect(main).toContainText("minst");
    await expect(main).toContainText("Ingenting fjernes automatisk ennå");
    // Siden lover aldri sletting
    const text = (await main.innerText()).toLowerCase();
    expect(text).not.toContain("slettes");
    expect(text).not.toContain("fjernes etter");
  });

  test("E2 admin lagrer 3 og ser 3 etter omlasting", async ({ page }) => {
    await writeSetting(null);
    await logIn(page);
    await page.goto(URL);
    const field = yearsField(page);
    await expect(field).toHaveValue("10");

    await field.fill("3");
    await page.getByRole("button", { name: "Lagre" }).click();
    await expect(page.getByRole("status").filter({ hasText: /lagret/i })).toBeVisible();

    await page.reload();
    await expect(yearsField(page)).toHaveValue("3");
    const stored = await readSetting();
    expect(stored).toEqual({ present: true, json: "3", type: "number" });
  });

  for (const invalid of ["0", "11"]) {
    test(`E3 ${invalid} gir feilmelding ved feltet, og databasen er uendret`, async ({ page }) => {
      await writeSetting("4");
      await logIn(page);
      await page.goto(URL);
      const field = yearsField(page);
      await expect(field).toHaveValue("4");

      await field.fill(invalid);
      await page.getByRole("button", { name: "Lagre" }).click();

      await expect(page.getByText(FIELD_ERROR)).toBeVisible();
      await expect(yearsField(page)).toHaveAccessibleDescription(
        new RegExp(FIELD_ERROR.replace(/\./g, "\\.")),
      );
      await expect(yearsField(page)).toHaveAttribute("aria-invalid", "true");
      expect(await readSetting()).toEqual({ present: true, json: "4", type: "number" });
    });
  }

  const others = [
    { name: "leder", logInAs: logInAsManager },
    { name: "takstmann", logInAs: logInAsInspector },
  ];
  for (const [index, other] of others.entries()) {
    test(`E${4 + index} ${other.name} ser verken fanen eller siden`, async ({ page }) => {
      await writeSetting("4");
      await other.logInAs(page);
      await page.goto("/arbeidskoe");
      await expect(page.getByRole("link", { name: "KI", exact: true })).toHaveCount(0);

      await page.goto(URL);
      await expect(page.getByRole("heading", { name: "Ingen tilgang", level: 1 })).toBeVisible();
      await expect(page.getByLabel(LABEL)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Lagre" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "KI", exact: true })).toHaveCount(0);
      expect(await readSetting()).toEqual({ present: true, json: "4", type: "number" });
    });
  }

  test("E6 iPad: feltet og knappen kan brukes med berøring", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Bare iPad-størrelse");
    await writeSetting(null);
    await logIn(page);

    for (const viewport of [LANDSCAPE, PORTRAIT]) {
      await page.setViewportSize(viewport);
      await page.goto(URL);
      const field = yearsField(page);
      const button = page.getByRole("button", { name: "Lagre" });
      await expect(field).toBeVisible();
      await expect(button).toBeVisible();
      await expect(field).toHaveAttribute("inputmode", "numeric");

      const noHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      );
      expect(noHorizontalScroll).toBe(true);
      for (const element of [field, button]) {
        const box = await element.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      }
      const buttonBox = await button.boundingBox();
      expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
      const fieldBox = await field.boundingBox();
      expect(fieldBox!.height).toBeGreaterThanOrEqual(44);

      // Berøring: trykk i feltet, skriv og trykk «Lagre»
      await field.tap();
      await field.fill("2");
      await button.tap();
      await expect(page.getByRole("status").filter({ hasText: /lagret/i })).toBeVisible();
      expect(await readSetting()).toEqual({ present: true, json: "2", type: "number" });
      await writeSetting(null);
    }
  });
});
