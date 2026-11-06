import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_ASSIGNMENTS, SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import { brand } from "../src/shared/config/brand";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn } from "./helpers";

/*
 * De fire testoppdragene i appen (fase 2a). Testplan:
 * docs/funksjoner/fase2a-testoppdrag-testplan.md avsnitt 4. Kjører i prosjektene pc og ipad.
 *
 * Appen har ingen organisasjonsvelger, og admin lander i Byggcon (A135). Testen logger derfor inn
 * som prøvetakstmannen fra datafilen, som bare er ansatt i prøveorganisasjonen. Testen kjører ikke
 * seed-steget selv; CI og start.sh gjør det (`pnpm db:seed:testoppdrag`). Testen skriver ingenting
 * i databasen, den bare leser for å sjekke at testoppdragene finnes. Antall rader sjekkes aldri
 * som fast tall, fordi andre tester kan dele databasen.
 *
 * Støtter hovedmål: tid (testoppdragene er klare i arbeidskøen uten inntasting) og reklamasjoner
 * (de samme fire oppdragene hver gang, også på iPad).
 */

const SAMPLE_ORG = `${brand.companyName} prøve`;
const PORTRAIT = { width: 834, height: 1194 } as const;
const MISSING = "Kjør pnpm db:seed:testoppdrag først";

type Sample = {
  externalRef: string;
  status: string;
  property: { address: string };
  buildings: { name: string }[];
};
const samples = (SAMPLE_ASSIGNMENTS as readonly unknown[]).map((sample) => sample as Sample);
const detached = samples.find((sample) => sample.externalRef === "sample:detached-garage")!;
const inProgress = samples.filter((sample) => sample.status === "in_progress");

/** Oppdrags-id per external_ref i prøveorganisasjonen, satt i beforeAll. */
const assignmentIds = new Map<string, string>();

test.beforeAll(async () => {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const orgs = await sql<{ id: string }[]>`
      select id from organizations
      where name = ${SAMPLE_ORG} and settings->>'sampleData' = 'true' and deleted_at is null`;
    if (orgs.length !== 1) throw new Error(MISSING);
    const found = await sql<{ external_ref: string; assignment_id: string | null }[]>`
      select external_ref, assignment_id from orders
      where organization_id = ${orgs[0]!.id} and external_ref like 'sample:%'`;
    for (const sample of samples) {
      const row = found.find((entry) => entry.external_ref === sample.externalRef);
      if (!row?.assignment_id) throw new Error(MISSING);
      assignmentIds.set(sample.externalRef, row.assignment_id);
    }
    const [inspector] = await sql<{ n: number }[]>`
      select count(*)::int as n from users u
      join employees e on e.user_id = u.id
      where u.email = ${SAMPLE_INSPECTOR.email.toLowerCase()} and e.organization_id = ${orgs[0]!.id}
        and e.deleted_at is null and e.deactivated_at is null`;
    if (!inspector || inspector.n !== 1) throw new Error(MISSING);
  } finally {
    await sql.end();
  }
});

function statusNav(page: Page) {
  return page.getByRole("navigation", { name: "Status" });
}

function cards(page: Page) {
  return page.getByTestId("work-queue-card");
}

/** Køen for «Alle» i fanen, med søk på adressen (så andre testers data ikke forstyrrer). */
function queueUrl(status: string, query = ""): string {
  return `/arbeidskoe?status=${status}&mine=0&q=${encodeURIComponent(query)}`;
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling: ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

test.describe("testoppdragene (pc og ipad)", () => {
  test("4.2 arbeidskøen: eneboligen under «Bestilt», de tre andre under «Under arbeid»", async ({
    page,
  }) => {
    await logIn(page, SAMPLE_INSPECTOR.email);

    await page.goto(queueUrl("ordered"));
    await expect(statusNav(page).getByRole("link", { name: /^Bestilt/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      cards(page).filter({ hasText: detached.property.address }),
      "eneboligen i «Bestilt»",
    ).toHaveCount(1);
    for (const sample of inProgress) {
      await expect(cards(page).filter({ hasText: sample.property.address })).toHaveCount(0);
    }

    await page.goto(queueUrl("in_progress"));
    await expect(statusNav(page).getByRole("link", { name: /^Under arbeid/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const sample of inProgress) {
      await expect(
        cards(page).filter({ hasText: sample.property.address }),
        `${sample.externalRef} i «Under arbeid»`,
      ).toHaveCount(1);
    }
    await expect(cards(page).filter({ hasText: detached.property.address })).toHaveCount(0);
  });

  test("4.3 bygningene på eneboligen: bolig og garasje", async ({ page }) => {
    await logIn(page, SAMPLE_INSPECTOR.email);
    await page.goto(queueUrl("ordered", detached.property.address));
    await cards(page)
      .filter({ hasText: detached.property.address })
      .getByRole("link", { name: detached.property.address })
      .click();
    const id = assignmentIds.get(detached.externalRef)!;
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${id}$`));

    await page.goto(`/oppdrag/${id}/bygninger`);
    const main = page.getByRole("main");
    expect(detached.buildings).toHaveLength(2);
    for (const building of detached.buildings) {
      await expect(
        main.getByRole("heading", { name: building.name, exact: true }),
        `bygningen ${building.name}`,
      ).toBeVisible();
    }
    expect(detached.buildings.some((building) => /bolig/i.test(building.name))).toBe(true);
    expect(detached.buildings.some((building) => /garasje/i.test(building.name))).toBe(true);
  });

  test("4.4 iPad stående: ingen vannrett rulling i arbeidskøen og på bygningssiden", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare iPad");
    await logIn(page, SAMPLE_INSPECTOR.email);
    await page.setViewportSize(PORTRAIT);

    await page.goto(queueUrl("in_progress"));
    await expect(cards(page).first()).toBeVisible();
    await expectNoHorizontalScroll(page, "arbeidskøen");

    await page.goto(`/oppdrag/${assignmentIds.get(detached.externalRef)!}/bygninger`);
    await expect(
      page
        .getByRole("main")
        .getByRole("heading", { name: detached.buildings[0]!.name, exact: true }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page, "bygningssiden");
  });
});
