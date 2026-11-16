import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  e2eDatabaseUrl,
  logIn,
  logInAsInspector,
  logInAsOffice,
  signInWithCode,
  uniqueSuffix,
} from "./helpers";

/*
 * Tilbud i stedet for ordre (fase 2a, ADR 0012). Testplan: docs/funksjoner/fase2a-tilbud-testplan.md
 * avsnitt 5 (5.1–5.21) og e2e-delene av avsnitt 7 (F1 7.1.5, F2 7.2.6, F3 7.3.5, F4 7.4.4, F5 7.5.1
 * på iPad). De gamle testene for ordre står i fase-2a-tilbud-grunn.spec.ts,
 * fase-2a-rette-tilbud.spec.ts og fase-2a-sok-tilbud-arbeidsko.spec.ts, og «Lagre som tilbud i
 * stedet» og pekeren etter omgjøring i fase-2a-nytt-oppdrag.spec.ts (5.16, 5.22, 5.23).
 *
 * Kjører i prosjektene pc og ipad; 5.18–5.21 bare i ipad. Tilbud lages direkte i databasen der
 * status eller dato må styres, med en unik oppdiktet adresse per test, fordi e2e-databasen ikke
 * tømmes. Admin fra seed; Byggcon har kontoret «Bodø». Data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte («Gjør om til oppdrag» er ett trykk uten rulling på iPad, åpne
 * tilbud drukner ikke i gamle), KI i bunnen (statuskodene og «Gyldig til» er de samme som et senere
 * tilbudsutkast bruker) og færre reklamasjoner (alt fra tilbudet kopieres, ett oppdrag ved
 * dobbelttrykk, avslag har grunn).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OFFER_URL = new RegExp(`/tilbud/(${UUID})(\\?.*)?(#.*)?$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})(\\?.*)?(#.*)?$`);
const PORTRAIT = { width: 834, height: 1194 } as const;
const LANDSCAPE = { width: 1194, height: 834 } as const;
const OFFLINE = "Du er uten nett. Endringen er ikke lagret.";
const CONVERTED_RECEIPT = "Oppdraget er laget.";
const POINTER_LINK = "Velg takstmann og befaringsdato";

/* ------------------------------------------------------------------ datoer */

