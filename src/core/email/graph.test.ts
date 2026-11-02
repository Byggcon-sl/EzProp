import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createLogger } from "@/shared/lib/logger";
import { fakeFetch, type FakeFetchCall } from "../../../tests/fake-fetch";
import { createGraphEmailSender, EmailSendError } from "./index";

/*
 * Graph-adapteren, testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 6. Støtter
 * hovedmål: tid (alle ansatte kan logge inn med kode på e-post) og reklamasjoner (hemmeligheten
 * står bare i token-kroppen, og feilmeldingene har aldri svar, mottaker eller hemmelighet).
 * Bare falsk `fetchFn`; `globalThis.fetch` skal aldri kalles. Alle verdier er oppdiktet.
 */

const SECRET = "hemmelig-test-verdi";
const CONFIG = {
  tenantId: "t-oppdiktet",
  clientId: "c-oppdiktet",
  clientSecret: SECRET,
  from: "noreply@example.com",
};
const EMAIL = { to: "a@example.com", subject: "Emne", text: "Hei" };
const MS_ERROR_BODY = '{"error":"invalid_client","error_description":"AADSTS7000215 oppdiktet"}';

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Ingen nett i tester"));
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** Meldingen i feilen har verken svaret fra Microsoft, e-posten eller hemmeligheten. */
function expectCleanMessage(error: unknown) {
  const message = (error as Error).message;
  for (const text of [
    MS_ERROR_BODY,
    "invalid_client",
    "AADSTS7000215",
    "a@example.com",
    "Emne",
    "Hei",
    SECRET,
  ]) {
    expect(message).not.toContain(text);
    expect(String(error)).not.toContain(text);
  }
}

function tokenCall(call: FakeFetchCall | undefined) {
  expect(call?.kind).toBe("token");
  return call!;
}

