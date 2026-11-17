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
import {
  e2eDatabaseUrl,
  ensureSampleOrgEmployee,
  logIn,
  SAMPLE_ADMIN_ONLY_EMAIL,
  uniqueSuffix,
} from "./helpers";

/*
 * Badet på PC (fase 2a-2). Testplan: docs/funksjoner/fase2a-badet-pc-testplan.md avsnitt 6
 * (B6.1–B6.17), designet docs/funksjoner/fase2a-badet-pc-design.md. Kjører i prosjektene `pc` og
 * `ipad` (liggende 1194 × 834); stående prøves med `setViewportSize` i egne tester.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag`, som har den publiserte badmalen.
 * Hver test lager sitt eget oppdrag med ett våtrom («Bad E2E …») og ett soverom direkte mot
 * databasen (oppdiktet, `uniqueSuffix()`), så testene ikke avhenger av hverandre. Kontoret er en
 * oppdiktet ansatt med rollen `office` i prøveorganisasjonen.
 *
 * Tilgjengelighet: axe-core kjøres i siden fra pakken som alt følger med lint-oppsettet
 * (`eslint-plugin-jsx-a11y`), så ingen ny avhengighet.
 *
 * Støtter hovedmål: de ansatte (to trykk fra forslag til avvik, ingen tekst går tapt), færre
 * reklamasjoner (TG, årsak, konsekvens, tiltak og kostnad som faste felt; advarsler som ikke
 * sperrer) og KI i bunnen (regelforslag merkes aldri som KI; KI setter aldri TG).
 */

const MISSING_SAMPLE = "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med badmalen)";
const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;
const OFFICE_EMAIL = "kontor.badet.e2e@example.invalid";
const OFFICE_NAME = "Oppdiktet kontor badet";
const MEMBRANE = "wet_room.membrane_drain";
const ADJACENT = "wet_room.adjacent";
const FLOOR = "wet_room.floor";

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

type Bathroom = { assignmentId: string; roomId: string; bedroomId: string; suffix: string };

/** Et oppdrag i prøveorganisasjonen med ett bad og ett soverom. Oppdiktet. */
async function createBathroomAssignment(): Promise<Bathroom> {
  const db = sql();
  const suffix = uniqueSuffix();
  try {
    const organizationId = await sampleOrganizationId(db);
    const [office] = await db<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!office) throw new Error(MISSING_SAMPLE);
    const orderId = randomUUID();
    const assignmentId = randomUUID();
    const buildingId = randomUUID();
    const floorId = randomUUID();
    const roomId = randomUUID();
    const bedroomId = randomUUID();
    const address = `Badeveien 1 ${suffix}, 8000 Bodø`;
    await db`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, valid_until)
      values (${orderId}, ${organizationId}, ${address}, now(), 'manual', 'received',
        'condition_report', (now() at time zone 'Europe/Oslo')::date + 30)`;
    await db`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, address_text, received_at, source)
      values (${assignmentId}, ${organizationId}, ${`E2E-BAD-${suffix}`}, ${office.id},
        'condition_report', 'in_progress', ${orderId}, ${address}, now(), 'manual')`;
    await db`
      insert into report_buildings (id, organization_id, assignment_id, name)
      values (${buildingId}, ${organizationId}, ${assignmentId}, 'Bolighus')`;
    await db`
      insert into floors (id, organization_id, report_building_id, name, level, below_ground)
      values (${floorId}, ${organizationId}, ${buildingId}, '1. etasje', 1, false)`;
    await db`
      insert into rooms (id, organization_id, floor_id, room_type, name, area_type, below_ground)
      values (${roomId}, ${organizationId}, ${floorId}, 'bathroom', ${`Bad E2E ${suffix}`},
        'bra_i', false),
        (${bedroomId}, ${organizationId}, ${floorId}, 'bedroom', ${`Soverom E2E ${suffix}`},
        'bra_i', false)`;
    return { assignmentId, roomId, bedroomId, suffix };
  } finally {
    await db.end();
  }
}

/** Den oppdiktede kontoransatte i prøveorganisasjonen. Idempotent. */
async function ensureSampleOffice(): Promise<void> {
  const db = sql();
  try {
    const organizationId = await sampleOrganizationId(db);
    await db`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, ${OFFICE_NAME}, ${OFFICE_EMAIL}, true)
      on conflict (email) do nothing`;
    const [user] = await db<{ id: string }[]>`select id from users where email = ${OFFICE_EMAIL}`;
    if (!user) throw new Error("Kunne ikke lage kontoret for e2e (badet)");
    let [employee] = await db<{ id: string }[]>`
      select id from employees where user_id = ${user.id} and organization_id = ${organizationId}
        and deleted_at is null and deactivated_at is null`;
    if (!employee) {
      [employee] = await db<{ id: string }[]>`
        insert into employees (organization_id, user_id, name)
        values (${organizationId}, ${user.id}, ${OFFICE_NAME}) returning id`;
    }
    if (!employee) throw new Error("Kunne ikke lage kontoret for e2e (badet)");
    await db`
      insert into employee_roles (organization_id, employee_id, role)
      select ${organizationId}, ${employee.id}, 'office'::employee_role
      where not exists (
        select 1 from employee_roles where employee_id = ${employee.id}
          and role = 'office'::employee_role and deleted_at is null)`;
  } finally {
    await db.end();
  }
}

