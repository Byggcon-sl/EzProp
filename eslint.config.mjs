import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import ezprop from "./eslint-rules/module-boundaries.js";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "src/db/migrations/**",
      // Designskissene fra researchen er ikke kode
      "docs/**",
      // Midlertidige arbeidskopier (git worktrees) og arbeidsflytskript for agenter
      ".claude/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  prettier,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { ezprop },
    rules: {
      "ezprop/module-boundaries": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Produktnavnet står bare ett sted (CLAUDE.md regel 10)
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/EzProp/]",
          message: "Produktnavnet hentes fra src/shared/config/brand.ts.",
        },
        {
          selector: "TemplateElement[value.raw=/EzProp/]",
          message: "Produktnavnet hentes fra src/shared/config/brand.ts.",
        },
      ],
    },
  },
  {
    files: ["src/shared/config/brand.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
];

export default config;
