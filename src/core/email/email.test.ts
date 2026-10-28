import { describe, expect, it } from "vitest";
import { emailTransport, readDevMailbox, sendEmail } from "./index";

describe("e-post", () => {
  it("bruker utviklings-postkassen i test, og viser nyeste først", async () => {
    expect(emailTransport()).toBe("devMailbox");
    await sendEmail({ to: "a@example.com", subject: "Første", text: "x" });
    await sendEmail({ to: "b@example.com", subject: "Andre", text: "y" });
    const [latest] = readDevMailbox();
    expect(latest).toMatchObject({ to: "b@example.com", subject: "Andre" });
  });

  it("velger tjeneste ut fra innstillingene", () => {
    const base = { DEV_MAILBOX: false } as Parameters<typeof emailTransport>[0];
    expect(emailTransport(base!)).toBe("none");
    expect(
      emailTransport({
        ...base!,
        MS_GRAPH_TENANT_ID: "t",
        MS_GRAPH_CLIENT_ID: "c",
        MS_GRAPH_CLIENT_SECRET: "s",
        MAIL_FROM: "noreply@example.com",
      }),
    ).toBe("graph");
  });
});
