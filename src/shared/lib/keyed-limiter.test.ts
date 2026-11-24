import { describe, expect, it } from "vitest";
import { createKeyedLimiter } from "./keyed-limiter";

/*
 * Vern mot overbelastning (docs/funksjoner/fase2a-pdf-badet-testplan.md 3.7 og 11.2). Falsk klokke,
 * så tidsavbrudd og rydding prøves uten å vente. Tallene er de fra ADR 0016: felles tak 2 per
 * prosess, 1 per ansatt, og en plass regnes som tapt etter mer enn tidsgrensen på 20 sekunder.
 */

function fakeClock(start = 1_000_000) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

const STALE_AFTER_MS = 30_000;

function pdfLimiter(clock = fakeClock()) {
  return createKeyedLimiter({
    maxTotal: 2,
    maxPerKey: 1,
    staleAfterMs: STALE_AFTER_MS,
    now: clock.now,
  });
}

describe("createKeyedLimiter", () => {
  it("3.7.1 én pågående per ansatt: andre kall for samme ansatt avvises", () => {
    const limiter = pdfLimiter();
    const first = limiter.tryAcquire("ansatt-a");
    expect(first.ok).toBe(true);
    expect(limiter.tryAcquire("ansatt-a")).toEqual({ ok: false, reason: "key_busy" });
    expect(limiter.active()).toBe(1);
  });

  it("3.7.2 to ansatte slipper til opp til felles tak; den tredje avvises", () => {
    const limiter = pdfLimiter();
    expect(limiter.tryAcquire("ansatt-a").ok).toBe(true);
    expect(limiter.tryAcquire("ansatt-b").ok).toBe(true);
    expect(limiter.tryAcquire("ansatt-c")).toEqual({ ok: false, reason: "total_busy" });
    expect(limiter.active()).toBe(2);
  });

  it("samme ansatt får «key_busy» også når det felles taket er fullt", () => {
    const limiter = pdfLimiter();
    limiter.tryAcquire("ansatt-a");
    limiter.tryAcquire("ansatt-b");
    expect(limiter.tryAcquire("ansatt-a")).toEqual({ ok: false, reason: "key_busy" });
  });

  it("3.7.3 plassen frigjøres etter suksess og etter feil, uten lekkasje (20 feil på rad)", async () => {
    const limiter = pdfLimiter();
    const work = async (fail: boolean) => {
      const slot = limiter.tryAcquire("ansatt-a");
      if (!slot.ok) throw new Error("avvist");
      try {
        if (fail) throw new Error("feil i arbeidet");
        return "ferdig";
      } finally {
        slot.release();
      }
    };
    for (let i = 0; i < 20; i += 1) {
      await expect(work(true)).rejects.toThrow("feil i arbeidet");
    }
    expect(limiter.active()).toBe(0);
    await expect(work(false)).resolves.toBe("ferdig");
    expect(limiter.active()).toBe(0);
  });

  it("11.2 release tåler flere kall, og frigir aldri en annen plass", () => {
    const limiter = pdfLimiter();
    const first = limiter.tryAcquire("ansatt-a");
    if (!first.ok) throw new Error("ventet plass");
    first.release();
    const second = limiter.tryAcquire("ansatt-a");
    expect(second.ok).toBe(true);
    first.release();
    first.release();
    expect(limiter.active()).toBe(1);
    expect(limiter.tryAcquire("ansatt-a")).toEqual({ ok: false, reason: "key_busy" });
  });

  it("3.7.4 en plass som aldri frigis, ryddes etter staleAfterMs (falsk klokke)", () => {
    const clock = fakeClock();
    const limiter = pdfLimiter(clock);
    expect(limiter.tryAcquire("ansatt-a").ok).toBe(true);
    clock.advance(STALE_AFTER_MS - 1);
    expect(limiter.tryAcquire("ansatt-a")).toEqual({ ok: false, reason: "key_busy" });
    clock.advance(1);
    expect(limiter.tryAcquire("ansatt-a").ok).toBe(true);
    expect(limiter.active()).toBe(1);
  });

  it("en ryddet plass som frigis for sent, tar ikke med seg den nye plassen", () => {
    const clock = fakeClock();
    const limiter = pdfLimiter(clock);
    const lost = limiter.tryAcquire("ansatt-a");
    if (!lost.ok) throw new Error("ventet plass");
    clock.advance(STALE_AFTER_MS);
    expect(limiter.tryAcquire("ansatt-a").ok).toBe(true);
    lost.release();
    expect(limiter.active()).toBe(1);
  });

  it("active rydder også gamle plasser", () => {
    const clock = fakeClock();
    const limiter = pdfLimiter(clock);
    limiter.tryAcquire("ansatt-a");
    limiter.tryAcquire("ansatt-b");
    clock.advance(STALE_AFTER_MS);
    expect(limiter.active()).toBe(0);
  });

  it("bruker Date.now når klokken ikke er gitt", () => {
    const limiter = createKeyedLimiter({ maxTotal: 1, maxPerKey: 1, staleAfterMs: 60_000 });
    expect(limiter.tryAcquire("x").ok).toBe(true);
    expect(limiter.tryAcquire("y")).toEqual({ ok: false, reason: "total_busy" });
  });

  it.each([
    { maxTotal: 0, maxPerKey: 1, staleAfterMs: 1 },
    { maxTotal: 1.5, maxPerKey: 1, staleAfterMs: 1 },
    { maxTotal: 1, maxPerKey: 0, staleAfterMs: 1 },
    { maxTotal: 1, maxPerKey: 1, staleAfterMs: 0 },
    { maxTotal: 1, maxPerKey: 1, staleAfterMs: Number.NaN },
  ])("avviser ugyldige tall %o", (options) => {
    expect(() => createKeyedLimiter(options)).toThrow(RangeError);
  });
});
