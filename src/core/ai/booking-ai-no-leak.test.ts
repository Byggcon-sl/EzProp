import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { assignments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  allAiRows,
  employeeWithGrant,
  enableAi,
  enableAnthropic,
  fakeAiProvider,
  requestSuggestion,
  validRequest,
} from "../../../tests/ai";
import {
  fakeAnthropic,
  okReply,
  sentPromptText,
  TEST_ANTHROPIC_KEY,
} from "../../../tests/fake-anthropic";
import { createOrganization, resetDatabase } from "../../../tests/factories";
import { seedKnownValues, type KnownSeed } from "../../../tests/known-values";

/*
 * Testplan for «Nytt oppdrag» 4.10.3: bestillingsfeltene som nå står på oppdraget (ADR 0011)
 * når aldri KI. Oppdraget har verken ordre eller eiendom, så verdiene finnes bare i de nye
 * kolonnene på `assignments`. Sjekkes mot merker som ikke kan forekomme tilfeldig, både med den
 * falske leverandøren (`fake`) og med Anthropic-adapteren mot falsk HTTP (`tests/fake-anthropic.ts`).
 * Ingen nettkall. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (adresse, matrikkel og bestiller fra «Nytt oppdrag» sendes aldri
 * til KI, regel 14, selv når takstmannen skriver dem inn i teksten).
 */

const TEST_TARGET_TYPE = "test_ekte_mal_bestilling";

vi.mock("./features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features")>();
  return {
    ...actual,
    getFeatureDefinition: (code: string) => {
      const definition = actual.getFeatureDefinition(code);
      if (!definition || definition.code !== "language_polish") return definition;
      return {
        ...definition,
        allowedTargets: [
          ...definition.allowedTargets,
          { type: TEST_TARGET_TYPE, fieldKey: "text" },
        ],
      };
    },
  };
});

/** Merkene fra testplanen. */
const MARKS = {
  address: "MERKE-ADR-N7Q",
  orderedBy: "MERKE-BEST-N7Q",
  externalRef: "MERKE-REF-N7Q",
  association: "MERKE-BRL-N7Q",
  gnr: "7771",
  bnr: "7772",
  snr: "7773",
} as const;
const ALL_MARKS = Object.values(MARKS);
const CONTACT_FIRST = "Qxzmerkekontakt";
const CONTACT_LAST = "Bestillersen";
const FIRM_NAME = "Qxzmerkefirma Megling AS";

const BOOKING_ON_ASSIGNMENT: KnownSeed = {
  order: {
    addressText: `${MARKS.address} 5, 8000 Bodø`,
    orderedByText: MARKS.orderedBy,
    gnr: MARKS.gnr,
    bnr: MARKS.bnr,
    snr: MARKS.snr,
    housingAssociationName: MARKS.association,
    orderedByContact: { firstName: CONTACT_FIRST, lastName: CONTACT_LAST },
    orderedByFirm: { name: FIRM_NAME },
  },
};

/** Takstmannen har skrevet bestillingsverdiene inn i teksten (det verste tilfellet). */
const TEXT_WITH_BOOKING =
  `Befaring i ${MARKS.address} 5, gnr ${MARKS.gnr} bnr ${MARKS.bnr} snr ${MARKS.snr}, ` +
  `${MARKS.association}. Bestilt av ${MARKS.orderedBy} via ${CONTACT_FIRST} ${CONTACT_LAST} ` +
  `i ${FIRM_NAME}, ref ${MARKS.externalRef}. taket er gammelt og har noen sprekker`;
const NEUTRAL_TEXT = "taket er gammelt og har noen sprekker";
const FORBIDDEN = [...ALL_MARKS, CONTACT_FIRST, CONTACT_LAST, "Qxzmerkefirma"];

async function seedAssignment(organizationId: string): Promise<string> {
  const assignmentId = await seedKnownValues(organizationId, BOOKING_ON_ASSIGNMENT, {
    onAssignment: true,
  });
  // Meglerens ordrenummer står ikke i `KnownSeed`; det legges rett på oppdraget.
  await db
    .update(assignments)
    .set({ externalRef: MARKS.externalRef })
    .where(eq(assignments.id, assignmentId));
  const [row] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  // Forutsetningen for testen: verdiene finnes bare på oppdraget
  expect(row?.orderId).toBeNull();
  expect(row?.propertyId).toBeNull();
  expect(row?.addressText).toContain(MARKS.address);
  expect(row?.externalRef).toBe(MARKS.externalRef);
  return assignmentId;
}

function expectNoMarks(text: string, where: string) {
  for (const mark of FORBIDDEN) {
    expect(text, `${mark} i ${where}`).not.toContain(mark);
  }
}

async function aiRowsText(): Promise<string> {
  return JSON.stringify(await allAiRows());
}

beforeEach(resetDatabase);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("4.10.3 bestillingen på oppdraget når aldri den falske leverandøren", () => {
  async function fakeOrganization(): Promise<{ grant: EmployeeGrant; assignmentId: string }> {
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAi(organization.id);
    const assignmentId = await seedAssignment(organization.id);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);
    return { grant, assignmentId };
  }

  it.each([
    ["teksten har bestillingsverdiene", TEXT_WITH_BOOKING],
    ["nøytral tekst", NEUTRAL_TEXT],
  ])(
    "fake: ingen merke i kallet til leverandøren eller i ai_usage_log (%s)",
    async (_name, text) => {
      const { grant, assignmentId } = await fakeOrganization();
      const spy = vi.spyOn(fakeAiProvider, "complete");

      const result = await requestSuggestion(
        grant,
        validRequest({ assignmentId, fields: { text } }),
      );

      expect(result.kind).toBe("suggestion");
      expect(spy).toHaveBeenCalledTimes(1);
      expectNoMarks(JSON.stringify(spy.mock.calls), "kallet til fake");
      expectNoMarks(await aiRowsText(), "ai_usage_log");
      expect(JSON.stringify(spy.mock.calls)).toContain("taket er gammelt");
    },
  );
});

describe("4.10.3 bestillingen på oppdraget når aldri Anthropic (falsk HTTP)", () => {
  it.each([
    ["teksten har bestillingsverdiene", TEXT_WITH_BOOKING],
    ["nøytral tekst", NEUTRAL_TEXT],
  ])("anthropic: ingen merke i HTTP-kroppen eller i ai_usage_log (%s)", async (_name, text) => {
    const http = fakeAnthropic(okReply({ text: "Taket er gammelt." }));
    vi.stubGlobal("fetch", http.fetchFn);
    vi.stubEnv("ANTHROPIC_API_KEY", TEST_ANTHROPIC_KEY);
    const organization = await createOrganization("Oppdiktet Takst A");
    await enableAnthropic(organization.id);
    const assignmentId = await seedAssignment(organization.id);
    const { grant } = await employeeWithGrant(organization.id, ["inspector"]);

    const result = await requestSuggestion(
      grant,
      validRequest({
        assignmentId,
        target: { type: TEST_TARGET_TYPE, id: uuidv7(), fieldKey: "text" },
        fields: { text },
      }),
    );

    // Vasket tekst går ut; ellers stopper lekkasjesjekken kallet. Begge er riktige, men et kall
    // som gikk ut, skal aldri ha et merke.
    expect(["suggestion", "blocked"]).toContain(result.kind);
    for (const call of http.calls) {
      expectNoMarks(call.body, "HTTP-kroppen");
      expectNoMarks(sentPromptText(call), "ledeteksten");
    }
    if (text === NEUTRAL_TEXT) expect(http.calls).toHaveLength(1);
    expectNoMarks(await aiRowsText(), "ai_usage_log");
  });
});
