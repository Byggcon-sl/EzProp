import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  e2eDatabaseUrl,
  logIn,
  logInAsInspector,
  logInAsOffice,
  uniqueSuffix,
  convertedAssignmentLink,
} from "./helpers";

/*
 * Varsel om mulig dublett på ordren (T3, fase 2a). Testplan:
 * docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 7. Kjører i prosjektene pc og ipad;
 * 7.13 og 7.14 bare i ipad.
 *
 * Ordre legges rett i databasen med en unik ending i adressen, fordi e2e-databasen ikke tømmes og
 * testene ikke skal se hverandres ordre. Bare lokal database eller testdatabasen
 * (`assertLocalOrTestDatabase`). Testdata er oppdiktet («Dublettveien …», «Prøvegata …»,
 * organisasjonen «Oppdiktet takst B (e2e dublett)»).
 *
 * Ordene fra kortet: overskriften «Mulig dublett» (h2) i et varsel med `role="status"`, teksten
 * «Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt
 * to ganger.», grunnene «samme adresse» og «samme matrikkel», og «Viser de 10 nyeste.».
 *
 * Ordre er kontorarbeid med nett, så det er ingen test uten nett.
 *
 * Støtter hovedmål: de ansatte (kontoret ser med en gang at boligen er bestilt før, og et trykk
 * åpner den andre ordren) og færre reklamasjoner (ikke to oppdrag på samme bolig). Varselet
 * stopper aldri lagring eller knapper.
 */

const NOTICE_TEXT =
  "Samme adresse eller matrikkel som en annen ordre. Sjekk at boligen ikke blir bestilt eller tatt to ganger.";