describe("Graph-adapteren", () => {
  it("1. sender riktig: token med klientlegitimasjon, så sendMail fra postboksen", async () => {
    const { fetchFn, calls } = fakeFetch();
    await createGraphEmailSender(CONFIG, fetchFn).send(EMAIL);

    expect(calls).toHaveLength(2);
    const [token, send] = calls;
    expect(token!.method).toBe("POST");
    expect(token!.url).toBe("https://login.microsoftonline.com/t-oppdiktet/oauth2/v2.0/token");
    expect(token!.headers["content-type"]).toContain("application/x-www-form-urlencoded");
    expect(token!.body).toContain("grant_type=client_credentials");
    expect(token!.body).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");
    expect(token!.body).toContain("client_id=c-oppdiktet");
    expect(token!.body).toContain(`client_secret=${SECRET}`);

    expect(send!.method).toBe("POST");
    expect(send!.url).toBe("https://graph.microsoft.com/v1.0/users/noreply%40example.com/sendMail");
    expect(send!.headers.authorization).toBe("Bearer tok-1");
    expect(send!.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(send!.body)).toEqual({
      message: {
        subject: "Emne",
        body: { contentType: "Text", content: "Hei" },
        toRecipients: [{ emailAddress: { address: "a@example.com" } }],
      },
      saveToSentItems: false,
    });
  });

  it("2. hemmeligheten står bare i kroppen til token-kallet", async () => {
    const { fetchFn, calls } = fakeFetch();
    await createGraphEmailSender(CONFIG, fetchFn).send(EMAIL);

    const [token, send] = calls;
    expect(
      JSON.stringify({ url: send!.url, headers: send!.headers, body: send!.body }),
    ).not.toContain(SECRET);
    expect(JSON.stringify({ url: token!.url, headers: token!.headers })).not.toContain(SECRET);
  });

  it("3. ett token-kall per sending (ingen mellomlager)", async () => {
    const { fetchFn, calls } = fakeFetch();
    const sender = createGraphEmailSender(CONFIG, fetchFn);
    await sender.send(EMAIL);
    await sender.send({ ...EMAIL, to: "b@example.com" });
    expect(calls.map((call) => call.kind)).toEqual(["token", "send", "token", "send"]);
  });

  it("4. tenantId legges i token-adressen, både som domene og som GUID", async () => {
    const domain = fakeFetch();
    await createGraphEmailSender({ ...CONFIG, tenantId: "contoso.example" }, domain.fetchFn).send(
      EMAIL,
    );
    expect(tokenCall(domain.calls[0]).url).toContain("/contoso.example/oauth2/");

    const guid = "0f1e2d3c-0000-4000-8000-000000000000";
    const byGuid = fakeFetch();
    await createGraphEmailSender({ ...CONFIG, tenantId: guid }, byGuid.fetchFn).send(EMAIL);
    expect(tokenCall(byGuid.calls[0]).url).toBe(
      `https://login.microsoftonline.com/${guid}/oauth2/v2.0/token`,
    );
  });

  it("5. token-svar uten access_token gir EmailSendError (token), ingen sending", async () => {
    const { fetchFn, calls } = fakeFetch({ token: { status: 200, body: {} } });
    const error = await rejection(createGraphEmailSender(CONFIG, fetchFn).send(EMAIL));
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).step).toBe("token");
    expect(calls.map((call) => call.kind)).toEqual(["token"]);
  });

  it.each([400, 401, 500])(
    "6. feil %i fra token gir EmailSendError med steg og kode, uten svartekst",
    async (status) => {
      const { fetchFn, calls } = fakeFetch({ token: { status, body: MS_ERROR_BODY } });
      const error = await rejection(createGraphEmailSender(CONFIG, fetchFn).send(EMAIL));
      expect(error).toBeInstanceOf(EmailSendError);
      expect((error as EmailSendError).step).toBe("token");
      expect((error as EmailSendError).statusCode).toBe(status);
      expect(calls.map((call) => call.kind)).toEqual(["token"]);
      expectCleanMessage(error);
    },
  );

  it.each([403, 429, 500])(
    "7. feil %i fra sending gir EmailSendError med steg og kode, uten svartekst",
    async (status) => {
      const { fetchFn, calls } = fakeFetch({ send: { status, body: MS_ERROR_BODY } });
      const error = await rejection(createGraphEmailSender(CONFIG, fetchFn).send(EMAIL));
      expect(error).toBeInstanceOf(EmailSendError);
      expect((error as EmailSendError).step).toBe("send");
      expect((error as EmailSendError).statusCode).toBe(status);
      expect(calls.map((call) => call.kind)).toEqual(["token", "send"]);
      expectCleanMessage(error);
    },
  );

  it("8. fetchFn som kaster gir EmailSendError med statusCode null og uten cause", async () => {
    const onToken = fakeFetch({ token: new TypeError("fetch failed") });
    const tokenError = await rejection(createGraphEmailSender(CONFIG, onToken.fetchFn).send(EMAIL));
    expect(tokenError).toBeInstanceOf(EmailSendError);
    expect((tokenError as EmailSendError).step).toBe("token");
    expect((tokenError as EmailSendError).statusCode).toBeNull();
    expect((tokenError as Error).message).not.toContain("fetch failed");
    expect((tokenError as Error).cause).toBeUndefined();
    expectCleanMessage(tokenError);

    const onSend = fakeFetch({ send: new DOMException("avbrutt", "AbortError") });
    const sendError = await rejection(createGraphEmailSender(CONFIG, onSend.fetchFn).send(EMAIL));
    expect(sendError).toBeInstanceOf(EmailSendError);
    expect((sendError as EmailSendError).step).toBe("send");
    expect((sendError as EmailSendError).statusCode).toBeNull();
    expect((sendError as Error).message).not.toContain("fetch failed");
    expect((sendError as Error).cause).toBeUndefined();
    expectCleanMessage(sendError);
  });

  it("9. begge kallene har tidsavbrudd (AbortSignal)", async () => {
    const { fetchFn, calls } = fakeFetch();
    await createGraphEmailSender(CONFIG, fetchFn).send(EMAIL);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.signal, call.kind).toBeInstanceOf(AbortSignal);
    }
  });

  it("10. provider er microsoft365", () => {
    const { fetchFn, calls } = fakeFetch();
    expect(createGraphEmailSender(CONFIG, fetchFn).provider).toBe("microsoft365");
    expect(calls).toHaveLength(0);
  });

  it("11. loggeren skriver feilen som vanlig Error, uten svartekst og hemmelighet", async () => {
    const { fetchFn } = fakeFetch({ token: { status: 401, body: MS_ERROR_BODY } });
    const error = await rejection(createGraphEmailSender(CONFIG, fetchFn).send(EMAIL));
    expect(error).toBeInstanceOf(EmailSendError);

    const lines: string[] = [];
    createLogger((_level, line) => lines.push(line)).error("x", { error });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(typeof parsed.error.message).toBe("string");
    expect(parsed.error.message.length).toBeGreaterThan(0);
    for (const text of [MS_ERROR_BODY, "AADSTS7000215", SECRET]) {
      expect(lines[0]).not.toContain(text);
    }
  });

  it.each([
    ["tenantId med skråstrek", { tenantId: "t/oppdiktet" }],
    ["tom tenantId", { tenantId: "" }],
    ["tenantId på 65 tegn", { tenantId: "t".repeat(65) }],
    ["from som ikke er en adresse", { from: "ikke-en-adresse" }],
  ])("12. ugyldig oppsett avvises når senderen lages: %s", (_name, override) => {
    const { fetchFn, calls } = fakeFetch();
    let error: unknown;
    try {
      createGraphEmailSender({ ...CONFIG, ...override }, fetchFn);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(SECRET);
    expect((error as Error).message).not.toContain(SECRET);
    expect(calls).toHaveLength(0);
  });
});
