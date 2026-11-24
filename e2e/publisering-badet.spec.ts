import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn, uniqueSuffix } from "./helpers";

/*
 * Publisering av badet (fase 2a-2). Testplan: docs/funksjoner/fase2a-publisering-badet-testplan.md
 * avsnitt 6 (E1–E9), designet docs/funksjoner/fase2a-publisering-badet-design.md. Kjører i
 * prosjektene `pc` og `ipad` (liggende); stående prøves med `setViewportSize`.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag`, som har den publiserte badmalen. Hver
 * test lager sitt eget oppdrag med ett bad direkte mot databasen (oppdiktet, `uniqueSuffix()`):
 * selskap, befaringstid, startet rapport, TG1 på punktene som ikke er nevnt i `missingTg`, og
 * hulltaking med måling når `hole` er sann. Takstmannen får gyldig sertifisering.
 *
 * Støtter hovedmål: de ansatte (2 trykk uten mangler, 4 for én sperre), færre reklamasjoner
 * (sperren passeres bare med aktiv bryter og grunn, og kommer tilbake i ny versjon) og KI i bunnen
 * (KI-forslag behandles på siden; KI setter aldri TG og publiserer aldri).
 */

const MISSING_SAMPLE = "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med badmalen)";
const PORTRAIT = { width: 834, height: 1194 } as const;
const OFFICE_EMAIL = "kontor.publisering.e2e@example.invalid";
const MANAGER_EMAIL = "leder.publisering.e2e@example.invalid";
const REASON_MARKER = "Oppdiktet grunn 6TQ1 for kontroll";

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

type Bathroom = {
  organizationId: string;
  assignmentId: string;
  roomId: string;
  reportId: string;
  suffix: string;
};

/** En oppdiktet ansatt med én rolle i prøveorganisasjonen. Idempotent. */
async function ensureSampleStaff(email: string, name: string, role: "office" | "manager") {
  const db = sql();
  try {
    const organizationId = await sampleOrganizationId(db);
    await db`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, ${name}, ${email}, true)
      on conflict (email) do nothing`;
    const [user] = await db<{ id: string }[]>`select id from users where email = ${email}`;
    if (!user) throw new Error("Kunne ikke lage brukeren for e2e (publisering)");
    let [employee] = await db<{ id: string }[]>`
      select id from employees where user_id = ${user.id} and organization_id = ${organizationId}
        and deleted_at is null and deactivated_at is null`;
    if (!employee) {
      [employee] = await db<{ id: string }[]>`
        insert into employees (organization_id, user_id, name)
        values (${organizationId}, ${user.id}, ${name}) returning id`;
    }
    if (!employee) throw new Error("Kunne ikke lage den ansatte for e2e (publisering)");
    await db`
      insert into employee_roles (organization_id, employee_id, role)
      select ${organizationId}, ${employee.id}, ${role}::employee_role
      where not exists (
        select 1 from employee_roles where employee_id = ${employee.id}
          and role = ${role}::employee_role and deleted_at is null)`;
  } finally {
    await db.end();
  }
}

/** Gyldig sertifisering for takstmannen i prøveorganisasjonen. Idempotent. */
async function ensureCertification(db: postgres.Sql, organizationId: string, email: string) {
  const [employee] = await db<{ id: string }[]>`
    select e.id from employees e join users u on u.id = e.user_id
    where u.email = ${email} and e.organization_id = ${organizationId} and e.deleted_at is null
    limit 1`;
  if (!employee) throw new Error(MISSING_SAMPLE);
  await db`
    insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
    select ${organizationId}, ${employee.id}, 'condition_report',
      (now() at time zone 'Europe/Oslo')::date - 30, (now() at time zone 'Europe/Oslo')::date + 365
    where not exists (
      select 1 from certifications where employee_id = ${employee.id} and deleted_at is null
        and valid_to >= (now() at time zone 'Europe/Oslo')::date)`;
  return employee.id;
}

/**
 * Et oppdrag med ett bad og startet rapport. `missingTg` er punktene uten TG (sperren
 * `mandatory_without_tg`); uten `hole` er hulltaking ubesvart (sperren for hulltaking).
 */
