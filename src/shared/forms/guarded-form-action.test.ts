import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  guardAction,
  listenForOnline,
  offlineState,
  readFormValues,
  resolveNotice,
  waitsForNetwork,
  withSignInLink,
  type NoticeOverlay,
} from "./guarded-form-action";
import {
  BACK_ONLINE_MESSAGE,
  OFFLINE_MESSAGE,
  SIGN_IN_LINK_TEXT,
  SIGNED_IN_AGAIN_MESSAGE,
  SIGNED_OUT_MESSAGE,
  SIGNED_OUT_ON_FOCUS_MESSAGE,
  type GuardedFormState,
} from "./messages";

/*
 * Skjemahjelperen (testplan 1c, T-0070 og T-0071). Ren logikk uten DOM: handlingen er falsk, og
 * nett og sti styres i testen. Støtter hovedmål: de ansatte (det som er skrevet, står ved
 * nettbrudd og utløpt innlogging, med norske meldinger) og færre reklamasjoner (mindre ny
 * skriving). Verdiene er oppdiktet.
 */

const ID = "3f2b8c1e-5a4d-4e7f-9b1c-2d3e4f5a6b7c";
const PATH = `/oppdrag/${ID}`;

const initial: GuardedFormState = { fieldErrors: {}, message: null, values: {}, attempt: 0 };

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
}

type Action = (previous: GuardedFormState, data: FormData) => Promise<GuardedFormState>;

function setup(action: Action) {
  const spy = vi.fn(action);
  let online = true;
  const guarded = guardAction<GuardedFormState>(spy, {
    readValues: readFormValues,
    isOnline: () => online,
    currentPath: () => PATH,
  });
  return {
    spy,
    guarded,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

const values = { address: "Oppdiktet gate 1", postalCode: "8000" };

describe("guardAction", () => {
  it("kaller ikke handlingen uten nett, og gir verdiene og meldingen tilbake", async () => {
    const { spy, guarded, setOnline } = setup(async () => initial);
    setOnline(false);
    const previous = { ...initial, attempt: 2, fieldErrors: { address: "Feil" } };
    const result = await guarded(previous, formData(values));
    expect(spy).not.toHaveBeenCalled();
    expect(result.message).toBe(OFFLINE_MESSAGE);
    expect(result.values).toEqual(values);
    expect(result.attempt).toBe(3);
    expect(result.fieldErrors).toEqual({});
    expect(result.signedOut).toBeUndefined();
  });

  it("gir samme svar når sendingen feiler med TypeError (nettbrudd)", async () => {
    const { spy, guarded } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    const result = await guarded(initial, formData(values));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ message: OFFLINE_MESSAGE, values, attempt: 1 });
  });

  it("gir «logget ut»-svaret lenken til innloggingen, og verdiene står", async () => {
    const { guarded } = setup(async (previous) => ({
      fieldErrors: {},
      message: SIGNED_OUT_MESSAGE,
      values,
      attempt: previous.attempt + 1,
      signedOut: true,
    }));
    const result = await guarded(initial, formData(values));
    expect(result.message).toBe(SIGNED_OUT_MESSAGE);
    expect(result.values).toEqual(values);
    expect(result.link).toEqual({
      href: `/logg-inn?neste=%2Foppdrag%2F${ID}`,
      text: SIGN_IN_LINK_TEXT,
    });
    expect(SIGN_IN_LINK_TEXT).toBe("Logg inn");
  });

  it("kaster andre feil videre uendret (også videresending etter lagring)", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace" });
    const { guarded } = setup(async () => {
      throw redirect;
    });
    await expect(guarded(initial, formData(values))).rejects.toBe(redirect);
  });

  it("gir vellykket svar tilbake uendret", async () => {
    const saved: GuardedFormState = { fieldErrors: {}, message: null, values: {}, attempt: 1 };
    const { guarded } = setup(async () => saved);
    await expect(guarded(initial, formData(values))).resolves.toBe(saved);
  });
});

describe("offlineState og withSignInLink", () => {
  it("fjerner lenke og «logget ut» fra forrige forsøk", () => {
    const previous: GuardedFormState = {
      ...initial,
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
      link: { href: "/logg-inn", text: SIGN_IN_LINK_TEXT },
    };
    const result = offlineState(previous, values);
    expect(result.link).toBeUndefined();
    expect(result.signedOut).toBeUndefined();
  });

  it("rører ikke andre svar", () => {
    const failed = { ...initial, message: "Rett feltene som er merket.", attempt: 1 };
    expect(withSignInLink(failed, PATH)).toBe(failed);
  });

  it("gir /logg-inn uten neste når stien ikke er godkjent", () => {
    const signedOut: GuardedFormState = {
      ...initial,
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
    };
    expect(withSignInLink(signedOut, "//evil.example").link?.href).toBe("/logg-inn");
  });
});