/** Dagens dato i Oslo som «ÅÅÅÅ-MM-DD» (samme regel som `todayInOslo`). */
function todayOslo(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

/** «2026-11-14» → «14.11.2026». */
function norwegianDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/* --------------------------------------------------------------- databasen */

function sql() {
  const databaseUrl = e2eDatabaseUrl();
  assertLocalOrTestDatabase(databaseUrl, process.env.TEST_DATABASE_URL);
  return postgres(databaseUrl, { max: 1, onnotice: () => {} });
}

/** Byggcon fra seed: organisasjonen til admin, ikke prøveorganisasjonen. */
async function byggconId(): Promise<string> {
  const db = sql();
  try {
    const [row] = await db<{ organization_id: string }[]>`
      select e.organization_id from employees e
      join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.deleted_at is null and e.deactivated_at is null
        and e.organization_id not in (
          select id from organizations where settings ->> 'sampleData' = 'true')
      limit 1`;
    if (!row) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    return row.organization_id;
  } finally {
    await db.end();
  }
}

/** Har admin fra seed et kontor? Uten kontor skal kontorvalget vises ved knappen (A295). */
async function adminHasOffice(): Promise<boolean> {
  const db = sql();
  try {
    const [row] = await db<{ office_id: string | null }[]>`
      select e.office_id from employees e join users u on u.id = e.user_id
      where u.email = ${ADMIN_EMAIL} and e.deleted_at is null
        and e.organization_id not in (
          select id from organizations where settings ->> 'sampleData' = 'true')
      limit 1`;
    return Boolean(row?.office_id);
  } finally {
    await db.end();
  }
}

type OfferSeed = {
  address: string;
  status?: "received" | "rejected";
  validUntil?: string;
  /** Dager før nå tilbudet ble mottatt. Standard 1. */
  receivedDaysAgo?: number;
  gnr?: string | null;
  bnr?: string | null;
  orderedBy?: string | null;
  organizationId?: string;
};

/** Et tilbud satt inn direkte (status og dato styres av testen). Gir id-en. */
async function insertOffer(seed: OfferSeed): Promise<string> {
  const organizationId = seed.organizationId ?? (await byggconId());
  const status = seed.status ?? "received";
  const receivedAt = new Date(Date.now() - (seed.receivedDaysAgo ?? 1) * 86_400_000);
  const db = sql();
  try {
    const [row] = await db<{ id: string }[]>`
      insert into orders (organization_id, received_at, valid_until, source, address_text, gnr,
        bnr, ordered_by_text, status, rejected_reason_key)
      values (${organizationId}, ${receivedAt}, ${seed.validUntil ?? addDaysIso(todayOslo(), 30)},
        'manual', ${seed.address}, ${seed.gnr ?? null}, ${seed.bnr ?? null},
        ${seed.orderedBy ?? null}, ${status}, ${status === "rejected" ? "price" : null})
      returning id`;
    if (!row) throw new Error("Kunne ikke lage tilbudet");
    return row.id;
  } finally {
    await db.end();
  }
}

type OfferRow = {
  status: string;
  valid_until: string;
  row_version: number;
  rejected_reason_key: string | null;
  address_text: string;
  assignment_id: string | null;
};

async function offerRow(id: string): Promise<OfferRow> {
  const db = sql();
  try {
    const [row] = await db<OfferRow[]>`
      select status, to_char(valid_until, 'YYYY-MM-DD') as valid_until, row_version,
        rejected_reason_key, address_text, assignment_id
      from orders where id = ${id}`;
    if (!row) throw new Error("Fant ikke tilbudet");
    return row;
  } finally {
    await db.end();
  }
}

async function offersWithAddress(address: string): Promise<{ id: string; status: string }[]> {
  const db = sql();
  try {
    return await db<{ id: string; status: string }[]>`
      select id, status from orders where address_text = ${address} and deleted_at is null`;
  } finally {
    await db.end();
  }
}

type AssignmentRow = {
  id: string;
  address_text: string;
  gnr: string | null;
  bnr: string | null;
  ordered_by_text: string | null;
};

/** Oppdragene laget fra tilbudet (ikke slettede). */
async function assignmentsFromOffer(orderId: string): Promise<AssignmentRow[]> {
  const db = sql();
  try {
    return await db<AssignmentRow[]>`
      select id, address_text, gnr, bnr, ordered_by_text from assignments
      where order_id = ${orderId} and deleted_at is null`;
  } finally {
    await db.end();
  }
}

async function assignmentsWithAddress(address: string): Promise<{ id: string }[]> {
  const db = sql();
  try {
    return await db<{ id: string }[]>`
      select id from assignments where address_text = ${address} and deleted_at is null`;
  } finally {
    await db.end();
  }
}

/** Antallet per filter i Byggcon slik listen skal telle det (dagens dato i Oslo). */
async function offerCountsInDb(): Promise<Record<string, number>> {
  const organizationId = await byggconId();
  const today = todayOslo();
  const db = sql();
  try {
    const [row] = await db<Record<string, number>[]>`
      select
        count(*) filter (where status = 'received' and valid_until >= ${today}::date)::int as open,
        count(*) filter (where status = 'received' and valid_until < ${today}::date)::int as expired,
        count(*) filter (where status = 'rejected')::int as rejected,
        count(*) filter (where status = 'converted')::int as converted,
        count(*)::int as "all"
      from orders where organization_id = ${organizationId} and deleted_at is null`;
    return row!;
  } finally {
    await db.end();
  }
}

/** En annen organisasjon (B) med ett tilbud. Gir id-en til tilbudet og adressen. */
async function offerInOtherOrganization(): Promise<{ id: string; address: string }> {
  const suffix = uniqueSuffix();
  const db = sql();
  let organizationId: string;
  try {
    const [org] = await db<{ id: string }[]>`
      insert into organizations (name, brand_name)
      values (${`Oppdiktet takst B ${suffix}`}, 'Oppdiktet takst B')
      returning id`;
    organizationId = org!.id;
  } finally {
    await db.end();
  }
  const address = `Fremmedveien 3 ${suffix}, 9999 Testby`;
  const id = await insertOffer({ address, organizationId });
  return { id, address };
}

/** Oppdiktet innlogging uten ansattrad. Bare lokal database eller testdatabasen. */
async function createUserWithoutEmployee(): Promise<string> {
  const db = sql();
  const email = `uten-ansatt-${uniqueSuffix()}@example.com`;
  try {
    await db`
      insert into users (id, name, email, email_verified)
      values (${randomUUID()}, 'Oppdiktet uten ansattrad', ${email}, true)`;
  } finally {
    await db.end();
  }
  return email;
}

/* ------------------------------------------------------------- skjermen */

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

function statusNav(page: Page): Locator {
  return page.getByRole("main").getByRole("navigation", { name: "Status" });
}

function filterLink(page: Page, label: string): Locator {
  // Navnet er «Åpne, 3 tilbud» (tallet og «tilbud» bare for skjermleseren); mellomrom før kommaet
  // betyr ingenting for opplesingen.
  return statusNav(page).getByRole("link", { name: new RegExp(`^${label}\\s*(,|$)`) });
}

function convertButton(page: Page): Locator {
  return page.getByRole("button", { name: /^(Gjør om til oppdrag|Lager oppdraget …)$/ });
}

function rejectToggle(page: Page): Locator {
  return page.getByRole("button", { name: "Avslå tilbud", exact: true });
}

function rejectSubmit(page: Page): Locator {
  return page.getByRole("button", { name: "Avslå tilbudet", exact: true });
}

function extendButton(page: Page): Locator {
  return page.getByRole("button", { name: "Forleng 30 dager", exact: true });
}

function deniedHeading(page: Page): Locator {
  return page.getByRole("heading", { name: /^(Ingen tilgang|Fant ikke siden)$/, level: 1 });
}

/**
 * Listen med filter og søk. e2e-databasen tømmes ikke og listen viser høyst 50, så sjekker av én
 * rad søker alltid på den unike adressen.
 */
function listUrl(filter: "open" | "expired" | "rejected" | "converted" | "all", query: string) {
  const params = new URLSearchParams();
  if (filter !== "open") params.set("status", filter);
  params.set("q", query);
  return `/tilbud?${params.toString()}`;
}

/** Raden i tilbudslisten med adressen (lenken til tilbudet). */
function listRow(page: Page, address: string): Locator {
  return page.getByRole("main").getByRole("link").filter({ hasText: address });
}

function changesSection(page: Page): Locator {
  return page
    .locator("section, [role=region]")
    .filter({ has: page.getByRole("heading", { name: "Endringer", exact: true }) })
    .last();
}

/** Velger «Bodø» når kontoret må velges (admin uten kontor); ellers er det forhåndsvalgt. */
async function chooseOfficeIfNeeded(page: Page) {
  // Vent til handlingsblokken er tegnet, ellers kan kontorvalget komme etter sjekken
  await expect(convertButton(page)).toBeVisible();
  const radio = page.getByRole("radio", { name: "Bodø", exact: true });
  if (await radio.isVisible()) await radio.check();
}

/** Ett trykk på «Gjør om til oppdrag» og venter på oppdraget. Gir id-en til oppdraget. */
async function convertWithOneTap(page: Page): Promise<string> {
  await chooseOfficeIfNeeded(page);
  await convertButton(page).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  return ASSIGNMENT_URL.exec(page.url())![1]!;
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
  expect(overflow.scrollWidth, `ingen vannrett rulling på ${where}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/** Hele knappen står i visningsvinduet uten rulling (siden er ikke rullet). */
async function expectFullyVisibleWithoutScroll(page: Page, target: Locator, name: string) {
  await expect(target).toBeVisible();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY, "siden er ikke rullet").toBe(0);
  const box = await target.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box, `${name} har en boks`).not.toBeNull();
  expect(box!.y, `${name} starter i vinduet`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${name} slutter i vinduet`).toBeLessThanOrEqual(viewport.height);
  expect(box!.x + box!.width, `${name} står innenfor bredden`).toBeLessThanOrEqual(viewport.width);
}

/** Kontrast etter WCAG (samme regel som i fase-1-testskjema.spec.ts). Ingen ny avhengighet. */
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

/** Tekstfargen og den første ikke-gjennomsiktige bakgrunnen bak elementet. */
async function colorsOf(target: Locator): Promise<{ foreground: string; background: string }> {
  return target.evaluate((element) => {
    const foreground = getComputedStyle(element).color;
    let node: Element | null = element;
    while (node) {
      const background = getComputedStyle(node).backgroundColor;
      if (background && background !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(background)) {
        return { foreground, background };
      }
      node = node.parentElement;
    }
    return { foreground, background: "rgb(255, 255, 255)" };
  });
}

/** Har elementet med fokus en synlig fokusmarkering (omriss eller skygge)? */
async function hasVisibleFocus(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== "none" && style.boxShadow !== "";
    return outline || shadow;
  });
}

