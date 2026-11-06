import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import {
  SAMPLE_ASSIGNMENTS,
  SAMPLE_INSPECTOR,
  SAMPLE_ORGANIZATION_NAME,
} from "../src/db/seed/sample-assignments.data";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn } from "./helpers";

/*
 * Fire testoppdrag som grunndata (fase 2a).
 * Testplan: docs/funksjoner/fase2a-testoppdrag-testplan.md avsnitt 4. Kjører i prosjektene pc og
 * ipad. E2e kjører ikke seed-steget selv; CI og start.sh kjører `pnpm db:seed:testoppdrag`.
 *
 * Appen har ingen organisasjonsvelger (A135), så testen logger inn som prøvetakstmannen fra
 * datafilen, som bare er ansatt i prøveorganisasjonen. Alt innhold er oppdiktet (A132).
 *
 * Støtter hovedmål: tid (ferdige oppdrag til prøver og demoer, ingen inntasting) og reklamasjoner
 * (reglene prøves senere mot fire boligtyper).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);

const detached = SAMPLE_ASSIGNMENTS.find(
  (entry) => entry.externalRef === "sample:detached-garage",
)!;
const inProgress = SAMPLE_ASSIGNMENTS.filter((entry) => entry.status === "in_progress");

function statusTab(page: Page, label: string): Locator {
  return page
    .getByRole("navigation", { name: "Status" })
    .getByRole("link", { name: new RegExp(`^${label}`) });
}

function cards(page: Page): Locator {
  return page.getByTestId("work-queue-card");
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

test.beforeAll(async () => {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const refs = SAMPLE_ASSIGNMENTS.map((entry) => entry.externalRef);
    const rows = await sql<{ external_ref: string }[]>`
      select o.external_ref from orders o
      join organizations org on org.id = o.organization_id
      where org.name = ${SAMPLE_ORGANIZATION_NAME}
        and (org.settings ->> 'sampleData') = 'true'
        and o.external_ref in ${sql(refs)}`;
    const found = new Set(rows.map((row) => row.external_ref));
    if (refs.some((ref) => !found.has(ref))) {
      throw new Error("Kjør pnpm db:seed:testoppdrag først");
    }
  } finally {
    await sql.end();
  }
});

test.describe("testoppdragene (pc og ipad)", () => {
  test("arbeidskøen viser testoppdragene, og eneboligen har bolig og garasje", async ({ page }) => {
    await logIn(page, SAMPLE_INSPECTOR.email);

    await page.goto("/arbeidskoe?status=in_progress&mine=0");
    await expect(statusTab(page, "Under arbeid")).toHaveAttribute("aria-current", "page");
    for (const entry of inProgress) {
      await expect(cards(page).filter({ hasText: entry.property.address! })).toHaveCount(1);
    }
    await expectNoHorizontalScroll(page, "arbeidskøen");

    await statusTab(page, "Bestilt").click();
    await expect(statusTab(page, "Bestilt")).toHaveAttribute("aria-current", "page");
    const card = cards(page).filter({ hasText: detached.property.address! });
    await expect(card).toHaveCount(1);

    await card.getByRole("link").first().click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    const id = ASSIGNMENT_URL.exec(page.url())![1]!;

    await page.goto(`/oppdrag/${id}/bygninger`);
    for (const building of detached.buildings) {
      await expect(
        page.getByRole("region", { name: building.name, exact: true }).first(),
      ).toBeVisible();
    }
    await expectNoHorizontalScroll(page, "bygningssiden");
  });
});