/** `access.inspectors_edit_all` i prøveorganisasjonen. Gir verdien som sto der før. */
async function setSampleInspectorsEditAll(value: boolean | null): Promise<boolean | null> {
  const db = sql();
  try {
    const organizationId = await sampleOrganizationId(db);
    const [row] = await db<{ previous: boolean | null }[]>`
      select (settings ->> 'access.inspectors_edit_all')::boolean as previous
      from organizations where id = ${organizationId}`;
    if (value === null) {
      await db`update organizations set settings = settings - 'access.inspectors_edit_all'
        where id = ${organizationId}`;
    } else {
      await db`update organizations
        set settings = settings || jsonb_build_object('access.inspectors_edit_all', ${value}::boolean)
        where id = ${organizationId}`;
    }
    return row?.previous ?? null;
  } finally {
    await db.end();
  }
}

type DecisionRow = {
  decision: string;
  override_reason_code: string | null;
  deviation_id: string | null;
};

async function decisions(assignmentId: string): Promise<DecisionRow[]> {
  const db = sql();
  try {
    return await db<DecisionRow[]>`
      select d.decision, d.override_reason_code, d.deviation_id
      from rule_suggestion_decisions d join reports r on r.id = d.report_id
      where r.assignment_id = ${assignmentId} and d.deleted_at is null
      order by d.decided_at`;
  } finally {
    await db.end();
  }
}

