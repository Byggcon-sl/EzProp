import { describe, expect, it } from "vitest";
import { brand } from "@/shared/config/brand";
import manifest from "./manifest";

describe("manifest", () => {
  it("gjør appen klar for hjemskjermen med navn, startside, farge og ikon", () => {
    const m = manifest();
    expect(m.name).toBe(brand.productName);
    expect(m.short_name).toBe(brand.productName);
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/arbeidskoe");
    expect(m.lang).toBe("nb");
    expect(m.theme_color).toBe(brand.color);
    expect(m.background_color).toBe(brand.color);
    expect(m.icons?.[0]?.src).toContain("/apple-icon");
    expect(m.description).not.toContain(brand.productName);
  });
});
