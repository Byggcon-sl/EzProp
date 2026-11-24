import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { setCheckpointDone } from "@/core/reports";
import { resetDatabase } from "../../../tests/factories";
import { CP, startedBathroom } from "../../../tests/report-fixtures";

/*
 * Funn fra nattløkken 24.11.2026 (punkt 1): skriverammen holdt en transaksjon med låst rapport og
 * leste malen på en ny kobling fra puljen (10 koblinger). Flere lagringer samtidig enn puljen er
 * stor, kunne da vente på hverandre for alltid. Nå leser skriverammen alt på sin egen kobling.
 * Testdata er oppdiktet.
 * Støtter hovedmål: best for de ansatte (lagring under befaring må aldri henge).
 */

beforeEach(resetDatabase);

describe("skriverammen og koblingspuljen", () => {
  it("12 lagringer samtidig i samme rom blir alle ferdige", { timeout: 60_000 }, async () => {
    const f = await startedBathroom();
    const keys = [CP.general, CP.documentation, CP.membrane, CP.adjacent, CP.floor];
    const writes = Array.from({ length: 12 }, (_, i) =>
      setCheckpointDone(f.actor, f.organizationId, f.room, {
        checkpointKey: keys[i % keys.length]!,
        done: i % 2 === 0,
      }),
    );
    const timeout = new Promise<"hang">((resolve) => setTimeout(() => resolve("hang"), 30_000));
    const result = await Promise.race([Promise.allSettled(writes), timeout]);
    expect(result).not.toBe("hang");
    const settled = result as PromiseSettledResult<unknown>[];
    expect(settled.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
