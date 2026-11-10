import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS_BY_PORT } from "@/core/integrations";
import { AI_FEATURES } from "./features";
import type { AiFeatureDefinition } from "./types";

/*
 * Testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md avsnitt 12 og kortet Omfang 5 og 9
 * (mønster fra src/core/integrations/static-checks.test.ts). Støtter hovedmål: KI i bunnen (én
 * vei inn, bare `fake` før S8), færre reklamasjoner (ingenting slettes, KI setter aldri TG) og de
 * ansatte (ingen tall per person, spørsmål 57).
 */

const repoRoot = join(__dirname, "..", "..", "..");
const srcDir = join(repoRoot, "src");
const aiDir = join(srcDir, "core", "ai");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const rel = (file: string) => relative(repoRoot, file).split(sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");
const productFiles = (dir: string) => sourceFiles(dir).filter((file) => !isTest(file));

/** Portene `ai` og `speech_to_text` som strengliteral, med enkle eller doble anførselstegn. */
const AI_PORT_LITERAL = /(["'])(ai|speech_to_text)\1/;

const PORT_ALLOWED_FILES = new Set([
  "src/core/integrations/ports.ts",
  "src/db/seed/sample-assignments.ts",
]);

/** Sperrelisten fra ADR 0006 del 6: felt som aldri kan stå på en tillatt-liste. */
const BLOCKED_FIELDS: Record<string, readonly string[]> = {
  contacts: ["first_name", "last_name", "email", "phone", "notes"],
  firms: ["name", "org_number", "notes"],
  assignment_parties: ["name", "firm_name", "email", "phone"],
  orders: [
    "address_text",
    "gnr",
    "bnr",
    "snr",
    "housing_association_name",
    "ordered_by_text",
    "external_ref",
    "rejected_reason",
  ],
  properties: ["address", "postal_code", "city"],
  cadastral_units: [
    "gnr",
    "bnr",
    "fnr",
    "snr",
    "share_number",
    "association_name",
    "association_org_number",
  ],
  common_areas: ["managing_agent", "notes"],
  claims: ["claimant_text", "description", "building_part_text"],
  employees: ["name"],
  users: ["name", "email"],
  assignments: ["internal_note"],
};

const toCamel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Alle former av sperrelisten: `tabell.kolonne`, kolonnen alene, og begge i camelCase. */
const BLOCKED_KEYS = new Set(
  Object.entries(BLOCKED_FIELDS).flatMap(([table, columns]) =>
    columns.flatMap((column) => [
      column,
      toCamel(column),
      `${table}.${column}`,
      `${toCamel(table)}.${toCamel(column)}`,
    ]),
  ),
);

const isTgField = (key: string) => {
  const lower = key.toLowerCase();
  return lower === "tg" || lower.startsWith("tg_") || lower.startsWith("tg.");
};

/** Brudd i en definisjon: TG-felt som mål eller på tillatt-listen, eller felt fra sperrelisten. */
function violations(definition: Pick<AiFeatureDefinition, "allowedFields" | "allowedTargets">) {
  const found: string[] = [];
  for (const target of definition.allowedTargets) {
    if (isTgField(target.fieldKey)) found.push(`mål ${target.type}.${target.fieldKey}`);
  }
  for (const field of definition.allowedFields) {
    if (isTgField(field)) found.push(`felt ${field}`);
    if (BLOCKED_KEYS.has(field)) found.push(`sperret felt ${field}`);
  }
  return found;
}

describe("KI-modulen, statiske kontroller", () => {
  it("1. src/core/ai har kildefiler (ellers sier testene under ingenting)", () => {
    expect(productFiles(aiDir).length).toBeGreaterThan(0);
  });

  it("2. portene ai og speech_to_text står bare i src/core/ai, ports.ts, seed og testfiler", () => {
    const offenders = productFiles(srcDir)
      .filter((file) => !rel(file).startsWith("src/core/ai/"))
      .filter((file) => !PORT_ALLOWED_FILES.has(rel(file)))
      .filter((file) => AI_PORT_LITERAL.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("3. mønsteret for portene er ikke hult", () => {
    expect(AI_PORT_LITERAL.test('findActiveConnection(orgId, "ai")')).toBe(true);
    expect(AI_PORT_LITERAL.test("findActiveConnection(orgId, 'ai')")).toBe(true);
    expect(AI_PORT_LITERAL.test('{ port: "speech_to_text" }')).toBe(true);
    expect(AI_PORT_LITERAL.test('"aim"')).toBe(false);
    expect(AI_PORT_LITERAL.test('"air"')).toBe(false);
    expect(AI_PORT_LITERAL.test("\"ai'")).toBe(false);
  });

  it("4. ingen sletting: ingen .delete( på aiUsageLog i src/", () => {
    for (const file of productFiles(srcDir)) {
      expect(read(file), rel(file)).not.toMatch(/\.delete\s*\(\s*aiUsageLog\b/);
    }
  });

  it("5. ingen console. og ingen process.env i src/core/ai", () => {
    const offenders = productFiles(aiDir)
      .filter((file) => /\bconsole\.|process\.env/.test(read(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("6. PROVIDERS_BY_PORT.ai er nøyaktig fake, og speech_to_text er tom (til S8)", () => {
    expect(PROVIDERS_BY_PORT.ai).toEqual(["fake"]);
    expect(PROVIDERS_BY_PORT.speech_to_text).toEqual([]);
  });

  it("7. index.ts eksporterer ingenting som lister eller teller rader per ansatt", async () => {
    const exported = Object.keys(await import("./index"));
    expect(exported.length).toBeGreaterThan(0);
    const offenders = exported.filter((name) =>
      /^(list|count)|ByEmployee$|Statistics$|PerEmployee$/i.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it("8. ingen SDK og ingen readSecret i src/core/ai (ingen ekte leverandør ennå)", () => {
    const offenders = productFiles(aiDir)
      .filter((file) => {
        const text = read(file);
        return (
          /\breadSecret\b/.test(text) ||
          /core\/integrations\/secrets/.test(text) ||
          /from\s+["'](openai|@anthropic-ai\/[^"']+|@azure\/openai|@google\/[^"']+|@mistralai\/[^"']+)["']/.test(
            text,
          ) ||
          /\bfetch\s*\(/.test(text)
        );
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("9. ingen funksjonsdefinisjon har TG-felt eller felt fra sperrelisten", () => {
    const definitions = Object.values(AI_FEATURES);
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(violations(definition), definition.code).toEqual([]);
    }
  });

  it("10. sjekken av definisjonene er ikke hul", () => {
    const bad = {
      allowedFields: ["text", "email", "tg_value", "contacts.phone", "internalNote"],
      allowedTargets: [{ type: "answer", fieldKey: "tg" }],
    };
    expect(violations(bad)).toEqual([
      "mål answer.tg",
      "sperret felt email",
      "felt tg_value",
      "sperret felt contacts.phone",
      "sperret felt internalNote",
    ]);
  });
});
