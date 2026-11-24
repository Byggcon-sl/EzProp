import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_INSPECTOR } from "../src/db/seed/sample-assignments.data";
import { inspectPdf } from "../tests/pdf-inspect";
import { assertLocalOrTestDatabase } from "./database-guard";
import { e2eDatabaseUrl, fakeOrgNumber, logIn, uniqueSuffix } from "./helpers";
import { clickToPdfTab, waitForPdfTab, type PdfTab } from "./pdf-tab";

/*
 * PDF-utkast av badet og «Åpne PDF» på utgivelsene (fase 2a-2). Testplan:
 * docs/funksjoner/fase2a-pdf-badet-testplan.md avsnitt 7, 10.2.5, 10.7.7, 11.6.2 og 11.9. Kjører i
 * prosjektene `pc` og `ipad`.
 *
 * Data: prøveorganisasjonen fra `pnpm db:seed:testoppdrag` (har den publiserte badmalen). Hver test
 * lager sitt eget oppdrag med ett bad, startet rapport, TG1 på alle punktene og hull tatt, direkte
 * mot databasen (oppdiktet, `uniqueSuffix()`). Bytene i PDF-en leses fra svaret med samme økt, ikke
 * fra fanen (11.9.1).
 *
 * Støtter hovedmål: de ansatte (ett trykk fra badet til PDF i ny fane, også rett etter skriving,
 * på PC og iPad), færre reklamasjoner (PDF-en har det som er lagret, og feilsidene sier hva som
 * skjedde) og KI i bunnen (ingen KI i PDF-en).
 */

const MISSING_SAMPLE = "Kjør pnpm db:seed:testoppdrag først (prøveorganisasjonen med badmalen)";
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
const DRAFT_BUTTON = "Lag PDF (utkast)";
const OFFLINE_TEXT = "Krever nett. PDF-en kan lages når du er på nett igjen.";
const ERROR_TEXT = "PDF-en kunne ikke lages. Prøv igjen.";

// --- Database (bare lokal database eller testdatabasen) -------------------------------------