const MORE = "Viser de 10 nyeste.";
const SAVED = "Endringene er lagret.";
const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})(\\?.*)?$`);
const ORG_B_NAME = "Oppdiktet takst B (e2e dublett)";

type Sql = ReturnType<typeof postgres>;

function connect(): Sql {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  return postgres(url, { max: 1, onnotice: () => {} });
}

async function withSql<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** Organisasjonen og kontoret «Bodø» (eller første kontor) til admin fra seed. */
async function seedOrganization(sql: Sql): Promise<{ organizationId: string; officeId: string }> {
  const [row] = await sql<{ organization_id: string; office_id: string }[]>`
    select e.organization_id, o.id as office_id
    from employees e
    join users u on u.id = e.user_id
    join offices o on o.organization_id = e.organization_id and o.deleted_at is null
    where u.email = ${ADMIN_EMAIL}
      and e.organization_id not in (select id from organizations where settings ->> 'sampleData' = 'true')
      and e.deleted_at is null and e.deactivated_at is null
    order by (o.name = 'Bodø') desc, o.created_at
    limit 1`;
  if (!row) throw new Error("Fant ikke admin og kontor fra seed (kjør pnpm db:seed)");
  return { organizationId: row.organization_id, officeId: row.office_id };
}

type OrderSeed = {
  address: string;
  gnr?: string | null;
  bnr?: string | null;
  snr?: string | null;
  /** Minutter før nå (nyere ordre står først i varselet). */
  minutesAgo?: number;
  status?: "received" | "rejected" | "converted";
  assignmentStatus?: "ordered" | "in_progress" | "completed" | "invoiced";
  /** Annen organisasjon enn Byggcon. */
  organizationId?: string;
};

/** En ordre (og oppdraget når den er gjort om). Gir id-en og eventuelt oppdragsnummeret. */
async function insertOrder(seed: OrderSeed): Promise<{ id: string; number: string | null }> {
  return withSql(async (sql) => {
    const own = await seedOrganization(sql);
    const organizationId = seed.organizationId ?? own.organizationId;
    const id = randomUUID();
    const minutes = seed.minutesAgo ?? 0;
    const rejected = seed.status === "rejected";
    await sql`
      insert into orders (id, organization_id, address_text, gnr, bnr, snr, received_at, source,
        status, requested_report_type, rejected_reason, ordered_by_text)
      values (${id}, ${organizationId}, ${seed.address}, ${seed.gnr ?? null}, ${seed.bnr ?? null},
        ${seed.snr ?? null}, now() - make_interval(mins => ${minutes}), 'manual',
        ${rejected ? "rejected" : "received"}, 'condition_report',
        ${rejected ? "Feil registrering (e2e)" : null}, 'Megler Testesen')`;
    if (seed.status !== "converted" && !seed.assignmentStatus) return { id, number: null };

    if (seed.organizationId) throw new Error("Gjort om i en annen organisasjon brukes ikke her");
    const assignmentId = randomUUID();
    const number = `E2E-DUB-${uniqueSuffix()}`.slice(0, 30);
    await sql`
      insert into assignments (id, organization_id, number, office_id, assignment_type, status,
        order_id)
      values (${assignmentId}, ${organizationId}, ${number}, ${own.officeId}, 'condition_report',
        ${seed.assignmentStatus ?? "ordered"}, ${id})`;
    await sql`
      update orders set status = 'converted', assignment_id = ${assignmentId}
      where id = ${id} and organization_id = ${organizationId}`;
    return { id, number };
  });
}

/** En oppdiktet organisasjon B (idempotent). */
async function organizationB(): Promise<string> {
  return withSql(async (sql) => {
    const [found] = await sql<{ id: string }[]>`
      select id from organizations where name = ${ORG_B_NAME} and deleted_at is null limit 1`;
    if (found) return found.id;
    const [row] = await sql<{ id: string }[]>`
      insert into organizations (name, brand_name) values (${ORG_B_NAME}, ${ORG_B_NAME})
      returning id`;
    return row!.id;
  });
}

/** Unik adresse for testen: «Dublettveien <ending> 1A, 8000 Bodø». */
function addressFor(suffix: string, extra = "") {
  return `Dublettveien ${suffix} 1A${extra}, 8000 Bodø`;
}

/** Varselet: `role="status"` med overskriften «Mulig dublett». */
function notice(page: Page): Locator {
  return page
    .getByRole("status")
    .filter({ has: page.getByRole("heading", { name: "Mulig dublett", exact: true }) });
}

function noticeLinks(page: Page): Locator {
  return notice(page).getByRole("link");
}

function editButton(page: Page): Locator {
  return page.getByRole("button", { name: "Endre ordren", exact: true });
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lagre", exact: true });
}

function addressField(page: Page): Locator {
  return page.getByLabel(/^Adresse/);
}

async function expectAtLeast(target: Locator, name: string, min: number) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `ingen vannrett rulling ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Samme kontrastberegning som i fase-1-testskjema.spec.ts (WCAG). */
function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const match = /rgba?\(([^)]+)\)/.exec(color);
    if (!match) throw new Error(`Ukjent farge «${color}»`);
    const [r, g, b] = match[1]!
      .split(/[,\s/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => {
        const c = Number(part) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Forgrunn og bakgrunn i sRGB for et element (Tailwind v4 gir lab()/oklab()). */
async function colorsOf(target: Locator): Promise<{ foreground: string; background: string }> {
  return target.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Fikk ikke 2d-canvas");
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a!];
    };
    const rgb = ([r, g, b]: number[]) => `rgb(${r}, ${g}, ${b})`;
    const foreground = toRgba(getComputedStyle(el).color);
    let background = [255, 255, 255];
    let node: Element | null = el;
    while (node) {
      const [r, g, b, a] = toRgba(getComputedStyle(node).backgroundColor);
      if (a > 0) {
        background = [r, g, b].map((c) => Math.round((c * a) / 255 + 255 * (1 - a / 255)));
        break;
      }
      node = node.parentElement;
    }
    return { foreground: rgb(foreground), background: rgb(background) };
  });
}

