import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import plugin from "./module-boundaries.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const rule = plugin.rules["module-boundaries"];

// `import type` trenger TypeScript-tolkeren (samme som lint bruker på src/).
const tsRuleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: "module" },
});
const AI_CLIENT_FILE = "/repo/src/core/ai/client/queue.ts";

ruleTester.run("module-boundaries", rule, {
  valid: [
    { filename: "/repo/src/modules/energy/actions.ts", code: 'import { x } from "@/core/access";' },
    {
      filename: "/repo/src/modules/energy/actions.ts",
      code: 'import { x } from "@/shared/lib/cn";',
    },
    {
      filename: "/repo/src/modules/energy/actions.ts",
      code: 'import { x } from "@/modules/energy/queries";',
    },
    { filename: "/repo/src/modules/energy/actions.ts", code: 'import { x } from "./queries";' },
    { filename: "/repo/src/modules/energy/pdf/report.ts", code: 'import { x } from "../schema";' },
    { filename: "/repo/src/modules/registry.ts", code: 'import { x } from "./energy";' },
    { filename: "/repo/src/app/page.tsx", code: 'import { x } from "@/modules/energy";' },
    { filename: "/repo/src/core/access/guards.ts", code: 'import { db } from "@/db/client";' },
    { filename: "/repo/src/core/access/guards.ts", code: 'import { z } from "zod";' },
    { filename: "/repo/src/db/seed/index.ts", code: 'import { x } from "@/core/access";' },
  ],
  invalid: [
    {
      filename: "/repo/src/db/schema/index.ts",
      code: 'import { x } from "@/core/access";',
      errors: [{ messageId: "forbiddenLayer" }],
    },
    {
      filename: "/repo/src/modules/energy/actions.ts",
      code: 'import { x } from "@/modules/maintenance";',
      errors: [{ messageId: "moduleToModule" }],
    },
    {
      filename: "/repo/src/modules/energy/actions.ts",
      code: 'import { x } from "../maintenance/queries";',
      errors: [{ messageId: "moduleToModule" }],
    },
    {
      filename: "/repo/src/modules/condition/index.ts",
      code: 'export * from "@/modules/energy/schema";',
      errors: [{ messageId: "moduleToModule" }],
    },
    {
      filename: "/repo/src/modules/condition/actions.ts",
      code: 'const m = import("@/modules/energy");',
      errors: [{ messageId: "moduleToModule" }],
    },
    {
      filename: "/repo/src/core/organizations/actions.ts",
      code: 'import { x } from "@/modules/maintenance";',
      errors: [{ messageId: "forbiddenLayer" }],
    },
    {
      filename: "/repo/src/core/access/guards.ts",
      code: 'import { x } from "../../modules/energy";',
      errors: [{ messageId: "forbiddenLayer" }],
    },
    {
      filename: "/repo/src/shared/ui/button.tsx",
      code: 'import { x } from "@/core/access";',
      errors: [{ messageId: "forbiddenLayer" }],
    },
    {
      filename: "/repo/src/modules/energy/actions.ts",
      code: 'import { x } from "@/app/page";',
      errors: [{ messageId: "forbiddenLayer" }],
    },
  ],
});

/*
 * KI-køen (docs/adr/0006-ki-i-bunnen.md del 10, docs/funksjoner/fase2a-ki-ko.md): klientdelen er
 * et rent blad, og bare prøvesiden /prove/ki og utloggingsknappen kan importere den.
 */
