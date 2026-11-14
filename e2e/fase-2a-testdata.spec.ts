import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  e2eDatabaseUrl,
  logIn,
  logInAsInspector,
  logInAsManager,
  logInAsOffice,
  restoreByggconSetting,
  seedTestdataForE2e,
  setByggconSetting,
  testdataAssignments,
  testdataOpenOrderRefs,
  type E2eTestdataAssignment,
} from "./helpers";

/*
 * Testdata som ligner en ekte arbeidshverdag, i appen (fase 2a). Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 7. Kjører i prosjektene pc og
 * ipad.
 *
 * `beforeAll` kjører `pnpm db:seed:testdata` mot e2e-databasen (etter `assertLocalOrTestDatabase`,
 * og produksjonsvakten i skriptet med `APP_ENVIRONMENT=test`). Skriptet skriver ingenting andre
 * gang. De oppdiktede TD-ansatte kan ikke logge inn, så testen bruker e2e-brukerne med riktig
 * rolle i Byggcon. Antall rader sjekkes aldri som fast tall, fordi andre tester deler databasen.
 *
 * Støtter hovedmål: de ansatte (arbeidskøen, ordrelisten, reklamasjonene, statistikken og
 * bygningene har innhold med en gang, også på iPad uten nett) og færre reklamasjoner
 * (reklamasjonene er bare synlige for leder og admin).
 */

const STATUS_LABELS = {
  ordered: "Bestilt",
  in_progress: "Under arbeid",
  completed: "Ferdig",
  invoiced: "Fakturert",
} as const;
const SEARCH_LABEL = "Søk på adresse, nummer, megler eller gnr/bnr";

let all: E2eTestdataAssignment[] = [];

test.beforeAll(async () => {
  test.setTimeout(300_000);
  assertLocalOrTestDatabase(e2eDatabaseUrl(), process.env.TEST_DATABASE_URL);
  seedTestdataForE2e();
  all = await testdataAssignments();
  if (all.length < 40) throw new Error("For få TD-oppdrag etter pnpm db:seed:testdata");
});

function cards(page: Page): Locator {
  return page.getByTestId("work-queue-card");
}

function statusNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Status" });
}

function claimsSection(page: Page): Locator {
  return page.getByRole("region", { name: "Reklamasjoner", exact: true });
}

/** Køen for «Alle» i fanen, med søket. */
function queueUrl(status: string, query = ""): string {
  return `/arbeidskoe?status=${status}&mine=0&q=${encodeURIComponent(query)}`;
}

/** Mandag 00:00 og søndag 24:00 denne uken i norsk tid, som tidspunkter. */
function thisWeek(): { from: number; to: number } {
  const day = 86_400_000;
  const osloDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
  const weekday = new Date(`${osloDate}T12:00:00Z`).getUTCDay(); // 0 = søndag
  const monday = new Date(`${osloDate}T00:00:00Z`).getTime() - ((weekday + 6) % 7) * day;
  // Romslig med to timer i hver ende for sommertid og vintertid
  return { from: monday - 2 * 3_600_000, to: monday + 7 * day + 2 * 3_600_000 };
}

function withClaim(): E2eTestdataAssignment {
  const found = all.find((a) => a.claimId !== null);
  if (!found) throw new Error("Ingen TD-oppdrag med reklamasjon");
  return found;
}

