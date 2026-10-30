import { describe, expect, it } from "vitest";
import {
  nextSavedAt,
  savedAtText,
  showSyncNow,
  SIGN_IN_LABEL,
  signInHref,
  SYNC_NOW_FAILED_MESSAGE,
  SYNC_NOW_OFFLINE_MESSAGE,
  SYNC_STATE_SIGN_IN_REQUIRED,
  syncStatusKind,
  syncStatusText,
  type SyncStatusKind,
} from "./sync-status-text";
import type { TrialSyncStatus } from "./sync/types";

// Tekstene og reglene bak synkstatusen (docs/funksjoner/fase1-synkstatus.md, «Regler»).
// Testplan avsnitt 2.1. Reglene er data: tabellene under er testsakene. Alle tidspunkt er faste,
// og tidssonen sendes inn som Europe/Oslo (A4). Ingen test bruker Date.now() eller maskinens
// tidssone. 29.10.2026 er Oslo på UTC+1 (sommertiden sluttet 25.10.2026).

const OSLO = "Europe/Oslo";

function status(
  online: boolean,
  serverConfirmed: boolean,
  pendingChanges: number,
  pendingPhotos: number,
): TrialSyncStatus {
  return { online, serverConfirmed, pendingChanges, pendingPhotos };
}

const ALL_SAVED = "Alt er lagret";
const AWAITING = "Venter på kontakt med serveren";
const NEVER = "Ikke lagret på serveren ennå";

describe("syncStatusText (sync-status-text.ts)", () => {
  it.each<[number, number, boolean]>([
    [0, 0, false],
    [3, 2, false],
    [0, 0, true],
    [3, 2, true],
  ])(
    "uten nett gir Uten nett uansett hva som venter (%i endringer, %i bilder, bekreftet: %s)",
    (changes, photos, confirmed) => {
      expect(syncStatusText(status(false, confirmed, changes, photos))).toBe("Uten nett");
    },
  );

  it("bekreftet og ingenting venter gir Alt er lagret", () => {
    expect(syncStatusText(status(true, true, 0, 0))).toBe(ALL_SAVED);
  });

  it("ingenting venter men ikke bekreftet gir Venter på kontakt med serveren", () => {
    // Ny enhet før første runde, eller Wi-Fi uten internett: nettleseren mener den har nett
    expect(syncStatusText(status(true, false, 0, 0))).toBe(AWAITING);
  });

  it.each([true, false])(
    "noe venter gir Venter med antall, også når bekreftet (bekreftet: %s)",
    (confirmed) => {
      expect(syncStatusText(status(true, confirmed, 3, 2))).toBe("Venter: 3 endringer, 2 bilder");
    },
  );

  it.each<[number, number, string]>([
    [1, 0, "Venter: 1 endring, 0 bilder"],
    [2, 1, "Venter: 2 endringer, 1 bilde"],
    [0, 1, "Venter: 0 endringer, 1 bilde"],
    [1, 1, "Venter: 1 endring, 1 bilde"],
    [0, 2, "Venter: 0 endringer, 2 bilder"],
  ])("entall og flertall: %i endringer og %i bilder gir «%s»", (changes, photos, text) => {
    expect(syncStatusText(status(true, true, changes, photos))).toBe(text);
  });

  // Obligatorisk (reklamasjoner: «Alt er lagret» skal aldri vises feil)
  it("Alt er lagret vises aldri uten bekreftelse", () => {
    const rows: { input: TrialSyncStatus; text: string }[] = [];
    for (const online of [false, true]) {
      for (const confirmed of [false, true]) {
        for (const changes of [0, 4]) {
          for (const photos of [0, 1]) {
            const input = status(online, confirmed, changes, photos);
            rows.push({ input, text: syncStatusText(input) });
          }
        }
      }
    }
    expect(rows).toHaveLength(16);
    const allSaved = rows.filter((row) => row.text === ALL_SAVED);
    expect(allSaved.map((row) => row.input)).toEqual([status(true, true, 0, 0)]);
    // Alle andre rader har en av de andre tilstandene, aldri tom tekst
    for (const row of rows) {
      expect(row.text, JSON.stringify(row.input)).toMatch(
        /^(Uten nett|Alt er lagret|Venter på kontakt med serveren|Venter: \d+ endringer?, \d+ bilder?)$/,
      );
    }
  });
});