tsRuleTester.run("module-boundaries: src/core/ai/client", rule, {
  valid: [
    { filename: AI_CLIENT_FILE, code: 'import { x } from "./types";' },
    { filename: AI_CLIENT_FILE, code: 'import { AI_FIELD_MAX_LENGTH } from "../limits";' },
    { filename: AI_CLIENT_FILE, code: 'import { AI_FIELD_MAX_LENGTH } from "@/core/ai/limits";' },
    { filename: AI_CLIENT_FILE, code: 'import { isUuid } from "@/shared/lib/uuid";' },
    { filename: AI_CLIENT_FILE, code: 'import { z } from "zod";' },
    { filename: AI_CLIENT_FILE, code: 'import type { AiFeatureCode } from "../types";' },
    { filename: AI_CLIENT_FILE, code: 'import type { AiFeatureDefinition } from "../features";' },
    { filename: AI_CLIENT_FILE, code: 'export type { AiFeatureCode } from "../types";' },
    { filename: "/repo/src/core/ai/client/index.ts", code: 'export * from "./queue";' },
    // Testfiler er unntatt
    {
      filename: "/repo/src/core/ai/client/queue.test.ts",
      code: 'import { AI_FEATURES } from "../features"; import { it } from "vitest";',
    },
    {
      filename: "/repo/src/core/ai/static-checks.test.ts",
      code: 'import { AI_QUEUE_ALLOWED_FIELDS } from "./client";',
    },
    // De to som kan importere køen
    {
      filename: "/repo/src/app/(ansatt)/prove/ki/ai-trial-client.tsx",
      code: 'import { createAiQueue } from "@/core/ai/client";',
    },
    {
      filename: "/repo/src/app/(ansatt)/prove/ki/actions.ts",
      code: 'import type { AiQueueFailureReason } from "@/core/ai/client";',
    },
    {
      filename: "/repo/src/app/(ansatt)/log-out-button.tsx",
      code: 'const m = import("@/core/ai/client");',
    },
  ],
  invalid: [
    {
      filename: AI_CLIENT_FILE,
      code: 'import { AI_FEATURES } from "../features";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      // Innebygd `type` holder ikke: importen kan bli stående som sideeffekt
      filename: AI_CLIENT_FILE,
      code: 'import { type AiFeatureCode } from "../types";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { requestSuggestion } from "..";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { requestSuggestion } from "@/core/ai";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import type { AiProvider } from "../providers/types";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { AI_FIELD_MAX_LENGTH } from "../request";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { db } from "@/db/client";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import type { AiTargetRef } from "@/db/schema";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import "server-only";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { useState } from "react";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'const m = import("../features");',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'export * from "../features";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    // Kjernen eksporterer ikke klientdelen, og ekte skjermer bruker den ikke ennå
    {
      filename: "/repo/src/core/ai/index.ts",
      code: 'export * from "./client";',
      errors: [{ messageId: "aiClientImporter" }],
    },
    {
      filename: "/repo/src/core/ai/request.ts",
      code: 'import { AI_QUEUE_MAX_ENTRIES } from "./client/types";',
      errors: [{ messageId: "aiClientImporter" }],
    },
    {
      filename: "/repo/src/modules/condition/report-field.tsx",
      code: 'import { createAiQueue } from "@/core/ai/client";',
      errors: [{ messageId: "aiClientImporter" }],
    },
    {
      filename: "/repo/src/app/(ansatt)/oppdrag/page.tsx",
      code: 'import type { AiQueueEntry } from "@/core/ai/client";',
      errors: [{ messageId: "aiClientImporter" }],
    },
    {
      filename: "/repo/src/shared/ui/ai-suggestion-card.tsx",
      code: 'const m = import("@/core/ai/client/queue");',
      errors: [{ messageId: "aiClientImporter" }],
    },
  ],
});

/*
 * KI-køen, testplanen (docs/funksjoner/fase2a-ki-ko-testplan.md avsnitt 4, K4.1–K4.3). Utfyller
 * tabellen over med det som ikke står der.
 */
tsRuleTester.run("module-boundaries: KI-køen K4.1–K4.3", rule, {
  valid: [
    // K4.1
    { filename: AI_CLIENT_FILE, code: 'import { cn } from "@/shared/lib/cn";' },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { createMemoryAiQueueStore } from "./memory-store";',
    },
    { filename: AI_CLIENT_FILE, code: 'import type { AiFeatureCode } from "@/core/ai/types";' },
    // K4.3
    {
      filename: "/repo/src/app/(ansatt)/prove/ki/ai-trial-client.tsx",
      code: 'import { createAiQueue, createIndexedDbAiQueueStore } from "@/core/ai/client";',
    },
    {
      filename: "/repo/src/app/(ansatt)/log-out-button.tsx",
      code: 'async function f() { const { clearAiQueue } = await import("@/core/ai/client"); }',
    },
  ],
  invalid: [
    // K4.2
    {
      filename: AI_CLIENT_FILE,
      code: 'import { AI_FEATURES } from "../types";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { requestSuggestion } from "../request-suggestion";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { x } from "@/modules/condition/schema";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { requireOrganizationAccess } from "@/core/access";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    {
      filename: AI_CLIENT_FILE,
      code: 'import { openDB } from "idb";',
      errors: [{ messageId: "aiClientLeaf" }],
    },
    // K4.3
    {
      filename: "/repo/src/app/(ansatt)/oppdrag/[id]/rapport/page.tsx",
      code: 'import { createAiQueue } from "@/core/ai/client";',
      errors: [{ messageId: "aiClientImporter" }],
    },
    {
      filename: "/repo/src/app/(ansatt)/layout.tsx",
      code: 'const m = import("@/core/ai/client");',
      errors: [{ messageId: "aiClientImporter" }],
    },
    {
      filename: "/repo/src/modules/condition/actions.ts",
      code: 'import type { AiQueueEntry } from "@/core/ai/client";',
      errors: [{ messageId: "aiClientImporter" }],
    },
  ],
});