async function doneCount(assignmentId: string): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count
      from checkpoint_results c join reports r on r.id = c.report_id
      where r.assignment_id = ${assignmentId} and c.done and c.deleted_at is null`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

async function deviationCount(assignmentId: string): Promise<number> {
  const db = sql();
  try {
    const [row] = await db<{ count: number }[]>`
      select count(*)::int as count
      from deviations d join reports r on r.id = d.report_id
      where r.assignment_id = ${assignmentId} and d.deleted_at is null`;
    return row?.count ?? 0;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

function roomUrl(bath: Bathroom, punkt?: string): string {
  const base = `/oppdrag/${bath.assignmentId}/rom/${bath.roomId}`;
  return punkt ? `${base}?punkt=${encodeURIComponent(punkt)}` : base;
}

async function logInAsInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

/** Åpner badet og starter rapporten når den ikke finnes. */
async function openBathroom(page: Page, bath: Bathroom, punkt?: string) {
  await page.goto(roomUrl(bath, punkt));
  const start = page.getByRole("button", { name: "Start rapporten" });
  const list = checkpointHeading(page);
  await expect(start.or(list).first()).toBeVisible();
  if (await start.isVisible()) {
    await start.click();
    await expect(list).toBeVisible();
  }
}

function checkpointHeading(page: Page): Locator {
  return page
    .getByRole("heading", { level: 2 })
    .filter({ hasNotText: /^Badet$/ })
    .first();
}

function liveRegion(page: Page): Locator {
  return page.locator('main [role="status"][aria-live="polite"].sr-only');
}

function totalSaveState(page: Page): Locator {
  return page.locator("header [role='status'][data-save-state]");
}

function suggestion(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Forslag fra reglene" }) })
    .first();
}

function deviationCard(page: Page, n: number): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: new RegExp(`^Avvik ${n}\\b`) }) })
    .first();
}

/** Velger et valg i en gruppe med pilleknapper (trykk på pillen). */
async function choose(page: Page, group: string, option: string | RegExp, scope?: Locator) {
  const root = scope ?? page;
  await root
    .getByRole("group", { name: group, exact: true })
    .locator("label")
    .filter({ hasText: option })
    .first()
    .click();
}

async function openCheckpoint(page: Page, name: string) {
  const portrait = (page.viewportSize()?.width ?? 1200) < 1024;
  if (portrait) {
    await page.getByRole("button", { name: /^Punkter \(\d+ av \d+\)$/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Kontrollpunkter" })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  }
  await expect(page.getByRole("heading", { level: 2, name })).toBeFocused();
}

/** Sjikt 1990 og folie: gir TG3-forslaget «før 2000». */
async function fillMembrane1990(page: Page) {
  await choose(page, "Vanntett sjikt", /^Folie$/);
  const year = page.getByLabel("Årstall for det vanntette sjiktet");
  await year.fill("1990");
  await year.blur();
  await expect(suggestion(page)).toContainText("TG3");
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

async function height(target: Locator): Promise<number> {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
}

/** Vannrett avstand mellom to knapper, eller loddrett når de står på hver sin linje. */
async function gap(a: Locator, b: Locator): Promise<number> {
  const [ba, bb] = [await a.boundingBox(), await b.boundingBox()];
  expect(ba && bb).toBeTruthy();
  const horizontal = Math.max(bb!.x - (ba!.x + ba!.width), ba!.x - (bb!.x + bb!.width));
  const vertical = Math.max(bb!.y - (ba!.y + ba!.height), ba!.y - (bb!.y + bb!.height));
  return Math.max(horizontal, vertical);
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

/** Holder igjen eller stopper lagringskallene (server actions er POST til siden). */
async function controlActions(page: Page, mode: { current: "pass" | "abort" | "hold" }) {
  const held: (() => Promise<void>)[] = [];
  await page.route(
    (url) => url.pathname.includes("/rom/"),
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
      if (mode.current === "abort") return route.abort();
      if (mode.current === "hold") {
        await new Promise<void>((resolve) => held.push(async () => resolve()));
      }
      return route.continue();
    },
  );
  return {
    release: async () => {
      mode.current = "pass";
      for (const next of held.splice(0)) await next();
    },
  };
}

test.beforeEach(async () => {
  await ensureSampleOffice();
});

// --- B6.1 hovedflyt -----------------------------------------------------------------------

test("B6.1 hovedflyt: «Fyll ut badet», forslag TG3, Godta, intervall og Ferdig", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);

  await page.goto(`/oppdrag/${bath.assignmentId}/bygninger`);
  const bathRow = page.getByRole("listitem", { name: `Bad E2E ${bath.suffix}` });
  const bedRow = page.getByRole("listitem", { name: `Soverom E2E ${bath.suffix}` });
  await expect(bathRow.getByRole("link", { name: "Fyll ut badet" })).toBeVisible();
  await expect(bedRow.getByRole("link", { name: /badet/ })).toHaveCount(0);
  await bathRow.getByRole("link", { name: "Fyll ut badet" }).click();

  await page.getByRole("button", { name: "Start rapporten" }).click();
  await expect(page.getByText("0 av 8 ferdig").first()).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Kontrollpunkter" }).getByRole("listitem"),
  ).toHaveCount(8);

  await openCheckpoint(page, "Vanntett sjikt, membran og sluk");
  await fillMembrane1990(page);
  const card = suggestion(page);
  await expect(card).toContainText("Hvorfor:");
  await expect(card).toContainText(/Befaringsår \d{4}/);
  await expect(card).not.toContainText("KI");

  await card.getByRole("button", { name: "Godta", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(liveRegion(page)).toHaveText("Avvik lagt til, TG3");
  const deviation = deviationCard(page, 1);
  await expect(deviation.getByLabel("Avvik", { exact: true })).not.toHaveValue("");
  await choose(page, "Kostnad", /^20\s000–100\s000$/, deviation);
  await expect(deviation.getByText("Lagret").first()).toBeVisible();

  await page.getByRole("button", { name: "Ferdig med punktet" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Sanitærutstyr og innredning" }),
  ).toBeFocused();
  await expect(page.getByText("1 av 8 ferdig").first()).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Kontrollpunkter" })
      .getByRole("link", { name: /^Vanntett sjikt/ })
      .getByRole("img", { name: "TG3 Store eller alvorlige avvik" }),
  ).toBeVisible();
  expect(await decisions(bath.assignmentId)).toMatchObject([{ decision: "accepted" }]);

  await page.reload();
  await expect(page.getByText("1 av 8 ferdig").first()).toBeVisible();
  await openCheckpoint(page, "Vanntett sjikt, membran og sluk");
  await expect(deviationCard(page, 1)).toBeVisible();
});

// --- B6.2 Endre og Avvis med ett trykk ------------------------------------------------------

test("B6.2 Endre og Avvis: grunn med ett trykk, «Annet» krever tekst, Avvis står unna Godta", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  const card = suggestion(page);

  const accept = card.getByRole("button", { name: "Godta", exact: true });
  const change = card.getByRole("button", { name: "Endre", exact: true });
  const reject = card.getByRole("button", { name: "Avvis", exact: true });
  expect(await gap(change, reject)).toBeGreaterThanOrEqual(48);
  expect(await gap(accept, reject)).toBeGreaterThanOrEqual(48);
  expect(await height(accept)).toBeGreaterThanOrEqual(56);

  await change.click();
  await choose(page, "Velg TG", /^TG2$/, card);
  const save = card.getByRole("button", { name: "Lagre endringen" });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(card.getByText("Velg en grunn for å lagre.")).toBeVisible();
  await expect(card.locator("select")).toHaveCount(0);
  await choose(page, "Hvorfor endrer du?", "Annet", card);
  await save.click();
  expect(await decisions(bath.assignmentId)).toEqual([]);
  await card.getByLabel("Skriv grunnen").fill("Oppdiktet grunn for endring");
  await choose(page, "Hvorfor endrer du?", "Synlig skade", card);
  await save.click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  await expect(suggestion(page)).toContainText("Endret: forslag TG3, du valgte TG2.");
  await expect(suggestion(page).getByRole("link", { name: "Gå til avvik 1" })).toBeVisible();
  expect(await decisions(bath.assignmentId)).toMatchObject([
    { decision: "changed", override_reason_code: "visible_damage" },
  ]);
  expect((await decisions(bath.assignmentId))[0]?.deviation_id).not.toBeNull();

  // Avvis på et nytt bad lager aldri avvik.
  const other = await createBathroomAssignment();
  await openBathroom(page, other, MEMBRANE);
  await fillMembrane1990(page);
  await suggestion(page).getByRole("button", { name: "Avvis", exact: true }).click();
  const confirm = suggestion(page).getByRole("button", { name: "Avvis forslaget" });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await choose(
    page,
    "Hvorfor avviser du forslaget?",
    "Dokumentasjon er lagt fram",
    suggestion(page),
  );
  await confirm.click();
  await expect(suggestion(page)).toContainText("Avvist:");
  expect(await decisions(other.assignmentId)).toMatchObject([
    { decision: "rejected", override_reason_code: "documentation_present", deviation_id: null },
  ]);
  expect(await deviationCount(other.assignmentId)).toBe(0);
});

// --- B6.3 bør/må ---------------------------------------------------------------------------

test("B6.3 bør og må: forhøyet fukt med TG2 gir «bør», TG3 gir «må»", async ({ page }) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, ADJACENT);
  await choose(page, "Hulltaking", "Utført med funn");
  await choose(page, "Enhet for fuktmålingen", "Vekt-%");
  const reading = page.getByLabel("Fuktmåling i hullet");
  await reading.fill("15");
  await reading.blur();
  await expect(suggestion(page)).toContainText("TG2 eller TG3");
  await suggestion(page).getByRole("button", { name: "Godta som TG2" }).click();
  const deviation = deviationCard(page, 1);
  await expect(deviation.getByLabel("Tiltak 1")).toHaveValue(/ bør /);
  await choose(page, "TG", /^TG3$/, deviation);
  await expect(deviation.getByLabel("Tiltak 1")).toHaveValue(/ må /);
});

// --- B6.4 TGIU ------------------------------------------------------------------------------

test("B6.4 TGIU: hull ikke utført og eier nektet gir forslag, Godta og advarsel til alt er fylt ut", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, ADJACENT);
  await choose(page, "Hulltaking", "Ikke utført");
  await choose(page, "Hvorfor hull ikke er tatt", "Eier ga ikke samtykke");
  await expect(suggestion(page)).toContainText("Sett TGIU på punktet");
  await suggestion(page).getByRole("button", { name: "Godta", exact: true }).click();
  await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toBeFocused();
  await expect(liveRegion(page)).toHaveText("TGIU satt på punktet");
  const review = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Å se over/ }) });
  await expect(review).toContainText("Fyll ut dette for TGIU");
  await expect(review).toContainText("eier er informert");

  const fill = async (label: string, text: string) => {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(text);
    await field.blur();
  };
  await fill(
    "Hva er ikke undersøkt, og hvorfor?",
    "Oppdiktet: hull ble ikke tatt i veggen mot gangen.",
  );
  await fill("Risiko", "Oppdiktet: skjult fukt kan gi råte.");
  await fill("Hva må til for å undersøke?", "Oppdiktet: hulltaking med samtykke.");
  await fill("Annen fuktkontroll", "Oppdiktet: overflatemåling.");
  await fill("Resultat av annen fuktkontroll", "Oppdiktet: ingen utslag.");
  await choose(page, "Skadeutsatt konstruksjon", "Ja");
  await page.getByLabel("Eier er informert om utvidet ansvar").check();
  await expect(review).not.toContainText("Fyll ut dette for TGIU");
});

// --- B6.5 T-0059 og hulltaking ---------------------------------------------------------------

test("B6.5 T-0059: «uten funn» med 15 gir advarsel med «Endre til utført med funn»; Ferdig sperres ikke", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, ADJACENT);
  await choose(page, "Hulltaking", "Utført uten funn");
  await choose(page, "Enhet for fuktmålingen", "Vekt-%");
  const reading = page.getByLabel("Fuktmåling i hullet");
  await reading.fill("15");
  await reading.blur();
  const warning = page.getByText(/Målingen er på eller over grensen/);
  await expect(warning).toBeVisible();
  await page.getByRole("button", { name: "Endre til utført med funn" }).click();
  await expect(warning).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Hulltaking" }).getByRole("radio", { name: "Utført med funn" }),
  ).toBeChecked();

  // TG1 på tilliggende konstruksjoner med hull ikke utført gir advarsel, men Ferdig virker.
  await choose(page, "Hulltaking", "Ikke utført");
  await choose(page, "TG uten avvik", /^TG1$/);
  await expect(page.getByText("Hulltaking er ikke utført. Punktet bør ha TGIU.")).toBeVisible();
  await page.getByRole("button", { name: "Ferdig med punktet" }).click();
  await expect.poll(() => doneCount(bath.assignmentId)).toBe(1);
});

// --- B6.6 kostnad ---------------------------------------------------------------------------

test("B6.6 kostnad: 37 500 gir advarsel mens man skriver, 40 000 ikke, 0 gir feil, fem intervaller", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  await suggestion(page).getByRole("button", { name: "Godta", exact: true }).click();
  const deviation = deviationCard(page, 1);
  const group = deviation.getByRole("group", { name: "Kostnad" });
  for (const band of [
    /^Under 20\s000$/,
    /^20\s000–100\s000$/,
    /^100\s000–200\s000$/,
    /^200\s000–500\s000$/,
    /^Over 500\s000$/,
  ]) {
    await choose(page, "Kostnad", band, deviation);
    await expect(group.getByRole("radio", { name: band })).toBeChecked();
  }
  await choose(page, "Kostnad", "Eget beløp", deviation);
  const amount = deviation.getByLabel("Eget beløp");
  await expect(amount).toBeFocused();
  await amount.pressSequentially("37500");
  await expect(
    deviation.getByText(/Beløpet er ikke rundet til nærmeste 10\s000\. Nærmeste er 40\s000\./),
  ).toBeVisible();
  await amount.fill("40000");
  await expect(deviation.getByText(/ikke rundet/)).toHaveCount(0);
  await amount.fill("0");
  await expect(deviation.getByText("Skriv et helt beløp over 0.")).toBeVisible();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
});

// --- B6.7 lagringsfeil ---------------------------------------------------------------------

test("B6.7 lagringsfeil: «Ikke lagret – prøv igjen», teksten står, og lagres når feilen er borte", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  const mode = { current: "abort" as "pass" | "abort" | "hold" };
  const control = await controlActions(page, mode);
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.fill("Oppdiktet beskrivelse som ikke ble lagret");
  await description.blur();
  await expect(page.getByText("Ikke lagret – prøv igjen").first()).toBeVisible();
  await expect(totalSaveState(page)).toContainText("1 felt er ikke lagret – prøv igjen");
  await expect(description).toHaveValue("Oppdiktet beskrivelse som ikke ble lagret");
  await control.release();
  await page.getByRole("button", { name: "Prøv igjen" }).first().click();
  await expect(totalSaveState(page)).toContainText("Alt er lagret");
});

// --- B6.8 uten nett -------------------------------------------------------------------------

test("B6.8 uten nett: teksten står, lagres når nettet er tilbake, ingen rapportdata lokalt", async ({
  page,
  context,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await context.setOffline(true);
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.fill("Oppdiktet tekst skrevet uten nett");
  await description.blur();
  await expect(totalSaveState(page)).toContainText(
    "Uten nett – endringene dine er ikke lagret ennå",
  );
  await context.setOffline(false);
  await expect(totalSaveState(page)).toContainText("Alt er lagret");
  const local = await page.evaluate(async () => ({
    storage: Object.keys(localStorage).filter((k) => /rapport|report|badet|deviation/i.test(k)),
    databases: (await indexedDB.databases()).map((d) => d.name ?? ""),
  }));
  expect(local.storage).toEqual([]);
  expect(local.databases.filter((name) => /report|rapport/i.test(name))).toEqual([]);
});

test("B6.8a punktbytte uten nett: siden lastes ikke på nytt, og teksten står og lagres", async ({
  page,
  context,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
  await context.setOffline(true);
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.fill("Oppdiktet tekst før punktbytte");
  await openCheckpoint(page, "Sanitærutstyr og innredning");
  await expect(page).toHaveURL(/\?punkt=wet_room\.fixtures$/);
  await openCheckpoint(page, "Vanntett sjikt, membran og sluk");
  await expect(page.getByLabel("Beskrivelse av punktet (valgfri)")).toHaveValue(
    "Oppdiktet tekst før punktbytte",
  );
  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  await context.setOffline(false);
  await expect(totalSaveState(page)).toContainText("Alt er lagret");
});

const SWITCHES: { name: string; pcOnly?: boolean; run(page: Page): Promise<void> }[] = [
  { name: "listen", run: (page) => openCheckpoint(page, "Ventilasjon") },
  {
    name: "Neste punkt",
    run: async (page) => {
      await page.setViewportSize(PORTRAIT);
      await page.getByRole("button", { name: "Neste punkt" }).click();
    },
  },
  {
    name: "Ferdig",
    run: (page) => page.getByRole("button", { name: "Ferdig med punktet" }).click(),
  },
  {
    name: "søketreff på annet punkt",
    run: async (page) => {
      await page.getByRole("button", { name: "+ Avvik" }).click();
      await page.getByLabel("Søk etter avvik i badet").fill("ventilasjon");
      await page
        .getByRole("button", { name: /· Ventilasjon$/ })
        .first()
        .click();
    },
  },
  {
    name: "Alt+pil ned",
    pcOnly: true,
    run: async (page) => {
      await page.getByRole("heading", { level: 2 }).first().focus();
      await page.keyboard.press("Alt+ArrowDown");
    },
  },
];

for (const change of SWITCHES) {
  test(`B6.8d punktbytte uten innlasting: ${change.name}`, async ({ page }, testInfo) => {
    test.skip(Boolean(change.pcOnly) && testInfo.project.name !== "pc", "snarveien prøves på PC");
    const bath = await createBathroomAssignment();
    await logInAsInspector(page);
    await openBathroom(page, bath, "wet_room.fixtures");
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    const mode = { current: "hold" as "pass" | "abort" | "hold" };
    const control = await controlActions(page, mode);
    const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
    await description.fill("Oppdiktet ulagret tekst");
    await description.blur();
    if (change.name === "Ferdig") {
      // «Ferdig» venter på lagringen; slipp den så punktet kan bli ferdig.
      setTimeout(() => void control.release(), 500);
    }
    await change.run(page);
    await expect(page).not.toHaveURL(/punkt=wet_room\.fixtures$/);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(
      1,
    );
    await control.release();
    await expect(totalSaveState(page)).toContainText("Alt er lagret");
  });
}

test("B6.8b beforeunload bare når et felt venter på lagring", async ({ page }) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  // Ingen ventende felt: ingen dialog.
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  const mode = { current: "hold" as "pass" | "abort" | "hold" };
  await controlActions(page, mode);
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.fill("Oppdiktet tekst som venter");
  await description.blur();
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs).toContain("beforeunload");
});

test("B6.8c «Ferdig» med ventende lagring: lagrer først, markerer ikke ferdig ved feil", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, "wet_room.fixtures");
  const mode = { current: "hold" as "pass" | "abort" | "hold" };
  const control = await controlActions(page, mode);
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.fill("Oppdiktet tekst rett før Ferdig");
  const done = page.getByRole("button", { name: /Ferdig med punktet|Lagrer …/ });
  await done.click();
  await expect(page.getByRole("button", { name: "Lagrer …" })).toBeDisabled();
  mode.current = "abort";
  await control.release();
  mode.current = "abort";
  await expect(page.getByRole("button", { name: "Ferdig med punktet" })).toBeEnabled();
  await expect(liveRegion(page)).toHaveText("Punktet er ikke ferdig. Ett felt er ikke lagret.");
  await expect(page.getByLabel("Beskrivelse av punktet (valgfri)")).toBeFocused();
  await expect(page.getByText("Ikke lagret – prøv igjen").first()).toBeVisible();
  expect(await doneCount(bath.assignmentId)).toBe(0);

  mode.current = "pass";
  await page.getByRole("button", { name: "Ferdig med punktet" }).click();
  await expect.poll(() => doneCount(bath.assignmentId)).toBe(1);
});

// --- B6.9 to faner --------------------------------------------------------------------------

test("B6.9 to faner: samme felt gir «Endret av andre» med nyeste verdi", async ({
  page,
  context,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  const second = await context.newPage();
  await openBathroom(second, bath, MEMBRANE);

  const first = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await first.fill("Oppdiktet tekst fra fane 1");
  await first.blur();
  await expect(totalSaveState(page)).toContainText("Alt er lagret");

  const other = second.getByLabel("Beskrivelse av punktet (valgfri)");
  await other.fill("Oppdiktet tekst fra fane 2");
  await other.blur();
  await expect(second.getByText("Endret av andre", { exact: true })).toBeVisible();
  await expect(second.getByText("Oppdiktet tekst fra fane 1")).toBeVisible();
  await second.getByRole("button", { name: "Bruk nyeste" }).click();
  await expect(other).toHaveValue("Oppdiktet tekst fra fane 1");
  await second.close();
});

// --- B6.10 kontor og B6.11 admin -------------------------------------------------------------

async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "nb-NO" });
  return { context, page: await context.newPage() };
}

test("B6.10 kontor: «ikke startet» uten knapp, deretter skrivebeskyttet med «ca. 40 000 kr»", async ({
  page,
  browser,
}) => {
  const bath = await createBathroomAssignment();
  const office = await newPage(browser);
  await logIn(office.page, OFFICE_EMAIL);
  await office.page.goto(roomUrl(bath));
  await expect(
    office.page.getByText("Rapporten er ikke startet. En takstmann starter den."),
  ).toBeVisible();
  await expect(office.page.getByRole("button", { name: "Start rapporten" })).toHaveCount(0);

  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  await suggestion(page).getByRole("button", { name: "Godta", exact: true }).click();
  const deviation = deviationCard(page, 1);
  await choose(page, "Kostnad", "Eget beløp", deviation);
  await deviation.getByLabel("Eget beløp").fill("40000");
  await deviation.getByLabel("Eget beløp").blur();
  await expect(totalSaveState(page)).toContainText("Alt er lagret");

  await office.page.goto(roomUrl(bath, MEMBRANE));
  await expect(office.page.getByText("Du kan se badet, men ikke endre det.")).toBeVisible();
  await expect(office.page.getByText(/ca\. 40\s000 kr/)).toBeVisible();
  await expect(office.page.getByRole("button", { name: "Godta", exact: true })).toHaveCount(0);
  await expect(office.page.getByRole("button", { name: "Ferdig med punktet" })).toHaveCount(0);
  await expect(office.page.locator("main textarea, main input:not([type=hidden])")).toHaveCount(0);
  await office.context.close();
});

test("B6.11 admin kan godta et forslag når innstillingen for takstmenn er av", async ({ page }) => {
  const bath = await createBathroomAssignment();
  await ensureSampleOrgEmployee({
    email: SAMPLE_ADMIN_ONLY_EMAIL,
    name: "Oppdiktet admin badet",
    role: "admin",
  });
  const previous = await setSampleInspectorsEditAll(false);
  try {
    await logIn(page, SAMPLE_ADMIN_ONLY_EMAIL);
    await openBathroom(page, bath, MEMBRANE);
    await fillMembrane1990(page);
    await suggestion(page).getByRole("button", { name: "Godta", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
    expect(await decisions(bath.assignmentId)).toMatchObject([{ decision: "accepted" }]);
  } finally {
    await setSampleInspectorsEditAll(previous);
  }
});

// --- B6.12 iPad liggende og stående ------------------------------------------------------

for (const viewport of [LANDSCAPE, PORTRAIT]) {
  const name = viewport === PORTRAIT ? "stående" : "liggende";
  test(`B6.12 iPad ${name}: Godta til Ferdig, mål på knapper, ingen vannrett rulling`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "iPad-størrelsen prøves i prosjektet ipad");
    await page.setViewportSize(viewport);
    const bath = await createBathroomAssignment();
    await logInAsInspector(page);
    await openBathroom(page, bath, MEMBRANE);
    await fillMembrane1990(page);
    const card = suggestion(page);
    const accept = card.getByRole("button", { name: "Godta", exact: true });
    expect(await height(accept)).toBeGreaterThanOrEqual(56);
    expect(
      await gap(
        card.getByRole("button", { name: "Endre", exact: true }),
        card.getByRole("button", { name: "Avvis", exact: true }),
      ),
    ).toBeGreaterThanOrEqual(48);
    expect(
      await gap(accept, card.getByRole("button", { name: "Avvis", exact: true })),
    ).toBeGreaterThanOrEqual(48);
    await expectNoHorizontalScroll(page, `${name} med forslag`);
    await accept.tap();
    await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
    await expectNoHorizontalScroll(page, `${name} med avvikskort`);

    const done = page.getByRole("button", { name: "Ferdig med punktet" });
    expect(await height(done)).toBeGreaterThanOrEqual(56);
    if (viewport === PORTRAIT) {
      await expect(page.getByRole("button", { name: /^Punkter \(0 av 8\)$/ })).toBeVisible();
      expect(
        await height(page.getByRole("button", { name: "Forrige punkt" })),
      ).toBeGreaterThanOrEqual(56);
      expect(
        await height(page.getByRole("button", { name: "Neste punkt" })),
      ).toBeGreaterThanOrEqual(56);
    }
    for (const button of await page.locator("main button:visible, main a:visible").all()) {
      const box = await button.boundingBox();
      if (box)
        expect(box.height, `${await button.textContent()} er minst 44 px`).toBeGreaterThanOrEqual(
          44,
        );
    }
    await expect(page.locator("select")).toHaveCount(0);
    await done.tap();
    await expect.poll(() => doneCount(bath.assignmentId)).toBe(1);
  });
}

// --- B6.13 tastatur -------------------------------------------------------------------------

test("B6.13 tastatur: Angre etter «Fjern avviket» og «Fjern TGIU» virker til punktet forlates", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  await suggestion(page).getByRole("button", { name: "Godta", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();

  await deviationCard(page, 1).getByRole("button", { name: "Fjern avviket" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Avvik 1 er fjernet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Angre" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  expect(await deviationCount(bath.assignmentId)).toBe(1);

  await deviationCard(page, 1).getByRole("button", { name: "Fjern avviket" }).click();
  await openCheckpoint(page, "Ventilasjon");
  await openCheckpoint(page, "Vanntett sjikt, membran og sluk");
  await expect(page.getByRole("button", { name: "Angre" })).toHaveCount(0);

  // TGIU: sett, fjern og angre med tastatur.
  await openCheckpoint(page, "Ventilasjon");
  const tgiu = page
    .getByRole("group", { name: "TG uten avvik" })
    .getByRole("radio", { name: "TGIU" });
  await tgiu.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { name: /TGIU – ikke undersøkt/ })).toBeVisible();
  const reason = page.getByLabel("Hva er ikke undersøkt, og hvorfor?");
  await reason.fill("Oppdiktet: avtrekket var tildekket.");
  await reason.blur();
  await expect(totalSaveState(page)).toContainText("Alt er lagret");
  await page.getByRole("button", { name: "Fjern TGIU" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Angre" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Hva er ikke undersøkt, og hvorfor?")).toHaveValue(
    "Oppdiktet: avtrekket var tildekket.",
  );
});

test("B6.13a snarveier: Ctrl/Cmd+Enter, Alt+pil, Ctrl/Cmd+K og «?», ingen tast godtar eller avviser", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "pc", "snarveiene prøves på PC");
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);

  // Ingen tast godtar eller avviser.
  await page.getByRole("heading", { level: 2, name: "Vanntett sjikt, membran og sluk" }).focus();
  for (const key of ["Enter", "Space", "g", "a", "G", "A"]) await page.keyboard.press(key);
  expect(await decisions(bath.assignmentId)).toEqual([]);

  // «?» utenfor tekstfelt viser snarveiene; i tekstfelt skrives det.
  await page.keyboard.press("?");
  await expect(page.getByRole("heading", { name: "Snarveier" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Snarveier" })).toHaveCount(0);
  const description = page.getByLabel("Beskrivelse av punktet (valgfri)");
  await description.focus();
  await page.keyboard.type("Hvorfor?");
  await expect(description).toHaveValue("Hvorfor?");

  // Alt+pil i tekstfelt flytter ikke punktet.
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page).toHaveURL(/punkt=wet_room\.membrane_drain/);
  await expect(description).toHaveValue("Hvorfor?");
  await page.getByRole("heading", { level: 2 }).first().focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(
    page.getByRole("heading", { level: 2, name: "Sanitærutstyr og innredning" }),
  ).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(
    page.getByRole("heading", { level: 2, name: "Vanntett sjikt, membran og sluk" }),
  ).toBeFocused();

  // Ctrl/Cmd+K: fokus i avvikssøket.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByLabel("Søk etter avvik i badet")).toBeFocused();

  // Ctrl/Cmd+Enter fra et tekstfelt: punktet er ferdig.
  await page.getByLabel("Beskrivelse av punktet (valgfri)").focus();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(() => doneCount(bath.assignmentId)).toBe(1);
  expect(await decisions(bath.assignmentId)).toEqual([]);
});

test("B6.13b avvikssøk: pil og Enter på treff fra annet punkt åpner punktet og lager avviket", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, "wet_room.general");
  await page.getByRole("button", { name: "+ Avvik" }).click();
  const search = page.getByLabel("Søk etter avvik i badet");
  await expect(search).toBeFocused();
  await search.fill("finnes ikke i noen mal xyz");
  await expect(page.getByText("Ingen avvik passer.")).toBeVisible();
  await search.fill("fukt");
  await expect(page.getByText(/\d+ treff/)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const first = page.getByRole("listitem").getByRole("button").first();
  await expect(first).toBeFocused();
  const label = (await first.textContent()) ?? "";
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/punkt=wet_room\.general$/);
  await expect(page.locator(":focus")).toBeVisible();
  expect(label.length).toBeGreaterThan(0);
  expect(await deviationCount(bath.assignmentId)).toBe(1);
});

test("B6.13c «Rett nå», «x å se over – gå til neste» og forslag som ikke gjelder lenger", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  await suggestion(page).getByRole("button", { name: "Godta", exact: true }).click();

  // TG3 uten kostnad: «Rett nå» flytter fokus til kostnadsvalget.
  const review = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Å se over/ }) });
  const costWarning = review.locator("li").filter({ hasText: "TG3 skal ha kostnad." });
  await costWarning.getByRole("button", { name: "Rett nå" }).click();
  await expect(
    deviationCard(page, 1).getByRole("group", { name: "Kostnad" }).getByRole("radio").first(),
  ).toBeFocused();

  // «x å se over – gå til neste» åpner neste punkt med advarsel og legger fokus på advarselen.
  await openCheckpoint(page, "Generelt");
  const next = page.getByRole("button", { name: /å se over – gå til neste$/ });
  await next.click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Vanntett sjikt, membran og sluk" }),
  ).toBeVisible();
  await expect(page.locator("#warning-0")).toBeFocused();

  // Rett årstallet til 2005: forslaget gjelder ikke lenger, avviket står til en knapp trykkes.
  const year = page.getByLabel("Årstall for det vanntette sjiktet");
  await year.fill("2005");
  await year.blur();
  const stale = page.getByText(/Forslaget gjelder ikke lenger/);
  await expect(stale).toBeVisible();
  await expect(deviationCard(page, 1)).toBeVisible();
  await suggestion(page).getByRole("button", { name: "Behold avviket" }).click();
  await expect(page.getByRole("heading", { name: /^Avvik 1/ })).toBeFocused();
  expect(await deviationCount(bath.assignmentId)).toBe(1);
  await suggestion(page).getByRole("button", { name: "Fjern avviket" }).click();
  await expect(page.getByText("Avvik 1 er fjernet.")).toBeVisible();
  await page.getByRole("button", { name: "Angre" }).click();
  await expect(deviationCard(page, 1)).toBeVisible();
  expect(await deviationCount(bath.assignmentId)).toBe(1);

  // Ferdig er fortsatt mulig med advarsler.
  await page.getByRole("button", { name: "Ferdig med punktet" }).click();
  await expect.poll(() => doneCount(bath.assignmentId)).toBe(1);
});

test("B6.13d «Hvorfor»-linjene flytter fokus til feltet verdien kom fra", async ({ page }) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  const link = suggestion(page).getByRole("link", { name: /1990.*gå til feltet/ });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Årstall for det vanntette sjiktet")).toBeFocused();
  expect(await decisions(bath.assignmentId)).toEqual([]);
});

// --- B6.14 axe ------------------------------------------------------------------------------

test("B6.14 axe uten feil: forslag, avvikskort, advarsler, Endre-flaten, søket og snarveiene", async ({
  page,
}, testInfo) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  if (testInfo.project.name === "ipad") await page.setViewportSize(PORTRAIT);
  await openBathroom(page, bath, MEMBRANE);
  await fillMembrane1990(page);
  await expectNoAxeViolations(page, "forslag");
  await suggestion(page).getByRole("button", { name: "Endre", exact: true }).click();
  await expectNoAxeViolations(page, "Endre-flaten");
  await suggestion(page).getByRole("button", { name: "Avbryt" }).click();
  await suggestion(page).getByRole("button", { name: "Godta", exact: true }).click();
  await expect(deviationCard(page, 1)).toBeVisible();
  await expectNoAxeViolations(page, "avvikskort og advarsler");
  await page.getByRole("button", { name: "+ Avvik" }).click();
  await page.getByLabel("Søk etter avvik i badet").fill("fukt");
  await expectNoAxeViolations(page, "avvikssøket");
  if (testInfo.project.name === "pc") {
    await page.getByRole("heading", { level: 2 }).first().focus();
    await page.keyboard.press("?");
    await expectNoAxeViolations(page, "snarveiene");
  }
});

// --- B6.15–B6.17 -----------------------------------------------------------------------------

test("B6.15 flettefelt: ingen {…} i avvikskortet når en verdi mangler", async ({ page }) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, FLOOR);
  await page.getByRole("button", { name: "+ Avvik" }).click();
  await page.getByRole("button", { name: /Målt fall mot sluk/ }).click();
  const deviation = deviationCard(page, 1);
  await expect(deviation).toBeVisible();
  const texts = await deviation
    .locator("textarea")
    .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value));
  expect(texts.join(" ")).not.toMatch(/[{}]/);
  await expect(deviation.getByText(/Fyll inn måleverdi i teksten\./)).toBeVisible();
});

test("B6.16 404: rom fra annet oppdrag og ugyldig id", async ({ page }) => {
  const bath = await createBathroomAssignment();
  const other = await createBathroomAssignment();
  await logInAsInspector(page);
  for (const url of [
    `/oppdrag/${bath.assignmentId}/rom/${other.roomId}`,
    `/oppdrag/${bath.assignmentId}/rom/ikke-en-id`,
    `/oppdrag/${bath.assignmentId}/rom/${bath.bedroomId}`,
  ]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Fant ikke siden", level: 1 })).toBeVisible();
  }
});

test("B6.17 «Ukjent» (T-0051): valget heter «Ukjent», og tomt årstall gir «ikke vurdert»", async ({
  page,
}) => {
  const bath = await createBathroomAssignment();
  await logInAsInspector(page);
  await openBathroom(page, bath, "wet_room.general");
  await choose(page, "Kilde for byggeåret", /^Ukjent$/);
  await expect(page.getByRole("group", { name: "Kilde for byggeåret" })).not.toContainText(
    "byggeåret brukes",
  );
  await openCheckpoint(page, "Vanntett sjikt, membran og sluk");
  await choose(page, "Vanntett sjikt", /^Folie$/);
  await expect(
    page.getByText(/Ikke vurdert: Fyll ut årstall for (det vanntette )?sjiktet/i).first(),
  ).toBeVisible();
});