describe("savedAtText (sync-status-text.ts)", () => {
  it("samme dag gir Lagret kl. HH:MM", () => {
    // Lagret 14:32 i Oslo, nå 16:00 samme dag
    expect(savedAtText("2026-10-29T13:32:00.000Z", new Date("2026-10-29T15:00:00Z"), OSLO)).toBe(
      "Lagret kl. 14:32",
    );
  });

  it("annen dag gir dato også", () => {
    // Lagret 28.10. 14:32 i Oslo, nå 29.10. 09:00
    expect(savedAtText("2026-10-28T13:32:00.000Z", new Date("2026-10-29T08:00:00Z"), OSLO)).toBe(
      "Lagret 28.10. kl. 14:32",
    );
  });

  it("aldri lagret gir Ikke lagret på serveren ennå", () => {
    expect(savedAtText(null, new Date("2026-10-29T13:32:00Z"), OSLO)).toBe(NEVER);
  });

  it.each<[string, string, string, string]>([
    // 28.10. 23:59 Oslo (22:59Z), nå 29.10. 00:01 Oslo (28.10. 23:01Z): to dager i Oslo, samme i UTC
    [
      "28.10. 23:59, nå 29.10. 00:01",
      "2026-10-28T22:59:00Z",
      "2026-10-28T23:01:00Z",
      "Lagret 28.10. kl. 23:59",
    ],
    // 29.10. 00:01 Oslo (28.10. 23:01Z), nå 29.10. 08:00 Oslo: samme dag i Oslo, to i UTC
    [
      "29.10. 00:01, nå 29.10. 08:00",
      "2026-10-28T23:01:00Z",
      "2026-10-29T07:00:00Z",
      "Lagret kl. 00:01",
    ],
  ])("grensen rundt midnatt følger Oslo, ikke UTC (%s)", (_label, savedAt, now, text) => {
    expect(savedAtText(savedAt, new Date(now), OSLO)).toBe(text);
  });

  it.each<[string, string]>([
    ["2026-10-29T08:05:00Z", "Lagret kl. 09:05"],
    ["2026-10-29T20:07:00Z", "Lagret kl. 21:07"],
    ["2026-10-28T23:00:00Z", "Lagret kl. 00:00"],
  ])("24 timer med to sifre (%s gir «%s»)", (savedAt, text) => {
    expect(savedAtText(savedAt, new Date("2026-10-29T21:30:00Z"), OSLO)).toBe(text);
  });

  it.each(["", "tull", "2026-13-45T99:99:00Z"])(
    "ugyldig tidspunkt gir Ikke lagret på serveren ennå (%j)",
    (savedAt) => {
      expect(savedAtText(savedAt, new Date("2026-10-29T13:32:00Z"), OSLO)).toBe(NEVER);
    },
  );
});

describe("nextSavedAt (sync-status-text.ts)", () => {
  const NOW = new Date("2026-10-29T13:32:00.000Z");
  const PREVIOUS = "2026-10-28T13:32:00.000Z";

  // Obligatorisk
  it.each([PREVIOUS, null])(
    "nextSavedAt gir nytt tidspunkt bare når bekreftet og ingenting venter (forrige: %s)",
    (previous) => {
      expect(nextSavedAt(status(true, true, 0, 0), previous, NOW)).toBe(NOW.toISOString());
    },
  );

  it.each<[string, TrialSyncStatus, string | null]>([
    ["1 endring venter", status(true, true, 1, 0), PREVIOUS],
    ["1 bilde venter", status(true, true, 0, 1), PREVIOUS],
    ["uten nett", status(false, true, 0, 0), PREVIOUS],
    ["uten bekreftelse", status(true, false, 0, 0), PREVIOUS],
    ["1 endring venter", status(true, true, 1, 0), null],
    ["1 bilde venter", status(true, true, 0, 1), null],
    ["uten nett", status(false, true, 0, 0), null],
    ["uten bekreftelse", status(true, false, 0, 0), null],
  ])(
    "nextSavedAt beholder forrige når noe venter, uten nett eller uten bekreftelse (%s, forrige: %s)",
    (_label, input, previous) => {
      expect(nextSavedAt(input, previous, NOW)).toBe(previous);
    },
  );

  it("nytt tidspunkt kan leses tilbake av savedAtText", () => {
    const saved = nextSavedAt(status(true, true, 0, 0), null, NOW);
    expect(savedAtText(saved, NOW, OSLO)).toBe("Lagret kl. 14:32");
  });
});

