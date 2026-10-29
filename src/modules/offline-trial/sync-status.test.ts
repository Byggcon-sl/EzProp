import { describe, expect, it } from "vitest";
import {
  SYNC_BUTTON_IDLE,
  syncButtonReducer,
  syncButtonState,
  SYNC_NOW_FAILED_MESSAGE,
  SYNC_NOW_OFFLINE_MESSAGE,
  type SyncButtonState,
} from "./sync-status-text";
import type { TrialSyncRoundResult } from "./sync/types";

// Logikken bak knappen «Synk nå» (docs/funksjoner/fase1-synkstatus.md pkt. 3–6). Testplan
// avsnitt 2.3. Ren tilstandsmaskin i sync-status-text.ts, ingen DOM (ingen jsdom, ingen ny
// avhengighet). Komponenten sync-status.tsx testes i e2e (e2e/fase-1-synkstatus.spec.ts).

function after(...events: Parameters<typeof syncButtonReducer>[1][]): SyncButtonState {
  return events.reduce(syncButtonReducer, SYNC_BUTTON_IDLE);
}

function round(result: TrialSyncRoundResult) {
  return [{ type: "start" as const }, { type: "done" as const, result }];
}

describe("knappen «Synk nå» (syncButtonReducer og syncButtonState)", () => {
  it("klar: Synk nå, kan trykkes, ingen beskjed", () => {
    expect(syncButtonState(SYNC_BUTTON_IDLE)).toEqual({
      label: "Synk nå",
      disabled: false,
      message: null,
    });
  });

  it("knappen viser Synker … under runden og kan ikke trykkes", () => {
    const view = syncButtonState(after({ type: "start" }));
    expect(view.label).toBe("Synker …");
    expect(view.disabled).toBe(true);
  });

  it("ok gir Synk nå og ingen beskjed", () => {
    expect(syncButtonState(after(...round("ok")))).toEqual({
      label: "Synk nå",
      disabled: false,
      message: null,
    });
  });

  it("offline gir Synk nå og beskjeden uten nett", () => {
    expect(syncButtonState(after(...round("offline")))).toEqual({
      label: "Synk nå",
      disabled: false,
      message: SYNC_NOW_OFFLINE_MESSAGE,
    });
  });

  it("failed gir Synk nå og feilbeskjeden", () => {
    expect(syncButtonState(after(...round("failed")))).toEqual({
      label: "Synk nå",
      disabled: false,
      message: SYNC_NOW_FAILED_MESSAGE,
    });
  });

  it("ny vellykket runde fjerner gammel feilbeskjed", () => {
    expect(syncButtonState(after(...round("failed"), ...round("ok"))).message).toBeNull();
    expect(syncButtonState(after(...round("offline"), ...round("ok"))).message).toBeNull();
  });

  it("nytt trykk fjerner gammel beskjed mens runden pågår", () => {
    const view = syncButtonState(after(...round("failed"), { type: "start" }));
    expect(view.message).toBeNull();
    expect(view.label).toBe("Synker …");
  });

  it("beskjeden står til pillen viser Alt er lagret (tillegg, skissen)", () => {
    const failed = after(...round("failed"));
    expect(syncButtonState(failed).message).toBe(SYNC_NOW_FAILED_MESSAGE);
    expect(syncButtonState(syncButtonReducer(failed, { type: "allSaved" })).message).toBeNull();
  });

  it("endrer aldri tilstanden den får inn", () => {
    const state = Object.freeze({ ...SYNC_BUTTON_IDLE });
    syncButtonReducer(state, { type: "start" });
    expect(state).toEqual(SYNC_BUTTON_IDLE);
  });
});
