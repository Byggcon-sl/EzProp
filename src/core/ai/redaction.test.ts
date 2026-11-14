import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { PII_PLACEHOLDERS } from "@/shared/lib/pii-patterns";
import { employeeWithGrant } from "../../../tests/ai";
import { stubFailingRegExp } from "../../../tests/failing-regexp";
import {
  createAssignment,
  createContact,
  createFirm,
  createOrder,
  createOrganization,
  resetDatabase,
} from "../../../tests/factories";
import {
  containsWord,
  knownStrings,
  knownValuesFor,
  loadKnownValues,
  placeholderCounts,
  redactText,
  seedKnownValues,
  type KnownSeed,
} from "../../../tests/redaction";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { REDACTION_CASES, STANDARD_KNOWN_VALUES } from "./redaction-cases";

/*
 * Vasken med kjente verdier (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 3, kortet
 * Omfang 2 og 3, A170, A174). `redactText(text, knownValues)` er ren; de kjente verdiene legges
 * inn som rader i testdatabasen og hentes med `loadKnownValues`, så testene ikke binder seg til
 * formen på `KnownValues` (se `tests/redaction.ts`). Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen og de ansatte (takstmannen kan skrive fritt i notatene; navn,
 * adresse og matrikkel til kunden sendes aldri til KI, regel 14).
 */

beforeEach(resetDatabase);

async function setup(name = "Oppdiktet Takst A"): Promise<EmployeeGrant> {
  const organization = await createOrganization(name);
  return (await employeeWithGrant(organization.id, ["inspector"], "Qxz Brukersen")).grant;
}

async function redactWith(seed: KnownSeed, texts: string[]) {
  const grant = await setup();
  const known = await knownValuesFor(grant, seed);
  return texts.map((text) => redactText(text, known));
}

async function redactOne(seed: KnownSeed, text: string) {
  const [result] = await redactWith(seed, [text]);
  return result!;
}