async function createBathroom(
  options: { missingTg?: readonly string[]; hole?: boolean } = {},
): Promise<Bathroom> {
  const db = sql();
  const suffix = uniqueSuffix();
  try {
    const organizationId = await sampleOrganizationId(db);
    const [office] = await db<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    const [version] = await db<{ id: string }[]>`
      select v.id from template_versions v join template_families f on f.id = v.family_id
      where f.organization_id = ${organizationId} and f.kind = 'system'
        and f.report_type = 'condition_report' and v.status = 'published'
        and v.deleted_at is null and f.deleted_at is null
      order by v.version_number desc limit 1`;
    if (!office || !version) throw new Error(MISSING_SAMPLE);
    const employeeId = await ensureCertification(db, organizationId, SAMPLE_INSPECTOR.email);
    let [company] = await db<{ id: string }[]>`
      select id from companies where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!company) {
      [company] = await db<{ id: string }[]>`
        insert into companies (organization_id, name, legal_name)
        values (${organizationId}, 'Oppdiktet Takst AS', 'Oppdiktet Takst AS') returning id`;
    }
    const orderId = randomUUID();
    const assignmentId = randomUUID();
    const buildingId = randomUUID();
    const floorId = randomUUID();
    const roomId = randomUUID();
    const reportId = randomUUID();
    const address = `Publiseringsveien 1 ${suffix}, 8000 Bodø`;
    await db`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, valid_until)
      values (${orderId}, ${organizationId}, ${address}, now(), 'manual', 'received',
        'condition_report', (now() at time zone 'Europe/Oslo')::date + 30)`;
    await db`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, address_text, received_at, source, company_id, inspection_at)
      values (${assignmentId}, ${organizationId}, ${`E2E-PUB-${suffix}`}, ${office.id},
        'condition_report', 'in_progress', ${orderId}, ${address}, now(), 'manual',
        ${company!.id}, '2026-11-03T09:00:00Z')`;
    await db`
      insert into report_buildings (id, organization_id, assignment_id, name)
      values (${buildingId}, ${organizationId}, ${assignmentId}, 'Bolighus')`;
    await db`
      insert into floors (id, organization_id, report_building_id, name, level, below_ground)
      values (${floorId}, ${organizationId}, ${buildingId}, '1. etasje', 1, false)`;
    await db`
      insert into rooms (id, organization_id, floor_id, room_type, name, area_type, below_ground)
      values (${roomId}, ${organizationId}, ${floorId}, 'bathroom', ${`Bad E2E ${suffix}`},
        'bra_i', false)`;
    await db`
      insert into reports (id, organization_id, assignment_id, template_version_id, report_type,
        status, created_by)
      values (${reportId}, ${organizationId}, ${assignmentId}, ${version.id}, 'condition_report',
        'draft', ${employeeId})`;
    const withTg = CHECKPOINTS.filter((key) => !options.missingTg?.includes(key));
    await db`
      insert into checkpoint_results (id, organization_id, report_id, checkpoint_id, room_id,
        tg_direct, created_by)
      select gen_random_uuid(), ${organizationId}, ${reportId}, c.id, ${roomId}, '1', ${employeeId}
      from checkpoints c
      where c.version_id = ${version.id} and c.key = any(${withTg}) and c.deleted_at is null`;
    if (options.hole !== false) {
      const answers: [string, string[] | null, number | null][] = [
        ["wet_room.hole_drilling", ["done_no_findings"], null],
        ["wet_room.hole_moisture_unit", ["weight_percent"], null],
        ["wet_room.hole_moisture_reading", null, 10],
      ];
      for (const [key, options_, number] of answers) {
        await db`
          insert into field_answers (id, organization_id, report_id, element_id, room_id,
            repeat_index, value_option_keys, value_number, created_by)
          select gen_random_uuid(), ${organizationId}, ${reportId}, e.id, ${roomId}, 0,
            ${options_}, ${number}, ${employeeId}
          from template_elements e
          where e.version_id = ${version.id} and e.key = ${key} and e.deleted_at is null`;
      }
    }
    return { organizationId, assignmentId, roomId, reportId, suffix };
  } finally {
    await db.end();
  }
}

/** Tar bort TG på et punkt «i en annen fane» (rett i databasen). */
async function removeTg(bath: Bathroom, checkpointKey: string) {
  const db = sql();
  try {
    await db`
      update checkpoint_results cr set tg_direct = null, row_version = cr.row_version + 1
      from checkpoints c
      where cr.checkpoint_id = c.id and cr.report_id = ${bath.reportId}
        and c.key = ${checkpointKey}`;
  } finally {
    await db.end();
  }
}

/** Et ventende KI-forslag på beskrivelsen av punktet. Oppdiktet tekst. */
async function createPendingAiSuggestion(bath: Bathroom, text: string): Promise<string> {
  const db = sql();
  try {
    const [result] = await db<{ id: string }[]>`
      select cr.id from checkpoint_results cr join checkpoints c on c.id = cr.checkpoint_id
      where cr.report_id = ${bath.reportId} and c.key = 'wet_room.general'`;
    const [employee] = await db<{ id: string }[]>`
      select e.id from employees e join users u on u.id = e.user_id
      where u.email = ${SAMPLE_INSPECTOR.email} and e.organization_id = ${bath.organizationId}
      limit 1`;
    if (!result || !employee) throw new Error(MISSING_SAMPLE);
    const id = randomUUID();
    await db`
      insert into ai_usage_log (id, organization_id, employee_id, feature, provider, model,
        prompt_version, assignment_id, report_id, target_ref, source_fields, input_summary,
        outcome, output_text, status, retain_until)
      values (${id}, ${bath.organizationId}, ${employee.id}, 'language_polish', 'fake', 'fake-v1',
        'language_polish.v1', ${bath.assignmentId}, ${bath.reportId},
        ${db.json({ type: "checkpoint_result", id: result.id, fieldKey: "description_text" })},
        ${db.json(["text"])}, ${db.json({ text: 12 })}, 'ok', ${text}, 'suggested',
        now() + interval '10 years')`;
    return id;
  } finally {
    await db.end();
  }
}

async function aiStatus(id: string): Promise<string | null> {
  const db = sql();
  try {
    const [row] = await db<{ status: string | null }[]>`
      select status from ai_usage_log where id = ${id}`;
    return row?.status ?? null;
  } finally {
    await db.end();
  }
}

async function releaseCount(bath: Bathroom): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from report_releases where report_id = ${bath.reportId}`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

