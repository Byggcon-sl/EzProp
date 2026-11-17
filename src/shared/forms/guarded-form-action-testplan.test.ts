import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guardAction,
  listenForOnline,
  resolveNotice,
  waitsForNetwork,
  type FormAction,
} from "./guarded-form-action";
import { loginHref } from "./login-link";
import {
  BACK_ONLINE_MESSAGE,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  type GuardedFormState,
} from "./messages";

/*
 * Rett T-0070 og T-0071: skjemahjelperen (testplan docs/agenter/oppgaver/rett-t0070-t0071-testplan.md
 * avsnitt 1c). En falsk handling og `navigator.onLine` styrt i testen. Testdata er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (det som er skrevet står igjen, med norsk melding, uten nett og
 * med utløpt innlogging) og færre reklamasjoner (mindre ny skriving, færre glemte opplysninger).
 */

const UUID = "0192f0c4-5d6e-7a8b-9c0d-1e2f3a4b5c6d";
const PATH = `/oppdrag/${UUID}`;
const ADDRESS = "Oppdiktet gate 1";

const initial: GuardedFormState = { message: null, values: {}, attempt: 0, fieldErrors: {} };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function setOnline(online: boolean) {
  vi.stubGlobal("navigator", { onLine: online });
}

function readValues(data: FormData): GuardedFormState["values"] {
  return {
    address: String(data.get("address") ?? ""),
    housingType: String(data.get("housingType") ?? ""),
  };
}

