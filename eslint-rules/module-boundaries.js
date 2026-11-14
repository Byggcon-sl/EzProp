// @ts-check
import path from "node:path";

/**
 * Håndhever arkitekturreglene for importer (docs/06-arkitektur.md):
 * - En modul (src/modules/<navn>) importerer bare fra core, shared, db og egen mappe.
 * - Kjernen (src/core) importerer aldri fra moduler eller app.
 * - Felles kode (src/shared) importerer aldri fra core, moduler eller app.
 * - Klientdelen av KI-modulen (src/core/ai/client, KI-køen) er et rent blad, og bare prøvesiden
 *   /prove/ki og utloggingsknappen kan importere den (docs/adr/0006-ki-i-bunnen.md del 10).
 * - Regelmotoren (src/core/rules) er et rent blad som kjører likt på iPaden og på serveren: bare
 *   egen mappe og shared, og bare `import type` fra malmotoren og databaseskjemaet. Ingen pakker.
 *   Malmotoren (src/core/templates) importerer ikke regelmotoren (docs/adr/0009-regelmotoren.md).
 * - De rene funksjonene for rapporten (src/core/reports/logic) er et rent blad som kjører likt i
 *   nettleseren og på serveren: bare egen mappe, shared og regelmotoren, og bare `import type` fra
 *   resten av src/core/reports, malmotoren og databaseskjemaet. Ingen pakker
 *   (docs/adr/0013-rapportens-datamodell.md).
 */

const RULES = "core/rules";
/** Bare `import type` herfra: malmotoren og skjemaet drar med databasen. */
const RULES_TYPE_ONLY_TARGETS = ["core/templates", "db/schema"];
const TEMPLATES = "core/templates";

const REPORTS_LOGIC = "core/reports/logic";
/** Bare `import type` herfra: resten av rapportkjernen, malmotoren og skjemaet drar med databasen. */
const REPORTS_LOGIC_TYPE_ONLY_TARGETS = ["core/reports", "core/templates", "db/schema"];

/** @param {string} target @param {string} dir */
function isInDir(target, dir) {
  return target === dir || target.startsWith(`${dir}/`);
}

const AI_CLIENT = "core/ai/client";
/** Verdi-importer klientdelen kan ha utenom egen mappe og `shared`. */
const AI_CLIENT_VALUE_TARGETS = ["core/ai/limits"];
/** Bare `import type` herfra: filene har ledetekster og databasetyper som ikke skal i nettleseren. */
const AI_CLIENT_TYPE_ONLY_TARGETS = ["core/ai/types", "core/ai/features"];
const AI_CLIENT_PACKAGES = ["zod"];
/**
 * Hvem som kan importere KI-køen. Køen holder fritekst ukryptert på enheten, så den brukes ikke
 * i ekte skjermer før «Sperring av iPader» er levert (fase 2b). Da fjernes denne listen.
 */
const AI_CLIENT_IMPORTERS = ["app/(ansatt)/prove/ki/", "app/(ansatt)/log-out-button.tsx"];

/** @param {string} target */
function isAiClient(target) {
  return target === AI_CLIENT || target.startsWith(`${AI_CLIENT}/`);
}

/** @param {string} target @param {string[]} files */
function isOneOf(target, files) {
  return files.some((file) => target === file || target === `${file}.ts`);
}

/** @param {string} filename */
function srcRelative(filename) {
  const normalized = filename.split(path.sep).join("/");
  const index = normalized.lastIndexOf("/src/");
  return index === -1 ? null : normalized.slice(index + "/src/".length);
}

/**
 * Finner hvilken del av src/ en import peker på, f.eks. "modules/energy/x" eller "core/access".
 * @param {string} source
 * @param {string} fromFile path relativt til src/
 */
function resolveTarget(source, fromFile) {
  if (source.startsWith("@/")) return source.slice(2);
  if (source.startsWith(".")) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source));
    return resolved.startsWith("..") ? null : resolved;
  }
  return null;
}