describe("readFormValues", () => {
  it("leser tekstfeltene, gjentatte navn som liste, og hopper over filer", () => {
    const data = formData({ name: "Kjeller" });
    data.append("roles", "a");
    data.append("roles", "b");
    data.append("file", new Blob(["x"]), "x.txt");
    expect(readFormValues(data)).toEqual({ name: "Kjeller", roles: ["a", "b"] });
  });
});

describe("resolveNotice", () => {
  const offline = { ...initial, message: OFFLINE_MESSAGE, attempt: 1 };

  it("viser svaret som feil (role=alert)", () => {
    expect(resolveNotice(offline, null)).toEqual({
      message: OFFLINE_MESSAGE,
      tone: "alert",
      signedOut: false,
    });
    expect(resolveNotice(initial, null)).toBeNull();
  });

  it("bytter til «Nettet er tilbake» (polite) for samme forsøk", () => {
    const overlay: NoticeOverlay = { attempt: 1, kind: "back_online" };
    expect(resolveNotice(offline, overlay)).toEqual({
      message: BACK_ONLINE_MESSAGE,
      tone: "polite",
      signedOut: false,
    });
  });

  it("neste svar tar over den lokale meldingen", () => {
    const overlay: NoticeOverlay = { attempt: 1, kind: "back_online" };
    const next = { ...initial, message: OFFLINE_MESSAGE, attempt: 2 };
    expect(resolveNotice(next, overlay)?.message).toBe(OFFLINE_MESSAGE);
  });

  it("viser «logget inn igjen» (polite) og «logget ut før du lagrer» (alert med lenke)", () => {
    const signedOut: GuardedFormState = {
      ...initial,
      message: SIGNED_OUT_MESSAGE,
      signedOut: true,
      link: { href: "/logg-inn", text: SIGN_IN_LINK_TEXT },
      attempt: 1,
    };
    expect(resolveNotice(signedOut, null)).toMatchObject({ tone: "alert", signedOut: true });
    expect(resolveNotice(signedOut, { attempt: 1, kind: "signed_in_again" })).toEqual({
      message: SIGNED_IN_AGAIN_MESSAGE,
      tone: "polite",
      signedOut: false,
    });
    const focus: NoticeOverlay = { attempt: 0, kind: "signed_out_on_focus", href: "/logg-inn" };
    expect(resolveNotice(initial, focus)).toEqual({
      message: SIGNED_OUT_ON_FOCUS_MESSAGE,
      tone: "alert",
      signedOut: true,
      link: { href: "/logg-inn", text: SIGN_IN_LINK_TEXT },
    });
  });
});

describe("lytting på online", () => {
  it("lytter bare mens meldingen om manglende nett vises", () => {
    const offline = { message: OFFLINE_MESSAGE, tone: "alert", signedOut: false } as const;
    const back = { message: BACK_ONLINE_MESSAGE, tone: "polite", signedOut: false } as const;
    expect(waitsForNetwork(offline)).toBe(true);
    expect(waitsForNetwork(back)).toBe(false);
    expect(waitsForNetwork(null)).toBe(false);
  });

  it("kaller tilbake ved online, og ikke etter at lytteren er fjernet", () => {
    const target = new EventTarget();
    const onOnline = vi.fn();
    const stop = listenForOnline(target, onOnline);
    target.dispatchEvent(new Event("online"));
    expect(onOnline).toHaveBeenCalledTimes(1);
    stop();
    target.dispatchEvent(new Event("online"));
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it("kaller aldri handlingen av seg selv når nettet er tilbake", async () => {
    const { spy, guarded, setOnline } = setup(async () => initial);
    setOnline(false);
    const state = await guarded(initial, formData(values));
    const target = new EventTarget();
    let overlay: NoticeOverlay | null = null;
    listenForOnline(target, () => {
      overlay = { attempt: state.attempt, kind: "back_online" };
    });
    setOnline(true);
    target.dispatchEvent(new Event("online"));
    expect(resolveNotice(state, overlay)?.message).toBe(BACK_ONLINE_MESSAGE);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("kildefilene i src/shared/forms", () => {
  const dir = join(process.cwd(), "src/shared/forms");
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({ file, text: readFileSync(join(dir, file), "utf8") }));

  it("finnes", () => {
    expect(sources.map((source) => source.file)).toEqual(
      expect.arrayContaining(["guarded-form-action.ts", "login-link.ts", "messages.ts"]),
    );
  });

  it.each(["localStorage", "sessionStorage", "indexedDB", "console."])("bruker ikke %s", (word) => {
    for (const source of sources) expect(source.text, source.file).not.toContain(word);
  });

  it("importerer ikke fra kjernen eller sidene", () => {
    for (const source of sources) {
      expect(source.text, source.file).not.toMatch(/from\s+["']@\/(core|app)\//);
    }
  });
});
