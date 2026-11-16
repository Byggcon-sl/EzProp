import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  convertedAssignmentLink,
  ADMIN_EMAIL,
  employeeByEmail,
  logIn,
  uniqueSuffix,
} from "./helpers";

/*
 * Oppdragslisten som arbeidskø (fase 2a).
 * Testplan: docs/funksjoner/fase2a-arbeidsko-testplan.md avsnitt 4. Kjører i prosjektene pc og
 * ipad. Uten JavaScript bare i pc; iPad stående (4.6) bare i ipad.
 *
 * Admin fra seed; Byggcon har kontoret «Bodø» fra seed. Hver test lager sitt eget oppdrag med en
 * unik ending i adressen og søker på den, fordi e2e-databasen ikke tømmes. Antall sjekkes bare som
 * tall, aldri som faste verdier. Data er oppdiktet; «fødselsnummeret» er elleve sifre som ikke er
 * et gyldig nummer. Takstmann med innstillingen av (4.7) er dekket av kjernetestene (2.8).
 *
 * Støtter hovedmål: tid (ett trykk til oppdraget, notat uten å forlate køen) og reklamasjoner
 * («Forfalt» og «Befaring ikke avtalt» synes på kortet).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ORDER_URL = new RegExp(`/ordre/(${UUID})$`);
const ASSIGNMENT_URL = new RegExp(`/oppdrag/(${UUID})$`);
const NUMBER = /\d{4}-\d{5}/;
const PORTRAIT = { width: 834, height: 1194 } as const;
const STATUSES = ["ordered", "in_progress", "completed", "invoiced"] as const;
const FAKE_NATIONAL_ID = "12345678901";

type Created = { id: string; number: string; address: string; suffix: string };

/** Ny ordre med unik adresse → «Gjør om til oppdrag» → åpner oppdraget. */
async function newAssignment(page: Page): Promise<Created> {
  const suffix = `ko${uniqueSuffix()}`;
  const address = `Køveien 12 ${suffix}, 8000 Bodø`;
  await page.goto("/ordre/ny");
  await page.getByLabel(/^Adresse/).fill(address);
  await page.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(page).toHaveURL(ORDER_URL);
  await page.getByLabel(/^Kontor/).selectOption({ label: "Bodø" });
  await page.getByRole("button", { name: "Gjør om til oppdrag", exact: true }).click();
  await expect(convertedAssignmentLink(page)).toBeVisible();
  await convertedAssignmentLink(page).click();
  await expect(page).toHaveURL(ASSIGNMENT_URL);
  const id = ASSIGNMENT_URL.exec(page.url())![1]!;
  const heading = await page.getByRole("heading", { level: 1 }).innerText();
  return { id, number: NUMBER.exec(heading)![0], address, suffix };
}

/** Setter admin som ansvarlig takstmann (gir «Mine») og venter til det er lagret. */
async function setAdminResponsible(page: Page, admin: { id: string; name: string }) {
  const line = page
    .getByRole("region", { name: "Team", exact: true })
    .getByRole("listitem", { name: "Ansvarlig takstmann", exact: true });
  await line.getByRole("combobox").selectOption(admin.id);
  await line.getByRole("button", { name: "Lagre", exact: true }).click();
  await expect(line.locator("h3 + p")).toHaveText(admin.name);
}

/** «Sett til Under arbeid» på oppdragssiden. */
async function startWork(page: Page) {
  const status = page.getByRole("region", { name: "Status", exact: true });
  await status.getByRole("button", { name: "Sett til Under arbeid", exact: true }).click();
  await expect(status.getByRole("button", { name: "Sett til Ferdig", exact: true })).toBeVisible();
}

function statusNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Status" });
}

function filterNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Filter" });
}

function tab(page: Page, label: string): Locator {
  return statusNav(page).getByRole("link", { name: new RegExp(`^${label}`) });
}

function cards(page: Page): Locator {
  return page.getByTestId("work-queue-card");
}

function noteSummary(card: Locator): Locator {
  return card.locator("summary");
}

async function expectAtLeast44(target: Locator, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
}

/** Dagens dato i norsk tid minus `days`, som «ÅÅÅÅ-MM-DD». */
function osloDate(days = 0): string {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(at);
}

/** Køen for «Alle» med søket, i fanen. */
function queueUrl(status: string, query: string): string {
  return `/arbeidskoe?status=${status}&mine=0&q=${encodeURIComponent(query)}`;
}