/** @param {string} p */
function layerOf(p) {
  const [layer, name] = p.split("/");
  return { layer, name };
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Moduler importerer ikke hverandre, og kjernen importerer ikke moduler" },
    schema: [],
    messages: {
      moduleToModule:
        "Modulen «{{from}}» kan ikke importere fra modulen «{{to}}». Samhandling går via kjernen (tiltaksforslag).",
      forbiddenLayer: "«{{from}}» kan ikke importere fra «{{to}}» (se docs/06-arkitektur.md).",
      aiClientLeaf:
        "Klientdelen av KI-modulen kan ikke importere «{{to}}». Lov: egen mappe, ../limits, @/shared og zod, og bare «import type» fra ../types og ../features (ADR 0006 del 10).",
      rulesLeaf:
        "Regelmotoren kan ikke importere «{{to}}». Lov: egen mappe og @/shared, og bare «import type» fra @/core/templates og @/db/schema. Ingen pakker (ADR 0009).",
      reportsLogicLeaf:
        "De rene funksjonene for rapporten kan ikke importere «{{to}}». Lov: egen mappe, @/shared og @/core/rules, og bare «import type» fra @/core/reports, @/core/templates og @/db/schema. Ingen pakker (ADR 0013).",
      templatesToRules:
        "Malmotoren (@/core/templates) kan ikke importere regelmotoren (@/core/rules) (ADR 0009).",
      aiClientImporter:
        "KI-køen (@/core/ai/client) kan bare importeres fra prøvesiden /prove/ki og utloggingsknappen til «Sperring av iPader» er levert (ADR 0006 del 10).",
    },
  },
  create(context) {
    const fromFile = srcRelative(context.filename);
    // Seed-skriptene setter opp data på tvers av lagene og er unntatt.
    if (!fromFile || fromFile.startsWith("db/seed/")) return {};
    const from = layerOf(fromFile);
    // Testfiler er ikke produktkode og er unntatt fra de to reglene for KI-køen.
    const isTestFile = /\.test\.tsx?$/.test(fromFile);
    const fromAiClient = isAiClient(fromFile) && !isTestFile;
    const fromRules = isInDir(fromFile, RULES) && !isTestFile;
    const fromTemplates = isInDir(fromFile, TEMPLATES) && !isTestFile;
    const fromReportsLogic = isInDir(fromFile, REPORTS_LOGIC) && !isTestFile;

    /** @type {Record<string, string[]>} */
    const forbidden = {
      core: ["modules", "app"],
      shared: ["core", "modules", "app", "db"],
      db: ["core", "modules", "app"],
      modules: ["app"],
    };

    /**
     * @param {any} node AST-noden for importstien
     * @param {unknown} value
     * @param {boolean} [typeOnly] `import type` eller `export type`, som forsvinner ved bygging
     */
    function check(node, value, typeOnly = false) {
      if (typeof value !== "string") return;
      const target = resolveTarget(value, fromFile ?? "");

      if (fromAiClient) {
        const allowed = target
          ? isAiClient(target) ||
            target.startsWith("shared/") ||
            isOneOf(target, AI_CLIENT_VALUE_TARGETS) ||
            (typeOnly && isOneOf(target, AI_CLIENT_TYPE_ONLY_TARGETS))
          : AI_CLIENT_PACKAGES.includes(value);
        if (!allowed) {
          context.report({ node, messageId: "aiClientLeaf", data: { to: value } });
          return;
        }
      }

      if (fromRules) {
        const allowed = target
          ? isInDir(target, RULES) ||
            target.startsWith("shared/") ||
            (typeOnly && RULES_TYPE_ONLY_TARGETS.some((dir) => isInDir(target, dir)))
          : false;
        if (!allowed) {
          context.report({ node, messageId: "rulesLeaf", data: { to: value } });
          return;
        }
      }

      if (fromReportsLogic) {
        const allowed = target
          ? isInDir(target, REPORTS_LOGIC) ||
            target.startsWith("shared/") ||
            isInDir(target, RULES) ||
            (typeOnly && REPORTS_LOGIC_TYPE_ONLY_TARGETS.some((dir) => isInDir(target, dir)))
          : false;
        if (!allowed) {
          context.report({ node, messageId: "reportsLogicLeaf", data: { to: value } });
          return;
        }
      }

      if (!target) return;
      const to = layerOf(target);

      if (fromTemplates && isInDir(target, RULES)) {
        context.report({ node, messageId: "templatesToRules" });
        return;
      }

      if (
        isAiClient(target) &&
        !isAiClient(fromFile ?? "") &&
        !isTestFile &&
        !AI_CLIENT_IMPORTERS.some((importer) => (fromFile ?? "").startsWith(importer))
      ) {
        context.report({ node, messageId: "aiClientImporter" });
        return;
      }

      if (from.layer === "modules" && to.layer === "modules" && to.name && to.name !== from.name) {
        // registry.ts er modulregisteret og får kjenne alle moduler.
        if (from.name !== "registry.ts") {
          context.report({
            node,
            messageId: "moduleToModule",
            data: { from: from.name ?? "", to: to.name },
          });
        }
        return;
      }
      if (to.layer && forbidden[from.layer ?? ""]?.includes(to.layer)) {
        context.report({
          node,
          messageId: "forbiddenLayer",
          data: { from: from.layer ?? "", to: to.layer },
        });
      }
    }

    return {
      ImportDeclaration: (node) =>
        check(node.source, node.source.value, /** @type {any} */ (node).importKind === "type"),
      ExportNamedDeclaration: (node) =>
        node.source &&
        check(node.source, node.source.value, /** @type {any} */ (node).exportKind === "type"),
      ExportAllDeclaration: (node) =>
        check(node.source, node.source.value, /** @type {any} */ (node).exportKind === "type"),
      ImportExpression: (node) =>
        node.source.type === "Literal" && check(node.source, node.source.value),
    };
  },
};

const plugin = {
  meta: { name: "ezprop" },
  rules: { "module-boundaries": rule },
};

export default plugin;