describe("V3 vasken med kjente verdier", () => {
  it("V3.1 kjente verdier vaskes før mønstrene: partens telefon gir én [telefon] og count 1", async () => {
    const result = await redactOne(
      { parties: [{ name: "Qxz Partsen", phone: "12345678" }] },
      "Ring 12345678 for nøkkel.",
    );
    expect(result.text).toBe("Ring [telefon] for nøkkel.");
    expect(result.count).toBe(1);
  });

  it("V3.1 partens telefon skrevet med mellomrom telles også én gang", async () => {
    const result = await redactOne(
      { parties: [{ name: "Qxz Partsen", phone: "12345678" }] },
      "Ring 123 45 678 for nøkkel.",
    );
    expect(result.text).toBe("Ring [telefon] for nøkkel.");
    expect(result.count).toBe(1);
  });

  it("V3.1 partens e-post gir én [e-post] og count 1", async () => {
    const result = await redactOne(
      { parties: [{ name: "Qxz Partsen", email: "qxz.partsen@example.no" }] },
      "Skriv til qxz.partsen@example.no i dag.",
    );
    expect(result.text).toBe("Skriv til [e-post] i dag.");
    expect(result.count).toBe(1);
  });

  it.each(["ÅSE TESTESEN", "åse testesen", "Åse Testesen", "åSE tESTESEN"])(
    "V3.2 store og små bokstaver: «%s» vaskes",
    async (written) => {
      const result = await redactOne({ parties: [{ name: "Åse Testesen" }] }, `Hei ${written}.`);
      expect(result.text).toBe("Hei [navn].");
      expect(result.count).toBe(1);
    },
  );

  it("V3.3 personnavn: hel frase og hvert ord på minst tre tegn", async () => {
    const results = await redactWith({ parties: [{ name: "Åse Testesen" }] }, [
      "Åse Testesen kom.",
      "Åse kom.",
      "Testesen kom.",
    ]);
    expect(results.map((r) => r.text)).toEqual(["[navn] kom.", "[navn] kom.", "[navn] kom."]);
  });

  it("V3.3 restrisiko (A174, villet): «Bo Li» vaskes som frase, men «Bo» og «Li» alene står", async () => {
    const results = await redactWith({ parties: [{ name: "Bo Li" }] }, [
      "Bo Li kom.",
      "Bo kom.",
      "Li kom.",
    ]);
    expect(results[0]!.text).toBe("[navn] kom.");
    expect(results[1]!.text).toBe("Bo kom.");
    expect(results[2]!.text).toBe("Li kom.");
  });

  const NORDIC: KnownSeed = {
    parties: [{ name: "Åse Ødegård" }, { name: "Anne-Lise Hansen" }],
    property: { address: "Sjøgata 4", city: "Bjørnø" },
  };

  it.each([
    "Åse",
    "Ødegård",
    "Bjørnø",
    "Sjøgata",
    "Anne-Lise",
    "Anne",
    "Lise",
    "Hansens",
    "Hansen's",
    "Anne-Lises",
  ])("V3.4 æøå, bindestrek og genitiv: «%s» vaskes", async (written) => {
    const result = await redactOne(NORDIC, `Før ${written} etter.`);
    expect(result.text).toMatch(/^Før \[(?:navn|adresse)\] etter\.$/u);
    expect(result.count).toBe(1);
  });

  it.each(["Åsen", "Lisens", "Hansenbygget", "Annexet", "Bjørnøya"])(
    "V3.4 grenser med Unicode: «%s» (lengre ord) står",
    async (written) => {
      const result = await redactOne(NORDIC, `Før ${written} etter.`);
      expect(result.text).toBe(`Før ${written} etter.`);
      expect(result.count).toBe(0);
    },
  );

  it("V3.4 «Åse Ødegård» skrevet i NFD vaskes som i NFC", async () => {
    const result = await redactOne(
      { parties: [{ name: "Åse Ødegård" }] },
      "Hei Åse Ødegård.".normalize("NFD"),
    );
    expect(result.text).toBe("Hei [navn].");
  });

  it.each(["Bygg & Co A/S", "Rør (Nord) AS", "St. Testhansen Eiendom", "Test+Sønn AS"])(
    "V3.5 verdier med regex-tegn: «%s» vaskes uten unntak",
    async (firmName) => {
      const result = await redactOne(
        { partyFirms: [{ name: firmName, orgNumber: null }] },
        `Arbeidet ble gjort av ${firmName} i fjor.`,
      );
      expect(result.text).toBe("Arbeidet ble gjort av [navn] i fjor.");
      expect(result.count).toBe(1);
    },
  );

  it("V3.5 regex-tegn i navn på part («(Ola)», «A/S») kaster ikke og treffer ikke alt", async () => {
    const result = await redactOne(
      { parties: [{ name: "(Ola) Testesen", firmName: "Prøve A/S" }] },
      "Taket er tett. Prøve A/S var her.",
    );
    expect(result.text).toBe("Taket er tett. [navn] var her.");
  });

  it.each([
    {
      column: "firms.name",
      seed: { partyFirms: [{ name: "Bygg og Tak AS", orgNumber: null }] },
      phrase: "Bygg og Tak AS",
      words: ["tak", "bygg"],
    },
    {
      column: "cadastral_units.association_name",
      seed: { property: { associationName: "Borettslaget Testtunet" } },
      phrase: "Borettslaget Testtunet",
      words: ["borettslaget"],
    },
    {
      column: "orders.housing_association_name",
      seed: { order: { housingAssociationName: "Sameiet Prøvehagen" } },
      phrase: "Sameiet Prøvehagen",
      words: ["sameiet"],
    },
    {
      column: "common_areas.managing_agent",
      seed: { managingAgent: "Forvaltning Nordtest AS" },
      phrase: "Forvaltning Nordtest AS",
      words: ["forvaltning"],
    },
    {
      column: "orders.ordered_by_text",
      seed: { order: { orderedByText: "Oppgjør og Megling Test AS" } },
      phrase: "Oppgjør og Megling Test AS",
      words: ["megling", "oppgjør"],
    },
  ] as { column: string; seed: KnownSeed; phrase: string; words: string[] }[])(
    "V3.6 $column vaskes som hel frase; fagordene alene står",
    async ({ seed, phrase, words }) => {
      const results = await redactWith(seed, [
        `Avtalt med ${phrase} i dag.`,
        ...words.map((word) => `Her står ${word} alene.`),
      ]);
      expect(results[0]!.text).toBe("Avtalt med [navn] i dag.");
      words.forEach((word, index) => {
        expect(results[index + 1]!.text).toBe(`Her står ${word} alene.`);
        expect(results[index + 1]!.count).toBe(0);
      });
    },
  );

  const ADDRESS_SEED: KnownSeed = {
    order: { addressText: "Prøvetunet 7, 8099 Testvik" },
    property: { address: "Prøvetunet 7", postalCode: "8099", city: "Testvik" },
  };

  it.each([
    {
      name: "hel streng",
      text: "Adresse Prøvetunet 7, 8099 Testvik nå.",
      gone: ["Prøvetunet", "8099", "Testvik"],
    },
    { name: "gatenavn alene", text: "Garasjen i Prøvetunet er ny.", gone: ["Prøvetunet"] },
    { name: "gatenavn og nummer", text: "Huset Prøvetunet 7 er gult.", gone: ["Prøvetunet", "7"] },
    { name: "poststed alene", text: "Vi kjørte til Testvik i går.", gone: ["Testvik"] },
  ])("V3.7 adresse ($name) vaskes", async ({ text, gone }) => {
    const result = await redactOne(ADDRESS_SEED, text);
    for (const value of gone) expect(containsWord(result.text, value), result.text).toBe(false);
    expect(result.text).toContain("[adresse]");
  });

  it("V3.7 postnummer alene står", async () => {
    const result = await redactOne(ADDRESS_SEED, "Skapet er merket 8099.");
    expect(result.text).toBe("Skapet er merket 8099.");
    expect(result.count).toBe(0);
  });

  const CADASTRAL_SEED: KnownSeed = {
    property: {
      municipalityNumber: "1899",
      gnr: "12",
      bnr: "34",
      fnr: "0",
      snr: "5",
      shareNumber: "5",
    },
  };

  it.each(["12/34", "12/34/0/5", "1899-12/34", "gnr 12", "bnr 34", "andelsnummer 5"])(
    "V3.8 matrikkel «%s» vaskes",
    async (written) => {
      const result = await redactOne(CADASTRAL_SEED, `Eiendommen ${written} er befart.`);
      expect(result.text).toBe("Eiendommen [matrikkel] er befart.");
      expect(result.count).toBe(1);
    },
  );

  it.each(["123 mm", "34 grader", "12 cm", "5 m", "0,5 m"])(
    "V3.8 mål med samme tall som matrikkelen står: «%s»",
    async (written) => {
      const text = `Målt ${written} ved trappen.`;
      const result = await redactOne(CADASTRAL_SEED, text);
      expect(result.text).toBe(text);
      expect(result.count).toBe(0);
    },
  );

  it("V3.9 lengste først: «Anne-Lise Testesen» blir én [navn]", async () => {
    const result = await redactOne(
      { parties: [{ name: "Anne-Lise Testesen" }] },
      "Anne-Lise Testesen kom.",
    );
    expect(result.text).toBe("[navn] kom.");
    expect(result.count).toBe(1);
  });

  it("V3.9 lengste først: hel adresse blir én [adresse], ikke flere biter", async () => {
    const result = await redactOne(ADDRESS_SEED, "Prøvetunet 7, 8099 Testvik");
    expect(result.text).toBe("[adresse]");
    expect(result.count).toBe(1);
  });

  it("V3.10 tom eller kort verdi (tom, ett tegn, bare mellomrom) treffer ikke alt", async () => {
    const text = "Taket er fint og tett, og pipen står.";
    const result = await redactOne(
      {
        parties: [{ name: "Q", firmName: " ", email: "", phone: " " }],
        order: { orderedByText: " ", housingAssociationName: "" },
        managingAgent: "",
      },
      text,
    );
    expect(result.text).toBe(text);
    expect(result.count).toBe(0);
  });

  it("V3 count er antall treff (navn, telefon og adresse i samme tekst)", async () => {
    const result = await redactOne(
      STANDARD_KNOWN_VALUES,
      "Åse Testesen (12345678) bor i Prøvetunet 7.",
    );
    expect(placeholderCounts(result.text)).toEqual({
      "[navn]": 1,
      "[telefon]": 1,
      "[adresse]": 1,
    });
    expect(result.count).toBe(3);
  });

  it("V3 de kjente verdiene endrer ikke teksten utenom treffene", async () => {
    const result = await redactOne(STANDARD_KNOWN_VALUES, "  Linje 1\nLinje 2  \tTG 2  ");
    expect(result.text).toBe("  Linje 1\nLinje 2  \tTG 2  ");
  });
});

