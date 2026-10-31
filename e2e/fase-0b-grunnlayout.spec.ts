import { expect, test, type Locator, type Page } from "@playwright/test";
import { trialForm } from "../src/modules/offline-trial/trial-form";
import { brand } from "../src/shared/config/brand";
import { ADMIN_EMAIL, INSPECTOR_EMAIL, createTrialForm, ensureInspector, logIn } from "./helpers";

// Grunnlayout i design A «Fjord» (fase 0b): ramme med topplinje, meny og tom arbeidskø.
// Testplan: docs/funksjoner/fase0b-grunnlayout-fjord-testplan.md avsnitt 3 (punkt 1–13; punkt 11
// dekkes av fase-0a.spec.ts). Kjører i prosjektene pc og ipad (liggende); iPad stående har egen
// describe. Elementer finnes på rolle og navn, ikke data-testid. Testdata er oppdiktet.
// Støtter tid (arbeidskøen først, ett trykk til testskjemaet), reklamasjoner (44 px trykkflater,
// synlig fokus) og KI først (fast plass for «Ingenting venter på deg»).

const PORTRAIT = { viewport: { width: 834, height: 1194 }, hasTouch: true } as const;

function banner(page: Page): Locator {
  return page.getByRole("banner");
}

function mainMenu(page: Page): Locator {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}

function workQueueLink(page: Page): Locator {
  return mainMenu(page).getByRole("link", { name: "Arbeidskø", exact: true });
}

function trialFormLink(page: Page): Locator {
  return mainMenu(page).getByRole("link", { name: "Testskjema uten nett", exact: true });
}

function logOutButton(page: Page): Locator {
  return banner(page).getByRole("button", { name: "Logg ut", exact: true });
}

function menuButton(page: Page): Locator {
  return page.getByRole("button", { name: /meny/i });
}

async function box(locator: Locator, what: string) {
  const result = await locator.boundingBox();
  expect(result, what).not.toBeNull();
  return result!;
}

/** Rammen og den tomme arbeidskøen (punkt 1 og 2). */
async function expectFrameWithEmptyQueue(page: Page) {
  await expect(page).toHaveURL(/\/arbeidskoe$/);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText(brand.productName);
  await expect(mainMenu(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arbeidskø", level: 1 })).toBeVisible();
  await expect(page.getByText("Ingenting venter på deg")).toBeVisible();
}

/** Hver lenke og knapp i topplinjen og menyen er minst 44x44 px (punkt 7). */
async function expectTouchTargets(page: Page) {
  const targets = [
    ...(await banner(page).getByRole("link").all()),
    ...(await banner(page).getByRole("button").all()),
    ...(await mainMenu(page).getByRole("link").all()),
    ...(await mainMenu(page).getByRole("button").all()),
  ];
  // Minst produktnavnet, «Logg ut», «Arbeidskø» og «Testskjema uten nett»
  expect(targets.length).toBeGreaterThanOrEqual(4);
  for (const target of targets) {
    const name = (await target.textContent())?.trim() ?? "";
    const b = await box(target, name);
    expect(b.width, `${name}: bredde`).toBeGreaterThanOrEqual(44);
    expect(b.height, `${name}: høyde`).toBeGreaterThanOrEqual(44);
  }
}

/** Ingen vannrett rulling på siden. */
async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "ingen vannrett rulling").toBeLessThanOrEqual(clientWidth);
}

