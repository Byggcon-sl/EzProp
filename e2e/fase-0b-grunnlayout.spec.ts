import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { trialForm } from "../src/modules/offline-trial/trial-form";
import { brand } from "../src/shared/config/brand";
import { assertLocalOrTestDatabase } from "./database-guard";
import {
  ADMIN_EMAIL,
  createTrialForm,
  e2eDatabaseUrl,
  indicator,
  logIn,
  logInAsInspector,
} from "./helpers";

/*
 * Grunnlayout i design A «Fjord» med tom arbeidskø som startside (fase 0b).
 * Testplan: docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 3.
 * Kjører i prosjektene pc (1280x720) og ipad (1194x834, liggende). iPad stående har egen describe.
 * Elementer finnes på rolle og navn, ikke data-testid.
 * Støtter hovedmål: tid (arbeidskøen først, testskjemaet ett trykk unna), reklamasjoner (store
 * trykkflater, synlig fokus), KI først (fast plass for «venter på deg»).
 */

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;

function banner(page: Page): Locator {
  return page.getByRole("banner");
}

/** Navigasjonen i rammen: den som har lenken «Arbeidskø». */
function mainNav(page: Page): Locator {
  return page
    .getByRole("navigation")
    .filter({ has: page.getByRole("link", { name: "Arbeidskø", exact: true }) });
}

function workQueueLink(page: Page): Locator {
  return mainNav(page).getByRole("link", { name: "Arbeidskø", exact: true });
}

function trialLink(page: Page): Locator {
  return mainNav(page).getByRole("link", { name: "Testskjema uten nett", exact: true });
}

/** Navnet til admin fra seed, lest fra databasen appen bruker (seed-navnet kan variere). */
async function adminName(): Promise<string> {
  const url = e2eDatabaseUrl();
  assertLocalOrTestDatabase(url, process.env.TEST_DATABASE_URL);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<
      { name: string }[]
    >`select name from users where email = ${ADMIN_EMAIL}`;
    if (!row) throw new Error("Fant ikke admin fra seed (kjør pnpm db:seed)");
    return row.name;
  } finally {
    await sql.end();
  }
}

/** Initialene slik skissen beskriver dem: første bokstav i de to første ordene, store bokstaver. */
function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return email.charAt(0).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