describe("V3.11 testsett med fasit (redaction-cases.ts)", () => {
  it("V3.11 settet har mellom 30 og 50 saker og dekker alle åtte plassholdere", async () => {
    expect(REDACTION_CASES.length).toBeGreaterThanOrEqual(30);
    expect(REDACTION_CASES.length).toBeLessThanOrEqual(50);
    expect(new Set(REDACTION_CASES.map((c) => c.name)).size).toBe(REDACTION_CASES.length);

    const seen = new Set<string>();
    for (const [index, testCase] of REDACTION_CASES.entries()) {
      // Egen organisasjon per sak: samme oppdiktede org.nr. kan stå i flere saker
      const grant = await setup(`Oppdiktet Takst ${index}`);
      const known = await knownValuesFor(grant, testCase.knownValues ?? {});
      for (const placeholder of Object.keys(
        placeholderCounts(redactText(testCase.input, known).text),
      )) {
        seen.add(placeholder);
      }
    }
    for (const placeholder of PII_PLACEHOLDERS) expect([...seen]).toContain(placeholder);
  });

  it("V3.11 0 bom: ingen mustRemove finnes etter vasken, og alle mustKeep står", async () => {
    const misses: string[] = [];
    const lostKeeps: string[] = [];
    let overRedacted = 0;
    const overRedactedWords: string[] = [];
    for (const [index, testCase] of REDACTION_CASES.entries()) {
      const grant = await setup(`Oppdiktet Takst ${index}`);
      const known = await knownValuesFor(grant, testCase.knownValues ?? {});
      const { text } = redactText(testCase.input, known);
      for (const value of testCase.mustRemove) {
        if (containsWord(text, value)) misses.push(`${testCase.name}: «${value}»`);
      }
      for (const value of testCase.mustKeep) {
        if (!text.includes(value)) lostKeeps.push(`${testCase.name}: «${value}»`);
      }
      // Ord som er borte, men ikke står i mustRemove: vasket unødig
      const removedWords = testCase.mustRemove.flatMap((v) => v.split(/[\s,]+/u));
      for (const word of testCase.input.match(/[\p{L}\p{N}]+/gu) ?? []) {
        if (containsWord(text, word)) continue;
        if (removedWords.some((removed) => containsWord(removed, word))) continue;
        overRedacted += 1;
        overRedactedWords.push(`${testCase.name}: ${word}`);
      }
    }
    console.info(
      `V3.11 testsettet: ${REDACTION_CASES.length} saker, ${misses.length} bom, ` +
        `${overRedacted} ord vasket unødig${overRedacted ? ` (${overRedactedWords.join("; ")})` : ""}`,
    );
    expect(misses, "treff vasken gikk glipp av").toEqual([]);
    expect(lostKeeps, "tekst som skulle stått").toEqual([]);
  });
});