function guarded(action: FormAction<GuardedFormState>) {
  return guardAction(action, {
    readValues,
    isOnline: () => navigator.onLine,
    currentPath: () => PATH,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("1c uten nett før sending", () => {
  it("handlingen kalles ikke; svaret har OFFLINE_MESSAGE og verdiene, og attempt øker", async () => {
    setOnline(false);
    const action = vi.fn<FormAction<GuardedFormState>>();
    const previous = { ...initial, attempt: 3 };
    const state = await guarded(action)(
      previous,
      form({ address: ADDRESS, housingType: "detached" }),
    );

    expect(action).not.toHaveBeenCalled();
    expect(state.message).toBe(OFFLINE_MESSAGE);
    expect(state.values).toEqual({ address: ADDRESS, housingType: "detached" });
    expect(state.attempt).toBe(4);
    expect(state.signedOut).toBeUndefined();
  });
});

describe("1c TypeError under sending (nettet faller)", () => {
  it("gir samme svar som uten nett", async () => {
    setOnline(true);
    const action = vi.fn<FormAction<GuardedFormState>>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const state = await guarded(action)(
      initial,
      form({ address: ADDRESS, housingType: "terraced" }),
    );

    expect(action).toHaveBeenCalledTimes(1);
    expect(state.message).toBe(OFFLINE_MESSAGE);
    expect(state.values).toEqual({ address: ADDRESS, housingType: "terraced" });
    expect(state.attempt).toBe(1);
  });
});

describe("1c meldingen når nettet er tilbake", () => {
  it("en online-hendelse mens meldingen om manglende nett vises gir «Nettet er tilbake. Trykk Lagre.» (polite), og handlingen kalles ikke", async () => {
    setOnline(false);
    const action = vi.fn<FormAction<GuardedFormState>>();
    const state = await guarded(action)(initial, form({ address: ADDRESS }));
    const before = resolveNotice(state, null);
    expect(before?.message).toBe(OFFLINE_MESSAGE);
    expect(before?.tone).toBe("alert");
    expect(waitsForNetwork(before)).toBe(true);

    const target = new EventTarget();
    const onOnline = vi.fn();
    const stop = listenForOnline(target, onOnline);
    setOnline(true);
    target.dispatchEvent(new Event("online"));
    expect(onOnline).toHaveBeenCalledTimes(1);

    const after = resolveNotice(state, { attempt: state.attempt, kind: "back_online" });
    expect(after?.message).toBe(BACK_ONLINE_MESSAGE);
    expect(after?.message).toBe("Nettet er tilbake. Trykk Lagre.");
    expect(after?.tone).toBe("polite");
    // Ingenting lagres av seg selv
    expect(action).not.toHaveBeenCalled();

    stop();
    target.dispatchEvent(new Event("online"));
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it("online uten at meldingen om manglende nett vises gir ingen endring", () => {
    expect(waitsForNetwork(null)).toBe(false);
    expect(
      waitsForNetwork(resolveNotice({ ...initial, message: "Rett feltene som er merket." }, null)),
    ).toBe(false);
    expect(
      waitsForNetwork(
        resolveNotice({ ...initial, message: SIGNED_OUT_MESSAGE, signedOut: true }, null),
      ),
    ).toBe(false);
  });

  it("meldingen om at nettet er tilbake gjelder bare forsøket den ble satt i", () => {
    const next = { ...initial, attempt: 5, message: "Rett feltene som er merket." };
    const notice = resolveNotice(next, { attempt: 4, kind: "back_online" });
    expect(notice?.message).toBe("Rett feltene som er merket.");
  });
});

describe("1c svar med signedOut: true", () => {
  it("meldingen er SIGNED_OUT_MESSAGE, verdiene står, og lenken er loginHref(sti) med teksten «Logg inn»", async () => {
    setOnline(true);
    const values = { address: ADDRESS, housingType: "detached" };
    const action = vi.fn<FormAction<GuardedFormState>>(async (previous) => ({
      message: SIGNED_OUT_MESSAGE,
      values,
      attempt: previous.attempt + 1,
      fieldErrors: {},
      signedOut: true,
    }));
    const state = await guarded(action)(initial, form(values));

    expect(state.message).toBe(SIGNED_OUT_MESSAGE);
    expect(state.message).toBe("Du er logget ut. Logg inn igjen.");
    expect(state.values).toEqual(values);
    expect(state.signedOut).toBe(true);
    expect(state.link).toEqual({ href: loginHref(PATH), text: "Logg inn" });
    expect(state.link?.href).toBe(`/logg-inn?neste=%2Foppdrag%2F${UUID}`);

    const notice = resolveNotice(state, null);
    expect(notice?.tone).toBe("alert");
    expect(notice?.signedOut).toBe(true);
    expect(notice?.link?.text).toBe("Logg inn");
  });
});

describe("1c andre svar og feil", () => {
  it("en annen feil (videresending etter lagring, Error) kastes videre uendret", async () => {
    setOnline(true);
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/arbeidskoe;307;",
    });
    const plain = new Error("noe annet");
    for (const error of [redirectError, plain]) {
      const action = vi.fn<FormAction<GuardedFormState>>(async () => {
        throw error;
      });
      await expect(guarded(action)(initial, form({ address: ADDRESS }))).rejects.toBe(error);
    }
  });

  it("et vellykket svar gis tilbake uendret", async () => {
    setOnline(true);
    const result: GuardedFormState = { message: null, values: {}, attempt: 1, fieldErrors: {} };
    const action = vi.fn<FormAction<GuardedFormState>>(async () => result);
    const state = await guarded(action)(initial, form({ address: ADDRESS }));
    expect(state).toBe(result);
  });

  it("et svar med feil ved feltene gis tilbake uendret (uten lenke)", async () => {
    setOnline(true);
    const result: GuardedFormState = {
      message: "Rett feltene som er merket.",
      values: { address: "" },
      attempt: 1,
      fieldErrors: { address: "Skriv adressen." },
    };
    const action = vi.fn<FormAction<GuardedFormState>>(async () => result);
    const state = await guarded(action)(initial, form({ address: "" }));
    expect(state).toEqual(result);
    expect(state.link).toBeUndefined();
  });
});

/* Statisk test av kildefilene i src/shared/forms (uten testfilene). */

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => ({ name, text: readFileSync(path.join(here, name), "utf8") }));

describe("1c kildefilene i src/shared/forms", () => {
  it("finnes (guarded-form-action.ts og login-link.ts)", () => {
    const names = sources.map((source) => source.name);
    expect(names).toEqual(expect.arrayContaining(["guarded-form-action.ts", "login-link.ts"]));
  });

  it.each(["localStorage", "sessionStorage", "indexedDB", "console."])(
    "ingen fil bruker %s",
    (word) => {
      for (const { name, text } of sources) expect(text, name).not.toContain(word);
    },
  );

  it("ingen import fra @/core eller @/app", () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/from\s+["']@\/(core|app)\//);
      expect(text, name).not.toMatch(/import\(\s*["']@\/(core|app)\//);
    }
  });
});
