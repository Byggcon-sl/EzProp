import { describe, expect, it } from "vitest";
import { CLAIM_MARKER_CASES } from "./claim-marker-cases";
import { classifyClaimMarker, latestReleaseOnOrBefore, osloDateOf } from "./claim-marker";

/*
 * Enhetstester for markeringen (docs/funksjoner/fase2a-overstyringer-leder-testplan.md avsnitt
 * 1b, O1.5 og O1.6). Testsakene er data i `claim-marker-cases.ts`; integrasjonstesten i
 * `overrides.test.ts` kjører de samme sakene mot databasen.
 *
 * Støtter hovedmål: færre reklamasjoner (rød bare når reklamasjonen gjelder samme punkt og
 * utgivelsen kunden faktisk fikk).
 */

describe("O1.5 classifyClaimMarker, alle sakene fra «Regler»", () => {
  it.each(CLAIM_MARKER_CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const releases = testCase.releases.map((releasedAt, index) => ({
      id: `v${index + 1}`,
      versionNumber: index + 1,
      releasedDate: osloDateOf(new Date(releasedAt)),
    }));
    // Det SQL-en gjør: bare saker i samme organisasjon og på samme oppdrag, ikke slettet
    const claims = testCase.claims.filter(
      (claim) => !claim.deleted && !claim.otherAssignment && !claim.otherOrganization,
    );
    for (const version of testCase.overriddenVersions) {
      const marker = classifyClaimMarker({
        checkpointKey: testCase.checkpointKey,
        claims: claims.map((claim) => ({
          checkpointKey: claim.checkpointKey,
          isLatestReleaseBeforeClaim:
            latestReleaseOnOrBefore(releases, claim.receivedAt) === `v${version}`,
        })),
      });
      expect(marker, `versjon ${version}`).toBe(testCase.expected[version]);
    }
  });
});

describe("O1.6 rød vinner over nøytral", () => {
  it("to reklamasjoner på oppdraget, én med samme punkt og én uten, gir rød", () => {
    expect(
      classifyClaimMarker({
        checkpointKey: "wet_room.membrane_drain",
        claims: [
          { checkpointKey: null, isLatestReleaseBeforeClaim: true },
          { checkpointKey: "wet_room.membrane_drain", isLatestReleaseBeforeClaim: true },
        ],
      }),
    ).toBe("same_checkpoint");
  });

  it("reklamasjon der utgivelsen ikke var den siste, teller ikke", () => {
    expect(
      classifyClaimMarker({
        checkpointKey: "wet_room.membrane_drain",
        claims: [
          { checkpointKey: "wet_room.membrane_drain", isLatestReleaseBeforeClaim: false },
          { checkpointKey: null, isLatestReleaseBeforeClaim: false },
        ],
      }),
    ).toBe("none");
  });
});

describe("tidsregelen", () => {
  it("norsk dato for utgivelse kl. 23:30 er samme dag, også ved vintertid", () => {
    expect(osloDateOf(new Date("2026-10-31T22:30:00Z"))).toBe("2026-10-31");
    expect(osloDateOf(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
  });

  it("siste utgivelse til og med datoen, samme dag med", () => {
    const releases = [
      { id: "a", versionNumber: 1, releasedDate: "2026-10-01" },
      { id: "b", versionNumber: 2, releasedDate: "2026-10-10" },
    ];
    expect(latestReleaseOnOrBefore(releases, "2026-09-30")).toBeNull();
    expect(latestReleaseOnOrBefore(releases, "2026-10-01")).toBe("a");
    expect(latestReleaseOnOrBefore(releases, "2026-10-09")).toBe("a");
    expect(latestReleaseOnOrBefore(releases, "2026-10-10")).toBe("b");
  });
});