/*
 * Oppslaget av kjente verdier filtrerer på `grant.organizationId` (testplanen V7.1, kortet
 * «Tilgang», regel 2). Mykt slettede rader tas med (A170), men aldri rader fra en annen
 * organisasjon. Alle verdier er oppdiktet.
 */
describe("loadKnownValues: tenant-isolasjon (V7.1)", () => {
  it("V7.1 expectTenantIsolation: B får ingen verdier fra A sitt oppdrag, og omvendt", async () => {
    const seeded: { assignmentId: string; marker: string }[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedKnownValues(grantA.organizationId, {
          parties: [{ name: "Annlaug Aorgsen", phone: "41112222", deleted: true }],
          property: { address: "Aorgtunet 1" },
        });
        const b = await seedKnownValues(grantB.organizationId, {
          parties: [{ name: "Bertil Borgsen", phone: "42223333" }],
          property: { address: "Borgtunet 2" },
        });
        seeded.push({ assignmentId: a, marker: "Aorgsen" }, { assignmentId: b, marker: "Borgsen" });
        return { a: [a], b: [b] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const visible: { id: string }[] = [];
        for (const { assignmentId, marker } of seeded) {
          let values: unknown;
          try {
            values = await loadKnownValues(grant, assignmentId);
          } catch {
            continue;
          }
          const strings = knownStrings(values).join(" ");
          if (strings.includes(marker)) visible.push({ id: assignmentId });
        }
        return visible;
      },
      idOf: (row) => row.id,
    });
  });

  it("V7.1 A sitt oppdrag slått opp med B sin grant kaster (feil stenger, A176) og røper ingen verdier fra A", async () => {
    const orgA = await createOrganization("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    const grantB = (await employeeWithGrant(orgB.id, ["admin"], "Qxz Admin B")).grant;
    const assignmentA = await seedKnownValues(orgA.id, {
      parties: [{ name: "Annlaug Aorgsen", email: "annlaug@example.no", phone: "41112222" }],
      property: { address: "Aorgtunet 1", city: "Aorgvik" },
    });
    const error = await loadKnownValues(grantB, assignmentA).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error, "oppslaget skulle kastet").toBeInstanceOf(Error);
    const seen = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
    for (const value of [
      "Aorgsen",
      "Annlaug",
      "annlaug@example.no",
      "41112222",
      "Aorgtunet",
      "Aorgvik",
    ]) {
      expect(seen).not.toContain(value);
    }
  });
});

