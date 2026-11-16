import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createAssignmentWithBuildings,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  uniqueSuffix,
  type E2eStructure,
} from "./helpers";

/*
 * Papirkurv og «Angre» for sletting (fase 2a, 2a-3).
 * Testplan: docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 10. Kjører i prosjektene pc og
 * ipad. Tiden (10 sekunder) styres med Playwrights klokke, aldri med ventetid.
 *
 * Hvert test lager sitt eget oppdrag direkte i databasen (`createAssignmentWithBuildings`):
 * «Bolighus test» med «1. etasje» (BRA-i 64,0, rommene «Bad» og «Soverom») og «2. etasje»
 * (fire rom), «Garasje test» og parten «Kjøper Test <ending>». Oppdiktede data.
 *
 * Støtter hovedmål: de ansatte (et feiltrykk rettes med ett trykk, etasje med rom fjernes med ett
 * trykk) og færre reklamasjoner (ingenting forsvinner uten spor, hvem og når står i papirkurven).
 */

const BUILDING = "Bolighus test";
const FIRST_FLOOR = "1. etasje";
const SECOND_FLOOR = "2. etasje";
const FAILED = "Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven.";
const DETAIL = "Du finner det også i papirkurven.";

function toast(page: Page): Locator {
  return page.getByTestId("undo-toast");
}

function undoButton(page: Page): Locator {
  return toast(page).getByRole("button", { name: "Angre", exact: true });
}

function closeButton(page: Page): Locator {
  return toast(page).getByRole("button", { name: "Lukk meldingen", exact: true });
}

function block(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("region", { name, exact: true });
}

function room(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("listitem", { name, exact: true });
}

function removeButton(scope: Locator): Locator {
  return scope.getByRole("button", { name: "Fjern", exact: true }).first();
}

function trash(page: Page, id = "papirkurv-bygninger"): Locator {
  return page.locator(`details#${id}`);
}

function trashSummary(page: Page, id = "papirkurv-bygninger"): Locator {
  return trash(page, id).locator("summary");
}

/** Trykk og vent på svaret fra server-handlingen (POST med «next-action»). */
async function clickAndWaitForAction(page: Page, target: Locator) {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await target.click();
  const response = await answered;
  expect(response.status(), "handlingen gir ikke 500").toBeLessThan(500);
}

async function openBuildings(page: Page, structure: E2eStructure) {
  const response = await page.goto(`/oppdrag/${structure.assignmentId}/bygninger`);
  expect(response?.status() ?? 500).toBeLessThan(500);
  await expect(block(page, BUILDING)).toBeVisible();
}

async function setup(page: Page, options: { withRemovedRoom?: boolean } = {}) {
  await logIn(page);
  const structure = await createAssignmentWithBuildings(uniqueSuffix(), options);
  await openBuildings(page, structure);
  return structure;
}

/** Navnene på rommene i etasjen, i rekkefølgen på skjermen. */
async function roomNames(floor: Locator): Promise<(string | null)[]> {
  return floor
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
}

async function removeBath(page: Page) {
  const floor = block(block(page, BUILDING), FIRST_FLOOR);
  await clickAndWaitForAction(page, removeButton(room(floor, "Bad")));
  await expect(toast(page).getByRole("status")).toContainText("Rommet «Bad» er fjernet.");
  await expect(room(floor, "Bad")).toHaveCount(0);
}

