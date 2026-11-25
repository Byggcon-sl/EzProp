import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import { inspectPdf } from "../tests/pdf-inspect";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn, uniqueSuffix } from "./helpers";
import { pdfTabBytes, waitForPdfTab } from "./pdf-tab";

/*
 * PDF-utkast av badet og «Åpne PDF» på utgivelsene (fase 2a-2). Kort:
 * docs/funksjoner/fase2a-pdf-badet.md (Skjermer, Omfang 6 og 6b, F4, F7). Testplan:
 * docs/funksjoner/fase2a-pdf-badet-testplan.md avsnitt 7, 10.2.5, 10.7.7 og 11.9. Kjører i
 * prosjektene `pc` og `ipad` (liggende 1194 × 834).
 *
 * Adressen, status og hoder leses fra forespørselen den nye fanen gjør, og bytene med `request.get`
 * mot samme adresse og samme økt, aldri fra fanens innhold (e2e/pdf-tab.ts: full Chromium viser
 * PDF-en i fanen, headless shell i CI laster den ned). Erstattet rapport prøves ikke her (runde 2: knappen kan ikke peke på
 * en erstattet rapport); 404 for den står i rutetesten.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag` (har den publiserte badmalen). Hver test
 * lager sitt eget oppdrag med ett bad og startet rapport direkte mot databasen (oppdiktet,
 * `uniqueSuffix()`). Alle punktene har TG1 og hull er tatt, så rapporten kan publiseres uten
 * sperrer.
 *
 * Støtter hovedmål: de ansatte (ett trykk gir PDF i ny fane, også på iPad; lenken fra utkastet
 * fører rett til punktet) og færre reklamasjoner (det som nettopp er skrevet, kommer med).
 */

const MISSING_SAMPLE = "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med badmalen)";
const DRAFT_NAME = /^Lag PDF \(utkast\)/;
const OFFLINE_TEXT = "Krever nett. PDF-en kan lages når du er på nett igjen.";
const PDF_TIME_LIMIT_MS = 5000;
const CHECKPOINTS = [
  "wet_room.general",
  "wet_room.documentation",
  "wet_room.walls_ceiling",
  "wet_room.floor",
  "wet_room.membrane_drain",
  "wet_room.fixtures",
  "wet_room.ventilation",
  "wet_room.adjacent",
] as const;

// --- Database (bare lokal database eller testdatabasen) -------------------------------------

function sql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

async function sampleOrganizationId(db: postgres.Sql): Promise<string> {
  const [row] = await db<{ id: string }[]>`
    select id from organizations
    where settings ->> 'sampleData' = 'true' and deleted_at is null
    order by created_at limit 1`;
  if (!row) throw new Error(MISSING_SAMPLE);
  return row.id;
}

/** Prøvetakstmannen med sertifisering som gjelder lenge (han publiserer i F7-testene). */
async function ensureSampleInspector(db: postgres.Sql, organizationId: string): Promise<void> {
  await db`
    insert into users (id, name, email, email_verified)
    values (${randomUUID()}, ${SAMPLE_INSPECTOR.name}, ${SAMPLE_INSPECTOR.email}, true)
    on conflict (email) do nothing`;
  const [user] = await db<{ id: string }[]>`
    select id from users where email = ${SAMPLE_INSPECTOR.email}`;
  if (!user) throw new Error("Kunne ikke lage brukeren for e2e (PDF)");
  let [employee] = await db<{ id: string }[]>`
    select id from employees where user_id = ${user.id} and organization_id = ${organizationId}
      and deleted_at is null and deactivated_at is null`;
  if (!employee) {
    [employee] = await db<{ id: string }[]>`
      insert into employees (organization_id, user_id, name)
      values (${organizationId}, ${user.id}, ${SAMPLE_INSPECTOR.name}) returning id`;
  }
  if (!employee) throw new Error("Kunne ikke lage den ansatte for e2e (PDF)");
  await db`
    insert into employee_roles (organization_id, employee_id, role)
    select ${organizationId}, ${employee.id}, 'inspector'::employee_role
    where not exists (
      select 1 from employee_roles where employee_id = ${employee.id}
        and role = 'inspector'::employee_role and deleted_at is null)`;
  await db`
    insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
    select ${organizationId}, ${employee.id}, 'condition_report', null, '2099-12-31'::date
    where not exists (
      select 1 from certifications where employee_id = ${employee.id}
        and valid_to = '2099-12-31'::date and deleted_at is null)`;
}