/*
 * Oppdraget eier bestillingsopplysningene (ADR 0011, A292, testplan for «Nytt oppdrag» 4.10).
 * Vasken leser dem fra oppdraget selv, også når `order_id` og `property_id` er tomme.
 * Alle verdier er oppdiktet.
 */
describe("loadKnownValues: bestillingen leses fra oppdraget (ADR 0011)", () => {
  it("4.10.1 oppdrag uten ordre og eiendom: adresse, matrikkel, borettslag, ordrenummer og bestiller vaskes", async () => {
    const grant = await setup();
    const organizationId = grant.organizationId;
    const firm = await createFirm(organizationId, { name: "Qxzmegling Bestiller AS" });
    const contact = await createContact(organizationId, {
      firstName: "Qxzolav",
      lastName: "Bestillersen",
      email: "qxzolav@example.no",
      phone: "47771234",
      firmId: firm.id,
    });
    const assignment = await createAssignment(organizationId, {
      orderId: null,
      propertyId: null,
      addressText: "Qxzbestillingsveien 17, 8019 Qxzby",
      gnr: "7781",
      bnr: "7782",
      snr: "3",
      housingAssociationName: "Qxztunet Borettslag",
      externalRef: "QXZREF-7731",
      orderedByText: "Qxzbestiller Fritekst",
      orderedByContactId: contact.id,
      orderedByFirmId: firm.id,
    });
    expect(assignment.orderId).toBeNull();
    expect(assignment.propertyId).toBeNull();

    const known = await loadKnownValues(grant, assignment.id);
    const text =
      "Befaring i Qxzbestillingsveien 17, gnr. 7781 bnr. 7782 snr. 3 i Qxztunet Borettslag. " +
      "Ref QXZREF-7731 fra Qxzbestiller Fritekst. Kontakt Qxzolav Bestillersen i " +
      "Qxzmegling Bestiller AS, qxzolav@example.no, 47771234.";
    const result = redactText(text, known);

    for (const value of [
      "Qxzbestillingsveien",
      "7781",
      "7782",
      "Qxztunet",
      "QXZREF-7731",
      "Qxzbestiller Fritekst",
      "Qxzolav",
      "Bestillersen",
      "Qxzmegling",
      "qxzolav@example.no",
      "47771234",
    ]) {
      expect(result.text, `${value} står igjen`).not.toContain(value);
    }
    expect(result.text).toContain("Befaring i");
  });

  it("4.10.2 oppdrag fra ordre der ordren er rettet etterpå: både ordrens og oppdragets verdi vaskes", async () => {
    const grant = await setup();
    const organizationId = grant.organizationId;
    const assignment = await createAssignment(organizationId, {
      addressText: "Qxzoppdragsveien 3, 8006 Qxzby",
      orderedByText: "Qxzoppdrag Bestiller",
    });
    await createOrder(organizationId, {
      status: "converted",
      assignmentId: assignment.id,
      addressText: "Qxzordreveien 9, 8006 Qxzby",
      orderedByText: "Qxzordre Bestiller",
      externalRef: "QXZORD-5512",
    });

    const known = await loadKnownValues(grant, assignment.id);
    const result = redactText(
      "Qxzoppdragsveien 3 og Qxzordreveien 9. Qxzoppdrag Bestiller, Qxzordre Bestiller, QXZORD-5512.",
      known,
    );
    for (const value of [
      "Qxzoppdragsveien",
      "Qxzordreveien",
      "Qxzoppdrag Bestiller",
      "Qxzordre Bestiller",
      "QXZORD-5512",
    ]) {
      expect(result.text, `${value} står igjen`).not.toContain(value);
    }
  });

  it("4.10 bestillingen på et oppdrag i en annen organisasjon gir feil, ingen verdier", async () => {
    const grantA = await setup("Oppdiktet Takst A");
    const orgB = await createOrganization("Oppdiktet Takst B");
    const assignmentB = await createAssignment(orgB.id, {
      addressText: "Qxzborgveien 4, 8000 Qxzby",
      orderedByText: "Qxzborg Bestiller",
    });
    const error = await loadKnownValues(grantA, assignmentB.id).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    const seen = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
    expect(seen).not.toContain("Qxzborg");
  });
});