test.describe("arbeidskøen (pc og ipad)", () => {
  test("4.1 gjennomgang: faner, tilbake, Mine/Alle, søk og notat", async ({ page }) => {
    const admin = await employeeByEmail(ADMIN_EMAIL);
    await logIn(page);
    const created = await newAssignment(page);
    await setAdminResponsible(page, admin);
    await startWork(page);

    // Startsiden: «Under arbeid» er valgt, alle fire faner har antall. Admin fra seed har ikke
    // takstmann-rollen, så standarden er «Alle» (T-0029, docs/funksjoner/fase2a-sok-ordre-arbeidsko.md).
    await page.goto("/arbeidskoe");
    await expect(tab(page, "Under arbeid")).toHaveAttribute("aria-current", "page");
    await expect(filterNav(page).getByRole("link", { name: "Alle" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const status of STATUSES) {
      await expect(page.getByTestId(`work-queue-count-${status}`)).toHaveText(/^\d+$/);
    }

    // Bytt fane og tilbake
    await tab(page, "Bestilt").click();
    await expect(page).toHaveURL(/\?status=ordered&mine=0$/);
    await expect(tab(page, "Bestilt")).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).toHaveURL(/\/arbeidskoe$/);
    await expect(tab(page, "Under arbeid")).toHaveAttribute("aria-current", "page");

    // «Alle» og søk
    await filterNav(page).getByRole("link", { name: "Alle" }).click();
    await expect(page).toHaveURL(/mine=0/);
    await page
      .getByRole("searchbox", { name: "Søk på adresse, nummer, megler eller gnr/bnr" })
      .fill(created.suffix);
    await page.getByRole("button", { name: "Søk", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=${created.suffix}`));
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByTestId("work-queue-count-in_progress")).toHaveText("1");

    const card = cards(page).first();
    await expect(card.getByRole("link", { name: created.address })).toHaveAttribute(
      "href",
      `/oppdrag/${created.id}`,
    );
    await expect(card).toContainText(created.number);
    await expect(card).toContainText("Under arbeid");
    await expect(card).toContainText("Befaring ikke avtalt");
    await expect(card).toContainText("Ingen frist");
    await expect(card).toContainText(admin.name);

    // Notat: åpne, skriv, lagre
    await noteSummary(card).click();
    await card.getByLabel("Notat").fill("Venter på nøkkel");
    await card.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#kort-${created.id}$`));
    await expect(page).toHaveURL(/status=in_progress&mine=0/);
    await expect(cards(page).first()).toContainText("Venter på nøkkel");

    // Fokusringen (nattløkkens punkt 3, testplan T2 7.7): kortet har fokus og synlig ring
    await expect(page.locator(`#kort-${created.id}`)).toBeFocused();
    const ring = await page.locator(`#kort-${created.id}`).evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(ring.style, "kortet har synlig fokusring").not.toBe("none");
    expect(ring.width, "fokusringen er bredere enn 0").toBeGreaterThan(0);

    // Hopplenken (testplan T2 7.8): målet får fokus og fortsatt ingen ring. Siden lastes på nytt
    // uten #kort-, så Tab starter øverst og ikke fra kortet som hadde fokus.
    await page.goto(page.url().split("#")[0]!);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Hopp til hovedinnhold" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    const target = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const style = active ? getComputedStyle(active) : null;
      return {
        inTarget: Boolean(active?.closest("#hovedinnhold")),
        tag: active?.tagName.toLowerCase() ?? "",
        id: active?.id ?? "",
        outline: style?.outlineStyle ?? "",
        width: style ? parseFloat(style.outlineWidth) : 0,
      };
    });
    expect(target.inTarget, "fokus er i #hovedinnhold").toBe(true);
    expect(["main", "div"]).toContain(target.tag);
    expect(target.tag === "main" || target.id === "hovedinnhold").toBe(true);
    expect(
      target.outline === "none" || target.width === 0,
      `ingen ring rundt hovedinnholdet (${target.outline} ${target.width}px)`,
    ).toBe(true);

    await page.reload();
    await expect(cards(page).first()).toContainText("Venter på nøkkel");
    await expect(cards(page).first().getByLabel("Notat")).toBeHidden();

    // Avbryt lar notatet stå
    await noteSummary(cards(page).first()).click();
    await cards(page).first().getByLabel("Notat").fill("Endret tekst");
    await cards(page).first().getByRole("link", { name: "Avbryt", exact: true }).click();
    await expect(cards(page).first().getByLabel("Notat")).toBeHidden();
    await expect(cards(page).first()).toContainText("Venter på nøkkel");
    await expect(cards(page).first()).not.toContainText("Endret tekst");

    // Tøm og lagre
    await noteSummary(cards(page).first()).click();
    await cards(page).first().getByLabel("Notat").fill("");
    await cards(page).first().getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#kort-${created.id}$`));
    await expect(cards(page).first()).not.toContainText("Venter på nøkkel");
  });

  test("4.2 befaring og frist på oppdraget gir merkene i køen", async ({ page }) => {
    await logIn(page);
    const created = await newAssignment(page);
    await startWork(page);

    const schedule = page.getByRole("region", { name: "Befaring og frist", exact: true });
    const yesterday = osloDate(1);
    await schedule.getByLabel("Avtalt befaring").fill(`${yesterday}T09:00`);
    await schedule.getByLabel("Frist for levering").fill(yesterday);
    await schedule.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(schedule.getByText("Befaring og frist er lagret.")).toBeVisible();

    await page.goto(queueUrl("in_progress", created.suffix));
    const card = cards(page).first();
    await expect(cards(page)).toHaveCount(1);
    await expect(card).toContainText(/Befaring \d{1,2}\. \S+ (\d{4} )?kl\. 09:00/);
    await expect(card).toContainText(/Frist \d{1,2}\. /);
    await expect(card.getByText("Forfalt", { exact: true })).toBeVisible();

    // Tøm begge
    await page.goto(`/oppdrag/${created.id}`);
    await expect(schedule.getByLabel("Frist for levering")).toHaveValue(yesterday);
    await schedule.getByLabel("Avtalt befaring").fill("");
    await schedule.getByLabel("Frist for levering").fill("");
    await schedule.getByRole("button", { name: "Lagre", exact: true }).click();
    await expect(schedule.getByText("Befaring og frist er lagret.")).toBeVisible();

    await page.goto(queueUrl("in_progress", created.suffix));
    await expect(cards(page).first()).toContainText("Befaring ikke avtalt");
    await expect(cards(page).first()).toContainText("Ingen frist");
    await expect(cards(page).first().getByText("Forfalt", { exact: true })).toHaveCount(0);
  });

  // Endret med «Nytt oppdrag» (docs/funksjoner/fase2a-nytt-oppdrag.md, Omfang 9): «Ny ordre» i
  // den tomme fanen er byttet med «Nytt oppdrag».
  test("4.3 tom fane: tekst og «Nytt oppdrag» i Bestilt", async ({ page }) => {
    await logIn(page);
    await page.goto(queueUrl("ordered", `finnes-ikke-${uniqueSuffix()}`));
    const empty = page.getByTestId("work-queue-empty");
    await expect(empty).toContainText("Ingen oppdrag med status Bestilt.");
    await expect(cards(page)).toHaveCount(0);
    await expect(empty.getByRole("link", { name: "Ny ordre", exact: true })).toHaveCount(0);
    await empty.getByRole("link", { name: "Nytt oppdrag", exact: true }).click();
    await expect(page).toHaveURL(/\/oppdrag\/ny$/);
  });

  test("4.5 notat med fødselsnummer avvises ved feltet, ingenting lagres", async ({ page }) => {
    await logIn(page);
    const created = await newAssignment(page);

    await page.goto(queueUrl("ordered", created.suffix));
    const card = cards(page).first();
    await noteSummary(card).click();
    await card.getByLabel("Notat").fill(`Ring ${FAKE_NATIONAL_ID}`);
    await card.getByRole("button", { name: "Lagre", exact: true }).click();

    await expect(page).toHaveURL(/feil=fnr/);
    expect(page.url()).not.toContain(FAKE_NATIONAL_ID);
    const after = cards(page).first();
    await expect(after.getByText("Fødselsnummer skal ikke lagres her.")).toBeVisible();
    await expect(after.getByLabel("Notat")).toHaveValue("");
    await expect(after).not.toContainText(FAKE_NATIONAL_ID);
  });

  test("4.6 iPad stående: ingen vannrett rulling, trykkflater minst 44 px", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "ipad", "bare iPad");
    await logIn(page);
    const created = await newAssignment(page);
    await page.setViewportSize(PORTRAIT);
    await page.goto(queueUrl("ordered", created.suffix));

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, "ingen vannrett rulling").toBeLessThanOrEqual(
      overflow.clientWidth,
    );

    for (const label of ["Bestilt", "Under arbeid", "Ferdig", "Fakturert"]) {
      await expectAtLeast44(tab(page, label), `fanen ${label}`);
    }
    await expectAtLeast44(filterNav(page).getByRole("link", { name: "Mine" }), "Mine");
    const card = cards(page).first();
    await expectAtLeast44(card.getByRole("link", { name: created.address }), "kortlenken");
    await expectAtLeast44(noteSummary(card), "Notat");
    await noteSummary(card).click();
    await expectAtLeast44(card.getByRole("button", { name: "Lagre", exact: true }), "Lagre");
    await expectAtLeast44(card.getByRole("link", { name: "Avbryt", exact: true }), "Avbryt");
  });
});

test.describe("arbeidskøen uten JavaScript (pc)", () => {
  test("4.4 notatet lagres med vanlig skjema", async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== "pc", "bare pc");
    await logIn(page);
    const created = await newAssignment(page);

    const { baseURL, viewport } = testInfo.project.use;
    const context = await browser.newContext({
      baseURL,
      viewport,
      locale: "nb-NO",
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    });
    try {
      const noJs = await context.newPage();
      await noJs.goto(queueUrl("ordered", created.suffix));
      const card = cards(noJs).first();
      await noteSummary(card).click();
      await card.getByLabel("Notat").fill("Nøkkel hos naboen");
      await card.getByRole("button", { name: "Lagre", exact: true }).click();
      await expect(noJs).toHaveURL(new RegExp(`#kort-${created.id}$`));
      await expect(cards(noJs).first()).toContainText("Nøkkel hos naboen");
    } finally {
      await context.close();
    }
  });
});