describe("beskjedene ved «Synk nå» (sync-status-text.ts)", () => {
  it("beskjeden uten nett, ordrett", () => {
    expect(SYNC_NOW_OFFLINE_MESSAGE).toBe(
      "Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.",
    );
  });

  it("beskjeden ved feil, ordrett", () => {
    expect(SYNC_NOW_FAILED_MESSAGE).toBe("Fikk ikke sendt. Prøver igjen automatisk.");
  });

  it("ingen gjetteord i tekstene", () => {
    const now = new Date("2026-10-29T13:32:00Z");
    const texts = [
      SYNC_NOW_OFFLINE_MESSAGE,
      SYNC_NOW_FAILED_MESSAGE,
      syncStatusText(status(false, false, 0, 0)),
      syncStatusText(status(true, true, 0, 0)),
      syncStatusText(status(true, false, 0, 0)),
      syncStatusText(status(true, true, 3, 2)),
      syncStatusText(status(true, true, 3, 2), true),
      SIGN_IN_LABEL,
      savedAtText(null, now, OSLO),
      savedAtText("2026-10-29T13:00:00Z", now, OSLO),
      savedAtText("2026-10-28T13:00:00Z", now, OSLO),
    ];
    for (const text of texts) {
      expect(text, text).not.toMatch(/antas|trolig|sannsynligvis/i);
    }
  });
});