/*
 * Småfunn fra «Vask før KI» som tas med evalueringssettet (docs/funksjoner/
 * fase2a-evalueringssett-testplan.md E6.1 og E6.4, kortet Omfang 7). Den rene vasken ligger i
 * `redact-text.ts` og hentes med dynamisk import, så resten av filen kjører også før den finnes.
 */
describe("evalueringssett: feil fra new RegExp i vasken (E6.1)", () => {
  const MARKER = "Qzxhemmelig";
  const SECRETS = [MARKER, "Verdisen", "98989898"];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function pure() {
    return import("./redact-text");
  }

  function knownWithSecrets(source: Awaited<ReturnType<typeof pure>>) {
    return {
      ...source.emptyKnownValues(),
      personNames: [`${MARKER} Verdisen`],
      phones: ["98989898"],
    };
  }

  function expectClean(error: unknown) {
    expect(error).toBeInstanceOf(Error);
    const failure = error as Error;
    const seen = `${failure.name} ${failure.message} ${failure.stack ?? ""} ${JSON.stringify(failure)}`;
    for (const secret of SECRETS) expect(seen).not.toContain(secret);
    expect(failure.cause).toBeUndefined();
    expect("cause" in failure && failure.cause !== undefined).toBe(false);
  }

  it("E6.1 compileKnownValues kaster en egen feiltype uten kjente verdier i message, stack og uten cause", async () => {
    const pureModule = await pure();
    const { compileKnownValues, RedactionPatternError } = pureModule;
    const known = knownWithSecrets(pureModule);
    stubFailingRegExp(MARKER);
    let error: unknown;
    try {
      compileKnownValues(known);
    } catch (caught) {
      error = caught;
    }
    vi.unstubAllGlobals();
    expect(error, "feilen skal kastes videre (A176)").toBeDefined();
    expect(error).toBeInstanceOf(RedactionPatternError);
    expectClean(error);
  });

  it("E6.1 redactText stenger med samme feil: ingen tekst kommer ut usvasket", async () => {
    const pureModule = await pure();
    const { redactText, RedactionPatternError } = pureModule;
    const known = knownWithSecrets(pureModule);
    stubFailingRegExp(MARKER);
    let error: unknown;
    let output: unknown;
    try {
      output = redactText(`${MARKER} Verdisen ringte fra 98989898.`, known);
    } catch (caught) {
      error = caught;
    }
    vi.unstubAllGlobals();
    expect(output).toBeUndefined();
    expect(error).toBeInstanceOf(RedactionPatternError);
    expectClean(error);
  });

  it("E6.1 stubben er ikke hul: uten markøren lages mønsteret og vasken virker", async () => {
    const { redactText, emptyKnownValues } = await pure();
    stubFailingRegExp("finnes-ikke-i-noe-mønster");
    const result = redactText("Qzx Prøvesen ringte.", {
      ...emptyKnownValues(),
      personNames: ["Qzx Prøvesen"],
    });
    vi.unstubAllGlobals();
    expect(result.text).toBe("[navn] ringte.");
  });

  it("E6.1 redaction.ts re-eksporterer den rene vasken (eksisterende importer virker)", async () => {
    const redaction = (await import("./redaction")) as Record<string, unknown>;
    const pureModule = (await pure()) as Record<string, unknown>;
    for (const name of ["redactText", "compileKnownValues", "emptyKnownValues"]) {
      expect(typeof redaction[name], name).toBe("function");
      expect(redaction[name], name).toBe(pureModule[name]);
    }
  });
});