test.describe("varsel om mulig dublett (pc og ipad)", () => {
  test("7.1 «Ny ordre» med samme adresse som en åpen ordre: varsel med lenke etter «Lagre», ordren er lagret", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const open = await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    await logInAsOffice(page);

    // Annen skrivemåte: små bokstaver, mellomrom i husnummeret og uten postnummer
    const typed = `dublettveien ${suffix} 1 a`;
    await page.goto("/ordre/ny");
    await addressField(page).fill(typed);
    await page.getByLabel(/^Hvem bestilte/).fill("Megler Testesen");
    await saveButton(page).click();
    await expect(page).toHaveURL(ORDER_URL);
    const newId = ORDER_URL.exec(page.url())![1]!;

    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText(NOTICE_TEXT);
    await expect(noticeLinks(page)).toHaveCount(1);
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${open.id}`);
    await expect(noticeLinks(page).first()).toContainText(addressFor(suffix));
    await expect(noticeLinks(page).first()).toContainText("samme adresse");
    await expect(noticeLinks(page).first()).toContainText(/mottatt \d{2}\.\d{2}\.\d{4}/);
    await expect(noticeLinks(page).first()).toContainText("Mottatt");

    // Ordren er lagret og står i ordrelisten
    await page.goto("/ordre");
    await expect(page.locator(`a[href="/ordre/${newId}"]`).first()).toBeVisible();
  });

  test("7.2 lenken åpner den andre ordren, og der står varselet med lenke tilbake", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const first = await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    const second = await insertOrder({ address: `DUBLETTVEIEN ${suffix} 1-A.`, minutesAgo: 5 });
    await logIn(page);

    await page.goto(`/ordre/${second.id}`);
    await expect(noticeLinks(page)).toHaveCount(1);
    await noticeLinks(page).first().click();
    await expect(page).toHaveURL(new RegExp(`/ordre/${first.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(addressFor(suffix));
    await expect(notice(page)).toBeVisible();
    await expect(noticeLinks(page)).toHaveCount(1);
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${second.id}`);
  });

  test("7.3 rekkefølge: «Endringene er lagret.» over varselet, og varselet over «Gjort om til oppdrag»", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    const converted = await insertOrder({
      address: addressFor(suffix),
      minutesAgo: 5,
      assignmentStatus: "ordered",
    });
    await logIn(page);

    await page.goto(`/ordre/${converted.id}`);
    await editButton(page).click();
    await page.getByLabel(/^Ekstern referanse/).fill(`E2E-DUB-${suffix}`);
    await saveButton(page).click();

    const saved = page.getByText(SAVED, { exact: true });
    await expect(saved).toBeVisible();
    await expect(notice(page)).toBeVisible();
    const card = page
      .getByRole("main")
      .getByText(/Gjort om til oppdrag/)
      .filter({
        hasText: converted.number!,
      });
    await expect(card.first()).toBeVisible();

    const savedY = (await saved.boundingBox())!.y;
    const noticeY = (await notice(page).boundingBox())!.y;
    const cardY = (await card.first().boundingBox())!.y;
    expect(savedY, "kvitteringen står over varselet").toBeLessThan(noticeY);
    expect(noticeY, "varselet står over «Gjort om til oppdrag»").toBeLessThan(cardY);
  });

  test("7.4 rette adressen til en annen ordres adresse viser varselet; rette tilbake fjerner det", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const other = await insertOrder({
      address: `Prøvegata ${suffix} 7, 8006 Bodø`,
      minutesAgo: 60,
    });
    const mine = addressFor(suffix);
    const order = await insertOrder({ address: mine, minutesAgo: 5 });
    await logIn(page);

    await page.goto(`/ordre/${order.id}`);
    await expect(notice(page)).toHaveCount(0);

    await editButton(page).click();
    await addressField(page).fill(`prøvegata ${suffix} 7`);
    await saveButton(page).click();
    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    await expect(notice(page)).toBeVisible();
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${other.id}`);

    await editButton(page).click();
    await addressField(page).fill(mine);
    await saveButton(page).click();
    await expect(page.getByText(SAVED, { exact: true })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });

  test("7.5 varselet stopper ingenting: «Gjør om til oppdrag», «Avvis» og «Endre ordren» virker uten ekstra trykk", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    const toConvert = await insertOrder({ address: addressFor(suffix), minutesAgo: 10 });
    const toReject = await insertOrder({ address: addressFor(suffix), minutesAgo: 5 });
    let dialogs = 0;
    page.on("dialog", async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });
    await logIn(page);

    // Gjør om til oppdrag med varselet synlig
    await page.goto(`/ordre/${toConvert.id}`);
    await expect(notice(page)).toBeVisible();
    await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
    await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
    await expect(page.getByRole("main")).toContainText(/Gjort om til oppdrag\s*\d{4}-\d{5}/);
    // Varsel og kort på samme side: bare kortlenken treffer, og den går til oppdraget.
    await expect(notice(page)).toBeVisible();
    await expect(convertedAssignmentLink(page)).toHaveCount(1);
    await expect(convertedAssignmentLink(page)).toHaveAttribute(
      "href",
      /\/oppdrag\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await expect(
      page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }),
    ).toHaveCount(0);

    // Avvis med varselet synlig
    await page.goto(`/ordre/${toReject.id}`);
    await expect(notice(page)).toBeVisible();
    await page.getByLabel(/^Grunn/).fill("Lagt inn to ganger (e2e)");
    await page.getByRole("button", { name: "Avvis", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("Grunn for avvisning");
    // 7.6: en avvist ordre viser aldri varsel
    await expect(notice(page)).toHaveCount(0);

    // Endre ordren med varselet synlig
    await page.goto(`/ordre/${toConvert.id}`);
    await expect(notice(page)).toBeVisible();
    await editButton(page).click();
    await expect(saveButton(page)).toBeVisible();
    await expect(addressField(page)).toBeVisible();

    expect(dialogs, "ingen dialog eller bekreftelse").toBe(0);
  });

  test("7.6 avvist ordre med samme adresse: ingen varsel på den avviste, og den åpne viser den ikke", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const rejected = await insertOrder({
      address: addressFor(suffix),
      minutesAgo: 60,
      status: "rejected",
    });
    const open = await insertOrder({ address: addressFor(suffix), minutesAgo: 5 });
    await logIn(page);

    await page.goto(`/ordre/${rejected.id}`);
    await expect(page.getByRole("main")).toContainText("Grunn for avvisning");
    await expect(notice(page)).toHaveCount(0);

    await page.goto(`/ordre/${open.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator(`a[href="/ordre/${rejected.id}"]`)).toHaveCount(0);
  });

  test("7.7 ulik adresse, samme gnr/bnr: varselet sier «samme matrikkel»", async ({ page }) => {
    const suffix = uniqueSuffix();
    // Unike gnr/bnr per kjøring (oppdiktede tall)
    const gnr = String(70000 + Math.floor(Math.random() * 20000));
    const bnr = String(10000 + Math.floor(Math.random() * 80000));
    const other = await insertOrder({
      address: `Prøvegata ${suffix} 7, 8006 Bodø`,
      gnr,
      bnr,
      minutesAgo: 60,
    });
    const order = await insertOrder({
      address: addressFor(suffix),
      gnr: `0${gnr}`,
      bnr,
      minutesAgo: 5,
    });
    await logIn(page);

    await page.goto(`/ordre/${order.id}`);
    await expect(noticeLinks(page)).toHaveCount(1);
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${other.id}`);
    await expect(noticeLinks(page).first()).toContainText("samme matrikkel");
    await expect(noticeLinks(page).first()).not.toContainText("samme adresse");
  });

  test("7.8 elleve treff: ti linjer og «Viser de 10 nyeste.»", async ({ page }) => {
    const suffix = uniqueSuffix();
    const others: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      others.push((await insertOrder({ address: addressFor(suffix), minutesAgo: 60 + index })).id);
    }
    const order = await insertOrder({ address: addressFor(suffix), minutesAgo: 1 });
    await logIn(page);

    await page.goto(`/ordre/${order.id}`);
    await expect(noticeLinks(page)).toHaveCount(10);
    await expect(notice(page)).toContainText(MORE);
    // Den eldste vises ikke
    await expect(notice(page).locator(`a[href="/ordre/${others[10]}"]`)).toHaveCount(0);
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${others[0]}`);
  });

  test("7.9 kontoret og takstmannen ser varselet", async ({ page }) => {
    const suffix = uniqueSuffix();
    const other = await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    const order = await insertOrder({ address: addressFor(suffix), minutesAgo: 5 });

    await logInAsOffice(page);
    await page.goto(`/ordre/${order.id}`);
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${other.id}`);

    await page.context().clearCookies();
    await logInAsInspector(page);
    await page.goto(`/ordre/${order.id}`);
    await expect(noticeLinks(page).first()).toHaveAttribute("href", `/ordre/${other.id}`);
  });

  test("7.10 en ordre i en annen organisasjon med samme adresse vises aldri som treff", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const orgB = await organizationB();
    // Unike gnr/bnr per kjøring, så ordre fra tidligere kjøringer ikke gir treff
    const gnr = String(70000 + Math.floor(Math.random() * 20000));
    const bnr = String(10000 + Math.floor(Math.random() * 80000));
    const foreign = await insertOrder({
      address: addressFor(suffix),
      gnr,
      bnr,
      minutesAgo: 60,
      organizationId: orgB,
    });
    const order = await insertOrder({
      address: addressFor(suffix),
      gnr,
      bnr,
      minutesAgo: 5,
    });
    await logIn(page);

    await page.goto(`/ordre/${order.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(`a[href="/ordre/${foreign.id}"]`)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
  });

  test("7.11 skjermleser og kontrast: role=status, h2 «Mulig dublett» og kontrast minst 4,5:1", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    const order = await insertOrder({ address: addressFor(suffix), minutesAgo: 5 });
    await logIn(page);

    await page.goto(`/ordre/${order.id}`);
    const box = notice(page);
    await expect(box).toHaveCount(1);
    await expect(box.getByRole("heading", { level: 2, name: "Mulig dublett" })).toBeVisible();
    // Ikonet er skjult for skjermleser, teksten bærer meningen
    for (const icon of await box.locator("svg").all()) {
      await expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    await expect(box).toContainText(NOTICE_TEXT);

    const targets: [string, Locator][] = [
      ["overskriften", box.getByRole("heading", { name: "Mulig dublett" })],
      ["teksten", box.getByText(NOTICE_TEXT, { exact: true })],
      ["lenken", noticeLinks(page).first()],
    ];
    for (const [name, target] of targets) {
      const colors = await colorsOf(target);
      const ratio = contrastRatio(colors.foreground, colors.background);
      expect(
        ratio,
        `${name}: ${colors.foreground} mot ${colors.background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("7.12 tastatur: lenkene nås med Tab, har synlig fokus og åpnes med Enter", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const other = await insertOrder({ address: addressFor(suffix), minutesAgo: 60 });
    const order = await insertOrder({ address: addressFor(suffix), minutesAgo: 5 });
    await logIn(page);

    await page.goto(`/ordre/${order.id}`);
    const link = noticeLinks(page).first();
    await expect(link).toBeVisible();

    let reached = false;
    for (let step = 0; step < 40; step += 1) {
      await page.keyboard.press("Tab");
      const href = await page.evaluate(() => document.activeElement?.getAttribute("href") ?? null);
      if (href === `/ordre/${other.id}`) {
        reached = true;
        break;
      }
    }
    expect(reached, "lenken i varselet nås med Tab").toBe(true);

    const focusStyle = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
        boxShadow: style.boxShadow,
      };
    });
    const visibleFocus =
      (focusStyle.outlineStyle !== "none" && focusStyle.outlineWidth > 0) ||
      (focusStyle.boxShadow !== "none" && focusStyle.boxShadow !== "");
    expect(visibleFocus, `synlig fokus (${JSON.stringify(focusStyle)})`).toBe(true);

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/ordre/${other.id}$`));
  });
});

test.describe("varsel om mulig dublett (bare ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  async function tenLongHits(page: Page): Promise<string> {
    const suffix = uniqueSuffix();
    const long = `Dublettveien ${suffix} langtnavnsomikkekanbrytesmedmellomrom${"x".repeat(60)} 1A`;
    for (let index = 0; index < 10; index += 1) {
      await insertOrder({
        address: `${long}, H0${index}01, 8000 Bodø i en svært lang adresse med mange ord`,
        minutesAgo: 60 + index,
        ...(index % 2 === 0 ? { assignmentStatus: "in_progress" as const } : {}),
      });
    }
    const order = await insertOrder({ address: `${long}, 8000 Bodø`, minutesAgo: 1 });
    await logIn(page);
    return order.id;
  }

  test("7.13 ingen vannrett rulling med 10 treff og lange adresser, stående og liggende", async ({
    page,
  }) => {
    const orderId = await tenLongHits(page);
    for (const [name, viewport] of [
      ["stående", PORTRAIT],
      ["liggende", LANDSCAPE],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(`/ordre/${orderId}`);
      await expect(noticeLinks(page)).toHaveCount(10);
      await expectNoHorizontalScroll(page, name);
    }
  });

  test("7.14 lenkene i varselet er minst 44 px høye, stående og liggende", async ({ page }) => {
    const orderId = await tenLongHits(page);
    for (const [name, viewport] of [
      ["stående", PORTRAIT],
      ["liggende", LANDSCAPE],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(`/ordre/${orderId}`);
      const links = noticeLinks(page);
      await expect(links).toHaveCount(10);
      for (let index = 0; index < 10; index += 1) {
        await expectAtLeast(links.nth(index), `lenke ${index + 1} (${name})`, 44);
      }
    }
  });
});
