import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "./module-boundaries.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const rule = plugin.rules["module-boundaries"];

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