describe("evalueringssett: telefon i nye grupperinger som kjent verdi (E6.4)", () => {
  const SPACES = [
    { name: "vanlig mellomrom", space: " " },
    { name: "U+00A0", space: "\u00A0" },
    { name: "U+2009", space: "\u2009" },
    { name: "U+202F", space: "\u202F" },
  ];
  const GROUPINGS = [
    { name: "3-5", parts: ["123", "45678"] },
    { name: "4-2-2", parts: ["1234", "56", "78"] },
    { name: "2-2-4", parts: ["12", "34", "5678"] },
    { name: "3-2-3", parts: ["123", "45", "678"] },
  ];
  const CASES = GROUPINGS.flatMap((grouping) =>
    SPACES.map((space) => ({
      name: `${grouping.name} med ${space.name}`,
      value: grouping.parts.join(space.space),
    })),
  );

  it.each(CASES)(
    "E6.4 kjent 12345678 skrevet $name gir én [telefon] og count 1",
    async ({ value }) => {
      const { redactText, emptyKnownValues } = await import("./redact-text");
      const result = redactText(`Ring ${value} i morgen.`, {
        ...emptyKnownValues(),
        phones: ["12345678"],
      });
      expect(result.text).toBe("Ring [telefon] i morgen.");
      expect(result.count).toBe(1);
    },
  );
});