type Bathroom = {
  assignmentId: string;
  reportId: string;
  roomId: string;
  number: string;
  suffix: string;
};

/** Et oppdrag i prøveorganisasjonen med ett bad og startet rapport, uten sperrer. */
async function createBathroom(options: { report?: boolean } = {}): Promise<Bathroom> {
  const db = sql();
  const suffix = uniqueSuffix();
  try {
    const organizationId = await sampleOrganizationId(db);
    await ensureSampleInspector(db, organizationId);
    const [office] = await db<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!office) throw new Error(MISSING_SAMPLE);
    let [company] = await db<{ id: string }[]>`
      select id from companies where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!company) {
      [company] = await db<{ id: string }[]>`
        insert into companies (organization_id, legal_name)
        values (${organizationId}, 'Oppdiktet Prøvetakst AS') returning id`;
    }
    const [version] = await db<{ id: string }[]>`
      select v.id from template_versions v join template_families f on f.id = v.family_id
      where v.organization_id = ${organizationId} and v.status = 'published'
        and v.deleted_at is null and f.kind = 'system' and f.deleted_at is null
      order by v.version_number desc limit 1`;
    if (!version) throw new Error(MISSING_SAMPLE);

    const orderId = randomUUID();
    const assignmentId = randomUUID();
    const buildingId = randomUUID();
    const floorId = randomUUID();
    const roomId = randomUUID();
    const reportId = randomUUID();
    const number = `E2E-PDF-${suffix}`;
    const address = `Utkastveien 1 ${suffix}, 8000 Bodø`;
    await db`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, valid_until)
      values (${orderId}, ${organizationId}, ${address}, now(), 'manual', 'received',
        'condition_report', (now() at time zone 'Europe/Oslo')::date + 30)`;
    await db`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, address_text, received_at, source, company_id, inspection_at)
      values (${assignmentId}, ${organizationId}, ${number}, ${office.id},
        'condition_report', 'in_progress', ${orderId}, ${address}, now(), 'manual', ${company!.id},
        '2026-11-03T09:00:00Z')`;
    await db`
      insert into report_buildings (id, organization_id, assignment_id, name)
      values (${buildingId}, ${organizationId}, ${assignmentId}, 'Bolighus')`;
    await db`
      insert into floors (id, organization_id, report_building_id, name, level, below_ground)
      values (${floorId}, ${organizationId}, ${buildingId}, '1. etasje', 1, false)`;
    await db`
      insert into rooms (id, organization_id, floor_id, room_type, name, area_type, below_ground)
      values (${roomId}, ${organizationId}, ${floorId}, 'bathroom', ${`Bad PDF ${suffix}`},
        'bra_i', false)`;
    if (options.report !== false) {
      await db`
        insert into reports (id, organization_id, assignment_id, template_version_id,
          report_type, status)
        values (${reportId}, ${organizationId}, ${assignmentId}, ${version.id},
          'condition_report', 'draft')`;
      for (const key of CHECKPOINTS) {
        await db`
          insert into checkpoint_results (organization_id, report_id, checkpoint_id, room_id,
            tg_direct)
          select ${organizationId}, ${reportId}, c.id, ${roomId}, '1'
          from checkpoints c where c.version_id = ${version.id} and c.key = ${key}
            and c.deleted_at is null`;
      }
      const answers: [string, number | null, string[] | null][] = [
        ["wet_room.hole_drilling", null, ["done_no_findings"]],
        ["wet_room.hole_moisture_unit", null, ["weight_percent"]],
        ["wet_room.hole_moisture_reading", 10, null],
      ];
      for (const [key, value, optionKeys] of answers) {
        await db`
          insert into field_answers (organization_id, report_id, element_id, room_id,
            value_number, value_option_keys)
          select ${organizationId}, ${reportId}, e.id, ${roomId}, ${value}, ${optionKeys}
          from template_elements e where e.version_id = ${version.id} and e.key = ${key}
            and e.deleted_at is null`;
      }
    }
    return { assignmentId, reportId, roomId, number, suffix };
  } finally {
    await db.end();
  }
}

/** Id-en til kontrollpunktet i rapportens låste malversjon (ankeret `#punkt-<id>`). */
async function checkpointId(reportId: string, key: string): Promise<string> {
  const db = sql();
  try {
    const [row] = await db<{ id: string }[]>`
      select c.id from checkpoints c join reports r on r.template_version_id = c.version_id
      where r.id = ${reportId} and c.key = ${key} and c.deleted_at is null`;
    if (!row) throw new Error("Fant ikke kontrollpunktet");
    return row.id;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

const roomUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}/rom/${b.roomId}`;
const assignmentUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}`;
const draftUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}/pdf`;

function draftLink(page: Page): Locator {
  return page.getByRole("link", { name: DRAFT_NAME });
}

function draftButton(page: Page): Locator {
  return page.getByRole("button", { name: DRAFT_NAME });
}

function releaseControl(page: Page, version: number, role: "link" | "button" = "link"): Locator {
  return page.getByRole(role, { name: new RegExp(`^Åpne PDF av versjon ${version}\\b`) });
}

async function height(target: Locator): Promise<number> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling (${where})`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** axe-core fra pakken lint-oppsettet alt har (ingen ny avhengighet). */
function axeSource(): string {
  const fromRoot = createRequire(`${process.cwd()}/package.json`);
  const nextConfig = createRequire(fromRoot.resolve("eslint-config-next"));
  const jsxA11y = createRequire(nextConfig.resolve("eslint-plugin-jsx-a11y"));
  return jsxA11y.resolve("axe-core/axe.min.js");
}