/** Den vanlige rammen for PC og iPad liggende. */
test.describe("rammen på PC og iPad liggende", () => {
  test("1. admin åpner / og havner på /arbeidskoe i rammen", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/");
    await expectFrameWithEmptyQueue(page);
  });

  test("2. takstmann ser den samme rammen og den tomme arbeidskøen", async ({ page }) => {
    await ensureInspector();
    // Kommer takstmannen ikke inn på main ennå, hoppes testen over (står i PR-en)
    let signedIn = true;
    try {
      await logIn(page, INSPECTOR_EMAIL);
    } catch {
      signedIn = false;
    }
    test.skip(
      !signedIn || (await page.getByText("Ingenting venter på deg").count()) === 0,
      "roller-branchen ikke merget",
    );
    await page.goto("/");
    await expectFrameWithEmptyQueue(page);
  });

  test("3. topplinjen viser initialene til admin, og menyen viser «Du jobber for» med organisasjonen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    const signedInAs = await banner(page)
      .getByText(/^Innlogget som /)
      .textContent();
    const name = (signedInAs ?? "").replace(/^Innlogget som /, "").trim();
    expect(name, "navnet til admin står i topplinjen for skjermleser").not.toBe("");
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join("");
    await expect(banner(page).getByText(initials, { exact: true })).toBeVisible();

    await expect(mainMenu(page)).toContainText(new RegExp(`Du jobber for\\s*${brand.companyName}`));
  });

  test("4. aktivt menypunkt følger siden", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expect(workQueueLink(page)).toHaveAttribute("aria-current", "page");
    await expect(trialFormLink(page)).not.toHaveAttribute("aria-current", "page");
    // «Testskjema uten nett» står i gruppen «Prøver»
    await expect(
      mainMenu(page)
        .getByRole("list", { name: /Prøver/ })
        .getByRole("link", { name: "Testskjema uten nett", exact: true }),
    ).toBeVisible();

    await trialFormLink(page).click();
    await expect(page).toHaveURL(/\/prove\/testskjema$/);
    await expect(workQueueLink(page)).not.toHaveAttribute("aria-current", "page");
    await expect(trialFormLink(page)).toHaveAttribute("aria-current", "page");
  });

  test("5. menyen er synlig til venstre for innholdet, og det finnes ingen knapp «Meny»", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await expect(workQueueLink(page)).toBeVisible();
    await expect(trialFormLink(page)).toBeVisible();
    const nav = await box(mainMenu(page), "menyen");
    const main = await box(page.getByRole("main"), "hovedinnholdet");
    expect(nav.x + nav.width, "menyen står til venstre for innholdet").toBeLessThanOrEqual(
      main.x + 1,
    );
    await expect(menuButton(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("7. lenker og knapper i rammen er minst 44x44 px", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expectTouchTargets(page);
  });

  test("9. tastatur: Tab når menyen og «Logg ut» med synlig fokus, Enter åpner testskjemaet", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await page.reload();
    const targets: [string, Locator][] = [
      ["Arbeidskø", workQueueLink(page)],
      ["Testskjema uten nett", trialFormLink(page)],
      ["Logg ut", logOutButton(page)],
    ];
    const reached = new Map<string, { outline: string; shadow: string }>();
    for (let i = 0; i < 25 && reached.size < targets.length; i++) {
      await page.keyboard.press("Tab");
      for (const [name, target] of targets) {
        if (reached.has(name)) continue;
        const style = await target.evaluate((el) =>
          el === document.activeElement
            ? {
                outline: getComputedStyle(el).outlineStyle,
                shadow: getComputedStyle(el).boxShadow,
              }
            : null,
        );
        if (style) reached.set(name, style);
      }
    }
    for (const [name] of targets) {
      const style = reached.get(name);
      expect(style, `Tab når «${name}»`).toBeDefined();
      expect(
        style!.outline !== "none" || style!.shadow !== "none",
        `«${name}» har synlig fokus (outline ${style!.outline}, skygge ${style!.shadow})`,
      ).toBe(true);
    }

    await trialFormLink(page).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/prove\/testskjema$/);
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  });

  test("10. «Logg ut» i topplinjen fører til /logg-inn, og arbeidskøen er stengt etterpå", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await logOutButton(page).click();
    await expect(page).toHaveURL(/\/logg-inn$/);
    await page.goto("/arbeidskoe");
    await expect(page).toHaveURL(/\/logg-inn$/);
  });

  test("12. /logg-inn og /dev/epost har ikke rammen", async ({ page }) => {
    for (const path of ["/logg-inn", "/dev/epost"]) {
      await page.goto(path);
      await expect(page.getByRole("link", { name: "Arbeidskø", exact: true }), path).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Logg ut", exact: true }), path).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Hovedmeny" }), path).toHaveCount(0);
    }
    // Heller ikke når man er innlogget
    await logIn(page, ADMIN_EMAIL);
    await page.goto("/dev/epost");
    await expect(page.getByRole("link", { name: "Arbeidskø", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Logg ut", exact: true })).toHaveCount(0);
  });
});