test.describe("testdata i appen (pc og ipad)", () => {
  test("7.1 takstmann ser arbeidskøen med et TD-oppdrag med befaring denne uken", async ({
    page,
  }) => {
    const week = thisWeek();
    const target = all.find(
      (a) =>
        a.inspectionAt !== null &&
        a.inspectionAt.getTime() >= week.from &&
        a.inspectionAt.getTime() < week.to,
    );
    expect(target, "minst ett TD-oppdrag har befaring denne uken").toBeTruthy();
    await logInAsInspector(page);
    await page.goto(queueUrl(target!.status, target!.number));
    await expect(cards(page).filter({ hasText: target!.number })).toHaveCount(1);
    await expect(
      cards(page).filter({ hasText: target!.number }).getByRole("link", { name: target!.address }),
    ).toBeVisible();
  });

  test("7.2 kontor ser ordrelisten og alle fire statuser; statusfilteret gir bare valgt status", async ({
    page,
  }) => {
    await logInAsOffice(page);
    // Ordrelisten: en TD-ordre som ikke er gjort om, står som «Mottatt»
    const [open] = await testdataOpenOrderRefs();
    expect(open, "minst én TD-ordre er ikke gjort om").toBeTruthy();
    await page.goto(`/ordre?q=${encodeURIComponent(open!)}`);
    const row = page
      .getByRole("main")
      .getByRole("link")
      .filter({ hasText: `Ordrenr. ${open}` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Mottatt");
    // En TD-ordre som er gjort om, viser oppdragsnummeret
    const converted = all[0]!;
    await page.goto(`/ordre?q=${encodeURIComponent(converted.externalRef)}`);
    await expect(
      page.getByRole("main").getByRole("link").filter({ hasText: converted.number }),
    ).toHaveCount(1);

    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      const own = all.find((a) => a.status === status);
      const other = all.find((a) => a.status !== status);
      expect(own, `TD-oppdrag med status ${status}`).toBeTruthy();
      // Fanen har oppdraget med statusen
      await page.goto(queueUrl(status, own!.number));
      await expect(
        statusNav(page).getByRole("link", { name: new RegExp(`^${label}`) }),
      ).toHaveAttribute("aria-current", /page|true/);
      await expect(cards(page).filter({ hasText: own!.number })).toHaveCount(1);
      // … og ikke et oppdrag med en annen status
      await page.goto(queueUrl(status, other!.number));
      await expect(cards(page).filter({ hasText: other!.number })).toHaveCount(0);
    }
  });

  test("7.3 søket finner et TD-oppdrag på et etternavn fra datafila", async ({ page }) => {
    const target = all.find((a) => a.brokerLastName !== null);
    expect(target, "et TD-oppdrag med megler fra kontaktregisteret").toBeTruthy();
    await logInAsOffice(page);
    await page.goto(queueUrl(target!.status));
    await page.getByRole("searchbox", { name: SEARCH_LABEL }).fill(target!.brokerLastName!);
    await page.getByRole("button", { name: "Søk", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(target!.brokerLastName!)}`));
    await expect(cards(page).first()).toBeVisible();
    // Ordrelisten finner det samme
    await page.goto(`/ordre?q=${encodeURIComponent(target!.brokerLastName!)}`);
    await expect(page.getByRole("main").getByRole("link").first()).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("Ingen ordre passer søket.");
  });

  test("7.4 leder ser reklamasjonene på oppdraget og kan åpne saken", async ({ page }) => {
    const target = withClaim();
    await logInAsManager(page);
    await page.goto(`/oppdrag/${target.assignmentId}`);
    await expect(claimsSection(page)).toBeVisible();
    const link = claimsSection(page)
      .getByRole("link")
      .filter({ hasNotText: "Registrer reklamasjon" });
    await expect(link.first()).toBeVisible();
    await link.first().click();
    await expect(page).toHaveURL(new RegExp(`/oppdrag/${target.assignmentId}/reklamasjoner/`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fant ikke siden", level: 1 })).toHaveCount(0);
  });

  test("7.5 takstmann ser ikke reklamasjonsdelen, og direkte adresse gir ingen tilgang", async ({
    page,
  }) => {
    const target = withClaim();
    await logInAsInspector(page);
    await page.goto(`/oppdrag/${target.assignmentId}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(claimsSection(page)).toHaveCount(0);
    const response = await page.goto(
      `/oppdrag/${target.assignmentId}/reklamasjoner/${target.claimId}`,
    );
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Fant ikke siden", level: 1 })).toBeVisible();
  });

  test("7.6 admin ser reklamasjonene (admin stenges ikke ute)", async ({ page }) => {
    const target = withClaim();
    await logIn(page);
    await page.goto(`/oppdrag/${target.assignmentId}`);
    await expect(claimsSection(page)).toBeVisible();
    const response = await page.goto(
      `/oppdrag/${target.assignmentId}/reklamasjoner/${target.claimId}`,
    );
    expect(response?.status()).toBe(200);
  });

  test("7.7 tidsstatistikken viser tall for leder når tidsmåling er slått på av testen", async ({
    page,
  }) => {
    const previous = await setByggconSetting("time_tracking.enabled", true);
    try {
      await logInAsManager(page);
      const response = await page.goto("/statistikk/tid");
      expect(response?.status()).toBe(200);
      const table = page.getByRole("main").getByRole("table").first();
      await expect(table).toBeVisible();
      await expect(table.getByRole("cell").filter({ hasText: /[1-9]/ }).first()).toBeVisible();
    } finally {
      await restoreByggconSetting("time_tracking.enabled", previous);
    }
  });

  test("7.8 bygninger og rom viser etasjer, rom og areal for et befart TD-oppdrag", async ({
    page,
  }) => {
    const target = all.find((a) => a.buildingName && a.floorName && a.roomName);
    expect(target, "et befart TD-oppdrag med bygning, etasje og rom").toBeTruthy();
    await logIn(page);
    await page.goto(`/oppdrag/${target!.assignmentId}/bygninger`);
    const main = page.getByRole("main");
    await expect(main).toContainText(target!.buildingName!);
    await expect(main).toContainText(target!.floorName!);
    await expect(main).toContainText(target!.roomName!);
    await expect(main).toContainText(/\d+([,.]\d+)?\s*m²/);
  });

  test("7.9 uten nett (bare ipad): arbeidskøen viser TD-oppdragene etter én åpning med nett", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "Uten nett prøves i iPad-størrelse");
    await logIn(page);
    await page.goto("/arbeidskoe");
    await expect(cards(page).first()).toBeVisible();
    const numbers = await cards(page).allInnerTexts();
    const shown = all.filter((a) => numbers.some((text) => text.includes(a.number)));
    expect(shown.length, "TD-oppdrag i køen med nett").toBeGreaterThan(0);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Andre åpning med nett, når service workeren styrer siden, legger siden i hurtiglageret
    await page.reload();
    await expect(cards(page).first()).toBeVisible();
    try {
      await context.setOffline(true);
      await page.reload();
      await expect(cards(page).filter({ hasText: shown[0]!.number })).toHaveCount(1);
    } finally {
      await context.setOffline(false);
    }
  });

  for (const [name, path, login] of [
    ["arbeidskøen", "/arbeidskoe?status=in_progress&mine=0", logInAsOffice],
    ["ordrelisten", "/ordre", logInAsOffice],
  ] as const) {
    test(`7.10 tilgjengelighet: ${name} med full testdata har ingen alvorlige brudd`, async ({
      page,
    }) => {
      await login(page);
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      // Grunnleggende sjekk uten ny avhengighet: én h1, alle lenker og knapper har navn,
      // ingen doble id-er, alle bilder har alt-tekst og alle skjemafelt har etikett.
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const h1 = document.querySelectorAll("h1").length;
        if (h1 !== 1) out.push(`antall h1: ${h1}`);
        for (const el of Array.from(document.querySelectorAll("a[href], button"))) {
          const name =
            (el.getAttribute("aria-label") ?? "").trim() ||
            (el.textContent ?? "").trim() ||
            (el.getAttribute("title") ?? "").trim();
          const labelledBy = el.getAttribute("aria-labelledby");
          if (!name && !labelledBy) out.push(`uten navn: ${el.outerHTML.slice(0, 80)}`);
        }
        const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        if (dupes.length) out.push(`doble id-er: ${[...new Set(dupes)].join(", ")}`);
        for (const img of Array.from(document.querySelectorAll("img"))) {
          if (!img.hasAttribute("alt")) out.push("bilde uten alt");
        }
        for (const input of Array.from(
          document.querySelectorAll("input:not([type=hidden]), select, textarea"),
        )) {
          const id = input.getAttribute("id");
          const labelled =
            input.getAttribute("aria-label") ||
            input.getAttribute("aria-labelledby") ||
            input.closest("label") ||
            (id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
          if (!labelled) out.push(`felt uten etikett: ${input.outerHTML.slice(0, 80)}`);
        }
        return out;
      });
      expect(problems).toEqual([]);
    });
  }
});