// Prøve F: innlogging som har gått ut (docs/funksjoner/fase1-prove-f-innlogging-testplan.md,
// avsnitt 1).
describe("signInRequired (sync-status-text.ts)", () => {
  const SIGN_IN = "Logg inn på nytt for å sende. Alt er lagret på iPaden.";
  const KINDS: SyncStatusKind[] = [
    "offline",
    "allSaved",
    "pending",
    "awaitingServer",
    "signInRequired",
  ];

  it("teksten er Logg inn på nytt for å sende. Alt er lagret på iPaden.", () => {
    expect(SYNC_STATE_SIGN_IN_REQUIRED).toBe(SIGN_IN);
    expect(SIGN_IN_LABEL).toBe("Logg inn");
  });

  it.each<[string, TrialSyncStatus]>([
    ["Venter …", status(true, true, 3, 2)],
    ["Venter … uten bekreftelse", status(true, false, 1, 0)],
    ["Venter på kontakt med serveren", status(true, false, 0, 0)],
    ["Alt er lagret", status(true, true, 0, 0)],
  ])("har forrang foran %s", (_name, input) => {
    expect(syncStatusKind(input, true)).toBe("signInRequired");
    expect(syncStatusText(input, true)).toBe(SIGN_IN);
  });

  it.each<[number, number, boolean]>([
    [0, 0, false],
    [3, 2, false],
    [0, 0, true],
    [3, 2, true],
  ])("har ikke forrang foran Uten nett (%i endringer, %i bilder, bekreftet: %s)", (c, p, ok) => {
    expect(syncStatusKind(status(false, ok, c, p), true)).toBe("offline");
    expect(syncStatusText(status(false, ok, c, p), true)).toBe("Uten nett");
  });

  it("uten signInRequired er alt som før (standardverdien er false)", () => {
    expect(syncStatusKind(status(true, false, 0, 0))).toBe("awaitingServer");
    expect(syncStatusKind(status(true, false, 0, 0), false)).toBe("awaitingServer");
    expect(syncStatusText(status(true, true, 3, 2), false)).toBe("Venter: 3 endringer, 2 bilder");
  });

  it("markøren er alltid en av de fem verdiene for alle kombinasjoner", () => {
    const seen = new Set<SyncStatusKind>();
    for (const online of [false, true]) {
      for (const confirmed of [false, true]) {
        for (const changes of [0, 4]) {
          for (const photos of [0, 1]) {
            for (const signIn of [false, true]) {
              const kind = syncStatusKind(status(online, confirmed, changes, photos), signIn);
              expect(KINDS).toContain(kind);
              expect(syncStatusText(status(online, confirmed, changes, photos), signIn)).not.toBe(
                "",
              );
              seen.add(kind);
            }
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  it("Synk nå er skjult ved signInRequired og vises ellers", () => {
    for (const kind of KINDS) {
      expect(showSyncNow(kind)).toBe(kind !== "signInRequired");
    }
    expect(showSyncNow(null)).toBe(true);
  });

  it.each<[string, string]>([
    [
      "/prove/testskjema/0b8f3c1e-2d4a-4c6b-9e7f-1a2b3c4d5e6f?x=1#a",
      "/logg-inn?neste=%2Fprove%2Ftestskjema%2F0b8f3c1e-2d4a-4c6b-9e7f-1a2b3c4d5e6f",
    ],
    ["/prove/testskjema", "/logg-inn?neste=%2Fprove%2Ftestskjema"],
    ["/prove/testskjema#a", "/logg-inn?neste=%2Fprove%2Ftestskjema"],
    ["/prove/testskjema?neste=//evil.example", "/logg-inn?neste=%2Fprove%2Ftestskjema"],
    ["/arbeidskoe", "/logg-inn?neste=%2Farbeidskoe"],
  ])("lenken Logg inn bygges av bare stien: %s", (pathname, href) => {
    expect(signInHref(pathname)).toBe(href);
  });

  it("neste i lenken har aldri spørrestreng eller #", () => {
    const href = signInHref("/prove/testskjema/abc?x=1&y=2#del");
    const next = new URL(href, "http://localhost").searchParams.get("neste");
    expect(next).toBe("/prove/testskjema/abc");
    expect(href.indexOf("?")).toBe(href.lastIndexOf("?"));
    expect(href).not.toContain("#");
  });
});

// --- Prøve F: «Logg inn på nytt» (docs/funksjoner/fase1-prove-f-innlogging.md, punkt 2) ---
// Testplan: docs/funksjoner/fase1-prove-f-innlogging-testplan.md avsnitt 1. Støtter reklamasjoner
// (takstmannen får vite at noe ikke er sendt ennå) og tid (ett trykk tilbake til innlogging).

const SIGN_IN_TEXT = "Logg inn på nytt for å sende. Alt er lagret på iPaden.";
const ALL_KINDS: readonly SyncStatusKind[] = [
  "offline",
  "allSaved",
  "pending",
  "awaitingServer",
  "signInRequired",
];
const FORM_ID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";

/** Alle 16 kombinasjoner av status, ganger innlogging gjelder / har gått ut. */
function allCombinations(): { input: TrialSyncStatus; signInRequired: boolean }[] {
  const rows: { input: TrialSyncStatus; signInRequired: boolean }[] = [];
  for (const online of [false, true]) {
    for (const confirmed of [false, true]) {
      for (const changes of [0, 4]) {
        for (const photos of [0, 1]) {
          for (const signInRequired of [false, true]) {
            rows.push({ input: status(online, confirmed, changes, photos), signInRequired });
          }
        }
      }
    }
  }
  return rows;
}

describe("signInRequired i synkstatusen (sync-status-text.ts)", () => {
  it("teksten, ordrett", () => {
    expect(SYNC_STATE_SIGN_IN_REQUIRED).toBe(SIGN_IN_TEXT);
    expect(syncStatusText(status(true, false, 3, 2), true)).toBe(SIGN_IN_TEXT);
  });

  it("knappen heter Logg inn", () => {
    expect(SIGN_IN_LABEL).toBe("Logg inn");
  });

  // [beskrivelse, status, forventet tilstand med signInRequired]
  it.each<[string, TrialSyncStatus, SyncStatusKind]>([
    ["foran Venter (endringer)", status(true, true, 3, 0), "signInRequired"],
    ["foran Venter (bilder)", status(true, true, 0, 2), "signInRequired"],
    ["foran Venter (ikke bekreftet)", status(true, false, 3, 2), "signInRequired"],
    ["foran Venter på kontakt med serveren", status(true, false, 0, 0), "signInRequired"],
    ["ikke foran Uten nett (noe venter)", status(false, false, 3, 2), "offline"],
    ["ikke foran Uten nett (ingenting venter)", status(false, true, 0, 0), "offline"],
  ])("forrang: %s", (_label, input, kind) => {
    expect(syncStatusKind(input, true)).toBe(kind);
  });

  it("uten nett vises aldri meldingen om innlogging", () => {
    for (const { input } of allCombinations().filter((row) => !row.input.online)) {
      expect(syncStatusText(input, true), JSON.stringify(input)).toBe("Uten nett");
    }
  });

  it("uten signInRequired er alt som før (fire tilstander)", () => {
    for (const { input } of allCombinations()) {
      expect(syncStatusKind(input, false), JSON.stringify(input)).toBe(syncStatusKind(input));
      expect(syncStatusText(input, false), JSON.stringify(input)).toBe(syncStatusText(input));
      expect(syncStatusKind(input)).not.toBe("signInRequired");
    }
  });

  it("markøren er alltid en av de fem verdiene", () => {
    const rows = allCombinations();
    expect(rows).toHaveLength(32);
    for (const { input, signInRequired } of rows) {
      expect(ALL_KINDS, JSON.stringify({ input, signInRequired })).toContain(
        syncStatusKind(input, signInRequired),
      );
    }
  });

  // Obligatorisk (reklamasjoner): «Alt er lagret» vises aldri når innloggingen har gått ut
  it("Alt er lagret vises aldri når innloggingen har gått ut", () => {
    for (const { input } of allCombinations()) {
      expect(syncStatusText(input, true), JSON.stringify(input)).not.toBe(ALL_SAVED);
    }
  });

  it("ingen gjetteord i teksten", () => {
    expect(SIGN_IN_TEXT).not.toMatch(/antas|trolig|sannsynligvis/i);
  });
});

describe("knappen «Synk nå» eller «Logg inn» (showSyncNow)", () => {
  it.each<[SyncStatusKind | null, boolean]>([
    ["offline", true],
    ["allSaved", true],
    ["pending", true],
    ["awaitingServer", true],
    ["signInRequired", false],
    [null, true],
  ])("%s: Synk nå vises = %s", (kind, shown) => {
    expect(showSyncNow(kind)).toBe(shown);
  });
});

describe("lenken «Logg inn» (signInHref)", () => {
  it.each<[string, string]>([
    [`/prove/testskjema/${FORM_ID}`, `/prove/testskjema/${FORM_ID}`],
    [`/prove/testskjema/${FORM_ID}?x=1#a`, `/prove/testskjema/${FORM_ID}`],
    [`/prove/testskjema/${FORM_ID}#a`, `/prove/testskjema/${FORM_ID}`],
    ["/prove/testskjema", "/prove/testskjema"],
    ["/prove/testskjema?x=1", "/prove/testskjema"],
  ])("%s gir neste=%s, uten spørrestreng og #", (pathname, next) => {
    const href = signInHref(pathname);
    const url = new URL(href, "https://ezprop.invalid");
    expect(url.host).toBe("ezprop.invalid");
    expect(url.pathname).toBe("/logg-inn");
    expect(url.hash).toBe("");
    expect([...url.searchParams.keys()]).toEqual(["neste"]);
    expect(url.searchParams.get("neste")).toBe(next);
  });
  // At lenken og safeNextPath passer sammen, testes i src/app/logg-inn/safe-next-path.test.ts
  // (moduler importerer ikke fra app).
});