function sql() {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

type Bathroom = {
  organizationId: string;
  assignmentId: string;
  assignmentNumber: string;
  reportId: string;
  roomId: string;
  generalCheckpointId: string;
  suffix: string;
};

/** Et oppdrag i prøveorganisasjonen med ett bad uten mangler, selskap med org.nr. og en beskrivelse. */
async function createBathroom(options: { report?: boolean } = {}): Promise<Bathroom> {
  const db = sql();
  const suffix = uniqueSuffix();
  try {
    const [org] = await db<{ id: string }[]>`
      select id from organizations
      where settings ->> 'sampleData' = 'true' and deleted_at is null
      order by created_at limit 1`;
    if (!org) throw new Error(MISSING_SAMPLE);
    const organizationId = org.id;
    const [user] = await db<
      { id: string }[]
    >`select id from users where email = ${SAMPLE_INSPECTOR.email}`;
    if (!user) throw new Error(MISSING_SAMPLE);
    const [employee] = await db<{ id: string }[]>`
      select id from employees where user_id = ${user.id} and organization_id = ${organizationId}
        and deleted_at is null and deactivated_at is null`;
    if (!employee) throw new Error(MISSING_SAMPLE);
    await db`
      insert into certifications (organization_id, employee_id, area, valid_from, valid_to)
      select ${organizationId}, ${employee.id}, 'condition_report', null, '2099-12-31'::date
      where not exists (
        select 1 from certifications where employee_id = ${employee.id}
          and valid_to = '2099-12-31'::date and deleted_at is null)`;
    const [office] = await db<{ id: string }[]>`
      select id from offices where organization_id = ${organizationId} and deleted_at is null
      order by created_at limit 1`;
    if (!office) throw new Error(MISSING_SAMPLE);
    const [company] = await db<{ id: string }[]>`
      insert into companies (organization_id, legal_name, org_number)
      values (${organizationId}, ${`Oppdiktet PDF-takst ${suffix} AS`}, ${fakeOrgNumber()})
      returning id`;
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
    const assignmentNumber = `E2E-PDF-${suffix}`;
    const address = `Prøvevegen 7 ${suffix}, 8000 Bodø`;
    await db`
      insert into orders (id, organization_id, address_text, received_at, source, status,
        requested_report_type, valid_until)
      values (${orderId}, ${organizationId}, ${address}, now(), 'manual', 'received',
        'condition_report', (now() at time zone 'Europe/Oslo')::date + 30)`;
    await db`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id, address_text, received_at, source, company_id, inspection_at)
      values (${assignmentId}, ${organizationId}, ${assignmentNumber}, ${office.id},
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
    const [general] = await db<{ id: string }[]>`
      select id from checkpoints where version_id = ${version.id} and key = 'wet_room.general'
        and deleted_at is null`;
    if (options.report !== false) {
      await db`
        insert into reports (id, organization_id, assignment_id, template_version_id, report_type,
          status)
        values (${reportId}, ${organizationId}, ${assignmentId}, ${version.id}, 'condition_report',
          'draft')`;
      for (const key of CHECKPOINTS) {
        await db`
          insert into checkpoint_results (organization_id, report_id, checkpoint_id, room_id,
            tg_direct, description_text)
          select ${organizationId}, ${reportId}, c.id, ${roomId}, '1',
            ${key === "wet_room.general" ? `Oppdiktet beskrivelse ${suffix}.` : null}
          from checkpoints c where c.version_id = ${version.id} and c.key = ${key}
            and c.deleted_at is null`;
      }
      const answers: [string, number | null, string[] | null][] = [
        ["wet_room.hole_drilling", null, ["done_no_findings"]],
        ["wet_room.hole_moisture_unit", null, ["weight_percent"]],
        ["wet_room.hole_moisture_reading", 10, null],
      ];
      for (const [key, number, opts] of answers) {
        await db`
          insert into field_answers (organization_id, report_id, element_id, room_id,
            value_number, value_option_keys)
          select ${organizationId}, ${reportId}, e.id, ${roomId}, ${number}, ${opts}
          from template_elements e where e.version_id = ${version.id} and e.key = ${key}
            and e.deleted_at is null`;
      }
    }
    return {
      organizationId,
      assignmentId,
      assignmentNumber,
      reportId,
      roomId,
      generalCheckpointId: general!.id,
      suffix,
    };
  } finally {
    await db.end();
  }
}

async function eventRows(reportId: string, type: string) {
  const db = sql();
  try {
    return await db<{ data: Record<string, unknown> }[]>`
      select data from events where report_id = ${reportId} and type = ${type}`;
  } finally {
    await db.end();
  }
}

// --- Siden ----------------------------------------------------------------------------------

const roomUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}/rom/${b.roomId}`;
const assignmentUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}`;
const draftPdfUrl = (b: Bathroom) => `/oppdrag/${b.assignmentId}/pdf`;

function draftButton(page: Page): Locator {
  return page
    .getByRole("link", { name: DRAFT_BUTTON })
    .or(page.getByRole("button", { name: DRAFT_BUTTON }))
    .first();
}

async function logInAsInspector(page: Page) {
  await logIn(page, SAMPLE_INSPECTOR.email);
}

/** Leser PDF-en fra ruten med samme økt (11.9.1). */
async function pdfFrom(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^application\/pdf/);
  const bytes = new Uint8Array(await response.body());
  const pdf = inspectPdf(bytes);
  return { pdf, text: pdf.pages.map((p) => p.text).join("\n"), headers: response.headers() };
}

/** Svaret fanen fikk: 200 og PDF (bytene leses med `pdfFrom`, e2e/pdf-tab.ts). */
function expectPdfAnswer(tab: PdfTab) {
  expect(tab.response.status()).toBe(200);
  expect(tab.response.headers()["content-type"]).toMatch(/^application\/pdf/);
}

async function expectMinHeight(target: Locator, min = 44) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(min);
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

async function expectDisabled(target: Locator) {
  await expect(target).toBeVisible();
  const disabled =
    (await target.getAttribute("aria-disabled")) === "true" ||
    (await target.isDisabled().catch(() => false));
  expect(disabled, "knappen er sperret").toBe(true);
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

/** Publiserer badet fra skjermen «Se over og publiser» (ingen sperrer). */
async function publishFromScreen(page: Page, b: Bathroom) {
  await page.goto(`/oppdrag/${b.assignmentId}/publiser`);
  await page.getByRole("button", { name: "Publiser versjon 1" }).click();
  await expect(page.getByRole("heading", { name: "Versjon 1 er publisert" })).toBeVisible();
}

// --- Testene --------------------------------------------------------------------------------

test("7.1 knappen på badet: i toppen, sekundær, minst 44 pt, tekst og ikon", async ({ page }) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  const button = draftButton(page);
  await expectMinHeight(button);
  await expect(button).toHaveText(/Lag PDF \(utkast\)/);
  expect(await button.locator("svg").count()).toBeGreaterThan(0);
  // Sekundær: ikke hovedknappen på siden
  const box = await button.boundingBox();
  expect(box!.y).toBeLessThan((page.viewportSize()?.height ?? 800) / 2);
});

test("7.2 knappen på oppdraget finnes når rapporten finnes, og ikke ellers", async ({ page }) => {
  const withReport = await createBathroom();
  const withoutReport = await createBathroom({ report: false });
  await logInAsInspector(page);
  await page.goto(assignmentUrl(withReport));
  await expectMinHeight(draftButton(page));
  await page.goto(assignmentUrl(withoutReport));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(draftButton(page)).toHaveCount(0);
});

test("7.3 ett trykk gir PDF i ny fane, og badet står fortsatt i originalfanen", async ({
  page,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  const tab = await clickToPdfTab(page, draftButton(page), /\/pdf$/);
  expect(tab.path).toBe(draftPdfUrl(b));
  expectPdfAnswer(tab);
  expect(tab.response.headers()["content-disposition"]).toMatch(/^inline; filename="utkast-/);
  await expect(page).toHaveURL(new RegExp(`${roomUrl(b)}`));
  const { text, headers } = await pdfFrom(page, draftPdfUrl(b));
  expect(headers["content-disposition"]).toMatch(/^inline; filename="utkast-/);
  expect(text).toContain(`Oppdiktet beskrivelse ${b.suffix}.`);
  expect(text).toContain("UTKAST");
});

test("7.4 «Lager PDF …» vises og knappen er sperret mens PDF-en lages", async ({
  page,
  context,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await context.route(/\/oppdrag\/[^/]+\/pdf$/, async (route) => {
    await held;
    await route.continue();
  });
  // Fanens svar kommer først når ruten slippes
  const opened = waitForPdfTab(page, /\/oppdrag\/[^/]+\/pdf$/);
  await draftButton(page).click();
  const status = page.getByRole("status").filter({ hasText: "Lager PDF" });
  await expect(
    status.or(page.locator("[aria-live]").filter({ hasText: "Lager PDF" })).first(),
  ).toBeVisible();
  await expectDisabled(page.getByRole("button", { name: /^Lager PDF …/ }));
  release();
  const tab = await opened();
  expect(tab.path).toBe(draftPdfUrl(b));
  expectPdfAnswer(tab);
  await expect(page.getByText("Lager PDF")).toHaveCount(0, { timeout: 15_000 });
  await context.unroute(/\/oppdrag\/[^/]+\/pdf$/);
});

test("7.5 skriv og trykk straks: «Lagrer endringer …», og PDF-en har det som ble skrevet", async ({
  page,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  const portrait = (page.viewportSize()?.width ?? 1200) < 1024;
  if (portrait) {
    await page.getByRole("button", { name: /^Punkter \(\d+ av \d+\)$/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /^Ventilasjon/ })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "Kontrollpunkter" })
      .getByRole("link", { name: /^Ventilasjon/ })
      .click();
  }
  // Lagringen holdes igjen litt, så knappen rekker å vise at den venter
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  const mark = `Oppdiktet nyskrevet ${b.suffix}`;
  await page.getByLabel("Beskrivelse av punktet (valgfri)").fill(mark);
  const opened = waitForPdfTab(page, /\/oppdrag\/[^/]+\/pdf$/, { timeout: 15_000 });
  await draftButton(page).click();
  // Knappen viser teksten; samme tekst står også i statusen for skjermleser
  await expectDisabled(page.getByRole("button", { name: "Lagrer endringer …" }));
  const tab = await opened();
  expect(tab.path).toBe(draftPdfUrl(b));
  expectPdfAnswer(tab);
  const { text } = await pdfFrom(page, tab.path);
  expect(text).toContain(mark);
  await page.unroute("**/*");
});

test("7.6 og 10.7.7 uten nett er knappen sperret med fast tekst, og synkstatusen synes", async ({
  page,
  context,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  await expect(draftButton(page)).toBeVisible();
  await context.setOffline(true);
  try {
    await expectDisabled(draftButton(page));
    await expect(page.getByText(OFFLINE_TEXT).first()).toBeVisible();
    // Synkstatusen på badet (SaveState), ikke den i prøveskjemaet
    await expect(page.locator("[data-save-state=offline]").first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByText(OFFLINE_TEXT)).toHaveCount(0);
  const tab = await clickToPdfTab(page, draftButton(page), /\/pdf$/);
  expect(tab.path).toBe(draftPdfUrl(b));
  expectPdfAnswer(tab);
});

test("7.7 svar 500 gir feilsiden med «Prøv igjen», som laster ruten på nytt", async ({ page }) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  let failed = false;
  await page.route(/\/oppdrag\/[^/]+\/pdf$/, async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="nb"><body><main><h1>${ERROR_TEXT}</h1><a href="${draftPdfUrl(b)}">Prøv igjen</a></main></body></html>`,
      });
      return;
    }
    await route.continue();
  });
  // Motoren kan ikke tvinges til feil i e2e; feilsiden fra serveren prøves i rutetesten (6.1.6).
  // Her vises at «Prøv igjen» laster ruten på nytt og da gir PDF-en.
  await page.goto(draftPdfUrl(b));
  await expect(page.getByText(ERROR_TEXT)).toBeVisible();
  const retry = page.getByRole("link", { name: "Prøv igjen" });
  await expect(retry).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(/\/oppdrag\/[^/]+\/pdf$/),
    retry.click(),
  ]);
  expect(response.status()).toBe(200);
});

