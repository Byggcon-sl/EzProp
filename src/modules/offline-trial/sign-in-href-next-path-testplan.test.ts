import { describe, expect, it } from "vitest";
import { isSafeNextPath, safeNextPath } from "@/shared/navigation/safe-next-path";
import { signInHref } from "./sync-status-text";

/*
 * Rett T-0070: lenken «Logg inn» i synkstatusen godtas fortsatt av tillatt-listen i
 * `safeNextPath` (testplan docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1a).
 * Støtter hovedmål: de ansatte (rett tilbake til testskjemaet etter innlogging).
 */

const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";

describe("1a lenken fra synkstatusen godtas fortsatt", () => {
  it.each([`/prove/testskjema/${UUID}`, `/prove/testskjema/${UUID}?x=1#a`, "/prove/testskjema"])(
    "neste fra signInHref(%s) godtas uendret",
    (pathname) => {
      const next = new URL(signInHref(pathname), "https://ezprop.invalid").searchParams.get(
        "neste",
      );
      expect(next).not.toBeNull();
      expect(isSafeNextPath(next)).toBe(true);
      expect(safeNextPath(next ?? undefined)).toBe(next);
      expect(next).toBe(pathname.split(/[?#]/)[0]);
    },
  );
});