describe("K4.3 feilmeldingene viser til ADR 0006 del 10", () => {
  it("begge meldingene for KI-køen nevner ADR-en", () => {
    const messages = rule.meta?.messages ?? {};
    expect(messages.aiClientLeaf).toContain("ADR 0006 del 10");
    expect(messages.aiClientImporter).toContain("ADR 0006 del 10");
  });
});

const RULES_FILE = "/repo/src/core/rules/evaluate.ts";

tsRuleTester.run("module-boundaries: src/core/rules", rule, {
  valid: [
    { filename: RULES_FILE, code: 'import { x } from "./types";' },
    { filename: RULES_FILE, code: 'import { x } from "@/core/rules/codes";' },
    { filename: "/repo/src/core/rules/data/lifespans.ts", code: 'import { x } from "../codes";' },
    { filename: RULES_FILE, code: 'import { x } from "@/shared/lib/cn";' },
    { filename: RULES_FILE, code: 'import type { TemplateDocument } from "@/core/templates";' },
    { filename: RULES_FILE, code: 'import type { OutcomeKind } from "@/db/schema";' },
    { filename: RULES_FILE, code: 'import type { OutcomeKind } from "@/db/schema/templates";' },
    { filename: RULES_FILE, code: 'export type { TemplateKind } from "@/core/templates";' },
    // Testfiler er unntatt: de trenger vitest og badmalen.
    { filename: "/repo/src/core/rules/evaluate.test.ts", code: 'import { it } from "vitest";' },
    // Andre kan bruke regelmotoren.
    { filename: "/repo/src/core/assignments/x.ts", code: 'import { x } from "@/core/rules";' },
    { filename: "/repo/src/app/page.tsx", code: 'import { x } from "@/core/rules";' },
    {
      filename: "/repo/src/core/templates/templates.test.ts",
      code: 'import { x } from "@/core/rules";',
    },
  ],
  invalid: [
    ...[
      'import { rules } from "@/db/schema";',
      'import { db } from "@/db/client";',
      'import { parseTemplateDocument } from "@/core/templates";',
      'export { TEMPLATE_KINDS } from "@/db/schema";',
      'export * from "@/core/templates";',
      'import type { AiFeature } from "@/core/ai";',
      'import { x } from "@/core/ai";',
      'import { x } from "@/core/access";',
      'import "server-only";',
      'import { readFile } from "node:fs";',
      'import { z } from "zod";',
      'const m = import("@/db/schema");',
    ].map((code) => ({ filename: RULES_FILE, code, errors: [{ messageId: "rulesLeaf" }] })),
    {
      filename: "/repo/src/core/templates/document.ts",
      code: 'import { evaluateRules } from "@/core/rules";',
      errors: [{ messageId: "templatesToRules" }],
    },
    {
      filename: "/repo/src/core/templates/document.ts",
      code: 'import type { RuleResult } from "../rules/types";',
      errors: [{ messageId: "templatesToRules" }],
    },
  ],
});
