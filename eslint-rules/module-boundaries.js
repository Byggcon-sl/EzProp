// @ts-check
import path from "node:path";

/**
 * Håndhever arkitekturreglene for importer (docs/06-arkitektur.md):
 * - En modul (src/modules/<navn>) importerer bare fra core, shared, db og egen mappe.
 * - Kjernen (src/core) importerer aldri fra moduler eller app.
 * - Felles kode (src/shared) importerer aldri fra core, moduler eller app.
 */

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
    },
  },
  create(context) {
    const fromFile = srcRelative(context.filename);
    // Seed-skriptene setter opp data på tvers av lagene og er unntatt.
    if (!fromFile || fromFile.startsWith("db/seed/")) return {};
    const from = layerOf(fromFile);

    /** @type {Record<string, string[]>} */
    const forbidden = {
      core: ["modules", "app"],
      shared: ["core", "modules", "app", "db"],
      db: ["core", "modules", "app"],
      modules: ["app"],
    };

    /** @param {any} node AST-noden for importstien @param {unknown} value */
    function check(node, value) {
      if (typeof value !== "string") return;
      const target = resolveTarget(value, fromFile ?? "");
      if (!target) return;
      const to = layerOf(target);

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
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
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
