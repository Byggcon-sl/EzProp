import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkMicrosoftProfile,
  getMicrosoftLoginConfig,
  MICROSOFT_REJECTION_REASONS,
} from "./microsoft-login";

/*
 * Utviklerens enhetstester for oppsettet og profilsjekken (ADR 0008 punkt 10 og 17). Den fulle
 * regeltabellen (M1–M2) ligger i testskriverens fil. Oppdiktede verdier.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000;
const expected = { tenantId: TENANT, clientId: CLIENT, nowSeconds: NOW };
const good = {
  aud: CLIENT,
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  exp: NOW + 60,
  tid: TENANT,
  oid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: " Ola@Byggcon.Example ",
};

afterEach(() => vi.unstubAllEnvs());

describe("getMicrosoftLoginConfig", () => {
  it("alle tre gyldige gir oppsettet; ingen gir null", () => {
    vi.stubEnv("MS_LOGIN_CLIENT_SECRET", "test-ms-login-secret");
    expect(
      getMicrosoftLoginConfig({ MS_LOGIN_TENANT_ID: TENANT, MS_LOGIN_CLIENT_ID: CLIENT }),
    ).toEqual({ tenantId: TENANT, clientId: CLIENT, clientSecret: "test-ms-login-secret" });
    vi.stubEnv("MS_LOGIN_CLIENT_SECRET", "");
    expect(
      getMicrosoftLoginConfig({ MS_LOGIN_TENANT_ID: undefined, MS_LOGIN_CLIENT_ID: undefined }),
    ).toBeNull();
  });

  it.each(["common", "organizations", "consumers", "byggcon.example"])(
    "tenant-id %s gir null",
    (tenantId) => {
      vi.stubEnv("MS_LOGIN_CLIENT_SECRET", "test-ms-login-secret");
      expect(
        getMicrosoftLoginConfig({ MS_LOGIN_TENANT_ID: tenantId, MS_LOGIN_CLIENT_ID: CLIENT }),
      ).toBeNull();
    },
  );

  it("uløst nøkkelboks-referanse gir null", () => {
    vi.stubEnv("MS_LOGIN_CLIENT_SECRET", "@Microsoft.KeyVault(SecretUri=https://kv.example/x)");
    expect(
      getMicrosoftLoginConfig({ MS_LOGIN_TENANT_ID: TENANT, MS_LOGIN_CLIENT_ID: CLIENT }),
    ).toBeNull();
  });
});

describe("checkMicrosoftProfile", () => {
  it("godkjent gir oid og normalisert e-post", () => {
    expect(checkMicrosoftProfile(good, expected)).toEqual({
      ok: true,
      oid: good.oid,
      email: "ola@byggcon.example",
    });
    expect(checkMicrosoftProfile({ ...good, aud: ["x", CLIENT] }, expected).ok).toBe(true);
  });

  it.each([
    ["feil aud", { aud: "x" }, "invalid_token"],
    ["feil iss", { iss: "https://login.microsoftonline.com/common/v2.0" }, "invalid_token"],
    ["utløpt", { exp: NOW }, "invalid_token"],
    ["feil tenant", { tid: "22222222-2222-4222-8222-222222222222" }, "wrong_tenant"],
    ["fremmed idp", { idp: "live.com" }, "guest_account"],
    ["#EXT#", { upn: "a_b#EXT#@byggcon.example" }, "guest_account"],
    ["uten oid", { oid: " " }, "missing_oid"],
    ["uten e-post", { email: undefined, preferred_username: " " }, "missing_email"],
  ])("%s avvises", (_label, overrides, reason) => {
    expect(checkMicrosoftProfile({ ...good, ...overrides }, expected)).toEqual({
      ok: false,
      reason,
    });
  });

  it("egen idp i begge former er ikke gjest, og invalid_token er sist i kodelisten", () => {
    for (const idp of [`https://sts.windows.net/${TENANT}/`, TENANT]) {
      expect(checkMicrosoftProfile({ ...good, idp }, expected).ok).toBe(true);
    }
    expect(MICROSOFT_REJECTION_REASONS.at(-1)).toBe("invalid_token");
  });
});