test("8 iPad-størrelse: knappen dekker ikke hovedknappene, og ingen vannrett rulling", async ({
  page,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  const button = draftButton(page);
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  const mainActions = page.getByRole("link", { name: /^Se over og publiser/ });
  if ((await mainActions.count()) > 0) {
    const other = (await mainActions.first().boundingBox())!;
    const overlap =
      box.x < other.x + other.width &&
      other.x < box.x + box.width &&
      box.y < other.y + other.height &&
      other.y < box.y + box.height;
    expect(overlap, "knappen dekker ikke hovedknappen").toBe(false);
  }
  await expectNoHorizontalScroll(page, "badet");
  await page.setViewportSize({ width: 834, height: 1194 });
  await expect(button).toBeVisible();
  await expectNoHorizontalScroll(page, "badet, stående");
});

test("9 axe uten funn på badet og oppdraget med knappen synlig, og på 404-siden", async ({
  page,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.goto(roomUrl(b));
  await expect(draftButton(page)).toBeVisible();
  await expectNoAxeViolations(page, "badet");
  await page.goto(assignmentUrl(b));
  await expect(draftButton(page)).toBeVisible();
  await expectNoAxeViolations(page, "oppdraget");
  await page.goto("/oppdrag/00000000-0000-0000-0000-000000000000/pdf");
  await expect(page.getByText("Fant ikke rapporten")).toBeVisible();
  await expectNoAxeViolations(page, "404-siden");
});

test("7.10 utkastet av badet svarer på under 5 sekunder, og durationMs er satt", async ({
  page,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await page.request.get(draftPdfUrl(b));
  const start = Date.now();
  const response = await page.request.get(draftPdfUrl(b));
  expect(response.status()).toBe(200);
  expect(Date.now() - start).toBeLessThan(5000);
  const rows = await eventRows(b.reportId, "report.draft_pdf_created");
  expect(rows.length).toBeGreaterThanOrEqual(2);
  for (const row of rows) expect(typeof row.data.durationMs).toBe("number");
});

test("7.12 og 11.9.4 POST gir 405 mot begge rutene, ingen PDF", async ({ page }) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  const draft = await page.request.post(draftPdfUrl(b));
  expect(draft.status()).toBe(405);
  expect((await draft.body()).subarray(0, 5).toString()).not.toBe("%PDF-");
  const release = await page.request.post(
    `/oppdrag/${b.assignmentId}/utgivelser/00000000-0000-0000-0000-000000000000/pdf`,
  );
  expect(release.status()).toBe(405);
  expect(await eventRows(b.reportId, "report.draft_pdf_created")).toEqual([]);
});

test("7.11 lenken til et punkt i utkastet lander på badet med ankeret synlig (F4)", async ({
  page,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  const { pdf } = await pdfFrom(page, draftPdfUrl(b));
  const links = pdf.pages.flatMap((p) => p.links).map((l) => JSON.stringify(l));
  const target = links
    .map((l) => /(https?:\/\/[^"\\]+#punkt-[0-9a-f-]{36})/.exec(l)?.[1])
    .find((url) => url?.includes(`#punkt-${b.generalCheckpointId}`));
  expect(target, "lenke til punktet «Generelt»").toBeDefined();
  const url = new URL(target!);
  expect(url.pathname).toBe(roomUrl(b));
  await page.goto(`${url.pathname}${url.hash}`);
  await expect(page.locator(`[id="punkt-${b.generalCheckpointId}"]`)).toBeVisible();
});

test("11.6.2 feilsidene har CSP med frame-ancestors 'none' og no-store, private", async ({
  page,
}) => {
  await createBathroom();
  await logInAsInspector(page);
  const notFound = await page.request.get("/oppdrag/00000000-0000-0000-0000-000000000000/pdf");
  expect(notFound.status()).toBe(404);
  const headers = notFound.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["cache-control"]).toMatch(/no-store/);
  expect(headers["cache-control"]).toMatch(/private/);
  const notAllowed = await page.request.post("/oppdrag/00000000-0000-0000-0000-000000000000/pdf");
  expect(notAllowed.status()).toBe(405);
  expect(notAllowed.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("10.2.5 og 10.7.7 publiser badet: «Åpne PDF» etter publisering og i utgivelseskortet", async ({
  page,
  context,
}) => {
  const b = await createBathroom();
  await logInAsInspector(page);
  await publishFromScreen(page, b);

  const afterPublish = page.getByRole("link", { name: "Åpne PDF av versjon 1" });
  await expectMinHeight(afterPublish);
  await expect(afterPublish).toHaveAttribute("target", "_blank");
  const tab = await clickToPdfTab(page, afterPublish, /\/utgivelser\/[^/]+\/pdf$/);
  expectPdfAnswer(tab);
  const releaseUrl = tab.path;
  expect(releaseUrl).toMatch(
    new RegExp(`^/oppdrag/${b.assignmentId}/utgivelser/[0-9a-f-]{36}/pdf$`),
  );
  const { text, headers, pdf } = await pdfFrom(page, releaseUrl);
  expect(headers["content-disposition"]).toBe(
    `inline; filename="tilstandsrapport-${b.assignmentNumber.replace(/[^0-9-]/g, "")}-v1.pdf"`,
  );
  expect(text).not.toContain("UTKAST");
  expect(text).toContain(`Oppdiktet beskrivelse ${b.suffix}.`);
  expect(pdf.info.title).not.toContain("UTKAST");
  await expectNoAxeViolations(page, "skjermen etter publisering");

  await page.goto(assignmentUrl(b));
  const inCard = page.getByRole("link", { name: "Åpne PDF av versjon 1" });
  await expectMinHeight(inCard);
  await expect(inCard).toHaveAttribute("href", releaseUrl);
  await expectNoHorizontalScroll(page, "oppdraget med utgivelser");
  await expectNoAxeViolations(page, "oppdraget med utgivelser");

  // Utkastet virker også på en publisert rapport (A541)
  const draft = await pdfFrom(page, draftPdfUrl(b));
  expect(draft.text).toContain("UTKAST");

  // 11.9.2 uten nett er begge sperret med samme tekst
  await context.setOffline(true);
  try {
    await expectDisabled(page.getByText("Åpne PDF", { exact: false }).first());
    await expect(page.getByText(OFFLINE_TEXT).first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
