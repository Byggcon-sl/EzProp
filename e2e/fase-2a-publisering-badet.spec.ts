import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, logIn, uniqueSuffix } from "./helpers";

/*
 * Publisering av badet (fase 2a-2). Testplan: docs/funksjoner/fase2a-publisering-badet-testplan.md
 * avsnitt 6 (E1–E12), designet docs/funksjoner/fase2a-publisering-badet-design.md. Kjører i
 * prosjektene `pc` og `ipad` (liggende 1194 × 834); stående prøves med `setViewportSize`.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag` (har den publiserte badmalen). Hver test
 * lager sitt eget oppdrag med ett bad, startet rapport og punkter direkte mot databasen (oppdiktet,
 * `uniqueSuffix()`), så testene ikke avhenger av hverandre. Prøvetakstmannen får en sertifisering
 * som gjelder lenge; leder, kontor og en takstmann med utløpt sertifisering er oppdiktede ansatte i
 * prøveorganisasjonen.
 *
 * Støtter hovedmål: de ansatte (2 trykk uten mangler, 4 med én sperre, «Gå til» og tilbake),
 * færre reklamasjoner (sperren kan bare krysses bort aktivt, og kommer tilbake i ny versjon) og
 * KI i bunnen (ingen TG er forhåndsvalgt; KI publiserer aldri).
 */

const MISSING_SAMPLE = "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med badmalen)";
const PORTRAIT = { width: 834, height: 1194 } as const;
const MANAGER = {
  email: "leder.publisering.e2e@example.invalid",
  name: "Oppdiktet leder publisering",
};
const OFFICE = {
  email: "kontor.publisering.e2e@example.invalid",
  name: "Oppdiktet kontor publisering",
};
const EXPIRED = {
  email: "takstmann.utlopt.e2e@example.invalid",
  name: "Oppdiktet takstmann utløpt",
};
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

/** En oppdiktet ansatt i prøveorganisasjonen med rollen. Idempotent. Gir ansatt-id. */
async function ensureSampleStaff(
  db: postgres.Sql,
  organizationId: string,
  person: { email: string; name: string },
  role: "inspector" | "manager" | "office" | "admin",
): Promise<string> {
  await db`
    insert into users (id, name, email, email_verified)
    values (${randomUUID()}, ${person.name}, ${person.email}, true)
    on conflict (email) do nothing`;
  const [user] = await db<{ id: string }[]>`select id from users where email = ${person.email}`;
  if (!user) throw new Error("Kunne ikke lage brukeren for e2e (publisering)");
  let [employee] = await db<{ id: string }[]>`
    select id from employees where user_id = ${user.id} and organization_id = ${organizationId}
      and deleted_at is null and deactivated_at is null`;
  if (!employee) {
    [employee] = await db<{ id: string }[]>`
      insert into employees (organization_id, user_id, name)
      values (${organizationId}, ${user.id}, ${person.name}) returning id`;
  }
  if (!employee) throw new Error("Kunne ikke lage den ansatte for e2e (publisering)");
  await db`
    insert into employee_roles (organization_id, employee_id, role)
    select ${organizationId}, ${employee.id}, ${role}::employee_role
    where not exists (
      select 1 from employee_roles where employee_id = ${employee.id}
        and role = ${role}::employee_role and deleted_at is null)`;
  return employee.id;
}

/** Sertifisering for den ansatte, bare når det ikke finnes en med samme sluttdato. */
async function ensureCertification(
  db: postgres.Sql,
  organizationId: string,
  employeeId: string,
  validTo: string,
) {
  await db`
    insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
    select ${organizationId}, ${employeeId}, 'condition_report', null, ${validTo}::date
    where not exists (
      select 1 from certifications where employee_id = ${employeeId}
        and valid_to = ${validTo}::date and deleted_at is null)`;
}

type Setup = {
  /** Hulltaking besvart med måling. */
  hole?: boolean;
  /** Punktene uten TG. */
  withoutTg?: string[];
  /** Befaringsdato. Standard sann. */
  inspectionDate?: boolean;
};

type Bathroom = {
  organizationId: string;
  assignmentId: string;
  reportId: string;
  roomId: string;
  suffix: string;
};

