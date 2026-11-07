import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // All user text renders as React text nodes; raw HTML injection is forbidden (design 6.4).
      "react/no-danger": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "supabase/.temp/**",
    ".agents/**",
    "next-env.d.ts",
    "src/server/db/types.ts",
  ]),
]);

export default eslintConfig;