/** Tab til elementet (høyst 80 trykk) og sjekker at det har fokus. */
async function tabTo(page: Page, target: Locator, name: string) {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target, `${name} kan nås med Tab`).toBeFocused();
}

/**
 * Synlig «ordre» i teksten, unntatt «meglerens ordrenummer» og forkortelsen «Meglerens ordrenr.»
 * i listen (samme begrep). Gir funnene.
 */
async function visibleOrdreWords(page: Page): Promise<string[]> {
  const text = await page.locator("body").innerText();
  const cleaned = text
    .replace(/meglerens ordre(nummer|nr\.)/gi, "")
    // Hjelpeteksten under «Meglerens ordrenummer» (samme begrep, meglerens nummer)
    .replace(/Ordrenummeret fra megleren\./g, "");
  return cleaned.match(/[^\s]*ordre[^\s]*/gi) ?? [];
}

/** Går fra nett mens siden er åpen. Settes tilbake i `finally` av testen. */
async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
}

/* =================================================================== pc og ipad */

test.describe("tilbud (pc og ipad)", () => {
  test("5.1 menyen: «Tilbud» står under «Firma» og over «Statistikk», er aktivt på listen og tilbudet, og ingen «ordre» er synlig", async ({
    page,
  }) => {
    const address = `Menyveien 1 ${uniqueSuffix()}, 8000 Bodø`;
    const id = await insertOffer({ address });
    await logIn(page);
    await page.goto("/tilbud");

    const names = (await mainNav(page).getByRole("list").first().getByRole("link").allInnerTexts())
      .map((name) => name.trim())
      .filter(Boolean);
    expect(names).toEqual([
      "Nytt oppdrag",
      "Arbeidskø",
      "Kontakter",
      "Firma",
      "Tilbud",
      "Statistikk",
    ]);
    await expect(mainNav(page).getByRole("link", { name: "Nytt tilbud" })).toHaveCount(0);
    await expect(mainNav(page).getByRole("link", { name: /ordre/i })).toHaveCount(0);

    const menuLink = mainNav(page).getByRole("link", { name: "Tilbud", exact: true });
    await expect(menuLink).toHaveAttribute("aria-current", "page");
    expect(await visibleOrdreWords(page), "/tilbud").toEqual([]);

    await page.goto("/tilbud/ny");
    await expect(menuLink).toHaveAttribute("aria-current", "page");
    expect(await visibleOrdreWords(page), "/tilbud/ny").toEqual([]);

    await page.goto(`/tilbud/${id}`);
    await expect(menuLink).toHaveAttribute("aria-current", "page");
    expect(await visibleOrdreWords(page), "/tilbud/<id>").toEqual([]);
  });

  test("5.2 videresending: /ordre, /ordre/ny og /ordre/<id> gir 308 til /tilbud uten oppslag", async ({
    request,
  }) => {
    const id = randomUUID();
    for (const [from, to] of [
      ["/ordre", "/tilbud"],
      ["/ordre/ny", "/tilbud/ny"],
      [`/ordre/${id}`, `/tilbud/${id}`],
    ] as const) {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      const location = response.headers()["location"] ?? "";
      expect(new URL(location, "http://x").pathname, from).toBe(to);
    }
  });

  test("5.3 /ordre/<id i en annen organisasjon> → /tilbud/<id> → samme svar som ukjent id, og ingen adresse fra B", async ({
    page,
  }) => {
    const other = await offerInOtherOrganization();
    await logIn(page);

    const response = await page.goto(`/ordre/${other.id}`);
    expect(response?.status() ?? 0).toBeLessThan(500);
    await expect(page).toHaveURL(new RegExp(`/tilbud/${other.id}$`));
    await expect(deniedHeading(page)).toBeVisible();
    const deniedText = await deniedHeading(page).innerText();
    expect(await page.content()).not.toContain(other.address);

    // Samme svar som en ukjent id
    await page.goto(`/tilbud/${randomUUID()}`);
    await expect(deniedHeading(page)).toHaveText(deniedText);

    // Listen i A viser ikke B sitt tilbud, heller ikke i «Alle»
    await page.goto(listUrl("all", other.address));
    await expect(page.getByRole("main")).not.toContainText(other.address);
    await expect(page.getByText("Ingen tilbud passer søket.")).toBeVisible();
  });

  test("5.4 «Nytt tilbud» på listen: «Gyldig til» er i dag + 30, lagres og står i «Åpne»", async ({
    page,
  }) => {
    const address = `Nyveien 4 ${uniqueSuffix()}, 8000 Bodø`;
    const expected = addDaysIso(todayOslo(), 30);
    await logIn(page);
    await page.goto("/tilbud");
    await page.getByRole("main").getByRole("link", { name: "Nytt tilbud", exact: true }).click();
    await expect(page).toHaveURL(/\/tilbud\/ny$/);
    await expect(page.getByLabel("Gyldig til")).toHaveValue(expected);

    await page.getByLabel(/^Adresse/).fill(address);
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page).toHaveURL(OFFER_URL);
    await expect(
      page.getByText(`Tilbudet er laget. Gyldig til ${norwegianDate(expected)}.`),
    ).toBeVisible();

    const [saved] = await offersWithAddress(address);
    expect(saved).toBeTruthy();
    expect((await offerRow(saved!.id)).valid_until).toBe(expected);

    await page.goto(listUrl("open", address));
    await expect(filterLink(page, "Åpne")).toHaveAttribute("aria-current", "page");
    await expect(listRow(page, address)).toHaveCount(1);
  });

  test("5.5 «Gjør om til oppdrag» med ett trykk: alt er fylt inn, «Laget fra tilbud» lenker tilbake, og tilbudet er gjort om", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const address = `Ettrykkveien 5 ${suffix}, 8000 Bodø`;
    const orderedBy = `Megler Testesen ${suffix}`;
    const id = await insertOffer({ address, gnr: "12", bnr: "34", orderedBy });
    await logIn(page);
    await page.goto(`/tilbud/${id}`);

    const assignmentId = await convertWithOneTap(page);
    await expect(page.getByText(CONVERTED_RECEIPT).first()).toBeVisible();

    const main = page.getByRole("main");
    await expect(main).toContainText(address);
    await expect(main).toContainText(orderedBy);
    const [copied] = await assignmentsFromOffer(id);
    expect(copied).toMatchObject({
      id: assignmentId,
      address_text: address,
      gnr: "12",
      bnr: "34",
      ordered_by_text: orderedBy,
    });

    await expect(main).toContainText("Laget fra tilbud");
    await main.getByRole("link", { name: "Åpne tilbudet", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tilbud/${id}$`));
    await expect(page.getByRole("main").getByText("Gjort om til oppdrag").first()).toBeVisible();
    await expect(convertButton(page)).toHaveCount(0);
    expect((await offerRow(id)).status).toBe("converted");
  });

  test("5.6 dobbelttrykk på «Gjør om til oppdrag» gir nøyaktig ett oppdrag, og knappen er låst mens lagringen pågår", async ({
    page,
  }) => {
    const address = `Dobbelttrykkveien 6 ${uniqueSuffix()}, 8000 Bodø`;
    const id = await insertOffer({ address });
    await logIn(page);
    await page.goto(`/tilbud/${id}`);
    await chooseOfficeIfNeeded(page);

    // Lagringen holdes igjen litt, så knappen kan sjekkes mens den pågår
    await page.route(`**/tilbud/${id}`, async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await convertButton(page).dblclick();
    await expect(convertButton(page)).toBeDisabled();
    await expect(page).toHaveURL(ASSIGNMENT_URL, { timeout: 15_000 });
    await page.unroute(`**/tilbud/${id}`);

    expect(await assignmentsFromOffer(id)).toHaveLength(1);
    expect(await assignmentsWithAddress(address)).toHaveLength(1);
  });

  test("5.7 admin uten kontor: kontorvalget står ved knappen, og omgjøringen virker med valgt kontor", async ({
    page,
  }) => {
    test.skip(await adminHasOffice(), "Admin fra seed har kontor her; dekket av 3.4.7 i Vitest");
    const address = `Kontorveien 7 ${uniqueSuffix()}, 8000 Bodø`;
    const id = await insertOffer({ address });
    await logIn(page);
    await page.goto(`/tilbud/${id}`);

    const group = page.getByRole("group", { name: "Kontor" });
    await expect(group).toBeVisible();
    await group.getByRole("radio", { name: "Bodø", exact: true }).check();
    await convertButton(page).click();
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    expect(await assignmentsFromOffer(id)).toHaveLength(1);
  });

  test("5.8 og 7.4.4 avslå med grunn: uten valg og «Annet» uten tekst gir melding; «Pris» gir «Avslått: Pris»", async ({
    page,
  }) => {
    const address = `Avslagsveien 8 ${uniqueSuffix()}, 8000 Bodø`;
    const id = await insertOffer({ address });
    await logIn(page);
    await page.goto(`/tilbud/${id}`);

    await rejectToggle(page).click();
    await rejectSubmit(page).click();
    await expect(page.getByText("Velg en grunn.")).toBeVisible();
    expect((await offerRow(id)).status).toBe("received");

    await page.getByRole("radio", { name: "Annet", exact: true }).check();
    await rejectSubmit(page).click();
    await expect(page.getByText("Skriv grunnen.")).toBeVisible();
    await expect(page.getByLabel(/^Mer om grunnen/)).toHaveAttribute("aria-describedby", /.+/);
    expect((await offerRow(id)).status).toBe("received");

    // 7.4.4: valgknappene er minst 44 px og kan brukes med tastaturet
    const price = page.getByRole("radio", { name: "Pris", exact: true });
    const priceLabel = page.locator("label").filter({ has: price });
    await expectAtLeast(priceLabel, "valget «Pris»", 44);
    await price.focus();
    await page.keyboard.press("Space");
    await expect(price).toBeChecked();
    await rejectSubmit(page).click();

    const main = page.getByRole("main");
    await expect(main.getByText("Avslått: Pris", { exact: true })).toBeVisible();
    await expect(convertButton(page)).toHaveCount(0);
    await expect(rejectToggle(page)).toHaveCount(0);
    const row = await offerRow(id);
    expect(row.status).toBe("rejected");
    expect(row.rejected_reason_key).toBe("price");

    await page.goto(listUrl("rejected", address));
    await expect(listRow(page, address)).toHaveCount(1);
    await page.goto(listUrl("open", address));
    await expect(listRow(page, address)).toHaveCount(0);
  });

  test("5.9 utløpt tilbud står i «Utløpt» med «Utløpt [dato]», ikke i «Åpne», og kan gjøres om og avslås", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const validUntil = addDaysIso(todayOslo(), -3);
    const convertAddress = `Utløptveien 9 ${suffix}, 8000 Bodø`;
    const rejectAddress = `Utløptveien 10 ${suffix}, 8000 Bodø`;
    const convertId = await insertOffer({
      address: convertAddress,
      validUntil,
      receivedDaysAgo: 40,
    });
    const rejectId = await insertOffer({ address: rejectAddress, validUntil, receivedDaysAgo: 40 });
    await logIn(page);

    await page.goto(listUrl("expired", convertAddress));
    await expect(filterLink(page, "Utløpt")).toHaveAttribute("aria-current", "page");
    await expect(listRow(page, convertAddress)).toContainText(
      `Utløpt ${norwegianDate(validUntil)}`,
    );
    await page.goto(listUrl("open", convertAddress));
    await expect(listRow(page, convertAddress)).toHaveCount(0);

    await page.goto(`/tilbud/${rejectId}`);
    await expect(page.getByText(`Utløpt ${norwegianDate(validUntil)}`).first()).toBeVisible();
    await rejectToggle(page).click();
    await page.getByRole("radio", { name: "Pris", exact: true }).check();
    await rejectSubmit(page).click();
    await expect(page.getByText("Avslått: Pris", { exact: true })).toBeVisible();
    expect((await offerRow(rejectId)).status).toBe("rejected");

    await page.goto(`/tilbud/${convertId}`);
    await convertWithOneTap(page);
    expect(await assignmentsFromOffer(convertId)).toHaveLength(1);
  });

  test("5.10 utløpt tilbud får ny «Gyldig til» (i dag + 10), står i «Åpne» igjen, og «Endringer» viser datoen", async ({
    page,
  }) => {
    const address = `Nydatoveien 10 ${uniqueSuffix()}, 8000 Bodø`;
    const old = addDaysIso(todayOslo(), -2);
    const next = addDaysIso(todayOslo(), 10);
    const id = await insertOffer({ address, validUntil: old, receivedDaysAgo: 40 });
    await logIn(page);
    await page.goto(`/tilbud/${id}`);

    await page.getByRole("button", { name: "Endre tilbudet", exact: true }).click();
    await page.getByLabel("Gyldig til").fill(next);
    await page.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page.getByText("Endringene er lagret.")).toBeVisible();
    expect((await offerRow(id)).valid_until).toBe(next);

    const changes = changesSection(page);
    await expect(changes).toContainText("Gyldig til");
    await expect(changes).toContainText(norwegianDate(old));
    await expect(changes).toContainText(norwegianDate(next));

    await page.goto(listUrl("open", address));
    await expect(listRow(page, address)).toHaveCount(1);
    await page.goto(listUrl("expired", address));
    await expect(listRow(page, address)).toHaveCount(0);
  });

  test("5.11 filteret står i adressen: «Utløpt» → tilbudet → «Tilbake» gir samme filter og liste; søk og filter virker sammen", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const expiredAddress = `Filterveien 11 ${suffix}, 8000 Bodø`;
    const openAddress = `Filterveien 12 ${suffix}, 8000 Bodø`;
    await insertOffer({
      address: expiredAddress,
      validUntil: addDaysIso(todayOslo(), -1),
      receivedDaysAgo: 35,
    });
    await insertOffer({ address: openAddress });
    await logIn(page);

    // Søk på den unike endingen, så klikk «Utløpt»: filteret og søket står begge i adressen
    await page.goto("/tilbud");
    const search = page.getByRole("main").getByRole("searchbox");
    await search.fill(suffix);
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(listRow(page, openAddress)).toHaveCount(1);
    await expect(listRow(page, expiredAddress)).toHaveCount(0);

    await filterLink(page, "Utløpt").click();
    await expect(page).toHaveURL(/[?&]status=expired/);
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(filterLink(page, "Utløpt")).toHaveAttribute("aria-current", "page");
    await expect(listRow(page, expiredAddress)).toHaveCount(1);
    await expect(listRow(page, openAddress)).toHaveCount(0);

    // Åpne tilbudet og «Tilbake»: samme filter, samme søk, samme liste
    await listRow(page, expiredAddress).click();
    await expect(page).toHaveURL(OFFER_URL);
    await page.goBack();
    await expect(page).toHaveURL(/[?&]status=expired/);
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(filterLink(page, "Utløpt")).toHaveAttribute("aria-current", "page");
    await expect(search).toHaveValue(suffix);
    await expect(listRow(page, expiredAddress)).toHaveCount(1);
    await expect(listRow(page, openAddress)).toHaveCount(0);

    await filterLink(page, "Alle").click();
    await expect(page).toHaveURL(/[?&]status=all/);
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(listRow(page, expiredAddress)).toHaveCount(1);
    await expect(listRow(page, openAddress)).toHaveCount(1);
  });

  test("5.12 et åpent og et utløpt tilbud vises ikke i arbeidskøen, og tallene i fanene er uendret", async ({
    page,
  }) => {
    await logIn(page);
    const readCounts = async () => {
      await page.goto("/arbeidskoe");
      const counts: Record<string, string> = {};
      for (const status of ["ordered", "in_progress", "completed", "invoiced"]) {
        const target = page.getByTestId(`work-queue-count-${status}`);
        counts[status] = (await target.count()) > 0 ? await target.innerText() : "";
      }
      return counts;
    };
    const before = await readCounts();

    const suffix = uniqueSuffix();
    const openAddress = `Køveien 12 ${suffix}, 8000 Bodø`;
    const expiredAddress = `Køveien 13 ${suffix}, 8000 Bodø`;
    await insertOffer({ address: openAddress });
    await insertOffer({
      address: expiredAddress,
      validUntil: addDaysIso(todayOslo(), -5),
      receivedDaysAgo: 40,
    });

    expect(await readCounts()).toEqual(before);
    await page.goto(`/arbeidskoe?q=${encodeURIComponent(`Køveien 1`)}`);
    await expect(page.getByRole("main")).not.toContainText(openAddress);
    await expect(page.getByRole("main")).not.toContainText(expiredAddress);
  });

  test("5.13 takstmann og kontor ser listen og kan gjøre om", async ({ page, browser }) => {
    const suffix = uniqueSuffix();
    const inspectorAddress = `Rolleveien 13 ${suffix}, 8000 Bodø`;
    const officeAddress = `Rolleveien 14 ${suffix}, 8000 Bodø`;
    const inspectorOffer = await insertOffer({ address: inspectorAddress });
    const officeOffer = await insertOffer({ address: officeAddress });

    await logInAsInspector(page);
    await page.goto(listUrl("open", inspectorAddress));
    await expect(listRow(page, inspectorAddress)).toHaveCount(1);
    await listRow(page, inspectorAddress).click();
    await convertWithOneTap(page);
    expect(await assignmentsFromOffer(inspectorOffer)).toHaveLength(1);

    const { baseURL, viewport, hasTouch } = test.info().project.use;
    const officeContext = await browser.newContext({
      baseURL,
      viewport,
      hasTouch,
      locale: "nb-NO",
    });
    try {
      const officePage = await officeContext.newPage();
      await logInAsOffice(officePage);
      await officePage.goto(listUrl("open", officeAddress));
      await expect(listRow(officePage, officeAddress)).toHaveCount(1);
      await listRow(officePage, officeAddress).click();
      await convertWithOneTap(officePage);
      expect(await assignmentsFromOffer(officeOffer)).toHaveLength(1);
    } finally {
      await officeContext.close();
    }
  });

  test("5.14 bruker uten ansattrad får «Ingen tilgang» på /tilbud og /tilbud/<id>, og ingen adresse er synlig", async ({
    page,
  }) => {
    const address = `Tilgangsveien 14 ${uniqueSuffix()}, 8000 Bodø`;
    const id = await insertOffer({ address });
    const email = await createUserWithoutEmployee();
    await page.goto("/logg-inn");
    await signInWithCode(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/logg-inn"));

    for (const url of ["/tilbud", `/tilbud/${id}`]) {
      const response = await page.goto(url);
      expect(response?.status() ?? 0, url).toBeLessThan(500);
      await expect(deniedHeading(page)).toBeVisible();
      expect(await page.content(), url).not.toContain(address);
      await expect(convertButton(page)).toHaveCount(0);
    }
  });

  test.describe("5.15 uten nett", () => {
    test.afterEach(async ({ context }) => {
      await context.setOffline(false);
    });

    test("«Nytt tilbud»: meldingen, teksten står igjen, ingenting lagret; med nett igjen lagres det", async ({
      page,
      context,
    }) => {
      const address = `Nettveien 1 ${uniqueSuffix()}, 8000 Bodø`;
      await logIn(page);
      await page.goto("/tilbud/ny");
      await page.getByLabel(/^Adresse/).fill(address);
      await goOffline(context);
      await page.getByRole("button", { name: "Lagre", exact: true }).click();
      await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
      await expect(page.getByLabel(/^Adresse/)).toHaveValue(address);
      expect(await offersWithAddress(address)).toHaveLength(0);

      await context.setOffline(false);
      await page.getByRole("button", { name: "Lagre", exact: true }).click();
      await expect(page).toHaveURL(OFFER_URL);
      expect(await offersWithAddress(address)).toHaveLength(1);
    });

    test("«Avslå tilbud»: meldingen, valget står igjen, tilbudet er fortsatt åpent", async ({
      page,
      context,
    }) => {
      const id = await insertOffer({ address: `Nettveien 2 ${uniqueSuffix()}, 8000 Bodø` });
      await logIn(page);
      await page.goto(`/tilbud/${id}`);
      await rejectToggle(page).click();
      await page.getByRole("radio", { name: "Annet", exact: true }).check();
      await page.getByLabel(/^Mer om grunnen/).fill("Oppdiktet grunn");
      await goOffline(context);
      await rejectSubmit(page).click();
      await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
      await expect(page.getByLabel(/^Mer om grunnen/)).toHaveValue("Oppdiktet grunn");
      const row = await offerRow(id);
      expect(row.status).toBe("received");
      expect(row.rejected_reason_key).toBeNull();
    });

    test("«Endre»: meldingen, den nye adressen står igjen, ingenting lagret", async ({
      page,
      context,
    }) => {
      const suffix = uniqueSuffix();
      const address = `Nettveien 3 ${suffix}, 8000 Bodø`;
      const next = `Nettgata 3 ${suffix}, 8006 Bodø`;
      const id = await insertOffer({ address });
      const before = await offerRow(id);
      await logIn(page);
      await page.goto(`/tilbud/${id}`);
      await page.getByRole("button", { name: "Endre tilbudet", exact: true }).click();
      await page.getByLabel(/^Adresse/).fill(next);
      await goOffline(context);
      await page.getByRole("button", { name: "Lagre", exact: true }).click();
      await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
      await expect(page.getByLabel(/^Adresse/)).toHaveValue(next);
      const after = await offerRow(id);
      expect(after.address_text).toBe(address);
      expect(after.row_version).toBe(before.row_version);
    });

    test("«Forleng 30 dager»: meldingen, datoen er uendret", async ({ page, context }) => {
      const validUntil = addDaysIso(todayOslo(), -1);
      const id = await insertOffer({
        address: `Nettveien 4 ${uniqueSuffix()}, 8000 Bodø`,
        validUntil,
        receivedDaysAgo: 35,
      });
      await logIn(page);
      await page.goto(`/tilbud/${id}`);
      await goOffline(context);
      await extendButton(page).click();
      await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
      expect((await offerRow(id)).valid_until).toBe(validUntil);
    });

    test("«Gjør om til oppdrag»: meldingen, ingen oppdrag", async ({ page, context }) => {
      const id = await insertOffer({ address: `Nettveien 5 ${uniqueSuffix()}, 8000 Bodø` });
      await logIn(page);
      await page.goto(`/tilbud/${id}`);
      await chooseOfficeIfNeeded(page);
      await goOffline(context);
      await convertButton(page).click();
      await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
      expect(await assignmentsFromOffer(id)).toHaveLength(0);
      expect((await offerRow(id)).status).toBe("received");
    });

    test("«Lagre som tilbud i stedet»: meldingen, adressen står igjen, intet tilbud", async ({
      page,
      context,
    }) => {
      const address = `Nettveien 6 ${uniqueSuffix()}, 8000 Bodø`;
      await logIn(page);
      await page.goto("/oppdrag/ny");
      const addressField = page.getByRole("main").getByLabel("Adresse", { exact: true });
      await addressField.fill(address);
      await goOffline(context);
      await page.getByRole("button", { name: "Lagre som tilbud i stedet", exact: true }).click();
      await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
      await expect(addressField).toHaveValue(address);
      expect(await offersWithAddress(address)).toHaveLength(0);
      expect(await assignmentsWithAddress(address)).toHaveLength(0);
    });
  });

  test("5.16 og 7.3.5 tilgjengelighet: h1, valgt filter, tall på knappene, og kontrast på merkene", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const today = todayOslo();
    const open = `Kontrastveien 1 ${suffix}, 8000 Bodø`;
    const soon = `Kontrastveien 2 ${suffix}, 8000 Bodø`;
    const expired = `Kontrastveien 3 ${suffix}, 8000 Bodø`;
    const rejected = `Kontrastveien 4 ${suffix}, 8000 Bodø`;
    await insertOffer({ address: open });
    await insertOffer({ address: soon, validUntil: addDaysIso(today, 3) });
    await insertOffer({ address: expired, validUntil: addDaysIso(today, -4), receivedDaysAgo: 40 });
    await insertOffer({ address: rejected, status: "rejected" });
    await logIn(page);
    await page.goto("/tilbud");

    await expect(
      page.getByRole("heading", { level: 1, name: "Tilbud", exact: true }),
    ).toBeVisible();
    await expect(filterLink(page, "Åpne")).toHaveAttribute("aria-current", "page");
    for (const label of ["Utløpt", "Avslått", "Gjort om til oppdrag", "Alle"]) {
      await expect(filterLink(page, label)).not.toHaveAttribute("aria-current", /.+/);
    }

    // 7.3.5: tallene på knappene er de samme som i databasen, og skjermleseren får «Åpne, N tilbud»
    const counts = await offerCountsInDb();
    for (const [filter, label] of [
      ["open", "Åpne"],
      ["expired", "Utløpt"],
      ["rejected", "Avslått"],
      ["converted", "Gjort om til oppdrag"],
      ["all", "Alle"],
    ] as const) {
      await expect(page.getByTestId(`offer-count-${filter}`)).toHaveText(String(counts[filter]));
      await expect(
        statusNav(page).getByRole("link", {
          name: new RegExp(`^${label}\\s*, ${counts[filter]} tilbud$`),
        }),
      ).toHaveCount(1);
    }

    // «Går ut om 3 dager» har ikon og tekst
    await page.goto(listUrl("open", suffix));
    const soonBadge = listRow(page, soon).getByText("Går ut om 3 dager", { exact: true });
    await expect(soonBadge).toBeVisible();
    await expect(listRow(page, soon).locator("svg")).not.toHaveCount(0);

    // Kontrast på merkene, minst 4,5:1
    await page.goto(listUrl("all", suffix));
    const badges: [string, string][] = [
      [open, "Åpent"],
      [soon, "Går ut om 3 dager"],
      [expired, `Utløpt ${norwegianDate(addDaysIso(today, -4))}`],
      [rejected, "Avslått"],
    ];
    for (const [address, text] of badges) {
      const badge = listRow(page, address).getByText(text, { exact: true });
      await expect(badge, text).toBeVisible();
      const colors = await colorsOf(badge);
      expect(
        contrastRatio(colors.foreground, colors.background),
        `${text}: ${colors.foreground} mot ${colors.background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("5.17 tastatur: filter, «Gjør om til oppdrag» og «Avslå tilbud» nås med Tab, brukes med Enter og har synlig fokus", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const rejectId = await insertOffer({ address: `Tastveien 1 ${suffix}, 8000 Bodø` });
    const convertId = await insertOffer({ address: `Tastveien 2 ${suffix}, 8000 Bodø` });
    await logIn(page);

    await page.goto("/tilbud");
    const expiredFilter = filterLink(page, "Utløpt");
    await tabTo(page, expiredFilter, "filteret «Utløpt»");
    expect(await hasVisibleFocus(expiredFilter), "synlig fokus på filteret").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]status=expired/);

    await page.goto(`/tilbud/${rejectId}`);
    await tabTo(page, rejectToggle(page), "«Avslå tilbud»");
    expect(await hasVisibleFocus(rejectToggle(page)), "synlig fokus på «Avslå tilbud»").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Avslå tilbudet" })).toBeVisible();

    await page.goto(`/tilbud/${convertId}`);
    await chooseOfficeIfNeeded(page);
    const button = page.getByRole("button", { name: "Gjør om til oppdrag", exact: true });
    await tabTo(page, button, "«Gjør om til oppdrag»");
    expect(await hasVisibleFocus(button), "synlig fokus på «Gjør om til oppdrag»").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(ASSIGNMENT_URL);
    expect(await assignmentsFromOffer(convertId)).toHaveLength(1);
  });

  test("7.1.5 «Forleng 30 dager» på tilbudssiden: «Gyldig til [dato].», står i «Åpne», og knappen er minst 44 px", async ({
    page,
  }) => {
    const address = `Forlengveien 1 ${uniqueSuffix()}, 8000 Bodø`;
    const expected = addDaysIso(todayOslo(), 30);
    const id = await insertOffer({
      address,
      validUntil: addDaysIso(todayOslo(), -2),
      receivedDaysAgo: 40,
    });
    await logIn(page);

    await page.goto(`/tilbud/${id}`);
    await expectAtLeast(extendButton(page), "«Forleng 30 dager»", 44);
    await extendButton(page).click();
    await expect(page.getByText(`Gyldig til ${norwegianDate(expected)}.`).first()).toBeVisible();
    expect((await offerRow(id)).valid_until).toBe(expected);

    await page.goto(listUrl("open", address));
    await expect(listRow(page, address)).toHaveCount(1);
  });

  test("7.1.5 «Forleng 30 dager» i listen «Utløpt»: kvitteringen har adressen, og raden går til «Åpne»", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const first = `Forlengveien 2 ${suffix}, 8000 Bodø`;
    const second = `Forlengveien 3 ${suffix}, 8000 Bodø`;
    const expected = addDaysIso(todayOslo(), 30);
    const firstId = await insertOffer({
      address: first,
      validUntil: addDaysIso(todayOslo(), -2),
      receivedDaysAgo: 40,
    });
    await insertOffer({
      address: second,
      validUntil: addDaysIso(todayOslo(), -2),
      receivedDaysAgo: 40,
    });
    await logIn(page);

    // To utløpte i listen; den ene forlenges, den andre står igjen
    await page.goto(listUrl("expired", suffix));
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: first });
    const button = row.getByRole("button", { name: "Forleng 30 dager" });
    await expectAtLeast(button, "«Forleng 30 dager» i listen", 44);
    await button.click();
    await expect(
      page.getByText(`${first} er gyldig til ${norwegianDate(expected)}.`),
    ).toBeVisible();
    expect((await offerRow(firstId)).valid_until).toBe(expected);
    await expect(listRow(page, first)).toHaveCount(0);
    await expect(listRow(page, second)).toHaveCount(1);

    await page.goto(listUrl("open", first));
    await expect(listRow(page, first)).toHaveCount(1);
  });

  test("7.1.5 «Forleng 30 dager» på den siste raden i «Utløpt»: kvitteringen vises også når listen blir tom", async ({
    page,
  }) => {
    const address = `Forlengveien 4 ${uniqueSuffix()}, 8000 Bodø`;
    const expected = addDaysIso(todayOslo(), 30);
    const id = await insertOffer({
      address,
      validUntil: addDaysIso(todayOslo(), -2),
      receivedDaysAgo: 40,
    });
    await logIn(page);

    // Søket gir én rad; etter forleng er «Utløpt» tom for søket. A372: kvitteringen står over listen.
    await page.goto(`/tilbud?status=expired&q=${encodeURIComponent(address)}`);
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: address });
    await row.getByRole("button", { name: "Forleng 30 dager" }).click();
    await expect.poll(async () => (await offerRow(id)).valid_until).toBe(expected);
    await expect(
      page.getByText(`${address} er gyldig til ${norwegianDate(expected)}.`),
    ).toBeVisible();
  });

  test("7.2.6 åpent tilbud → «Nytt oppdrag» med samme adresse → «Gjør om tilbudet» → ett trykk: ett oppdrag, og tilbudet er gjort om", async ({
    page,
  }) => {
    const address = `Testveien 12 dbl${uniqueSuffix()}, 8000 Bodø`;
    const id = await insertOffer({ address });
    await logIn(page);
    await page.goto("/oppdrag/ny");
    const addressField = page.getByRole("main").getByLabel("Adresse", { exact: true });
    await addressField.fill(address);
    await addressField.press("Tab");

    const notice = page.getByRole("status").filter({ hasText: "Mulig dublett" });
    await notice.getByRole("link", { name: "Gjør om tilbudet", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tilbud/${id}#gjor-om$`));
    await convertWithOneTap(page);

    expect(await assignmentsFromOffer(id)).toHaveLength(1);
    expect(await assignmentsWithAddress(address)).toHaveLength(1);
    expect((await offerRow(id)).status).toBe("converted");
  });
});