const publishUrl = (bath: Bathroom) => `/oppdrag/${bath.assignmentId}/publiser`;
const roomUrl = (bath: Bathroom) => `/oppdrag/${bath.assignmentId}/rom/${bath.roomId}`;

async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO" });
  return { context, page: await context.newPage() };
}

async function logInAsInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

function publishButton(page: Page): Locator {
  return page.locator("#publish-button");
}

function blockerCards(page: Page): Locator {
  return page.locator("article").filter({ hasText: /Må rettes|Krysset bort/ });
}

function blocker(page: Page, text: string | RegExp): Locator {
  return page.locator("article").filter({ has: page.getByRole("heading", { name: text }) });
}

/** Velger et valg i en gruppe med pilleknapper (trykk på pillen). */
async function choose(scope: Locator, group: string | RegExp, option: string | RegExp) {
  await scope
    .getByRole("group", { name: group })
    .locator("label")
    .filter({ hasText: option })
    .first()
    .click();
}

/**
 * Teller trykk i siden (E3). `pointerdown`, ikke `click`: et trykk på en pille gir også et klikk
 * på radioknappen bak etiketten.
 */
async function countTaps(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __taps?: number };
    w.__taps = 0;
    document.addEventListener("pointerdown", () => (w.__taps = (w.__taps ?? 0) + 1), true);
  });
}

/** Trykk på hovedknappen også når den er sperret (`aria-disabled`): trykket skal forklare. */
async function pressPublish(page: Page) {
  await publishButton(page).click({ force: true });
}