/**
 * Et oppdrag i prøveorganisasjonen med ett bad og startet rapport. Standard: alle åtte punktene har
 * TG1, hull er tatt med måling, befaringsdato og selskap er satt (ingen sperrer).
 */
async function createBathroom(setup: Setup = {}): Promise<Bathroom> {
  const db = sql();
  const suffix = uniqueSuffix();
  try {
    const organizationId = await sampleOrganizationId(db);
    const inspector = await ensureSampleStaff(
      db,
      organizationId,
      {
        email: SAMPLE_INSPECTOR.email,
        name: SAMPLE_INSPECTOR.name,
      },
      "inspector",
    );
    await ensureCertification(db, organizationId, inspector, "2099-12-31");
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
        'condition_report', 'in_progress', ${orderId}, ${address}, now(), 'manual', ${company!.id},
        ${setup.inspectionDate === false ? null : "2026-11-03T09:00:00Z"})`;
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
        status)
      values (${reportId}, ${organizationId}, ${assignmentId}, ${version.id}, 'condition_report',
        'draft')`;
    const without = new Set(setup.withoutTg ?? []);
    for (const key of CHECKPOINTS) {
      if (without.has(key)) continue;
      await db`
        insert into checkpoint_results (organization_id, report_id, checkpoint_id, room_id,
          tg_direct)
        select ${organizationId}, ${reportId}, c.id, ${roomId}, '1'
        from checkpoints c where c.version_id = ${version.id} and c.key = ${key}
          and c.deleted_at is null`;
    }
    if (setup.hole !== false) {
      const answers: [string, number | null, string[] | null][] = [
        ["wet_room.hole_drilling", null, ["done_no_findings"]],
        ["wet_room.hole_moisture_unit", null, ["weight_percent"]],
        ["wet_room.hole_moisture_reading", 10, null],
      ];
      for (const [key, number, options] of answers) {
        await db`
          insert into field_answers (organization_id, report_id, element_id, room_id,
            value_number, value_option_keys)
          select ${organizationId}, ${reportId}, e.id, ${roomId}, ${number}, ${options}
          from template_elements e where e.version_id = ${version.id} and e.key = ${key}
            and e.deleted_at is null`;
      }
    }
    return { organizationId, assignmentId, reportId, roomId, suffix };
  } finally {
    await db.end();
  }
}

async function overrideRows(reportId: string) {
  const db = sql();
  try {
    return await db<{ check_code: string; override_reason_code: string | null }[]>`
      select check_code, override_reason_code from publish_check_results
      where report_id = ${reportId} and overridden order by check_code`;
  } finally {
    await db.end();
  }
}

