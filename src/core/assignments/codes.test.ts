import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPES,
  assignmentStatusLabel,
  defaultReceives,
  NUMBER_SEQUENCE_SCOPES,
  PARTY_ROLES,
  partyRoleLabel,
  TEAM_ROLES,
  teamRoleLabel,
} from "./codes";

/*
 * Faste koder for oppdrag og nummerserier (testplan fase2a-manuell-ordre 1.1–1.2). Kodene endres
 * aldri (regel 6). Støtter hovedmål: reklamasjoner (de fire statusene fra 27.10.2026 er låst).
 */

describe("faste koder for oppdrag", () => {
  it("1.1 ASSIGNMENT_STATUSES er de fire fra 27.10.2026 i rekkefølgen bestilt → fakturert", () => {
    expect([...ASSIGNMENT_STATUSES]).toEqual(["ordered", "in_progress", "completed", "invoiced"]);
  });

  it("1.1 ASSIGNMENT_TYPES og NUMBER_SEQUENCE_SCOPES har én kode hver", () => {
    expect([...ASSIGNMENT_TYPES]).toEqual(["condition_report"]);
    expect([...NUMBER_SEQUENCE_SCOPES]).toEqual(["assignment"]);
  });

  it.each([
    ["ordered", "Bestilt"],
    ["in_progress", "Under arbeid"],
    ["completed", "Ferdig"],
    ["invoiced", "Fakturert"],
  ])("1.2 %s har etiketten «%s»", (code, label) => {
    expect(assignmentStatusLabel(code)).toBe(label);
  });

  it("1.2 ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(assignmentStatusLabel("cancelled")).toBe("cancelled");
  });
});

/*
 * Team og parter på oppdraget (docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 1).
 * Rollekodene endres aldri (regel 6); en ny kode kan legges til, men da må testsakene utvides.
 * Støtter hovedmål: tid (mottar-valgene er forhåndsutfylt etter rollen) og KI først (faste
 * rollekoder som KI senere kan foreslå mot).
 */

/** Leser «mottar» uansett om utvikleren bruker `report` eller `receivesReport` som nøkkel. */
function receives(role: string) {
  const value = defaultReceives(role as (typeof PARTY_ROLES)[number]) as unknown as Record<
    string,
    unknown
  >;
  const pick = (short: string, long: string) => (short in value ? value[short] : value[long]);
  return {
    report: pick("report", "receivesReport"),
    invoice: pick("invoice", "receivesInvoice"),
    messages: pick("messages", "receivesMessages"),
  };
}

describe("faste koder for team og parter", () => {
  it("1.1 TEAM_ROLES er de fem rollene i fast rekkefølge", () => {
    expect([...TEAM_ROLES]).toEqual([
      "responsible",
      "co_responsible",
      "inspector",
      "peer_reviewer",
      "office",
    ]);
  });

  it("1.2 PARTY_ROLES er de fem rollene i fast rekkefølge, uten client og other", () => {
    expect([...PARTY_ROLES]).toEqual([
      "broker",
      "seller",
      "buyer",
      "seller_representative",
      "invoice_recipient",
    ]);
    const roles: readonly string[] = PARTY_ROLES;
    expect(roles).not.toContain("client");
    expect(roles).not.toContain("other");
  });

  it("1.3 teamRoleLabel gir de norske etikettene i rekkefølgen til TEAM_ROLES", () => {
    expect(TEAM_ROLES.map((code) => teamRoleLabel(code))).toEqual([
      "Ansvarlig takstmann",
      "Medansvarlig",
      "Befaringstakstmann",
      "Sidemann",
      "Saksbehandler",
    ]);
  });

  it("1.3 partyRoleLabel gir de norske etikettene i rekkefølgen til PARTY_ROLES", () => {
    expect(PARTY_ROLES.map((code) => partyRoleLabel(code))).toEqual([
      "Megler",
      "Selger",
      "Kjøper",
      "Selgers representant",
      "Fakturamottaker",
    ]);
  });

  it("1.3 ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(teamRoleLabel("owner")).toBe("owner");
    expect(partyRoleLabel("client")).toBe("client");
  });
});

/** Forhåndsvalgene for hva parten mottar (A62), som testsaker. */
const DEFAULT_RECEIVES_CASES = [
  { role: "broker", report: true, invoice: false, messages: true },
  { role: "seller", report: true, invoice: false, messages: true },
  { role: "seller_representative", report: true, invoice: false, messages: true },
  { role: "buyer", report: true, invoice: false, messages: false },
  { role: "invoice_recipient", report: false, invoice: true, messages: false },
] as const;

describe("defaultReceives (A62)", () => {
  it.each(DEFAULT_RECEIVES_CASES)(
    "1.4 $role: rapport $report, faktura $invoice, kopi $messages",
    ({ role, report, invoice, messages }) => {
      expect(receives(role)).toEqual({ report, invoice, messages });
    },
  );

  it("1.4 svaret har alle tre nøklene (rapport, faktura, kopi av meldinger)", () => {
    for (const role of PARTY_ROLES) {
      const value = receives(role);
      expect(typeof value.report, `${role}: rapport`).toBe("boolean");
      expect(typeof value.invoice, `${role}: faktura`).toBe("boolean");
      expect(typeof value.messages, `${role}: kopi`).toBe("boolean");
    }
  });

  it("1.5 alle partsroller har en testsak (ny kode uten forhåndsvalg gjør testen rød)", () => {
    expect(DEFAULT_RECEIVES_CASES.map((c) => c.role).sort()).toEqual([...PARTY_ROLES].sort());
  });
});
