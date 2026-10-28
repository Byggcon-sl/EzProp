import { describe, expect, it, vi } from "vitest";
import { createServerLogSender } from "./server-log";

const logLine = "Engangskode til første admin: 123456 (gyldig i 10 minutter)";

describe("serverlogg i stedet for e-post", () => {
  it("skriver én linje med egen skriver", async () => {
    const write = vi.fn();
    await createServerLogSender(
      "admin@example.com",
      write,
    )({ to: "admin@example.com", subject: "Emne", text: "x", logLine });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      `[innlogging] ${logLine}. E-post er ikke satt opp ennå; se docs/drift/testmiljo-azure.md`,
    );
  });

  it("feilmeldingen avslører ikke hvem første admin er", async () => {
    const write = vi.fn();
    const send = createServerLogSender("admin@example.com", write);
    const error = await send({ to: "annen@example.com", subject: "Emne", text: "x", logLine }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain("admin@example.com");
    expect(message).not.toContain("@");
    expect(write).not.toHaveBeenCalled();
  });
});
