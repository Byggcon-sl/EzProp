import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { FAKE_ERROR_INPUT } from "../src/core/ai/providers/fake";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn, logInAsOffice, uniqueSuffix } from "./helpers";

/*
 * Forslagsmønsteret på /prove/ki (docs/funksjoner/fase2a-forslagsmonster-testplan.md avsnitt 12).
 * Kjøres i prosjektene pc og ipad. Innlogging som prøvetakstmannen i prøveorganisasjonen (KI på
 * med den falske leverandøren, `pnpm db:seed:testoppdrag`). Hver test bruker en unik markør i
 * teksten og leser bare radene med den markøren, fordi e2e-databasen deles. All tekst er
 * oppdiktet.
 *
 * Støtter hovedmål: de ansatte (forslaget vises, ett trykk for å velge, angre virker, og egen
 * tekst går aldri tapt, heller ikke uten nett, på PC og iPad) og KI i bunnen («Ferdig når» for
 * 2a-1: forslaget vises, takstmannen godtar eller avviser, og loggen viser det).
 */

const PAGE = "/prove/ki";
const PORTRAIT = { width: 834, height: 1194 } as const;
const MISSING = "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med KI på)";

const TEXTS = {
  ask: "Foreslå bedre språk",
  heading: "Forslag fra KI",
  use: "Bruk",
  keep: "Behold min tekst",
  newSuggestion: "Nytt forslag",
  undo: "Angre",
  working: "KI jobber …",
  error: "KI svarte ikke. Prøv igjen.",
  aiOff: "KI er av.",
  offline: "Krever nett. Teksten din er lagret og kan skrives videre.",
  queued: "Venter på KI. Forslaget kommer når nettet er tilbake.",
  mark: "Tekst fra KI, godkjent",
  fixedLine:
    "Bruk oppdiktet tekst. Ikke skriv navn, adresse eller kundeopplysninger. Forslaget lagres i KI-loggen.",
  loggedAccepted: "Logget: godtatt",
  loggedRejected: "Logget: avvist",
  loggedSuggested: "Logget: forslag",
};

/** Organisasjonen uten KI for testplanen (egen, så den ikke deler data med andre tester). */
const NO_AI_ORGANIZATION = "Oppdiktet takst uten KI (testplan)";
const NO_AI_EMAIL = "uten.ki.testplan@example.invalid";
const NO_AI_NAME = "Oppdiktet takstmann uten KI";

function sqlClient() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

type Row = { id: string; status: string | null; outcome: string; decidedBy: string | null };

/** Radene i KI-loggen der forslaget inneholder markøren, eldste først. Bare lesing. */
async function rowsWithMarker(marker: string): Promise<Row[]> {
  const sql = sqlClient();
  try {
    return await sql<Row[]>`
      select id, status, outcome, decided_by as "decidedBy" from ai_usage_log
      where output_text like ${`%${marker}%`} order by created_at, id`;
  } finally {
    await sql.end();
  }
}

/** Linjene i `audit_log` for en rad i KI-loggen. Bare lesing. */
async function auditLines(entityId: string): Promise<{ changes: unknown }[]> {
  const sql = sqlClient();
  try {
    return await sql<{ changes: unknown }[]>`
      select changes from audit_log where entity_id = ${entityId} order by occurred_at, id`;
  } finally {
    await sql.end();
  }
}

