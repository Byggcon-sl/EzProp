import { readFileSync } from "node:fs";
import path from "node:path";
import { jwtVerify, importJWK } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueSyncToken,
  SYNC_TOKEN_KEY_ID,
} from "../../src/modules/offline-trial/server/sync-token";
import { resetDatabase } from "../factories";
import { setupOrganization } from "../offline-trial";

/*
 * Nøkkelen PowerSync sjekker tokenet med (PS_JWT_SECRET_BASE64) lages i Bicep av samme
 * POWERSYNC_JWT_SECRET som appen signerer med. Blir omformingen feil, avviser PowerSync alle
 * tokens og prøve A stopper på iPaden. Testplan: docs/funksjoner/fase1-synk-i-azure-testplan.md,
 * avsnitt 3 «Nøkkelen for PowerSync».
 */

/** Det samme som Bicep-uttrykket: base64 av UTF-8, så `+`→`-`, `/`→`_` og fjerning av `=`. */
function bicepBase64Url(secret: string): string {
  return Buffer.from(secret, "utf8")
    .toString("base64")
    .split("+")
    .join("-")
    .split("/")
    .join("_")
    .split("=")
    .join("");
}

/**
 * Leser uttrykket for `base64(powerSyncJwtSecret)` i main.bicep og regner det ut. Forstår bare
 * `base64(powerSyncJwtSecret)` og `replace(…, 'a', 'b')`, som er det Bicep-filen skal bruke.
 */
function evaluateBicepJwtKey(secret: string): string {
  const bicep = readFileSync(path.resolve(process.cwd(), "infra/azure/main.bicep"), "utf8");
  const line = bicep.split("\n").find((l) => /base64\(\s*powerSyncJwtSecret\s*\)/.test(l));
  if (!line) throw new Error("fant ikke base64(powerSyncJwtSecret) i main.bicep");
  const start = line.search(/replace\(|base64\(/);
  const expression = line
    .slice(start)
    .replace(/\s*\/\/.*$/, "")
    .trim();
  const evaluate = (expr: string): string => {
    const trimmed = expr.trim();
    if (/^base64\(\s*powerSyncJwtSecret\s*\)$/.test(trimmed)) {
      return Buffer.from(secret, "utf8").toString("base64");
    }
    const match = /^replace\(([\s\S]*),\s*'([^']*)'\s*,\s*'([^']*)'\s*\)$/.exec(trimmed);
    if (!match) throw new Error(`ukjent Bicep-uttrykk: ${trimmed}`);
    return evaluate(match[1]!).split(match[2]!).join(match[3]!);
  };
  return evaluate(expression);
}

// Oppdiktede nøkler. Med vilje slike som gir `+`, `/` og `=` i vanlig base64.
const KEYS = [
  "oppdiktet-testnokkel-for-bicep-0123456789abcdef",
  String.fromCharCode(0xfb, 0xff) + "-oppdiktet-nokkel-med-latin1-tegn-0123456789",
  "oppdiktet-nøkkel-med-æøå-ÆØÅ-for-utf8-0123456789",
  "oppdiktet-nokkel-med-lengde-som-gir-likhetstegn-1",
  "?>?>?>~~~oppdiktet-nokkel-som-gir-pluss-og-skraastrek",
];

describe("nøkkelen for PowerSync (PS_JWT_SECRET_BASE64)", () => {
  it("testnøklene dekker +, / og = i vanlig base64", () => {
    const plain = KEYS.map((key) => Buffer.from(key, "utf8").toString("base64")).join("");
    expect(plain).toContain("+");
    expect(plain).toContain("/");
    expect(plain).toContain("=");
  });

  it("Bicep-omformingen gir samme base64url som start.sh og Node", () => {
    for (const key of KEYS) {
      expect(bicepBase64Url(key), key).toBe(Buffer.from(key, "utf8").toString("base64url"));
    }
    // start.sh bruker Buffer.from(…, "utf8").toString("base64url"), som over.
    const startSh = readFileSync(path.resolve(process.cwd(), "start.sh"), "utf8");
    expect(startSh).toContain('toString("base64url")');
  });

  it("uttrykket i main.bicep gir samme base64url som Node", () => {
    for (const key of KEYS) {
      expect(evaluateBicepJwtKey(key), key).toBe(Buffer.from(key, "utf8").toString("base64url"));
    }
  });
});

describe("token fra appen mot nøkkelen slik Bicep lager den", () => {
  const SECRET = "oppdiktet-synknokkel-for-azure-testen-æøå-0123456789";
  const OTHER = "oppdiktet-annen-synknokkel-som-ikke-passer-0123456789";

  beforeEach(async () => {
    await resetDatabase();
    vi.stubEnv("POWERSYNC_JWT_SECRET", SECRET);
    vi.stubEnv("POWERSYNC_URL", "https://powersync.eksempel.invalid");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function verifyWith(token: string, k: string) {
    const key = await importJWK({ kty: "oct", alg: "HS256", kid: SYNC_TOKEN_KEY_ID, k }, "HS256");
    return jwtVerify(token, key, { audience: "powersync", algorithms: ["HS256"] });
  }

  it("et token fra appen godtas med nøkkelen slik Bicep lager den", async () => {
    expect(SECRET).not.toBe(process.env.BETTER_AUTH_SECRET);
    const { actor, organizationId, grant } = await setupOrganization("inspector");
    const { token } = await issueSyncToken(actor, organizationId);
    const { payload, protectedHeader } = await verifyWith(token, bicepBase64Url(SECRET));
    expect(protectedHeader.kid).toBe(SYNC_TOKEN_KEY_ID);
    expect(payload.organization_id).toBe(grant.organizationId);
  });

  it("med en annen nøkkel avvises tokenet", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const { token } = await issueSyncToken(actor, organizationId);
    await expect(verifyWith(token, bicepBase64Url(OTHER))).rejects.toThrow();
  });
});
