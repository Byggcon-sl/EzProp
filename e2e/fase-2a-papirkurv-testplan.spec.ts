import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createAssignmentWithTrashTree,
  logIn,
  logInAsInspector,
  restoreInspectorsEditAll,
  setInspectorsEditAll,
  trashCountsFor,
  uniqueSuffix,
  type E2eTrashTree,
} from "./helpers";

/*
 * Papirkurv og «Angre» for sletting (fase 2a, 2a-3 Bredden).
 * Testplan: docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 10. Design:
 * docs/funksjoner/fase2a-papirkurv-design.md. Kjører i prosjektene pc (1440 × 900) og ipad
 * (iPad Pro stående, 1024 × 1366); størrelsen settes i `beforeEach`.
 *
 * Hver test lager sitt eget oppdrag direkte i databasen (`createAssignmentWithTrashTree`) med
 * «Bolighus test <ending>», «1. etasje» (tre rom, BRA 64), «2. etasje» (fire rom) og kjøperen
 * «Ola Testmann <ending>». Testdata er oppdiktet. Ingen e2e uten nett: papirkurven krever nett
 * (fase 2b tar den uten nett).
 *
 * Lokatorene bygger på designet (rettes her ved sammenslåingen hvis siden er bygget annerledes):
 * - bygninger og etasjer er landemerker (region) med navnet; rom er listepunkt med navnet;
 * - «Fjern» er en knapp som begynner med «Fjern»; i en bygning er bygningens egen den første;
 * - meldingen har `role="status"` med teksten, knappen «Angre» og «Lukk meldingen»;
 * - papirkurven er `<details>` med `<summary>` «Papirkurv (n)», id «papirkurv-bygninger» eller
 *   «papirkurv-parter»; «Gjenopprett» har `aria-label` «Gjenopprett <navn>»;
 * - det som kom tilbake, har `data-restore-id="<type>:<id>"`.
 * Playwrights klokke (`page.clock`) styrer de 10 sekundene; ingen `waitForTimeout`.
 *
 * Støtter hovedmål: de ansatte (et feiltrykk koster ett trykk på «Angre», også på iPad) og færre
 * reklamasjoner (ingenting forsvinner uten spor, og takstmann uten endringsrett kan ikke hente
 * noe tilbake).
 */

const PC = { width: 1440, height: 900 } as const;
const IPAD = { width: 1024, height: 1366 } as const;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HINT = "Du finner det også i papirkurven.";

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(testInfo.project.name === "ipad" ? IPAD : PC);
});

function block(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("region", { name, exact: true });
}

function roomItem(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("listitem", { name, exact: true });
}

function removeButton(scope: Locator): Locator {
  return scope.getByRole("button", { name: /^Fjern/ });
}

function toast(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /er fjernet\.|hentet tilbake|kom tilbake/ });
}

function undoButton(page: Page): Locator {
  return page.getByRole("button", { name: "Angre", exact: true });
}

function closeButton(page: Page): Locator {
  return page.getByRole("button", { name: "Lukk meldingen", exact: true });
}

function trashSummary(page: Page, id = "papirkurv-bygninger"): Locator {
  return page.locator(`#${id} summary`);
}

function restoreButton(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name: `Gjenopprett ${name}`, exact: true });
}

