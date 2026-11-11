import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
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