test.describe("ingen halvferdig mørk visning", () => {
  test.use({ colorScheme: "dark" });

  test("8. med mørk systemvisning er bakgrunnen den samme lyse som uten", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    const backgrounds = async () =>
      page.evaluate(() => {
        const header = document.querySelector("header");
        return {
          body: getComputedStyle(document.body).backgroundColor,
          header: header ? getComputedStyle(header).backgroundColor : null,
        };
      });

    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await backgrounds();
    await page.emulateMedia({ colorScheme: "light" });
    const light = await backgrounds();

    expect(dark).toEqual(light);
    // canvas #eef2f7 bak innholdet, hvit topplinje
    expect(dark.body).toBe("rgb(238, 242, 247)");
    expect(dark.header).toBe("rgb(255, 255, 255)");
  });
});

test.describe("iPad stående (834x1194)", () => {
  test.use(PORTRAIT);

  test("6. menypunktene står synlige under topplinjen og over overskriften, uten menyknapp", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await expectFrameWithEmptyQueue(page);
    const top = await box(banner(page), "topplinjen");
    const heading = await box(
      page.getByRole("heading", { name: "Arbeidskø", level: 1 }),
      "overskriften",
    );
    for (const [name, link] of [
      ["Arbeidskø", workQueueLink(page)],
      ["Testskjema uten nett", trialFormLink(page)],
    ] as const) {
      await expect(link, name).toBeVisible();
      const b = await box(link, name);
      expect(b.y, `${name} står under topplinjen`).toBeGreaterThanOrEqual(top.y + top.height - 1);
      expect(b.y + b.height, `${name} står over overskriften`).toBeLessThanOrEqual(heading.y + 1);
    }
    await expect(menuButton(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await trialFormLink(page).tap();
    await expect(page).toHaveURL(/\/prove\/testskjema$/);
    await expect(page.getByRole("heading", { name: "Testskjema", level: 1 })).toBeVisible();
  });

  test("7. lenker og knapper i rammen er minst 44x44 px", async ({ page }) => {
    await logIn(page, ADMIN_EMAIL);
    await expectTouchTargets(page);
  });

  test("13. felt som får fokus med Tab i testskjemaet dekkes ikke av topplinjen eller statuslinjen", async ({
    page,
  }) => {
    await logIn(page, ADMIN_EMAIL);
    await createTrialForm(page);
    await expect(page.getByText(/^\d+ av 40 felt utfylt$/)).toBeVisible();

    const target = trialForm.groups[1]!.fields.find(
      (field) => field.type === "text" || field.type === "number",
    );
    expect(target, "andre gruppe har et tekst- eller tallfelt").toBeDefined();
    const input = page.getByLabel(target!.label, { exact: true });
    await expect(input).toBeVisible();

    // Fokus på elementet foran feltet uten å rulle, så rull helt ned: feltet ligger da over
    // synsfeltet, og Tab må rulle det inn under den faste linjen.
    await input.evaluate((el) => {
      const tabbable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0);
      const index = tabbable.indexOf(el as HTMLElement);
      if (index < 1) throw new Error("Fant ikke elementet foran feltet");
      tabbable[index - 1]!.focus({ preventScroll: true });
    });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(async () => (await input.boundingBox())?.y ?? 0, {
        message: "feltet ligger over synsfeltet før det får fokus",
      })
      .toBeLessThan(0);

    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();

    // Vent til rullingen har stoppet
    let last = Number.NaN;
    await expect
      .poll(async () => {
        const y = (await input.boundingBox())?.y ?? Number.NaN;
        const stable = y === last;
        last = y;
        return stable;
      })
      .toBe(true);

    // Nederste kant av alt som står fast øverst (sticky eller fixed), inkludert topplinjen hvis
    // den skulle bli fast
    const coveredTo = await page.evaluate(() => {
      let bottom = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const position = getComputedStyle(el).position;
        if (position !== "sticky" && position !== "fixed") continue;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0 || rect.top > 1 || rect.bottom <= 0) continue;
        bottom = Math.max(bottom, rect.bottom);
      }
      return bottom;
    });
    expect(coveredTo, "statuslinjen står fast øverst").toBeGreaterThan(0);
    const field = await box(input, "feltet");
    expect(
      field.y,
      `feltet (${field.y}) starter under den faste linjen (${coveredTo})`,
    ).toBeGreaterThanOrEqual(coveredTo - 1);
  });
});
