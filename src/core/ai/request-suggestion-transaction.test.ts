import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { requestSuggestion } from "@/core/ai";
import { db } from "@/db/client";
import { createAiUsageLog, resetDatabase } from "../../../tests/factories";
import { aiOrganization, polishRequest, polishTarget, usageRow } from "../../../tests/ai";

/*
 * Ny rad og avvisning av forrige forslag skrives i samme transaksjon som linjen i revisjonsloggen
 * (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md 6.24, kortet avklaring F).
 *
 * `recordAuditEvent` er pakket inn: den kaller den ekte funksjonen, og kaster bare der testen ber
 * om det. Egen fil, så mocken ikke treffer andre tester. Ingen ny spørring her, så filen trenger
 * ikke expectTenantIsolation. Testdata er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (en avvisning skjer aldri uten spor).
 */

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordAuditEvent).mockClear();
});

describe("requestSuggestion: samme transaksjon (6.24)", () => {
  it("6.24 revisjonsloggen feiler: forrige forslag er urørt og den nye raden finnes ikke", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    const previous = await createAiUsageLog(organization.id, { targetRef: target });
    const before = (await usageRow(previous.id))!;
    const request = polishRequest({ target });
    vi.mocked(recordAuditEvent).mockRejectedValueOnce(new Error("audit nede"));

    let outcome: unknown;
    try {
      outcome = await requestSuggestion(inspector.grant, request);
    } catch (error) {
      outcome = error;
    }

    // Kallet gir feil eller et error-svar, aldri et forslag
    if (!(outcome instanceof Error)) {
      expect((outcome as { kind: string }).kind).toBe("error");
    }
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalledTimes(1);

    const after = (await usageRow(previous.id))!;
    expect(after.status).toBe("suggested");
    expect(after.rowVersion).toBe(before.rowVersion);
    expect(after.decidedBy).toBeNull();
    expect(after.decidedAt).toBeNull();
    expect(await usageRow(request.requestId)).toBeNull();
  });

  it("6.24 kontroll: uten feil skrives både avvisningen og den nye raden", async () => {
    const { organization, inspector } = await aiOrganization();
    const target = polishTarget();
    const previous = await createAiUsageLog(organization.id, { targetRef: target });
    const request = polishRequest({ target });

    const result = await requestSuggestion(inspector.grant, request);

    expect(result.kind).toBe("suggestion");
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalledTimes(1);
    // Første argument er transaksjonen, ikke den vanlige databaseklienten
    const executor = vi.mocked(recordAuditEvent).mock.calls[0]![0];
    expect(executor).toBeDefined();
    expect(executor).not.toBe(db);
    expect((await usageRow(previous.id))!.status).toBe("rejected");
    expect(await usageRow(request.requestId)).not.toBeNull();
  });
});