async function releaseCount(reportId: string): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count from report_releases where report_id = ${reportId}`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

async function staffInSample(person: { email: string; name: string }, role: "manager" | "office") {
  const db = sql();
  try {
    await ensureSampleStaff(db, await sampleOrganizationId(db), person, role);
  } finally {
    await db.end();
  }
}

async function expiredInspector() {
  const db = sql();
  try {
    const organizationId = await sampleOrganizationId(db);
    const id = await ensureSampleStaff(db, organizationId, EXPIRED, "inspector");
    await db`
      insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
      select ${organizationId}, ${id}, 'condition_report', '2024-11-01'::date, '2025-11-01'::date
      where not exists (select 1 from certifications where employee_id = ${id} and deleted_at is null)`;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

const publishUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}/publiser`;
const roomUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}/rom/${b.roomId}`;

async function logInAsInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

function mainButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Publiser\b/ });
}

function blockers(page: Page): Locator {
  return page
    .locator("section, div")
    .filter({ has: page.getByRole("heading", { name: /^Må rettes eller krysses bort/ }) })
    .last()
    .locator("article");
}

function overrideSwitch(scope: Locator): Locator {
  return scope.getByRole("switch", { name: /Publiser likevel/ });
}

/** Teller trykk i testen. */
function clicks() {
  let n = 0;
  return {
    async click(target: Locator) {
      n += 1;
      await target.click();
    },
    get count() {
      return n;
    },
  };
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

// --- Testene --------------------------------------------------------------------------------

test("E1 tellemerket på rommet viser «2 må rettes», også på iPad stående", async ({ page }) => {
  const bath = await createBathroom({ hole: false, withoutTg: ["wet_room.ventilation"] });
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const link = page.getByRole("link", { name: /^Se over og publiser/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleName(/2 må rettes/);
  await page.setViewportSize(PORTRAIT);
  await expect(link).toBeVisible();
  await expect(link).toContainText(/2 må rettes/);
  await expectNoHorizontalScroll(page, "rommet, stående");
});

test("E3 uten mangler: publisert med 2 trykk fra rommet", async ({ page }) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const counter = clicks();
  await counter.click(page.getByRole("link", { name: /^Se over og publiser/ }));
  await expect(page.getByRole("heading", { level: 1, name: "Se over og publiser" })).toBeVisible();
  await expect(page.getByText("Ingen sperrer.")).toBeVisible();
  await counter.click(page.getByRole("button", { name: "Publiser versjon 1" }));
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  expect(counter.count).toBe(2);
  expect(await releaseCount(bath.reportId)).toBe(1);
});

test("E3 én sperre krysset bort med fast grunn: 4 trykk og ingen tekst", async ({ page }) => {
  const bath = await createBathroom({ hole: false });
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const counter = clicks();
  await counter.click(page.getByRole("link", { name: /^Se over og publiser/ }));
  const blocker = blockers(page).first();
  await expect(blocker).toContainText("Hulltaking er ikke besvart.");
  await counter.click(overrideSwitch(blocker));
  await counter.click(
    blocker
      .getByRole("group", { name: "Hvorfor publiserer du likevel?" })
      .getByText("Ikke tilgang eller nektet av eier"),
  );
  await counter.click(page.getByRole("button", { name: "Publiser versjon 1" }));
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  expect(counter.count).toBe(4);
  expect(await overrideRows(bath.reportId)).toEqual([
    {
      check_code: "wet_or_below_ground_missing_hole",
      override_reason_code: "no_access_or_refused",
    },
  ]);
});

test("E3/E9 én sperre rettet med «Rett nå» (TG for punktet, ingen forhåndsvalgt): 4 trykk", async ({
  page,
}) => {
  const bath = await createBathroom({ withoutTg: ["wet_room.ventilation"] });
  await logInAsInspector(page);
  await page.goto(roomUrl(bath));
  const counter = clicks();
  await counter.click(page.getByRole("link", { name: /^Se over og publiser/ }));
  const blocker = blockers(page).first();
  await expect(blocker).toContainText("Punktet mangler TG.");
  await counter.click(blocker.getByRole("button", { name: "Rett nå" }));
  const group = blocker.getByRole("group", { name: "TG for punktet" });
  await expect(group).toBeVisible();
  // Ingen TG er forhåndsvalgt
  await expect(
    group.locator("input:checked, [aria-checked='true'], [aria-pressed='true']"),
  ).toHaveCount(0);
  await counter.click(group.getByText(/^TG ?1$/));
  await expect(page.getByRole("button", { name: "Publiser versjon 1" })).toBeVisible();
  await counter.click(page.getByRole("button", { name: "Publiser versjon 1" }));
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
  expect(counter.count).toBe(4);
  expect(await overrideRows(bath.reportId)).toEqual([]);
});

test("E4 sperret knapp sier hvorfor, flytter fokus, bryter (ikke avkrysningsboks), «Annet» krever tekst", async ({
  page,
}) => {
  const bath = await createBathroom({ hole: false, withoutTg: ["wet_room.ventilation"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const button = page.getByRole("button", { name: "Publiser (2 må rettes eller krysses bort)" });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await button.click();
  const first = blockers(page).first();
  await expect.poll(() => first.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(await releaseCount(bath.reportId)).toBe(0);

  const toggle = overrideSwitch(first);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await first.locator("input[type='checkbox']").count()).toBe(0);
  const row = first.locator("label, button").filter({ hasText: "Publiser likevel" }).first();
  expect(await height(row)).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Grunnene vises under funnet, ingen dialog og ingen nedtrekksmeny
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("select")).toHaveCount(0);
  await first
    .getByRole("group", { name: "Hvorfor publiserer du likevel?" })
    .getByText("Annet")
    .click();
  const text = first.getByRole("textbox", { name: /Skriv grunnen/ });
  await expect(text).toBeFocused();
  await text.fill("kort");
  await text.blur();
  await expect(first).toContainText("Skriv minst 10 tegn.");
  await expect(mainButton(page)).toHaveAttribute("aria-disabled", "true");
  expect(await releaseCount(bath.reportId)).toBe(0);
});

test("E5 etter publisering: lesbart bad, «Lag ny versjon» som sekundærknapp, sperren kommer tilbake", async ({
  page,
}) => {
  const bath = await createBathroom({ hole: false });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const blocker = blockers(page).first();
  await overrideSwitch(blocker).click();
  await blocker
    .getByRole("group", { name: "Hvorfor publiserer du likevel?" })
    .getByText("Ikke tilgang eller nektet av eier")
    .click();
  await page.getByRole("button", { name: "Publiser versjon 1" }).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();

  await page.goto(roomUrl(bath));
  await expect(page.getByText("Rapporten er publisert. Lag ny versjon for å rette.")).toBeVisible();
  const editable = page.locator(
    "main input:not([type='hidden']):not([disabled]):not([readonly]), main textarea:not([disabled]):not([readonly])",
  );
  await expect(editable).toHaveCount(0);
  const newVersion = page.getByRole("button", { name: "Lag ny versjon" });
  await expect(newVersion).toBeVisible();
  await newVersion.click();
  await expect(
    page.getByText(/Du retter versjon 2\. Versjon 1 er uendret\./).first(),
  ).toBeVisible();

  await page.goto(publishUrl(bath));
  const again = blockers(page).first();
  await expect(again).toContainText("I versjon 1 krysset du bort dette");
  await expect(overrideSwitch(again)).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: /^Publiser \(1 må rettes/ })).toBeVisible();
  await again.getByRole("button", { name: "Bruk samme begrunnelse" }).click();
  await expect(overrideSwitch(again)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Publiser versjon 2" })).toBeVisible();
});

test("E6 «Utgivelser»: leder ser begrunnelsen, kontor ser grunnen men ikke teksten", async ({
  page,
}) => {
  const bath = await createBathroom({ hole: false });
  const reasonText = `Oppdiktet grunn ${bath.suffix} med nok tegn`;
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const blocker = blockers(page).first();
  await overrideSwitch(blocker).click();
  await blocker
    .getByRole("group", { name: "Hvorfor publiserer du likevel?" })
    .getByText("Annet")
    .click();
  await blocker.getByRole("textbox", { name: /Skriv grunnen/ }).fill(reasonText);
  await page.getByRole("button", { name: "Publiser versjon 1" }).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();

  await staffInSample(MANAGER, "manager");
  await page.context().clearCookies();
  await logIn(page, MANAGER.email);
  await page.goto(`/oppdrag/${bath.assignmentId}`);
  const card = page
    .locator("section, div")
    .filter({
      has: page.getByRole("heading", { name: "Utgivelser" }),
    })
    .last();
  await expect(card).toBeVisible();
  await card.getByText("Versjon 1").first().click();
  await expect(card).toContainText(reasonText);

  await staffInSample(OFFICE, "office");
  await page.context().clearCookies();
  await logIn(page, OFFICE.email);
  await page.goto(`/oppdrag/${bath.assignmentId}`);
  await expect(page.getByRole("heading", { name: "Utgivelser" })).toBeVisible();
  await page.getByText("Versjon 1").first().click();
  await expect(page.getByText("Grunn: Annet").first()).toBeVisible();
  await expect(
    page.getByText("Begrunnelsen vises for takstmann, leder og admin.").first(),
  ).toBeVisible();
  expect(await page.content()).not.toContain(reasonText);
});

test("E7 uten nett: tydelig melding, listen vises og knappen er sperret", async ({
  page,
  context,
}) => {
  const bath = await createBathroom({ hole: false });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await expect(blockers(page).first()).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText("Publisering krever nett. Alt er lagret på enheten.")).toBeVisible();
  await expect(blockers(page).first()).toContainText("Hulltaking er ikke besvart.");
  await expect(mainButton(page)).toHaveAttribute("aria-disabled", "true");
  await context.setOffline(false);
  expect(await releaseCount(bath.reportId)).toBe(0);
});

test("E8 universell utforming: axe uten feil, knappehøyder, tastatur og ingen vannrett rulling", async ({
  page,
}) => {
  const bath = await createBathroom({ hole: false, withoutTg: ["wet_room.ventilation"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  await expect(blockers(page).first()).toBeVisible();
  await expectNoAxeViolations(page, "publiser-siden med sperrer");
  const main = mainButton(page);
  const mainHeight = await height(main);
  expect(mainHeight).toBeGreaterThanOrEqual(56);
  expect(mainHeight).toBeLessThanOrEqual(72);
  for (const goTo of await page.getByRole("link", { name: /^Gå til/ }).all()) {
    expect(await height(goTo)).toBeGreaterThanOrEqual(44);
  }

  // Tastatur: bryter med mellomrom, grunn med mellomrom eller Enter
  const first = blockers(page).first();
  await overrideSwitch(first).focus();
  await page.keyboard.press("Space");
  await expect(overrideSwitch(first)).toHaveAttribute("aria-checked", "true");
  await expectNoAxeViolations(page, "grunnvalget åpent");

  await page.setViewportSize(PORTRAIT);
  await expectNoHorizontalScroll(page, "publiser-siden, stående");
  await expectNoAxeViolations(page, "publiser-siden, stående");
});

test("E10 utløpt sertifisering: meldingen står øverst før klikk, og listen og «Gå til» virker", async ({
  page,
}) => {
  const bath = await createBathroom({ hole: false });
  await expiredInspector();
  await logIn(page, EXPIRED.email);
  await page.goto(publishUrl(bath));
  await expect(
    page.getByText(/^Du kan ikke publisere: sertifiseringen din gikk ut 01\.11\./),
  ).toBeVisible();
  await expect(blockers(page).first()).toContainText("Hulltaking er ikke besvart.");
  await expect(overrideSwitch(blockers(page).first())).toHaveCount(0);
  const goTo = blockers(page)
    .first()
    .getByRole("link", { name: /^Gå til/ });
  await goTo.click();
  await expect(page).toHaveURL(new RegExp(`/oppdrag/${bath.assignmentId}/rom/${bath.roomId}`));
  await expect(page.getByRole("link", { name: /Tilbake til publisering/ })).toBeVisible();
});

test("E2 «Gå til» og «Tilbake til publisering (N igjen)»", async ({ page }) => {
  const bath = await createBathroom({ hole: false, withoutTg: ["wet_room.ventilation"] });
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const target = blockers(page).filter({ hasText: "Punktet mangler TG." }).first();
  await target.getByRole("link", { name: /^Gå til/ }).click();
  await expect(page).toHaveURL(new RegExp(`/rom/${bath.roomId}`));
  const back = page.getByRole("link", { name: "Tilbake til publisering (2 igjen)" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/oppdrag/${bath.assignmentId}/publiser`));
  await expect(blockers(page)).toHaveCount(2);
});

test("E11 «Dette publiseres» viser TG per rom", async ({ page }) => {
  const bath = await createBathroom();
  await logInAsInspector(page);
  await page.goto(publishUrl(bath));
  const summary = page
    .locator("section, div")
    .filter({
      has: page.getByRole("heading", { name: "Dette publiseres" }),
    })
    .last();
  await expect(summary).toContainText(`Bad E2E ${bath.suffix}`);
  await expect(summary).toContainText("Versjon 1");
  await expect(summary).toContainText(/Gyldig til 03\.11\.2027/);
});

test("E12 404 for ukjent og ugyldig oppdrag", async ({ page }) => {
  await logInAsInspector(page);
  for (const id of [randomUUID(), "ikke-en-id"]) {
    const response = await page.goto(`/oppdrag/${id}/publiser`);
    expect(response?.status(), id).toBe(404);
  }
});