async function expectAtLeast(target: Locator, px: number, name: string) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} er synlig`).not.toBeNull();
  expect(box!.height, `${name} er minst ${px} px høy`).toBeGreaterThanOrEqual(px);
}

/** Trykk og vent på svaret fra server-handlingen (POST med «next-action»). */
async function clickAndWaitForAction(page: Page, target: Locator) {
  const done = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await target.click();
  const response = await done;
  expect(response.status(), "handlingen gir ikke 500").toBeLessThan(500);
}

async function openBuildings(page: Page, tree: E2eTrashTree) {
  await page.goto(`/oppdrag/${tree.assignmentId}/bygninger`);
  await expect(block(page, tree.buildingName)).toBeVisible();
}

async function roomNames(floor: Locator): Promise<string[]> {
  return floor
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label") ?? ""));
}

/** Ny økt, nytt oppdrag, klokka installert før siden lastes. */
async function start(page: Page): Promise<E2eTrashTree> {
  await page.clock.install();
  await logIn(page);
  const tree = await createAssignmentWithTrashTree(uniqueSuffix());
  await openBuildings(page, tree);
  // Klokken fryses etter oppsettet, slik at bare runFor flytter tiden (som i fase-2a-papirkurv.spec.ts).
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  return tree;
}

test.describe("papirkurv og angre (pc og ipad)", () => {
  test("10.1 rom: «Fjern» → melding → «Angre» → rommet står på samme plass, med fokus og utheving", async ({
    page,
  }) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const before = await roomNames(floor);
    const bath = tree.firstFloorRooms[1]!;

    await clickAndWaitForAction(page, removeButton(roomItem(floor, bath.name)));
    await expect(toast(page)).toContainText(`Rommet «${bath.name}» er fjernet.`);
    await expect(page.getByText(HINT)).toBeVisible();
    await expect(roomItem(floor, bath.name)).toHaveCount(0);

    await clickAndWaitForAction(page, undoButton(page));
    await expect(roomItem(floor, bath.name)).toBeVisible();
    expect(await roomNames(floor)).toEqual(before);
    const restored = page.locator(`[data-restore-id="room:${bath.id}"]`);
    await expect(restored).toBeFocused();
    await expect(restored).toBeInViewport();
    expect((await trashCountsFor(tree.assignmentId)).rooms).toBe(0);
  });

  test("10.2 etasje med rom: ett trykk på «Fjern» → «2. etasje og 4 rom er fjernet.» → «Angre» → alt tilbake", async ({
    page,
  }) => {
    const tree = await start(page);
    const building = block(page, tree.buildingName);
    const floor = block(building, "2. etasje");

    await clickAndWaitForAction(page, removeButton(floor).first());
    await expect(toast(page)).toContainText("2. etasje og 4 rom er fjernet.");
    await expect(block(building, "2. etasje")).toHaveCount(0);
    expect(await trashCountsFor(tree.assignmentId)).toMatchObject({
      floors: 1,
      rooms: 4,
      floorAreas: 1,
    });

    await clickAndWaitForAction(page, undoButton(page));
    await expect(block(building, "2. etasje")).toBeVisible();
    for (const room of tree.secondFloorRooms) {
      await expect(roomItem(block(building, "2. etasje"), room.name)).toBeVisible();
    }
    expect(await trashCountsFor(tree.assignmentId)).toMatchObject({
      floors: 0,
      rooms: 0,
      floorAreas: 0,
    });
  });

  test("10.3 bygning med innhold: «Fjern» → «Angre» → alt tilbake", async ({ page }) => {
    const tree = await start(page);
    await clickAndWaitForAction(page, removeButton(block(page, tree.buildingName)).first());
    await expect(toast(page)).toContainText(
      `${tree.buildingName} med 2 etasjer og 7 rom er fjernet.`,
    );
    await expect(block(page, tree.buildingName)).toHaveCount(0);

    await clickAndWaitForAction(page, undoButton(page));
    const building = block(page, tree.buildingName);
    await expect(building).toBeVisible();
    await expect(block(building, "1. etasje")).toBeVisible();
    await expect(block(building, "2. etasje")).toBeVisible();
    expect(await trashCountsFor(tree.assignmentId)).toEqual({
      buildings: 0,
      floors: 0,
      floorAreas: 0,
      rooms: 0,
      parties: 0,
    });
  });

  test("10.4 part: «Fjern» på partkortet → «Angre» → kortet tilbake", async ({ page }) => {
    const tree = await start(page);
    await page.goto(`/oppdrag/${tree.assignmentId}`);
    const parties = page.getByRole("region", { name: "Parter", exact: true });
    const card = parties.getByRole("listitem").filter({ hasText: tree.partyName });
    await expect(card).toBeVisible();

    await clickAndWaitForAction(page, removeButton(card));
    await expect(toast(page)).toContainText(`Parten «${tree.partyName}» er fjernet.`);
    await expect(card).toHaveCount(0);

    await clickAndWaitForAction(page, undoButton(page));
    await expect(parties.getByRole("listitem").filter({ hasText: tree.partyName })).toBeVisible();
    expect((await trashCountsFor(tree.assignmentId)).parties).toBe(0);
  });

  test("10.5 meldingen overlever revalideringen etter server-handlingen", async ({ page }) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const room = tree.firstFloorRooms[0]!;
    await clickAndWaitForAction(page, removeButton(roomItem(floor, room.name)));
    // Revalideringen har fjernet raden; meldingen står fortsatt.
    await expect(roomItem(floor, room.name)).toHaveCount(0);
    await expect(toast(page)).toContainText(`Rommet «${room.name}» er fjernet.`);
    await expect(undoButton(page)).toBeVisible();
  });

  test("10.6 tiden: synlig etter 9 999 ms, borte etter 10 000 ms; hover stopper tiden på PC", async ({
    page,
  }, testInfo) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    await clickAndWaitForAction(page, removeButton(roomItem(floor, tree.firstFloorRooms[0]!.name)));
    await expect(toast(page)).toBeVisible();
    // Musa står der «Fjern» ble trykket. Kommer meldingen under den, stopper Chrome tiden (hover)
    // når den selv vil. Flytt musa bort, så bare testen bestemmer når tiden står.
    await page.mouse.move(0, 0);
    await page.clock.runFor(9_999);
    await expect(toast(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(toast(page)).toHaveCount(0);

    if (testInfo.project.name !== "pc") return;
    await clickAndWaitForAction(page, removeButton(roomItem(floor, tree.firstFloorRooms[1]!.name)));
    await expect(toast(page)).toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(5_000);
    await toast(page).hover();
    await page.clock.runFor(30_000);
    await expect(toast(page), "tiden står mens musa er over").toBeVisible();
    await page.mouse.move(0, 0);
    await page.clock.runFor(4_999);
    await expect(toast(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(toast(page)).toHaveCount(0);
  });

  test("10.7 ny sletting erstatter: to «Fjern» etter hverandre gir én melding med «Mer i papirkurven»", async ({
    page,
  }) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const [first, second] = tree.firstFloorRooms;
    await clickAndWaitForAction(page, removeButton(roomItem(floor, first!.name)));
    await clickAndWaitForAction(page, removeButton(roomItem(floor, second!.name)));

    await expect(toast(page)).toHaveCount(1);
    await expect(toast(page)).toContainText(`Rommet «${second!.name}» er fjernet.`);
    await expect(page.getByRole("button", { name: "Mer i papirkurven" })).toBeVisible();
    await expect(undoButton(page)).toHaveCount(1);

    await clickAndWaitForAction(page, undoButton(page));
    await expect(roomItem(floor, second!.name)).toBeVisible();
    await expect(roomItem(floor, first!.name), "«Angre» gjelder bare den siste").toHaveCount(0);
  });

  test("10.8 papirkurven: lukket, åpnes med tastatur, linjen viser hva, hvor, areal, hvem og «i dag HH:MM»; «Gjenopprett» henter tilbake", async ({
    page,
  }) => {
    const tree = await start(page);
    const building = block(page, tree.buildingName);
    await expect(trashSummary(page), "tom papirkurv vises ikke").toHaveCount(0);

    const room = tree.firstFloorRooms[2]!;
    await clickAndWaitForAction(
      page,
      removeButton(roomItem(block(building, "1. etasje"), room.name)),
    );
    await clickAndWaitForAction(page, removeButton(block(building, "2. etasje")).first());
    await closeButton(page).click();

    const summary = trashSummary(page);
    await expect(summary).toHaveText(/Papirkurv \(2\)/);
    const details = page.locator("#papirkurv-bygninger");
    await expect(details).not.toHaveAttribute("open", /.*/);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", /.*/);

    const lines = details.locator("li");
    await expect(lines.first(), "nyeste først").toContainText("2. etasje (4 rom)");
    await expect(lines.first()).toContainText("BRA 40,0 m²");
    const roomLine = details.locator("li").filter({ hasText: room.name }).first();
    await expect(roomLine).toContainText(`${tree.buildingName} › 1. etasje`);
    await expect(roomLine).toContainText(/Fjernet av .+ i dag \d{2}:\d{2}/);
    await expect(details).not.toContainText("@");

    await clickAndWaitForAction(page, restoreButton(details, room.name));
    await expect(details.locator("li").filter({ hasText: room.name })).toHaveCount(0);
    const restored = page.locator(`[data-restore-id="room:${room.id}"]`);
    await expect(restored).toBeFocused();
    await expect(restored).toBeInViewport();
  });

  test("10.9 rom i fjernet etasje: «Gjenopprett» gir beskjeden om etasjen", async ({ page }) => {
    const tree = await start(page);
    const building = block(page, tree.buildingName);
    const room = tree.secondFloorRooms[0]!;
    await clickAndWaitForAction(
      page,
      removeButton(roomItem(block(building, "2. etasje"), room.name)),
    );
    await clickAndWaitForAction(page, removeButton(block(building, "2. etasje")).first());
    await closeButton(page).click();

    await trashSummary(page).click();
    await clickAndWaitForAction(
      page,
      restoreButton(page.locator("#papirkurv-bygninger"), room.name),
    );
    await expect(
      page.getByText("Rommet kom tilbake, sammen med etasjen «2. etasje»."),
    ).toBeVisible();
    await expect(roomItem(block(building, "2. etasje"), room.name)).toBeVisible();
    // Søsknene fra gruppen blir liggende.
    await expect(
      roomItem(block(building, "2. etasje"), tree.secondFloorRooms[1]!.name),
    ).toHaveCount(0);
  });

  test("10.10 Cmd/Ctrl+Z utløser «Angre», men ikke når fokus står i et tekstfelt", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "pc", "hurtigtasten gjelder PC");
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const [first, second] = tree.firstFloorRooms;
    const shortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";

    await clickAndWaitForAction(page, removeButton(roomItem(floor, first!.name)));
    // Fokus i et tekstfelt: ingenting skjer.
    const textField = page.getByRole("textbox").first();
    await textField.focus();
    await page.keyboard.press(shortcut);
    await expect(roomItem(floor, first!.name)).toHaveCount(0);
    await expect(undoButton(page)).toBeVisible();

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const done = page.waitForResponse((r) => r.request().headers()["next-action"] !== undefined);
    await page.keyboard.press(shortcut);
    await done;
    await expect(roomItem(floor, first!.name)).toBeVisible();

    // Begge hurtigtastene virker.
    await clickAndWaitForAction(page, removeButton(roomItem(floor, second!.name)));
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    const again = page.waitForResponse((r) => r.request().headers()["next-action"] !== undefined);
    await page.keyboard.press(shortcut === "Meta+z" ? "Control+z" : "Meta+z");
    await again;
    await expect(roomItem(floor, second!.name)).toBeVisible();
  });

  test("10.11 feil: avbrutt server-handling gir feilteksten og ny «Angre»; rommet vises ikke som gjenopprettet", async ({
    page,
  }) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const room = tree.firstFloorRooms[0]!;
    await clickAndWaitForAction(page, removeButton(roomItem(floor, room.name)));

    await page.route(`**/oppdrag/${tree.assignmentId}/bygninger`, (route) =>
      route.request().method() === "POST" ? route.abort("failed") : route.continue(),
    );
    await undoButton(page).click();
    await expect(
      page.getByText("Fikk ikke hentet tilbake rommet. Prøv igjen, eller bruk papirkurven."),
    ).toBeVisible();
    await expect(undoButton(page)).toBeVisible();
    await expect(roomItem(floor, room.name)).toHaveCount(0);
    expect((await trashCountsFor(tree.assignmentId)).rooms).toBe(1);

    await page.unroute(`**/oppdrag/${tree.assignmentId}/bygninger`);
    await clickAndWaitForAction(page, undoButton(page));
    await expect(roomItem(floor, room.name)).toBeVisible();
  });

  test("10.12 takstmann uten endringsrett ser papirkurven uten «Gjenopprett» og uten «Fjern»", async ({
    page,
  }) => {
    const previous = await setInspectorsEditAll(false);
    try {
      await logIn(page);
      const tree = await createAssignmentWithTrashTree(uniqueSuffix());
      await openBuildings(page, tree);
      const room = tree.firstFloorRooms[0]!;
      await clickAndWaitForAction(
        page,
        removeButton(roomItem(block(block(page, tree.buildingName), "1. etasje"), room.name)),
      );

      await page.context().clearCookies();
      await logInAsInspector(page);
      await openBuildings(page, tree);
      await expect(page.getByRole("button", { name: /^Fjern/ })).toHaveCount(0);
      await trashSummary(page).click();
      const details = page.locator("#papirkurv-bygninger");
      await expect(details).toContainText(room.name);
      await expect(details.getByRole("button", { name: /^Gjenopprett/ })).toHaveCount(0);
    } finally {
      await restoreInspectorsEditAll(previous);
    }
  });

  test("10.13 størrelser: «Fjern», «Gjenopprett» og lukk minst 44 px; «Angre» minst 56 px på iPad", async ({
    page,
  }, testInfo) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const room = tree.firstFloorRooms[0]!;
    await expectAtLeast(removeButton(roomItem(floor, room.name)), 44, "«Fjern»");
    await clickAndWaitForAction(page, removeButton(roomItem(floor, room.name)));
    await expectAtLeast(undoButton(page), testInfo.project.name === "ipad" ? 56 : 44, "«Angre»");
    await expectAtLeast(closeButton(page), 44, "lukkeknappen");
    const closeBox = (await closeButton(page).boundingBox())!;
    expect(closeBox.width, "lukkeknappen er minst 44 px bred").toBeGreaterThanOrEqual(44);
    await closeButton(page).click();
    await expectAtLeast(trashSummary(page), 44, "«Papirkurv (1)»");
    await trashSummary(page).click();
    await expectAtLeast(
      restoreButton(page.locator("#papirkurv-bygninger"), room.name),
      44,
      "«Gjenopprett»",
    );
  });

  test("10.14 meldingen dekker ikke hovedknappene festet nederst", async ({ page }) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    await clickAndWaitForAction(page, removeButton(roomItem(floor, tree.firstFloorRooms[0]!.name)));
    const box = (await toast(page).boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y + box.height, "meldingen er innenfor skjermen").toBeLessThanOrEqual(
      viewport.height,
    );
    // Knapper i elementer festet nederst (position: fixed/sticky, bottom) skal ikke overlappe.
    const fixedButtons = await page.evaluate(() => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      for (const el of Array.from(document.querySelectorAll("button, a[href]"))) {
        let node: Element | null = el;
        let pinned = false;
        while (node) {
          const style = getComputedStyle(node);
          if (
            (style.position === "fixed" || style.position === "sticky") &&
            style.bottom !== "auto"
          )
            pinned = true;
          if (node.getAttribute("role") === "status" || node.closest("[data-undo-toast]")) {
            pinned = false;
            break;
          }
          node = node.parentElement;
        }
        if (!pinned) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          out.push({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
      return out;
    });
    const toastButtons = [
      await undoButton(page).boundingBox(),
      await closeButton(page).boundingBox(),
    ];
    for (const b of fixedButtons) {
      if (toastButtons.some((t) => t && t.x === b.x && t.y === b.y)) continue;
      const overlaps =
        box.x < b.x + b.width &&
        b.x < box.x + box.width &&
        box.y < b.y + b.height &&
        b.y < box.y + box.height;
      expect(overlaps, `meldingen dekker en hovedknapp ved y=${b.y}`).toBe(false);
    }
  });

  test("10.15 skjermleser og tastatur: role=status, alle knapper har navn, Tab når «Angre» og ×", async ({
    page,
  }) => {
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    await clickAndWaitForAction(page, removeButton(roomItem(floor, tree.firstFloorRooms[0]!.name)));
    await expect(page.getByRole("status").filter({ hasText: "er fjernet." })).toHaveCount(1);
    await expect(undoButton(page)).not.toBeFocused();

    const unnamed = await page.getByRole("button").evaluateAll(
      (buttons) =>
        buttons.filter((b) => {
          const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").trim();
          return name.length === 0;
        }).length,
    );
    expect(unnamed, "ingen knapper uten navn").toBe(0);

    const reached = new Set<string>();
    for (let i = 0; i < 200 && reached.size < 2; i += 1) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return (el?.getAttribute("aria-label") ?? el?.textContent ?? "").trim();
      });
      if (label === "Angre" || label === "Lukk meldingen") reached.add(label);
    }
    expect([...reached].sort()).toEqual(["Angre", "Lukk meldingen"]);
  });

  test("10.16 prefers-reduced-motion: ingen animasjon på uthevingen", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const tree = await start(page);
    const floor = block(block(page, tree.buildingName), "1. etasje");
    const room = tree.firstFloorRooms[0]!;
    await clickAndWaitForAction(page, removeButton(roomItem(floor, room.name)));
    await clickAndWaitForAction(page, undoButton(page));
    const restored = page.locator(`[data-restore-id="room:${room.id}"]`);
    await expect(restored).toBeVisible();
    const motion = await restored.evaluate((el) => {
      const style = getComputedStyle(el);
      return { transition: style.transitionDuration, animation: style.animationName };
    });
    expect(motion.animation).toBe("none");
    expect(motion.transition.split(",").every((d) => parseFloat(d) === 0)).toBe(true);
  });

  test("10.17 ingen persondata i nettleserlagring eller adressen etter fjerning av part", async ({
    page,
  }) => {
    const tree = await start(page);
    await page.goto(`/oppdrag/${tree.assignmentId}`);
    const card = page
      .getByRole("region", { name: "Parter", exact: true })
      .getByRole("listitem")
      .filter({ hasText: tree.partyName });
    await clickAndWaitForAction(page, removeButton(card));
    await expect(toast(page)).toContainText(tree.partyName);

    const stored = await page.evaluate(() => {
      const dump = (s: Storage) =>
        Array.from({ length: s.length }, (_, i) => {
          const key = s.key(i) ?? "";
          return `${key}=${s.getItem(key)}`;
        }).join("\n");
      return dump(localStorage) + "\n" + dump(sessionStorage);
    });
    expect(stored).not.toContain(tree.partyName);
    expect(stored).not.toContain("Testmann");
    expect(stored).not.toContain(tree.partyId);
    const url = page.url();
    expect(url).not.toContain(tree.partyId);
    expect(decodeURIComponent(url)).not.toContain("Testmann");
    expect(new URL(url).search.match(UUID_RE)).toBeNull();
  });
});
