import { describe, expect, it } from "vitest";
import { localColumnsOf } from "@/modules/offline-trial/sync/local-columns";
import { block, contentLines, envExampleValue, indentOf, read } from "../compose-text";

// Konfigurasjonen for den selvdrevne PowerSync-tjenesten (docs/funksjoner/fase1-kandidat-powersync.md
// pkt. 13). Testplan avsnitt 2.9. Tekst-hjelperne ligger i tests/compose-text.ts (delt med
// tests/electricsql/config.test.ts).

/** Hver SQL-setning fra én SELECT fram til neste (synkreglene har én setning per linje eller blokk). */
function selectStatements(text: string): string[] {
  const body = contentLines(text).join("\n");
  return body
    .split(/(?=\bSELECT\b)/i)
    .filter((part) => /^SELECT\b/i.test(part))
    .map((part) => part.trim());
}

describe("PowerSync-konfigurasjon", () => {
  it("config.yaml slår av telemetri og leser hemmeligheter fra miljøet", () => {
    const config = read("powersync/config.yaml");

    expect(block(config, "telemetry")).toMatch(/disable_telemetry_sharing:\s*true\b/);

    const clientAuth = block(config, "client_auth");
    const audience = block(clientAuth, "audience", 1);
    expect(audience).toMatch(/\bpowersync\b/);

    // Nøkkelen (k) og tilkoblingen til databasen kommer fra miljøet, aldri som verdi i filen
    expect(clientAuth).toMatch(/\bk:\s*!env\s+\w+/);
    expect(config).toMatch(/\b(uri|url|connection|connection_string):\s*!env\s+\w+/);
    expect(clientAuth).toMatch(/\balg:\s*["']?HS256\b/);

    const devSecret = envExampleValue("POWERSYNC_JWT_SECRET");
    expect(devSecret, "POWERSYNC_JWT_SECRET mangler i .env.example").toBeTruthy();
    for (const line of config.split("\n")) {
      expect(line.includes(devSecret!), "utviklingshemmeligheten står i config.yaml").toBe(false);
      expect(line, "tilkoblingsstreng med passord i config.yaml").not.toMatch(
        /postgres(ql)?:\/\/\w+:\w+@/,
      );
    }
  });

  it("sync-rules.yaml filtrerer alle tre tabellene på organization_id og deleted_at", () => {
    const rules = read("powersync/sync-rules.yaml");
    const definitions = block(rules, "bucket_definitions");
    const defLines = definitions.split("\n").slice(1);
    const bucketIndent = Math.min(...defLines.map(indentOf));
    const buckets = defLines.filter((line) => indentOf(line) === bucketIndent);
    expect(buckets, "nøyaktig én bøtte").toHaveLength(1);

    expect(definitions).toMatch(
      /SELECT\s+request\.jwt\(\)\s*->>\s*'organization_id'\s+AS\s+organization_id/i,
    );

    // Datasetningene: én per tabell, ingen fjerde tabell
    const dataSelects = selectStatements(definitions).filter((s) => !/request\.jwt\(\)/i.test(s));
    const tables = dataSelects.map((s) => /\bFROM\s+"?(\w+)"?/i.exec(s)?.[1]).sort();
    expect(tables).toEqual(["trial_answers", "trial_forms", "trial_photos"]);
    for (const statement of dataSelects) {
      expect(statement).toMatch(/organization_id\s*=\s*bucket\.organization_id/i);
      expect(statement).toMatch(/deleted_at\s+IS\s+NULL/i);
    }
  });

  // Tillegg til testplanen: pkt. 3 og «Data» i kortet sier at storage_path aldri synkes til enheten.
  it("sync-rules.yaml sender ikke storage_path til enheten", () => {
    const rules = read("powersync/sync-rules.yaml");
    const photoSelect = selectStatements(rules).find((s) => /\bFROM\s+"?trial_photos\b/i.test(s));
    expect(photoSelect).toBeDefined();
    const columns = /^SELECT\b([\s\S]*?)\bFROM\b/i.exec(photoSelect!)![1]!;
    expect(columns, "SELECT * tar med storage_path").not.toMatch(/(^|[\s,])\*([\s,]|$)/);
    expect(columns).not.toMatch(/storage_path/);
  });

  // Småfunn 13: eksplisitt kolonneliste, samme kolonner som de andre kandidatene sender.
  it("sync-rules.yaml sender bare localColumnsOf for alle tre tabellene", () => {
    const rules = read("powersync/sync-rules.yaml");
    for (const table of ["trial_forms", "trial_answers", "trial_photos"] as const) {
      const statement = selectStatements(rules).find((s) =>
        new RegExp(`\\bFROM\\s+"?${table}\\b`, "i").test(s),
      );
      expect(statement, table).toBeDefined();
      const columns = /^SELECT\b([\s\S]*?)\bFROM\b/i
        .exec(statement!)![1]!
        .split(",")
        .map((column) => column.trim());
      expect(columns, table).not.toContain("*");
      expect(columns, table).toEqual([...localColumnsOf(table)]);
      for (const audit of ["created_by", "updated_by", "deleted_by"]) {
        expect(columns, `${table}.${audit}`).not.toContain(audit);
      }
    }
  });

  it("docker-compose binder PowerSync bare til 127.0.0.1 og bruker fast versjonstag", () => {
    const compose = read("docker-compose.yml");
    const services = block(compose, "services");
    const powersync = block(services, "powersync", 1);
    const db = block(services, "db", 1);

    const ports = block(powersync, "ports", 3)
      .split("\n")
      .slice(1)
      .map((line) => line.trim().replace(/^-\s*/, "").replace(/["']/g, ""));
    expect(ports.length).toBeGreaterThan(0);
    expect(ports[0]).toMatch(/^127\.0\.0\.1:/);
    for (const port of ports) expect(port).toMatch(/^127\.0\.0\.1:/);

    const image = /^\s*image:\s*["']?([^\s"']+)/m.exec(powersync)?.[1];
    expect(image, "image mangler").toBeTruthy();
    expect(image).toMatch(/:[\w.-]+$/);
    expect(image).not.toMatch(/:latest$/);

    const dependsOn = block(powersync, "depends_on", 3);
    expect(block(dependsOn, "db", 4)).toMatch(/condition:\s*service_healthy/);

    const volumes = block(powersync, "volumes", 3);
    const configMount = volumes.split("\n").find((line) => line.includes("config.yaml"));
    const rulesMount = volumes.split("\n").find((line) => line.includes("sync-rules.yaml"));
    expect(configMount, "config.yaml er ikke montert").toBeTruthy();
    expect(rulesMount, "sync-rules.yaml er ikke montert").toBeTruthy();
    expect(configMount!.replace(/["']/g, "").trim()).toMatch(/:ro$/);
    expect(rulesMount!.replace(/["']/g, "").trim()).toMatch(/:ro$/);

    expect(block(db, "command", 3)).toMatch(/wal_level=logical/);
  });
});