async function expectFrameWithEmptyQueue(page: Page) {
  await expect(page).toHaveURL(/\/arbeidskoe$/);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText(brand.productName);
  await expect(mainNav(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arbeidskø", level: 1 })).toBeVisible();
  await expect(page.getByText("Ingenting venter på deg")).toBeVisible();
}

/** Alle lenker og knapper i topplinjen og navigasjonen er minst 44x44 px. */
async function expectTouchTargets(page: Page) {
  const targets = [
    ...(await banner(page).getByRole("link").all()),
    ...(await banner(page).getByRole("button").all()),
    ...(await mainNav(page).getByRole("link").all()),
    ...(await mainNav(page).getByRole("button").all()),
  ];
  // Minst produktnavnet, «Logg ut», «Arbeidskø» og «Testskjema uten nett»
  expect(targets.length).toBeGreaterThanOrEqual(4);
  for (const target of targets) {
    const name = (await target.textContent())?.trim() ?? "";
    const box = await target.boundingBox();
    expect(box, `${name} er synlig`).not.toBeNull();
    expect(box!.width, `${name} er minst 44 px bred`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${name} er minst 44 px høy`).toBeGreaterThanOrEqual(44);
  }
}

test.describe("rammen og arbeidskøen (pc og iPad liggende)", () => {
  test("admin åpner / og havner på /arbeidskoe i rammen (admin stenges ikke ute)", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/");
    await expectFrameWithEmptyQueue(page);
    await expect(banner(page).getByRole("button", { name: "Logg ut" })).toBeVisible();
  });

  test("takstmann ser det samme som admin", async ({ page }) => {
    await logInAsInspector(page);
    await page.goto("/");
    await expectFrameWithEmptyQueue(page);
    await expect(page.getByText("Du er ikke registrert som ansatt")).toHaveCount(0);
  });

  test("topplinjen viser initialene til admin, og menyen «Du jobber for» med organisasjonen fra seed", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const initials = initialsOf(await adminName(), ADMIN_EMAIL);
    await expect(banner(page).getByText(initials, { exact: true })).toBeVisible();
    const workingFor = page.getByText(/Du jobber for/);
    await expect(workingFor.first()).toBeVisible();
    await expect(mainNav(page)).toContainText("Du jobber for");
    await expect(mainNav(page)).toContainText(brand.companyName);
    // Teksten står i menyen, ikke lenger i kortet
    await expect(page.getByRole("main")).not.toContainText("Du jobber for");
  });

  test("aktivt menypunkt følger siden", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expect(workQueueLink(page)).toHaveAttribute("aria-current", "page");
    await expect(trialLink(page)).not.toHaveAttribute("aria-current", "page");
    // «Testskjema uten nett» står under gruppen «Prøver»
    await expect(mainNav(page).getByText(/^Prøver:?$/)).toBeVisible();

    await trialLink(page).click();
    await expect(page).toHaveURL(/\/prove\/testskjema$/);
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
    await expect(workQueueLink(page)).not.toHaveAttribute("aria-current", "page");
    await expect(trialLink(page)).toHaveAttribute("aria-current", "page");
  });

  test("menyen står fast til venstre for innholdet uten trykk, og det finnes ingen knapp «Meny»", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await expect(workQueueLink(page)).toBeVisible();
    await expect(trialLink(page)).toBeVisible();
    const nav = await mainNav(page).boundingBox();
    const main = await page.getByRole("main").boundingBox();
    expect(nav).not.toBeNull();
    expect(main).not.toBeNull();
    expect(nav!.x + nav!.width, "menyen slutter før innholdet begynner").toBeLessThanOrEqual(
      main!.x + 1,
    );
    await expect(page.getByRole("button", { name: /meny/i })).toHaveCount(0);
  });

  test("alle lenker og knapper i topplinjen og menyen er minst 44x44 px", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expectTouchTargets(page);
  });

  test("tastatur: Tab når menyen og «Logg ut» med synlig fokus, Enter åpner testskjemaet", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/arbeidskoe");
    const wanted = ["Arbeidskø", "Testskjema uten nett", "Logg ut"];
    const reached = new Set<string>();
    for (let i = 0; i < 15 && reached.size < wanted.length; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return {
          text: (el.innerText ?? "").trim(),
          outline: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          boxShadow: style.boxShadow,
        };
      });
      if (!focused) continue;
      const name = wanted.find((w) => focused.text === w || focused.text.endsWith(w));
      if (!name) continue;
      reached.add(name);
      const outlineVisible = focused.outline !== "none" && focused.outlineWidth !== "0px";
      const ringVisible = focused.boxShadow !== "none";
      expect(outlineVisible || ringVisible, `${name} har synlig fokus`).toBe(true);
    }
    expect([...reached].sort()).toEqual([...wanted].sort());

    // Enter på «Testskjema uten nett» åpner skjemalisten
    await page.goto("/arbeidskoe");
    let onTrialLink = false;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      onTrialLink = await trialLink(page).evaluate((el) => el === document.activeElement);
      if (onTrialLink) break;
    }
    expect(onTrialLink, "Tab når «Testskjema uten nett»").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/prove\/testskjema$/);
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  });

  test("«Logg ut» i topplinjen fører til /logg-inn, og arbeidskøen er stengt etterpå", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await banner(page).getByRole("button", { name: "Logg ut" }).click();
    await expect(page).toHaveURL(/\/logg-inn$/);
    await page.goto("/arbeidskoe");
    await expect(page).toHaveURL(/\/logg-inn$/);
    await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
  });

  test("/logg-inn og /dev/epost har ikke rammen", async ({ page }) => {
    await page.goto("/logg-inn");
    await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Arbeidskø", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Logg ut" })).toHaveCount(0);

    // Også når man er innlogget
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/dev/epost");
    await expect(page.getByTestId("dev-email-subject").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Arbeidskø", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Logg ut" })).toHaveCount(0);
  });
});

test.describe("ingen halvferdig mørk visning (kommer i fase 3)", () => {
  test.use({ colorScheme: "dark" });

  test("bakgrunnen bak innholdet er den samme lyse med mørk systeminnstilling", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await expect(page.getByText("Ingenting venter på deg")).toBeVisible();

    const read = () =>
      page.evaluate(() => {
        const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : "");
        const main = document.querySelector("main");
        // Første forelder med egen bakgrunn bak innholdet
        let behind: Element | null = main?.parentElement ?? null;
        while (behind && /rgba\(0, 0, 0, 0\)|transparent/.test(bg(behind))) {
          behind = behind.parentElement;
        }
        return {
          body: bg(document.body),
          behind: bg(behind),
          color: getComputedStyle(document.body).color,
        };
      });

    const dark = await read();
    await page.emulateMedia({ colorScheme: "light" });
    const light = await read();
    expect(dark).toEqual(light);

    // Og bakgrunnen er lys (ikke mørk i begge)
    for (const value of [dark.body, dark.behind]) {
      const [r = 0, g = 0, b = 0] = (value.match(/\d+/g) ?? []).map(Number);
      expect(r + g + b, `bakgrunnen ${value} er lys`).toBeGreaterThan(600);
    }
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test("menypunktene står synlige under topplinjen og over overskriften, uten knapp «Meny»", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await expectFrameWithEmptyQueue(page);
    const header = await banner(page).boundingBox();
    const heading = await page.getByRole("heading", { name: "Arbeidskø", level: 1 }).boundingBox();
    expect(header).not.toBeNull();
    expect(heading).not.toBeNull();
    for (const link of [workQueueLink(page), trialLink(page)]) {
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y, "menypunktet står under topplinjen").toBeGreaterThanOrEqual(
        header!.y + header!.height - 1,
      );
      expect(box!.y + box!.height, "menypunktet står over overskriften").toBeLessThanOrEqual(
        heading!.y + 1,
      );
    }
    await expect(page.getByRole("button", { name: /meny/i })).toHaveCount(0);
    await expect(mainNav(page)).toContainText(brand.companyName);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, "ingen vannrett rulling").toBeLessThanOrEqual(
      overflow.clientWidth,
    );
  });

  test("ett trykk på «Testskjema uten nett» åpner /prove/testskjema", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await trialLink(page).tap();
    await expect(page).toHaveURL(/\/prove\/testskjema$/);
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  });

  test("alle lenker og knapper i topplinjen og menyen er minst 44x44 px", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expectTouchTargets(page);
  });

  test("testskjemaet i rammen: felt som får fokus dekkes ikke av topplinjen eller statuslinjen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await createTrialForm(page);
    await expect(page.getByText(/^\d+ av 40 felt utfylt$/)).toBeVisible();
    // Rammen er rundt skjemaet
    await expect(trialLink(page)).toHaveAttribute("aria-current", "page");

    const target = trialForm.groups[1]!.fields.find(
      (field) => field.type === "text" || field.type === "number",
    );
    expect(target, "andre gruppe har et tekst- eller tallfelt").toBeDefined();
    const input = page.getByLabel(target!.label, { exact: true });
    const bar = page
      .locator('[data-testid="sticky-status-bar"], div.sticky')
      .filter({ has: indicator(page) })
      .first();
    await expect(bar).toBeVisible();
    // Skjemaet må være ferdig tegnet før vi ruller, ellers er siden for kort
    await expect(input).toBeVisible();

    // Ruller helt ned, så feltet kommer ovenfra når det får fokus. Rull på nytt i hver runde,
    // siden skjemaet kan vokse etter første tegning.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          return (await input.boundingBox())?.y ?? 0;
        },
        {
          message: "feltet ligger over synsfeltet før det får fokus",
        },
      )
      .toBeLessThan(0);
    // Fokus som Safari på iPaden: feltet rulles til nærmeste kant
    await input.evaluate((el) => {
      (el as HTMLElement).focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    });
    await expect(input).toBeFocused();
    // Tab videre og tilbake, slik tastaturet gjør
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(input).toBeFocused();

    let last = Number.NaN;
    await expect
      .poll(async () => {
        const y = (await input.boundingBox())?.y ?? Number.NaN;
        const stable = y === last;
        last = y;
        return stable;
      })
      .toBe(true);

    const fieldBox = await input.boundingBox();
    const barBox = await bar.boundingBox();
    const headerBox = await banner(page).boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(
      fieldBox!.y,
      `feltet (${fieldBox!.y}) starter under statuslinjen (${barBox!.y + barBox!.height})`,
    ).toBeGreaterThanOrEqual(barBox!.y + barBox!.height - 1);
    // Topplinjen er ikke sticky: den er rullet ut av bildet eller ligger over feltet
    if (headerBox && headerBox.y + headerBox.height > 0) {
      expect(fieldBox!.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    }
  });
});
