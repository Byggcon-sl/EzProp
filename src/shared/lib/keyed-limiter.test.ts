import { describe, expect, it } from "vitest";
import { createKeyedLimiter } from "./keyed-limiter";

/*
 * Vernet mot overbelastning (testplanen for PDF av badet avsnitt 3.7 og 11.2.1; kortet A539).
 * Generisk teller med nøkkel og felles tak, med injisert klokke, så tidsavbrudd prøves uten å
 * vente. Rutene bruker `grant.employeeId` som nøkkel.
 *
 * Hovedmål: de ansatte (én ansatt kan ikke stenge PDF-en for de andre, og en feil stenger aldri
 * noen ute for godt).
 */

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function limiter(options: Partial<Parameters<typeof createKeyedLimiter>[0]> = {}) {
  const c = clock();
  const l = createKeyedLimiter({
    maxTotal: 2,
    maxPerKey: 1,
    staleAfterMs: 60_000,
    now: c.now,
    ...options,
  });
  return { l, c };
}

describe("3.7 vern mot overbelastning", () => {
  it("1. én pågående per ansatt: kall nummer to for samme nøkkel avvises med key_busy", () => {
    const { l } = limiter();
    const first = l.tryAcquire("ansatt-a");
    expect(first.ok).toBe(true);
    expect(l.tryAcquire("ansatt-a")).toEqual({ ok: false, reason: "key_busy" });
    expect(l.active()).toBe(1);
  });

  it("2. to ansatte slipper til opp til felles tak; en tredje avvises med total_busy", () => {
    const { l } = limiter({ maxTotal: 2 });
    expect(l.tryAcquire("a").ok).toBe(true);
    expect(l.tryAcquire("b").ok).toBe(true);
    expect(l.tryAcquire("c")).toEqual({ ok: false, reason: "total_busy" });
    expect(l.active()).toBe(2);
  });

  it("11.2.4 tre ansatte samtidig med felles tak 2 gir nøyaktig ett avslag", () => {
    const { l } = limiter({ maxTotal: 2 });
    const results = ["a", "b", "c"].map((k) => l.tryAcquire(k));
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("3. plassen frigjøres etter release, og release tåler å kalles flere ganger", () => {
    const { l } = limiter({ maxTotal: 2 });
    const a = l.tryAcquire("a");
    if (!a.ok) throw new Error("forventet plass");
    a.release();
    a.release();
    expect(l.active()).toBe(0);
    expect(l.tryAcquire("a").ok).toBe(true);
    // Dobbel release frigjør ikke en annen sin plass
    expect(l.tryAcquire("b").ok).toBe(true);
    expect(l.tryAcquire("c").ok).toBe(false);
  });

  it("3. ingen lekkasje: 20 feil på rad (release i finally), så et vellykket kall", async () => {
    const { l } = limiter();
    for (let i = 0; i < 20; i += 1) {
      const slot = l.tryAcquire("a");
      expect(slot.ok).toBe(true);
      try {
        await Promise.reject(new Error("oppdiktet feil"));
      } catch {
        // forventet
      } finally {
        if (slot.ok) slot.release();
      }
    }
    expect(l.active()).toBe(0);
    expect(l.tryAcquire("a").ok).toBe(true);
  });

  it("3. en plass som aldri frigis, regnes som tapt etter staleAfterMs", () => {
    const { l, c } = limiter({ staleAfterMs: 30_000 });
    expect(l.tryAcquire("a").ok).toBe(true);
    c.advance(29_999);
    expect(l.tryAcquire("a")).toEqual({ ok: false, reason: "key_busy" });
    c.advance(2);
    expect(l.tryAcquire("a").ok).toBe(true);
  });

  it("en tapt plass teller heller ikke i det felles taket", () => {
    const { l, c } = limiter({ maxTotal: 1, staleAfterMs: 30_000 });
    expect(l.tryAcquire("a").ok).toBe(true);
    expect(l.tryAcquire("b")).toEqual({ ok: false, reason: "total_busy" });
    c.advance(30_001);
    expect(l.tryAcquire("b").ok).toBe(true);
  });

  it("release av en gammel plass etter at den er regnet som tapt, frigjør ikke den nye", () => {
    const { l, c } = limiter({ staleAfterMs: 30_000 });
    const old = l.tryAcquire("a");
    if (!old.ok) throw new Error("forventet plass");
    c.advance(30_001);
    const fresh = l.tryAcquire("a");
    expect(fresh.ok).toBe(true);
    old.release();
    expect(l.tryAcquire("a")).toEqual({ ok: false, reason: "key_busy" });
  });

  it("nøklene holdes fra hverandre (samme tekst med annen form er en annen nøkkel)", () => {
    const { l } = limiter({ maxTotal: 3 });
    expect(l.tryAcquire("a").ok).toBe(true);
    expect(l.tryAcquire("A").ok).toBe(true);
  });

  it("uten klokke brukes standardklokken", () => {
    const l = createKeyedLimiter({ maxTotal: 1, maxPerKey: 1, staleAfterMs: 60_000 });
    expect(l.tryAcquire("a").ok).toBe(true);
    expect(l.tryAcquire("a").ok).toBe(false);
  });
});