async function expectNoAxeViolations(page: Page, where: string) {
  await page.addScriptTag({ path: axeSource() });
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            o: unknown,
          ) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }>;
        };
      }
    ).axe;
    const result = await axe.run({
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  });
  expect(violations, `axe uten feil (${where})`).toEqual([]);
}

async function logInAsInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

/** Publiserer badet fra publiser-siden (ingen sperrer) og står på kvitteringen. */
async function publish(page: Page, bath: Bathroom) {
  await page.goto(`/oppdrag/${bath.assignmentId}/publiser`);
  await page.getByRole("button", { name: "Publiser versjon 1" }).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
}

// --- Knappen og plasseringen ----------------------------------------------------------------

test("7.1 og 7.8 knappen på badet: sekundær, minst 44 pt, tekst og ikon, dekker ikke hovedknappene", async ({
  page,
}) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const link = draftLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("href", draftUrl(bath));
  await expect(link.locator("svg")).toHaveCount(1);
  expect(await height(link)).toBeGreaterThanOrEqual(44);
  // I toppen ved siden av fremdriften, ikke i hovedknappfeltet nederst
  const top = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(top.getByRole("link", { name: DRAFT_NAME })).toBeVisible();
  const done = page.locator("#checkpoint-done");
  await expect(done).toBeVisible();
  const a = (await link.boundingBox())!;
  const b = (await done.boundingBox())!;
  const overlap =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, "knappen dekker ikke «Ferdig med punktet»").toBe(false);
  await expectNoHorizontalScroll(page, "badet");
  await expectNoAxeViolations(page, "badet med PDF-knappen");
});

test("7.2 knappen på oppdraget når rapporten finnes, ikke uten rapport", async ({ page }) => {
  const bath = await createBathroom();
  const empty = await createBathroom({ report: false });
  await logInAsInspector(page);
  await page.goto(assignmentUrl(bath));
  const link = draftLink(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", draftUrl(bath));
  expect(await height(link)).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page, "oppdraget");
  await expectNoAxeViolations(page, "oppdraget med PDF-knappen");
  await page.goto(assignmentUrl(empty));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(empty.number);
  await expect(draftLink(page)).toHaveCount(0);
});

// --- Ett trykk gir PDF i ny fane ------------------------------------------------------------

