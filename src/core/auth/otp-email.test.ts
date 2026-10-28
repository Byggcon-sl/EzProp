import { describe, expect, it } from "vitest";
import { brand } from "@/shared/config/brand";
import { otpEmail } from "./otp-email";

describe("e-post med engangskode", () => {
  it("e-posten med engangskode har koden i tekst og logLine, men ikke adressen i logLine", () => {
    const email = otpEmail("Bruker@Example.com", "123456");
    expect(email.to).toBe("Bruker@Example.com");
    expect(email.text).toContain("123456");
    expect(email.logLine).toContain("123456");
    expect(email.logLine).toContain("10 minutter");
    expect(email.logLine).not.toContain("@");
    expect(email.subject).toContain(brand.productName);
  });
});