async function expectHeightAtLeast(target: Locator, min: number, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${min} px høy`).toBeGreaterThanOrEqual(min);
}

test.describe("papirkurv og «Angre» (pc og ipad)", () => {
  test("10.1 rom: «Fjern» → melding → «Angre» → rommet på samme plass, med fokus og utheving", async ({
    page,
  }) => {
    await setup(page);
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    expect(await roomNames(floor)).toEqual(["Bad", "Soverom"]);

    await removeBath(page);
    await expect(toast(page)).toContainText(DETAIL);
    await expect(undoButton(page)).toBeVisible();

    await clickAndWaitForAction(page, undoButton(page));
    await expect(toast(page).getByRole("status")).toContainText("Rommet «Bad» er hentet tilbake.");
    await expect(room(floor, "Bad")).toBeVisible();
    expect(await roomNames(floor)).toEqual(["Bad", "Soverom"]);
    await expect(room(floor, "Bad")).toBeFocused();
    await expect(room(floor, "Bad")).toHaveAttribute("data-restored", "true");
    await expect(undoButton(page)).toHaveCount(0);
  });

  test("10.2 etasje med rom: ett trykk på «Fjern» → «2. etasje og 4 rom er fjernet.» → «Angre» → alt tilbake", async ({
    page,
  }) => {
    await setup(page);
    const building = block(page, BUILDING);
    const upper = block(building, SECOND_FLOOR);
    await expect(upper.getByRole("listitem")).toHaveCount(4);

    await clickAndWaitForAction(page, removeButton(upper));
    await expect(toast(page).getByRole("status")).toContainText("2. etasje og 4 rom er fjernet.");
    await expect(block(building, SECOND_FLOOR)).toHaveCount(0);

    await clickAndWaitForAction(page, undoButton(page));
    await expect(toast(page)).toContainText("2. etasje og 4 rom er hentet tilbake.");
    await expect(block(building, SECOND_FLOOR).getByRole("listitem")).toHaveCount(4);
    await expect(
      block(building, SECOND_FLOOR).getByRole("heading", { name: SECOND_FLOOR }),
    ).toBeFocused();
  });

  test("10.3 bygning med innhold: «Fjern» → «Angre» → alt tilbake", async ({ page }) => {
    await setup(page);
    await clickAndWaitForAction(page, removeButton(block(page, BUILDING)));
    await expect(toast(page).getByRole("status")).toContainText(
      "Bolighus test med 2 etasjer og 6 rom er fjernet.",
    );
    await expect(block(page, BUILDING)).toHaveCount(0);

    await clickAndWaitForAction(page, undoButton(page));
    const building = block(page, BUILDING);
    await expect(block(building, FIRST_FLOOR).getByRole("listitem")).toHaveCount(2);
    await expect(block(building, SECOND_FLOOR).getByRole("listitem")).toHaveCount(4);
    await expect(block(building, FIRST_FLOOR)).toContainText("64,0");
    await expect(building.getByRole("heading", { name: BUILDING, level: 2 })).toBeFocused();
  });

  test("10.4 part: «Fjern» på partkortet → «Angre» → kortet tilbake", async ({ page }) => {
    await logIn(page);
    const structure = await createAssignmentWithBuildings(uniqueSuffix());
    await page.goto(`/oppdrag/${structure.assignmentId}`);
    const parties = page.getByRole("region", { name: "Parter", exact: true });
    const heading = parties.getByRole("heading", { name: structure.partyName, exact: true });
    await expect(heading).toBeVisible();
    const card = parties
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: structure.partyName, exact: true }) });

    await clickAndWaitForAction(page, removeButton(card));
    await expect(toast(page).getByRole("status")).toContainText(
      `Parten «${structure.partyName}» er fjernet.`,
    );
    await expect(heading).toHaveCount(0);
    await expect(trashSummary(page, "papirkurv-parter")).toHaveText(/Papirkurv \(1\)/);

    await clickAndWaitForAction(page, undoButton(page));
    await expect(toast(page)).toContainText(`Parten «${structure.partyName}» er hentet tilbake.`);
    await expect(heading).toBeFocused();
    await expect(trash(page, "papirkurv-parter")).toHaveCount(0);
  });

  test("10.5 meldingen overlever revalidering etter server-handlingen", async ({ page }) => {
    await setup(page);
    await removeBath(page);
    // Raden er borte (siden er lastet på nytt), meldingen står
    await expect(toast(page).getByRole("status")).toContainText("Rommet «Bad» er fjernet.");

    // En ny server-handling på samme side friskes opp igjen; meldingen står fortsatt
    const upper = block(block(page, BUILDING), SECOND_FLOOR);
    await upper.getByLabel(/^BRA-i/).fill("40,0");
    await clickAndWaitForAction(page, upper.getByRole("button", { name: "Lagre areal" }));
    await expect(upper).toContainText("40,0");
    await expect(undoButton(page)).toBeVisible();
    await expect(toast(page).getByRole("status")).toContainText("Rommet «Bad» er fjernet.");
  });

  test("10.6 tiden: synlig ved 9 999 ms, borte ved 10 000 ms; hover stopper tiden (pc)", async ({
    page,
  }) => {
    await page.clock.install();
    await setup(page);
    await page.clock.pauseAt(new Date(Date.now() + 60_000));

    await removeBath(page);
    await page.clock.runFor(9_999);
    await expect(undoButton(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(undoButton(page)).toHaveCount(0);
    await expect(toast(page).getByRole("status")).toHaveText("");

    if (test.info().project.name !== "pc") return;
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await clickAndWaitForAction(page, removeButton(room(floor, "Soverom")));
    await expect(undoButton(page)).toBeVisible();
    await toast(page).getByRole("status").hover();
    await page.clock.runFor(30_000);
    await expect(undoButton(page), "hover stopper tiden").toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(10_000);
    await expect(undoButton(page)).toHaveCount(0);
  });

  test("10.7 ny sletting erstatter: én melding og «Mer i papirkurven», som åpner papirkurven", async ({
    page,
  }) => {
    await setup(page);
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await removeBath(page);
    await clickAndWaitForAction(page, removeButton(room(floor, "Soverom")));

    await expect(toast(page)).toHaveCount(1);
    await expect(toast(page).getByRole("status")).toHaveText(/Rommet «Soverom» er fjernet\./);
    await expect(toast(page).getByRole("status")).not.toContainText("Bad");
    await expect(undoButton(page)).toHaveCount(1);
    const more = toast(page).getByRole("button", { name: "Mer i papirkurven", exact: true });
    await expect(more).toBeVisible();

    await more.click();
    await expect(trash(page)).toHaveAttribute("open", "");
    await expect(trashSummary(page)).toBeFocused();
    await expect(trash(page)).toContainText("Bad");
    await expect(trash(page)).toContainText("Soverom");
  });

  test("10.8 papirkurven: lukket, åpnes med tastatur, viser hva, hvor, areal, hvem og når; «Gjenopprett»", async ({
    page,
  }) => {
    await setup(page);
    const building = block(page, BUILDING);
    await clickAndWaitForAction(page, removeButton(block(building, FIRST_FLOOR)));
    await expect(toast(page)).toContainText("1. etasje og 2 rom er fjernet.");
    await closeButton(page).click();
    await expect(undoButton(page)).toHaveCount(0);

    await expect(trashSummary(page)).toHaveText(/Papirkurv \(1\)/);
    await expect(trash(page)).not.toHaveAttribute("open", "");
    await trashSummary(page).focus();
    await page.keyboard.press("Enter");
    await expect(trash(page)).toHaveAttribute("open", "");

    const line = trash(page).getByRole("listitem").first();
    await expect(line).toContainText("1. etasje (2 rom)");
    await expect(line).toContainText("Bolighus test · BRA 64,0 m²");
    await expect(line).toContainText(/Fjernet av .+ i dag \d{2}:\d{2}/);
    await expect(line.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);

    const restore = trash(page).getByRole("button", { name: "Gjenopprett 1. etasje", exact: true });
    await clickAndWaitForAction(page, restore);
    await expect(toast(page)).toContainText("1. etasje og 2 rom er hentet tilbake.");
    const heading = block(building, FIRST_FLOOR).getByRole("heading", { name: FIRST_FLOOR });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(trash(page), "tom papirkurv vises ikke").toHaveCount(0);
  });

  test("10.9 A410: rom i fjernet etasje → «Gjenopprett» → etasjen kommer med, ikke søsken", async ({
    page,
  }) => {
    await setup(page);
    const building = block(page, BUILDING);
    await removeBath(page);
    await clickAndWaitForAction(page, removeButton(block(building, FIRST_FLOOR)));
    await expect(block(building, FIRST_FLOOR)).toHaveCount(0);

    await trashSummary(page).click();
    await expect(trash(page)).toContainText("Bolighus test › 1. etasje (fjernet)");
    await clickAndWaitForAction(
      page,
      trash(page).getByRole("button", { name: "Gjenopprett Bad", exact: true }),
    );
    await expect(toast(page)).toContainText("Rommet kom tilbake, sammen med etasjen «1. etasje».");
    const floor = block(building, FIRST_FLOOR);
    expect(await roomNames(floor)).toEqual(["Bad"]);
    await expect(room(floor, "Bad")).toBeFocused();
  });

  test("10.10 Cmd/Ctrl+Z utløser «Angre», men ikke når fokus er i et tekstfelt (pc)", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "pc", "Hurtigtasten gjelder PC");
    await setup(page);
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await removeBath(page);

    const field = block(block(page, BUILDING), SECOND_FLOOR).getByLabel(/^BRA-i/);
    await field.focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(undoButton(page)).toBeVisible();
    await expect(room(floor, "Bad")).toHaveCount(0);

    await page.getByRole("heading", { level: 1 }).click();
    const answered = page.waitForResponse(
      (response) => response.request().headers()["next-action"] !== undefined,
    );
    await page.keyboard.press("ControlOrMeta+z");
    await answered;
    await expect(room(floor, "Bad")).toBeVisible();
    await expect(toast(page)).toContainText("Rommet «Bad» er hentet tilbake.");
  });

  test("10.11 feil: avbrutt server-handling gir feiltekst og ny «Angre»; rommet vises ikke", async ({
    page,
  }) => {
    await setup(page);
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await removeBath(page);

    await page.route("**/*", (route) =>
      route.request().method() === "POST" && route.request().headers()["next-action"]
        ? route.abort("failed")
        : route.continue(),
    );
    await undoButton(page).click();
    await expect(toast(page).getByRole("alert")).toHaveText(FAILED);
    await expect(undoButton(page)).toBeVisible();
    await expect(room(floor, "Bad")).toHaveCount(0);

    await page.unroute("**/*");
    await clickAndWaitForAction(page, undoButton(page));
    await expect(room(floor, "Bad")).toBeVisible();
    await expect(toast(page).getByRole("alert")).toHaveCount(0);
  });

  test("10.12 takstmann uten endringsrett ser papirkurven uten «Gjenopprett» og «Fjern»", async ({
    page,
  }) => {
    const previous = await setInspectorsEditAll(false);
    try {
      const structure = await createAssignmentWithBuildings(uniqueSuffix(), {
        withRemovedRoom: true,
      });
      await logInAsInspector(page);
      await openBuildings(page, structure);
      await expect(trashSummary(page)).toHaveText(/Papirkurv \(1\)/);
      await trashSummary(page).click();
      await expect(trash(page)).toContainText("Vaskerom test");
      await expect(trash(page)).toContainText(/Fjernet av .+/);
      await expect(page.getByRole("button", { name: /^Gjenopprett/ })).toHaveCount(0);
      await expect(page.getByRole("main").getByRole("button", { name: "Fjern" })).toHaveCount(0);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("10.13 størrelser: «Fjern», «Gjenopprett» og × minst 44 px, «Angre» minst 56 px", async ({
    page,
  }) => {
    await setup(page, { withRemovedRoom: true });
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await expectHeightAtLeast(removeButton(room(floor, "Bad")), 44, "Fjern");
    await expectHeightAtLeast(trashSummary(page), 44, "Papirkurv");
    await trashSummary(page).click();
    await expectHeightAtLeast(
      trash(page).getByRole("button", { name: "Gjenopprett Vaskerom test" }),
      44,
      "Gjenopprett",
    );

    await removeBath(page);
    await expectHeightAtLeast(undoButton(page), 56, "Angre");
    await expectHeightAtLeast(closeButton(page), 44, "Lukk meldingen");
    const close = await closeButton(page).boundingBox();
    expect(close!.width, "× er minst 44 px bred").toBeGreaterThanOrEqual(44);
  });

  test("10.14 meldingen dekker ikke hovedknappene festet nederst", async ({ page }) => {
    await setup(page);
    // En side med faste hovedknapper setter --fixed-bottom-bar-height; vi lager en slik linje.
    await page.evaluate(() => {
      const bar = document.createElement("div");
      bar.id = "e2e-fast-linje";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:88px;background:#fff";
      document.body.appendChild(bar);
      document.documentElement.style.setProperty("--fixed-bottom-bar-height", "88px");
    });
    await removeBath(page);
    const toastBox = await toast(page).boundingBox();
    const barBox = await page.locator("#e2e-fast-linje").boundingBox();
    expect(toastBox && barBox).toBeTruthy();
    expect(toastBox!.y + toastBox!.height, "meldingen slutter over linjen").toBeLessThanOrEqual(
      barBox!.y,
    );
    const viewport = page.viewportSize()!;
    expect(toastBox!.x).toBeGreaterThanOrEqual(0);
    expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(viewport.width);
  });

  test("10.15 skjermleser og tastatur: role=status, knapper med navn, Tab når «Angre» og ×", async ({
    page,
  }) => {
    await setup(page);
    await removeBath(page);
    const status = toast(page).getByRole("status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toContainText("Rommet «Bad» er fjernet.");
    await expect(undoButton(page)).toHaveAttribute("aria-keyshortcuts", "Meta+Z Control+Z");
    await expect(closeButton(page)).toBeVisible();

    // Papirkurven er det siste i innholdet; meldingen kommer etter den med Tab
    await trashSummary(page).focus();
    await page.keyboard.press("Tab");
    await expect(undoButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeButton(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(undoButton(page)).toHaveCount(0);
  });

  test("10.16 prefers-reduced-motion: uthevingen har ingen animasjon", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page);
    const floor = block(block(page, BUILDING), FIRST_FLOOR);
    await removeBath(page);
    await clickAndWaitForAction(page, undoButton(page));
    const bath = room(floor, "Bad");
    await expect(bath).toHaveAttribute("data-restored", "true");
    const style = await bath.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { duration: computed.transitionDuration, animation: computed.animationName };
    });
    expect(style.duration.split(",").every((value) => parseFloat(value) === 0)).toBe(true);
    expect(style.animation).toBe("none");
  });

  test("10.17 ingen persondata i nettleserlagring eller adressen etter fjerning av part", async ({
    page,
  }) => {
    await logIn(page);
    const structure = await createAssignmentWithBuildings(uniqueSuffix());
    await page.goto(`/oppdrag/${structure.assignmentId}`);
    const parties = page.getByRole("region", { name: "Parter", exact: true });
    const card = parties
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: structure.partyName, exact: true }) });
    await clickAndWaitForAction(page, removeButton(card));
    await expect(toast(page)).toContainText(structure.partyName);

    const stored = await page.evaluate(() => {
      const dump = (storage: Storage) =>
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) ?? "";
          return `${key}=${storage.getItem(key) ?? ""}`;
        }).join("\n");
      return { local: dump(localStorage), session: dump(sessionStorage) };
    });
    expect(stored.local).not.toContain(structure.partyName);
    expect(stored.session).not.toContain(structure.partyName);
    expect(stored.local).not.toContain(structure.partyId);
    expect(stored.session).not.toContain(structure.partyId);
    expect(page.url()).not.toContain(structure.partyId);
    expect(decodeURIComponent(page.url())).not.toContain(structure.partyName);
  });
});