test("7.3, 7.10 ett trykk: PDF i ny fane, under 5 sekunder, badet står igjen", async ({ page }) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const opened = waitForPdfTab(page, /\/oppdrag\/[^/]+\/pdf$/);
  const started = Date.now();
  await draftLink(page).click();
  const tab = await opened();
  // Tiden måles på svaret i fanen, før bytene hentes på nytt
  expect(Date.now() - started, "utkastet svarer på under 5 sekunder").toBeLessThan(
    PDF_TIME_LIMIT_MS,
  );
  expect(tab.path).toBe(draftUrl(bath));
  const bytes = await pdfTabBytes(page, tab);
  expect(tab.response.headers()["content-disposition"]).toMatch(
    /inline; filename="utkast-[0-9-]+\.pdf"/,
  );
  expect(inspectPdf(bytes).text).toContain("UTKAST");
  await expect(page).toHaveURL(new RegExp(`${roomUrl(bath)}`));
});

test("7.4 «Lager PDF …» er sperret med status for skjermleser, og borte etterpå", async ({
  page,
  context,
}) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route(`**${draftUrl(bath)}`, async (route) => {
    await held;
    await route.continue();
  });
  const popup = context.waitForEvent("page");
  await draftLink(page).click();
  const busy = page.getByRole("button", { name: /^Lager PDF …/ });
  await expect(busy).toBeVisible();
  await expect(busy).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Lager PDF-en." })).toHaveCount(1);
  release();
  await popup;
  await expect(draftLink(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("status").filter({ hasText: "Lager PDF-en." })).toHaveCount(0);
  await context.unroute(`**${draftUrl(bath)}`);
});

test("7.5 skriv i et felt og trykk straks: teksten står i PDF-en", async ({ page }) => {
  const bath = await createBathroom();
  const marker = `Merke ${bath.suffix.slice(-6).toUpperCase()}`;
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.fill(marker);
  const opened = waitForPdfTab(page, /\/oppdrag\/[^/]+\/pdf$/);
  // Før autolagringen (800 ms): knappen venter på lagringen og åpner fanen i samme trykk
  await draftLink(page).click();
  const tab = await opened();
  expect(tab.path).toBe(draftUrl(bath));
  const bytes = await pdfTabBytes(page, tab);
  expect(inspectPdf(bytes).text.replace(/\s+/g, " ")).toContain(marker);
});

// --- Utgivelsen (F7) ------------------------------------------------------------------------

test("10.2.5 «Åpne PDF» etter publisering og på utgivelsen: uten UTKAST, filnavn med versjon", async ({
  page,
}) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await publish(page, bath);

  const onReceipt = releaseControl(page, 1);
  await expect(onReceipt).toBeVisible();
  await expect(onReceipt).toHaveAttribute("target", "_blank");
  expect(await height(onReceipt)).toBeGreaterThanOrEqual(44);
  let opened = waitForPdfTab(page, /\/utgivelser\/[^/]+\/pdf$/);
  await onReceipt.click();
  let tab = await opened();
  expect(tab.path).toMatch(new RegExp(`^${assignmentUrl(bath)}/utgivelser/[0-9a-f-]{36}/pdf$`));
  let bytes = await pdfTabBytes(page, tab);
  expect(tab.response.headers()["content-disposition"]).toMatch(
    /filename="tilstandsrapport-[0-9-]+-v1\.pdf"/,
  );
  expect(inspectPdf(bytes).text).not.toContain("UTKAST");
  await expectNoAxeViolations(page, "kvitteringen med «Åpne PDF»");

  await page.goto(assignmentUrl(bath));
  const inCard = releaseControl(page, 1);
  await expect(inCard).toBeVisible();
  expect(await height(inCard)).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("PDF-en viser teksten og TG slik de ble publisert.")).toBeVisible();
  await expectNoHorizontalScroll(page, "utgivelseskortet");
  await expectNoAxeViolations(page, "utgivelseskortet med «Åpne PDF»");
  const firstPath = tab.path;
  opened = waitForPdfTab(page, /\/utgivelser\/[^/]+\/pdf$/);
  await inCard.click();
  tab = await opened();
  expect(tab.path).toBe(firstPath);
  bytes = await pdfTabBytes(page, tab);
  expect(tab.response.headers()["content-disposition"]).toMatch(/-v1\.pdf"/);
  expect(inspectPdf(bytes).text).not.toContain("UTKAST");
});