/** Antall rader i KI-loggen for organisasjonen uten KI. */
async function noAiOrganizationRows(): Promise<number> {
  const sql = sqlClient();
  try {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from ai_usage_log l join organizations o on o.id = l.organization_id
      where o.name = ${NO_AI_ORGANIZATION}`;
    return row?.n ?? -1;
  } finally {
    await sql.end();
  }
}

/** Lager organisasjonen uten KI med én takstmann. Idempotent. Slår aldri KI på. */
async function ensureNoAiInspector(): Promise<void> {
  const sql = sqlClient();
  try {
    let [organization] = await sql<{ id: string }[]>`
      select id from organizations where name = ${NO_AI_ORGANIZATION} and deleted_at is null
      order by created_at limit 1`;
    if (!organization) {
      [organization] = await sql<{ id: string }[]>`
        insert into organizations (name, brand_name) values (${NO_AI_ORGANIZATION}, ${NO_AI_ORGANIZATION})
        returning id`;
    }
    await sql`
      insert into users (id, name, email, email_verified) values (${randomUUID()}, ${NO_AI_NAME}, ${NO_AI_EMAIL}, true)
      on conflict (email) do nothing`;
    const [user] = await sql<{ id: string }[]>`select id from users where email = ${NO_AI_EMAIL}`;
    let [employee] = await sql<{ id: string }[]>`
      select id from employees where user_id = ${user!.id} and organization_id = ${organization!.id}
        and deleted_at is null and deactivated_at is null`;
    if (!employee) {
      [employee] = await sql<{ id: string }[]>`
        insert into employees (organization_id, user_id, name) values (${organization!.id}, ${user!.id}, ${NO_AI_NAME})
        returning id`;
    }
    const roles = await sql`
      select id from employee_roles where employee_id = ${employee!.id}
        and role = 'inspector'::employee_role and deleted_at is null`;
    if (roles.length === 0) {
      await sql`
        insert into employee_roles (organization_id, employee_id, role)
        values (${organization!.id}, ${employee!.id}, 'inspector'::employee_role)`;
    }
  } finally {
    await sql.end();
  }
}

/** Den falske leverandørens språkvask: stor forbokstav og punktum til slutt. */
function polished(sentence: string): string {
  const trimmed = sentence.replace(/[ \t]+/g, " ").trim();
  const capitalized = trimmed.charAt(0).toLocaleUpperCase("nb-NO") + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

/** En oppdiktet setning med unik markør, liten forbokstav og uten punktum. */
function sentence(words = "taket er gammelt og har noen sprekker") {
  const marker = `tpm${uniqueSuffix()}`;
  return { marker, text: `${words} ${marker} i nord` };
}

const field = (page: Page) => page.getByLabel("Setning");
const askButton = (page: Page) => page.getByRole("button", { name: TEXTS.ask });
const card = (page: Page) => page.getByRole("region", { name: TEXTS.heading });
/** Nettstatusen på siden (`role="status"`), ikke menylenken «Testskjema uten nett». */
const networkStatus = (page: Page) =>
  page.getByRole("status").filter({ hasText: /^(På nett|Uten nett)/ });
/** Synlig tekst (ikke kopien i skjermleserlinjen, `sr-only`). */
const shown = (scope: Page | ReturnType<Page["locator"]>, text: string) =>
  scope.getByText(text, { exact: true }).locator(":scope:not(.sr-only)");
const cardButton = (page: Page, name: string) =>
  card(page).getByRole("button", { name, exact: true });

async function openPage(page: Page) {
  await page.goto(PAGE);
  await expect(askButton(page)).toBeVisible();
}

/** Skriv setningen og be om forslag. Venter til forslaget står i kortet. */
async function askFor(page: Page, text: string) {
  await field(page).fill(text);
  await askButton(page).click();
  await expect(card(page).getByText(polished(text), { exact: true })).toBeVisible();
}

async function onlyRow(marker: string): Promise<Row> {
  const rows = await rowsWithMarker(marker);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

test.beforeAll(async () => {
  const sql = sqlClient();
  try {
    const found = await sql<{ n: number }[]>`
      select count(*)::int as n from users u
      join employees e on e.user_id = u.id
      join organizations o on o.id = e.organization_id
      where u.email = ${SAMPLE_INSPECTOR.email.toLowerCase()} and o.settings->>'sampleData' = 'true'
        and o.settings->>'ai.enabled' = 'true' and e.deleted_at is null and e.deactivated_at is null`;
    if (found[0]?.n !== 1) throw new Error(MISSING);
  } finally {
    await sql.end();
  }
});

test.describe("prøvetakstmannen på /prove/ki", () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, SAMPLE_INSPECTOR.email);
    await openPage(page);
  });

  test("12.1 forslaget vises med egen tekst, merket «Forslag fra KI» og den faste linjen", async ({
    page,
  }) => {
    await expect(page.getByText(TEXTS.fixedLine)).toBeVisible();
    const { marker, text } = sentence();
    await askFor(page, text);

    await expect(card(page).getByText(text, { exact: true })).toBeVisible();
    await expect(card(page).getByText(TEXTS.heading, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(TEXTS.loggedSuggested)).toBeVisible();
    const row = await onlyRow(marker);
    expect(row.status).toBe("suggested");
  });

  test("12.2 «Bruk» bytter teksten, viser «Logget: godtatt» og KI-merket, og raden er accepted", async ({
    page,
  }) => {
    const { marker, text } = sentence();
    await askFor(page, text);
    await expect(card(page).getByText(TEXTS.mark)).toHaveCount(0);

    await cardButton(page, TEXTS.use).click();

    await expect(page.getByText(TEXTS.loggedAccepted)).toBeVisible();
    await expect(field(page)).toHaveValue(polished(text));
    await expect(page.getByText(TEXTS.mark)).toBeVisible();
    const row = await onlyRow(marker);
    expect(row.status).toBe("accepted");
    expect(row.decidedBy).not.toBeNull();
  });

  test("12.3 «Angre» etter «Bruk»: egen tekst tilbake, merket borte, raden suggested", async ({
    page,
  }) => {
    const { marker, text } = sentence();
    await askFor(page, text);
    await cardButton(page, TEXTS.use).click();
    await expect(page.getByText(TEXTS.loggedAccepted)).toBeVisible();

    await cardButton(page, TEXTS.undo).click();

    await expect(page.getByText(TEXTS.loggedSuggested)).toBeVisible();
    await expect(field(page)).toHaveValue(text);
    await expect(page.getByText(TEXTS.mark)).toHaveCount(0);
    const row = await onlyRow(marker);
    expect(row.status).toBe("suggested");
    expect(row.decidedBy).toBeNull();
  });

  test("12.4 «Behold min tekst»: egen tekst uendret, raden rejected; «Angre» gir suggested", async ({
    page,
  }) => {
    const { marker, text } = sentence();
    await askFor(page, text);

    await cardButton(page, TEXTS.keep).click();

    await expect(page.getByText(TEXTS.loggedRejected)).toBeVisible();
    await expect(field(page)).toHaveValue(text);
    expect((await onlyRow(marker)).status).toBe("rejected");

    await cardButton(page, TEXTS.undo).click();
    await expect(page.getByText(TEXTS.loggedSuggested)).toBeVisible();
    await expect(field(page)).toHaveValue(text);
    expect((await onlyRow(marker)).status).toBe("suggested");
  });

  test("12.5 «Nytt forslag» gir ny rad og avviser det gamle; med feil står det gamle forslaget igjen", async ({
    page,
  }) => {
    const { marker, text } = sentence();
    await askFor(page, text);
    const second = `veggen har fuktmerker ${marker} ved gulvet`;
    await field(page).fill(second);

    await cardButton(page, TEXTS.newSuggestion).click();

    await expect(card(page).getByText(polished(second), { exact: true })).toBeVisible();
    const rows = await rowsWithMarker(marker);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe("rejected");
    expect(rows[1]!.status).toBe("suggested");

    await field(page).fill(`taket ${marker} ${FAKE_ERROR_INPUT}`);
    await cardButton(page, TEXTS.newSuggestion).click();

    await expect(shown(card(page), TEXTS.error)).toBeVisible();
    await expect(card(page).getByText(polished(second), { exact: true })).toBeVisible();
    const after = await rowsWithMarker(marker);
    expect(after.map((row) => row.status)).toEqual(["rejected", "suggested"]);
  });

  test("12.6 feil fra KI: «KI svarte ikke. Prøv igjen.», egen tekst uendret", async ({ page }) => {
    const { text } = sentence();
    const withError = `${text} ${FAKE_ERROR_INPUT}`;
    await field(page).fill(withError);
    await askButton(page).click();

    await expect(shown(page, TEXTS.error)).toBeVisible();
    await expect(field(page)).toHaveValue(withError);
    await expect(cardButton(page, TEXTS.use)).toHaveCount(0);
  });

  // Endret med KI-køen (docs/funksjoner/fase2a-ki-ko.md, K5.4 og avsnitt 8): knappen er aktiv uten
  // nett og legger forespørselen i kø med «Venter på KI …» i stedet for «Krever nett …».
  test("12.8 og 12.13 uten nett: knappen legger i kø («Venter på KI …»), feltet kan skrives i, ingenting henger", async ({
    page,
    context,
  }) => {
    await expect(networkStatus(page)).toHaveText(/På nett/);
    const { marker, text } = sentence();
    await field(page).fill(text);

    await context.setOffline(true);

    await expect(networkStatus(page)).toHaveText(/Uten nett/);
    await expect(askButton(page)).toBeEnabled();
    await askButton(page).click();
    await expect(shown(page, TEXTS.queued).first()).toBeVisible();
    await expect(page.getByText(TEXTS.offline)).toHaveCount(0);
    await expect(cardButton(page, TEXTS.use)).toHaveCount(0);
    await field(page).fill(`${text} og mer tekst`);
    await expect(field(page)).toHaveValue(`${text} og mer tekst`);
    await expect(page.getByText(TEXTS.working)).toHaveCount(0, { timeout: 5_000 });
    expect(await rowsWithMarker(marker)).toHaveLength(0);

    await context.setOffline(false);
    await expect(networkStatus(page)).toHaveText(/På nett/);
    await expect(card(page).getByText(polished(text), { exact: true })).toBeVisible();
    await expect(field(page)).toHaveValue(`${text} og mer tekst`);
    await expect.poll(async () => (await rowsWithMarker(marker)).length).toBe(1);
  });

  test("12.9 nettet faller midt i et forslag: «Krever nett …», egen tekst uendret og ikke overskrevet", async ({
    page,
    context,
  }) => {
    const held: { abort: () => Promise<void> }[] = [];
    await page.route(`**${PAGE}`, async (route) => {
      if (route.request().method() === "POST") {
        held.push({ abort: () => route.abort() });
        return;
      }
      await route.continue();
    });
    const { marker, text } = sentence();
    await field(page).fill(text);
    await askButton(page).click();
    await expect(page.getByText(TEXTS.working)).toBeVisible();

    await context.setOffline(true);

    await expect(page.getByText(TEXTS.offline).first()).toBeVisible();
    await expect(page.getByText(TEXTS.working)).toHaveCount(0, { timeout: 5_000 });
    await expect(field(page)).toHaveValue(text);
    await expect(card(page).getByText(polished(text), { exact: true })).toHaveCount(0);

    await page.unroute(`**${PAGE}`);
    for (const request of held) await request.abort().catch(() => {});
    await context.setOffline(false);
    await expect(field(page)).toHaveValue(text);
    expect(await rowsWithMarker(marker)).toHaveLength(0);
  });

  test("12.10 dobbelttrykk på «Foreslå bedre språk» og «Bruk» gir én rad og én linje i audit_log", async ({
    page,
  }) => {
    const { marker, text } = sentence();
    await field(page).fill(text);

    await askButton(page).dblclick();
    await expect(card(page).getByText(polished(text), { exact: true })).toBeVisible();
    const row = await onlyRow(marker);

    await cardButton(page, TEXTS.use).dblclick();
    await expect(page.getByText(TEXTS.loggedAccepted)).toBeVisible();

    expect(await rowsWithMarker(marker)).toHaveLength(1);
    expect((await onlyRow(marker)).status).toBe("accepted");
    expect(await auditLines(row.id)).toHaveLength(1);
  });

  test("12.11 trykkflater på iPad: «Bruk» 56–72, de andre knappene minst 44", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare iPad");
    const { text } = sentence();
    await askFor(page, text);

    const use = await cardButton(page, TEXTS.use).boundingBox();
    expect(use!.height).toBeGreaterThanOrEqual(56);
    expect(use!.height).toBeLessThanOrEqual(72);
    for (const name of [TEXTS.keep, TEXTS.newSuggestion]) {
      const box = await cardButton(page, name).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
    }
    await cardButton(page, TEXTS.keep).click();
    await expect(page.getByText(TEXTS.loggedRejected)).toBeVisible();
    const undo = await cardButton(page, TEXTS.undo).boundingBox();
    expect(undo!.height).toBeGreaterThanOrEqual(44);
    const ask = await askButton(page).boundingBox();
    expect(ask!.height).toBeGreaterThanOrEqual(56);
  });

  test("12.12 liggende og PC: egen tekst og forslaget side om side", async ({ page }) => {
    const { text } = sentence();
    await askFor(page, text);
    const own = await card(page).getByText(text, { exact: true }).boundingBox();
    const suggestion = await card(page).getByText(polished(text), { exact: true }).boundingBox();
    expect(Math.abs(own!.y - suggestion!.y)).toBeLessThanOrEqual(4);
    expect(suggestion!.x).not.toBe(own!.x);
  });

  test("12.12 stående iPad: egen tekst og forslaget over hverandre", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare iPad");
    await page.setViewportSize(PORTRAIT);
    const { text } = sentence();
    await askFor(page, text);
    const own = await card(page).getByText(text, { exact: true }).boundingBox();
    const suggestion = await card(page).getByText(polished(text), { exact: true }).boundingBox();
    expect(suggestion!.y).toBeGreaterThan(own!.y + own!.height);
    // Knappene står fortsatt synlig nederst i kortet
    await expect(cardButton(page, TEXTS.use)).toBeInViewport({ ratio: 0.5 });
  });

  test("12.14 forslag med HTML vises som tekst, aldri som element", async ({ page }) => {
    const marker = `tpm${uniqueSuffix()}`;
    const text = `<b>fet</b> tekst ${marker}`;
    await askFor(page, text);
    await expect(card(page).locator("b")).toHaveCount(0);
    expect(await card(page).innerText()).toContain(`<b>fet</b> tekst ${marker}`);
  });
});

test.describe("KI er av og tilgang", () => {
  test("12.7 organisasjon uten KI: «KI er av.», ingen rad i KI-loggen", async ({ page }) => {
    await ensureNoAiInspector();
    const before = await noAiOrganizationRows();
    await logIn(page, NO_AI_EMAIL);
    await openPage(page);
    const { text } = sentence();
    await field(page).fill(text);
    await askButton(page).click();

    await expect(page.getByText(TEXTS.aiOff).first()).toBeVisible();
    await expect(askButton(page)).toBeDisabled();
    await expect(field(page)).toHaveValue(text);
    expect(await noAiOrganizationRows()).toBe(before);
  });

  test("12.15 kontor uten report.edit får «Ingen tilgang» og ingen knapp", async ({ page }) => {
    await logInAsOffice(page);
    await page.goto(PAGE);
    await expect(page.getByRole("heading", { name: "Ingen tilgang" })).toBeVisible();
    await expect(askButton(page)).toHaveCount(0);
  });

  test("12.15 admin kommer inn", async ({ page }) => {
    await logIn(page);
    await openPage(page);
    await expect(page.getByText(TEXTS.fixedLine)).toBeVisible();
  });
});