/* ======================================================================= bare ipad */

test.describe("tilbud (bare ipad)", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "ipad", "Bare i prosjektet ipad");
  });

  test("5.18 «Gjør om til oppdrag» er helt synlig uten rulling og minst 56 px, også med dublettvarsel og lang adresse", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const longAddress = `Den svært lange oppdiktede Testveigata med mange ord i navnet 128 B ${suffix}, 8000 Bodø`;
    // To tilbud med samme adresse gir dublettvarselet
    const id = await insertOffer({ address: longAddress, gnr: "12", bnr: "34" });
    await insertOffer({ address: longAddress, gnr: "12", bnr: "34" });
    await logIn(page);

    for (const viewport of [PORTRAIT, LANDSCAPE]) {
      await page.setViewportSize(viewport);
      await page.goto(`/tilbud/${id}`);
      await expect(page.getByText(/Mulig dublett/).first()).toBeVisible();
      const button = page.getByRole("button", { name: "Gjør om til oppdrag", exact: true });
      await expectFullyVisibleWithoutScroll(
        page,
        button,
        `«Gjør om til oppdrag» (${viewport.width})`,
      );
      await expectAtLeast(button, "«Gjør om til oppdrag»", 56);
    }
  });

  test("5.19 filterknappene og «Avslå tilbud» er minst 44 px høye", async ({ page }) => {
    const id = await insertOffer({ address: `Flateveien 19 ${uniqueSuffix()}, 8000 Bodø` });
    await logIn(page);
    for (const viewport of [PORTRAIT, LANDSCAPE]) {
      await page.setViewportSize(viewport);
      await page.goto("/tilbud");
      for (const label of ["Åpne", "Utløpt", "Avslått", "Gjort om til oppdrag", "Alle"]) {
        await expectAtLeast(filterLink(page, label), `filteret «${label}»`, 44);
      }
      await page.goto(`/tilbud/${id}`);
      await expectAtLeast(rejectToggle(page), "«Avslå tilbud»", 44);
    }
  });

  test("5.20 ingen vannrett rulling på /tilbud, /tilbud/ny og /tilbud/<id>", async ({ page }) => {
    const id = await insertOffer({
      address: `Rulleveien 20 med et langt oppdiktet navn ${uniqueSuffix()}, 8000 Bodø`,
    });
    await logIn(page);
    for (const viewport of [PORTRAIT, LANDSCAPE]) {
      await page.setViewportSize(viewport);
      for (const url of ["/tilbud", "/tilbud?status=all", "/tilbud/ny", `/tilbud/${id}`]) {
        await page.goto(url);
        await expectNoHorizontalScroll(page, `${url} (${viewport.width} px)`);
      }
    }
  });

  test("5.21 og 7.5.1 flyten i stående: lag tilbud, gjør om med ett trykk (pekeren til takstmann synes), og avslå et annet", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const first = `Ipadveien 21 ${suffix}, 8000 Bodø`;
    const second = `Ipadveien 22 ${suffix}, 8000 Bodø`;
    await page.setViewportSize(PORTRAIT);
    await logIn(page);

    const create = async (address: string) => {
      await page.goto("/tilbud");
      await page.getByRole("main").getByRole("link", { name: "Nytt tilbud", exact: true }).click();
      await page.getByLabel(/^Adresse/).fill(address);
      await page.getByRole("button", { name: "Lagre", exact: true }).click();
      await expect(page).toHaveURL(OFFER_URL);
      return OFFER_URL.exec(page.url())![1]!;
    };

    const firstId = await create(first);
    await convertWithOneTap(page);
    const receipt = page.getByRole("status").filter({ hasText: CONVERTED_RECEIPT });
    await expect(receipt).toBeVisible();
    await receipt.getByRole("link", { name: POINTER_LINK }).click();
    await expect(page.locator("#takstmann")).toBeInViewport();
    expect(await assignmentsFromOffer(firstId)).toHaveLength(1);

    const secondId = await create(second);
    await rejectToggle(page).click();
    await page.getByRole("radio", { name: "Kunden trakk seg", exact: true }).check();
    await rejectSubmit(page).click();
    await expect(page.getByText("Avslått: Kunden trakk seg", { exact: true })).toBeVisible();
    expect((await offerRow(secondId)).status).toBe("rejected");
  });
});