// --- Uten nett --------------------------------------------------------------------------------

test("7.6 og 10.7.7 uten nett: utkast og «Åpne PDF» sperret med samme tekst, synkstatus synes", async ({
  page,
  context,
}) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await publish(page, bath);
  await page.goto(assignmentUrl(bath));
  await expect(draftLink(page)).toBeVisible();
  await expect(releaseControl(page, 1)).toBeVisible();

  await context.setOffline(true);
  try {
    await expect(draftButton(page)).toBeDisabled();
    await expect(releaseControl(page, 1, "button")).toBeDisabled();
    await expect(draftLink(page)).toHaveCount(0);
    await expect(page.getByText(OFFLINE_TEXT)).toHaveCount(2);
    await expect(draftButton(page)).toHaveAccessibleDescription(OFFLINE_TEXT);
    await expect(releaseControl(page, 1, "button")).toHaveAccessibleDescription(OFFLINE_TEXT);
    await expect(page.getByText("Uten nett", { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page, "oppdraget uten nett");

    // Badet (lastet før nettet forsvant): samme sperre, og synkstatusen i toppen
    await context.setOffline(false);
    await page.goto(roomUrl(bath));
    await expect(draftLink(page)).toBeVisible();
    await context.setOffline(true);
    await expect(draftButton(page)).toBeDisabled();
    await expect(page.getByText(OFFLINE_TEXT)).toBeVisible();
    await expect(page.locator("[data-save-state=offline]").first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
  await expect(draftLink(page)).toBeVisible();
});

// --- Feil og metoder ------------------------------------------------------------------------

test("7.12 POST mot begge rutene gir 405 og ingen PDF", async ({ page }) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await publish(page, bath);
  const db = sql();
  let releaseId: string;
  try {
    const [row] = await db<{ id: string }[]>`
      select id from report_releases where report_id = ${bath.reportId} limit 1`;
    releaseId = row!.id;
  } finally {
    await db.end();
  }
  for (const url of [draftUrl(bath), `/oppdrag/${bath.assignmentId}/utgivelser/${releaseId}/pdf`]) {
    const response = await page.request.post(url, { maxRedirects: 0 });
    expect(response.status(), url).toBe(405);
    expect(response.headers()["content-type"] ?? "").not.toContain("application/pdf");
  }
});

// --- Lenkene fra utkastet (F4) --------------------------------------------------------------

test("7.11 lenken fra utkastet åpner punktet på badet", async ({ page }) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const response = await page.request.get(draftUrl(bath));
  expect(response.status()).toBe(200);
  const pdf = inspectPdf(new Uint8Array(await response.body()));
  const target = pdf.pages
    .flatMap((p) => p.links)
    .map((l) => l.uri)
    .find((uri) => uri !== null && /#punkt-[0-9a-f-]+$/.test(uri));
  expect(target, "utkastet har en lenke til et punkt").toBeTruthy();
  const url = new URL(target!);
  expect(url.pathname).toBe(roomUrl(bath));
  await page.goto(`${url.pathname}${url.hash}`);
  const anchor = page.locator(url.hash);
  await expect(anchor).toBeVisible();
  await expect(anchor.getByRole("heading", { level: 2 })).toBeFocused();
});

test("ankeret #punkt-<id> åpner riktig punkt, også når det ikke er det første", async ({
  page,
}) => {
  const bath = await createBathroom();
  const id = await checkpointId(bath.reportId, "wet_room.ventilation");
  await logInAsInspector(page);
  await page.goto(`${roomUrl(bath)}#punkt-${id}`);
  const anchor = page.locator(`[id="punkt-${id}"]`);
  await expect(anchor).toBeVisible();
  await expect(anchor.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(page).toHaveURL(/punkt=wet_room\.ventilation/);
  await expect(page).toHaveURL(new RegExp(`#punkt-${id}$`));
});