async function taps(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __taps?: number }).__taps ?? 0);
}

async function height(target: Locator): Promise<number> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
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

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling (${where})`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Holder igjen serverhandlingene på publiser-siden (lagring via «Rett nå»). */
async function holdActions(page: Page) {
  const held: (() => void)[] = [];
  let holding = true;
  await page.route(
    (url) => url.pathname.endsWith("/publiser"),
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
      if (holding) await new Promise<void>((resolve) => held.push(resolve));
      return route.continue();
    },
  );
  return {
    release: () => {
      holding = false;
      for (const next of held.splice(0)) next();
    },
  };
}

// --- E1 og E2: tellemerket, «Gå til» og tilbake -------------------------------------------

test("E1 tellemerket på rommet viser «2 må rettes» og oppdateres etter retting", async ({
  page,
}) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"], hole: false });
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const link = page.getByRole("link", { name: /^Se over og publiser\b/ });
  await expect(link).toContainText("2 må rettes");
  await expect(link).toHaveAccessibleName(/^Se over og publiser\s+2 må rettes/);

  await page.setViewportSize(PORTRAIT);
  await expect(link).toBeVisible();
  await expectNoHorizontalScroll(page, "rommet, iPad stående");

  // Retting på publiser-siden gir 1 igjen på rommet.
  await link.click();
  await expect(page).toHaveURL(/\/publiser$/);
  const card = blocker(page, "Punktet mangler TG.");
  await card.getByRole("button", { name: "Rett nå" }).click();
  await choose(card, "TG for punktet", /TG1/);
  await expect(page.getByText(/^Rettet: /)).toBeVisible();
  await page.goto(roomUrl(bath));
  await expect(page.getByRole("link", { name: /^Se over og publiser\b/ })).toContainText(
    "1 må rettes",
  );
});

test("E2 «Gå til» åpner punktet med fokus, og «Tilbake til publisering» gir oppdatert liste", async ({
  page,
}) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor", "wet_room.fixtures"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const first = blockerCards(page).first();
  // Grunnen valgt før «Gå til» står igjen etter retur (F3).
  const second = blockerCards(page).nth(1);
  await second.getByRole("switch", { name: /Publiser likevel/ }).click();
  await choose(second, "Hvorfor publiserer du likevel?", "Beskrevet et annet sted i rapporten");

  await first.getByRole("link", { name: /^Gå til/ }).click();
  await expect(page).toHaveURL(/\/rom\/.+fra=publiser/);
  await expect(page.locator("#checkpoint-heading")).toBeFocused();
  const back = page.getByRole("link", { name: "Tilbake til publisering (2 igjen)" });
  await expect(back).toBeVisible();
  await back.click();

  await expect(page).toHaveURL(/\/publiser$/);
  await expect(page.getByText(/^Listen er oppdatert\./)).toBeVisible();
  const kept = blockerCards(page).nth(1);
  await expect(kept.getByRole("switch", { name: /Publiser likevel/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    kept.getByRole("radio", { name: "Beskrevet et annet sted i rapporten" }),
  ).toBeChecked();
});

// --- E3: trykktall ------------------------------------------------------------------------

test("E3 uten mangler: publisert med 2 trykk", async ({ page }) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  await countTaps(page);
  await page.getByRole("link", { name: /^Se over og publiser\b/ }).click();
  await expect(publishButton(page)).toHaveText("Publiser versjon 1");
  await publishButton(page).click();
  await expect(page.locator("#publish-published")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  expect(await taps(page)).toBe(2);
  expect(await releaseCount(bath)).toBe(1);
});

test("E3 én sperre krysset bort med fast grunn: 4 trykk, ingen tekst", async ({ page }) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await countTaps(page);
  const card = blockerCards(page).first();
  await card.getByRole("switch", { name: /Publiser likevel/ }).click();
  await choose(card, "Hvorfor publiserer du likevel?", "Ikke tilgang eller nektet av eier");
  await expect(card.getByText("Krysset bort")).toBeVisible();
  await publishButton(page).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  // Tre trykk her + «Se over og publiser» på rommet = 4.
  expect(await taps(page)).toBe(3);
});

test("E3 én sperre rettet med «Rett nå»: 4 trykk", async ({ page }) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await countTaps(page);
  const card = blockerCards(page).first();
  await card.getByRole("button", { name: "Rett nå" }).click();
  const group = card.getByRole("group", { name: "TG for punktet" });
  // Ingen TG er forhåndsvalgt.
  await expect(group.getByRole("radio", { checked: true })).toHaveCount(0);
  await choose(card, "TG for punktet", /TG1/);
  await expect(page.getByText(/^Rettet: /)).toBeVisible();
  await expect(publishButton(page)).toHaveText("Publiser versjon 1");
  await publishButton(page).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  expect(await taps(page)).toBe(3);
});

// --- E4: sperret knapp ----------------------------------------------------------------------

test("E4 sperret knapp sier hvorfor, flytter fokus, og «Annet» krever tekst", async ({ page }) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"], hole: false });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await expect(page.locator("select")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const button = publishButton(page);
  await expect(button).toHaveText("Publiser (2 må rettes eller krysses bort)");
  await expect(button).toHaveAttribute("aria-disabled", "true");
  expect(await height(button)).toBeGreaterThanOrEqual(56);
  expect(await height(button)).toBeLessThanOrEqual(72);
  await pressPublish(page);
  await expect(blockerCards(page).first()).toBeFocused();

  const card = blockerCards(page).first();
  const toggle = card.getByRole("switch", { name: /Publiser likevel/ });
  expect(await height(toggle)).toBeGreaterThanOrEqual(44);
  await expect(card.locator("input[type=checkbox]")).toHaveCount(0);
  expect(await height(card.getByRole("link", { name: /^Gå til/ }))).toBeGreaterThanOrEqual(44);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await choose(card, "Hvorfor publiserer du likevel?", /^Annet$/);
  await expect(card.getByLabel("Skriv grunnen")).toBeFocused();
  // Den andre sperren er fortsatt åpen.
  await expect(button).toHaveText("Publiser (1 må rettes eller krysses bort)");
  const other = blockerCards(page).nth(1);
  await other.getByRole("switch", { name: /Publiser likevel/ }).click();
  await choose(other, "Hvorfor publiserer du likevel?", "Gjelder ikke dette rommet");
  await expect(button).toHaveText("Publiser (1 mangler grunn)");
  await pressPublish(page);
  await expect(card.getByLabel("Skriv grunnen")).toBeFocused();
  await expect(card.getByText("Skriv minst 10 tegn.")).toBeVisible();
  await card.getByLabel("Skriv grunnen").fill(REASON_MARKER);
  await expect(button).toHaveText("Publiser versjon 1");
});

// --- E5: etter publisering og ny versjon ----------------------------------------------------

test("E5 lesbar visning etter publisering, og ny versjon gir sperren tilbake", async ({ page }) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const card = blockerCards(page).first();
  await card.getByRole("switch", { name: /Publiser likevel/ }).click();
  await choose(card, "Hvorfor publiserer du likevel?", "Ikke tilgang eller nektet av eier");
  await publishButton(page).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  await expect(page.getByText(/1 sperre krysset bort/)).toBeVisible();

  await page.getByRole("link", { name: "Se badet" }).click();
  await expect(page.getByText("Publisert versjon 1")).toBeVisible();
  await expect(page.getByText("Rapporten er publisert. Lag ny versjon for å rette.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ferdig med punktet" })).toHaveCount(0);
  await expect(page.locator("main :is(input, textarea):enabled:not([type=hidden])")).toHaveCount(0);
  const newVersion = page.getByRole("button", { name: "Lag ny versjon" });
  await expect(newVersion).toHaveClass(/ring-slate-700/);
  await newVersion.click();
  await expect(page.getByText("Du retter versjon 2. Versjon 1 er uendret.")).toBeVisible();

  await page.goto(publishUrl(bath));
  const again = blockerCards(page).first();
  await expect(again).toContainText(
    "I versjon 1 krysset du bort dette: Ikke tilgang eller nektet av eier",
  );
  const toggle = again.getByRole("switch", { name: /Publiser likevel/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(publishButton(page)).toHaveText("Publiser (1 må rettes eller krysses bort)");
  await again.getByRole("button", { name: "Bruk samme begrunnelse" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(publishButton(page)).toHaveText("Publiser versjon 2");
});

// --- E6: «Utgivelser» -----------------------------------------------------------------------

test("E6 «Utgivelser»: leder ser begrunnelsen, kontor ser grunnen men ikke teksten", async ({
  page,
  browser,
}) => {
  await ensureSampleStaff(MANAGER_EMAIL, "Oppdiktet leder publisering", "manager");
  await ensureSampleStaff(OFFICE_EMAIL, "Oppdiktet kontor publisering", "office");
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const card = blockerCards(page).first();
  await card.getByRole("switch", { name: /Publiser likevel/ }).click();
  await choose(card, "Hvorfor publiserer du likevel?", /^Annet$/);
  await card.getByLabel("Skriv grunnen").fill(REASON_MARKER);
  await publishButton(page).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();

  const manager = await newPage(browser);
  await logIn(manager.page, MANAGER_EMAIL);
  await manager.page.goto(`/oppdrag/${bath.assignmentId}`);
  const releases = manager.page.getByRole("region", { name: "Utgivelser" });
  await releases.getByText("Versjon 1").click();
  await expect(releases).toContainText("Grunn: Annet");
  await expect(releases).toContainText(REASON_MARKER);

  await manager.context.close();

  const office = await newPage(browser);
  await logIn(office.page, OFFICE_EMAIL);
  await office.page.goto(`/oppdrag/${bath.assignmentId}`);
  const officeReleases = office.page.getByRole("region", { name: "Utgivelser" });
  await officeReleases.getByText("Versjon 1").click();
  await expect(officeReleases).toContainText("Grunn: Annet");
  await expect(officeReleases).toContainText("Begrunnelsen vises for takstmann, leder og admin.");
  expect(await office.page.content()).not.toContain(REASON_MARKER);
  await expect(officeReleases.getByRole("button", { name: "Lag ny versjon" })).toHaveCount(0);

  await office.page.goto(publishUrl(bath));
  await expect(office.page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  await office.context.close();
});

// --- E7: synk og nett -----------------------------------------------------------------------

test("E7 «Venter på synk» mens en retting lagres, og uten nett en tydelig melding", async ({
  page,
  context,
}) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const control = await holdActions(page);
  const card = blockerCards(page).first();
  await card.getByRole("button", { name: "Rett nå" }).click();
  await choose(card, "TG for punktet", /TG1/);
  await expect(page.locator("#publish-bar-status")).toHaveText("Venter på synk (1 endring)");
  await expect(publishButton(page)).toHaveAttribute("aria-disabled", "true");
  await pressPublish(page);
  await expect(page.locator("#publish-bar-status")).toBeFocused();
  control.release();
  await expect(page.getByText(/^Rettet: /)).toBeVisible();

  await context.setOffline(true);
  await expect(page.locator("#publish-bar-status")).toHaveText(
    "Publisering krever nett. Alt er lagret på enheten.",
  );
  await expect(page.getByRole("heading", { name: /^Må rettes eller krysses bort/ })).toBeVisible();
  await expect(publishButton(page)).toHaveAttribute("aria-disabled", "true");
  await context.setOffline(false);
  await expect(publishButton(page)).toHaveText("Publiser versjon 1");
});

// --- E8: universell utforming ----------------------------------------------------------------

test("E8 axe uten feil og hele flyten med tastatur", async ({ page }) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await expectNoAxeViolations(page, "publiser-siden med sperre");

  const card = blockerCards(page).first();
  const toggle = card.getByRole("switch", { name: /Publiser likevel/ });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Space");
  await expect(card.getByRole("radio").first()).toBeChecked();
  await expectNoAxeViolations(page, "grunnvalget åpent");

  await page.setViewportSize(PORTRAIT);
  await expectNoHorizontalScroll(page, "publiser-siden, iPad stående");
  await expectNoAxeViolations(page, "iPad stående");

  await publishButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  await expectNoAxeViolations(page, "etter publisering");
});

// --- E9: «Rett nå», KI og endret liste ------------------------------------------------------

test("E9 «Rett nå» for hulltaking fjerner sperren uten sideskifte", async ({ page }) => {
  const bath = await createBathroom({ hole: false });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const card = blocker(page, "Hulltaking er ikke besvart.");
  await card.getByRole("button", { name: "Rett nå" }).click();
  await choose(card, "Hulltaking", /ikke utført/i);
  const reasonCard = blocker(page, /grunnen mangler/);
  await expect(reasonCard).toBeVisible();
  await choose(reasonCard, "Grunn", /Eier/i);
  await expect(page.getByText(/^Rettet: Hulltaking er besvart\./)).toBeVisible();
  await expect(page).toHaveURL(/\/publiser$/);
});

test("E9 ventende KI-forslag kan godtas og avvises på siden", async ({ page }) => {
  const bath = await createBathroom();
  const used = await createPendingAiSuggestion(bath, "Oppdiktet KI-tekst som brukes.");
  const kept = await createPendingAiSuggestion(bath, "Oppdiktet KI-tekst som avvises.");
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await expect(page.getByRole("heading", { name: "Bør sees over (2)" })).toBeVisible();
  const cards = page.getByRole("listitem").filter({ hasText: "Forslag fra KI" });
  await cards
    .filter({ hasText: "som brukes" })
    .getByRole("button", { name: "Bruk", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Bør sees over (1)" })).toBeVisible();
  await cards
    .filter({ hasText: "som avvises" })
    .getByRole("button", { name: "Behold min tekst" })
    .click();
  await expect(page.getByRole("heading", { name: "Bør sees over (0)" })).toBeVisible();
  expect(await aiStatus(used)).toBe("accepted");
  expect(await aiStatus(kept)).toBe("rejected");
});

test("E9 endret liste: «Listen er oppdatert», grunnen står, og ny sperre merkes", async ({
  page,
}) => {
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const card = blockerCards(page).first();
  await card.getByRole("switch", { name: /Publiser likevel/ }).click();
  await choose(card, "Hvorfor publiserer du likevel?", /^Annet$/);
  await card.getByLabel("Skriv grunnen").fill(REASON_MARKER);

  await removeTg(bath, "wet_room.fixtures");
  await publishButton(page).click();
  await expect(page.getByText(/^Listen er oppdatert\. 1 ny sperre\./)).toBeVisible();
  await expect(
    page.getByText("Noe er endret siden du åpnet siden. Se over listen og trykk Publiser igjen."),
  ).toBeVisible();
  await expect(page.getByText("Ny siden du åpnet siden")).toHaveCount(1);
  await expect(blockerCards(page).first().getByLabel("Skriv grunnen")).toHaveValue(REASON_MARKER);
  expect(await releaseCount(bath)).toBe(0);
});

test("E9 melding om rett, og 404 for annen organisasjon", async ({ page, browser }) => {
  await ensureSampleStaff(OFFICE_EMAIL, "Oppdiktet kontor publisering", "office");
  const bath = await createBathroom({ missingTg: ["wet_room.floor"] });
  await logIn(page, OFFICE_EMAIL);
  await page.goto(publishUrl(bath));
  await expect(
    page
      .getByText(
        "Du kan se sjekken, men ikke publisere eller krysse bort. En takstmann publiserer.",
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(publishButton(page)).toHaveCount(0);
  await expect(blockerCards(page).first()).toContainText("Punktet mangler TG.");

  // Admin i Byggcon (en annen organisasjon) får «Fant ikke siden».
  const other = await newPage(browser);
  await logIn(other.page);
  const response = await other.page.goto(publishUrl(bath));
  expect(response?.status()).toBe(404);
  await other.context.close();
});
